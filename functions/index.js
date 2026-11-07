// 突破重圍 Cloud Functions
// - api：學員 LINE 預約 App（LIFF）用：查自己的堂數、綁定、線上預約（扣 1 堂）、取消（退堂）
// - lineWebhook：官方帳號 Webhook（「通知綁定 密碼」→ 之後收新預約通知；「查堂數」）
// - onBookingCreated：網站有新預約 → LINE 通知教練／管理員
// 設定在 functions/.env（不進 git）：LINE_MSG_CHANNEL_ID、LINE_MSG_SECRET、LINE_LOGIN_CHANNEL_ID、NOTIFY_CODE
import { onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions, logger } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import crypto from 'node:crypto';

setGlobalOptions({ region: 'asia-east1', maxInstances: 5 });
initializeApp();
const db = getFirestore();

const SITE = 'https://tupo-chongwei.web.app';
const TZ_OFFSET = 8 * 60; // 台灣 UTC+8
const CANCEL_HOURS = 12;  // 上課前幾小時內不能線上取消
const DAY = ['日', '一', '二', '三', '四', '五', '六'];
const pad = n => String(n).padStart(2, '0');
const twNow = () => new Date(Date.now() + TZ_OFFSET * 60e3); // 用 UTC 欄位讀台灣時間
const twYmd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const slotMs = (date, time) => Date.parse(`${date}T${time}:00+08:00`);
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const md = s => { const d = new Date(`${s}T00:00:00Z`); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${DAY[d.getUTCDay()]}）`; };
const normPhone = p => String(p || '').replace(/[^0-9]/g, '');

/* ---------- LINE ---------- */
let msgToken = null, msgTokenExp = 0;
async function lineToken() {
  if (msgToken && Date.now() < msgTokenExp) return msgToken;
  const r = await fetch('https://api.line.me/v2/oauth/accessToken', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.LINE_MSG_CHANNEL_ID, client_secret: process.env.LINE_MSG_SECRET })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('LINE token failed');
  msgToken = j.access_token; msgTokenExp = Date.now() + (j.expires_in - 3600) * 1000;
  return msgToken;
}
async function linePost(path, body) {
  const r = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await lineToken()}` }, body: JSON.stringify(body)
  });
  if (!r.ok) logger.warn('LINE', path, r.status, await r.text());
}
const push = (to, messages) => to ? linePost('push', { to, messages }) : null;
const reply = (replyToken, messages) => linePost('reply', { replyToken, messages });
const text = t => ({ type: 'text', text: t });

async function notifyAdmins(msg) {
  const snap = await db.doc('notify/config').get();
  const ids = snap.exists ? snap.data().lineUserIds || [] : [];
  await Promise.all(ids.map(id => push(id, [text(msg)])));
}

// 給學員的卡片
function card(title, lines, color = '#d7262e') {
  return {
    type: 'flex', altText: `${title}｜${lines.join(' ')}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: { type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '14px', contents: [{ type: 'text', text: title, color: '#ffffff', weight: 'bold', size: 'md' }] },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: lines.map(l => ({ type: 'text', text: l, wrap: true, size: 'sm', color: '#333333' })) },
      footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '查看我的課', uri: `https://liff.line.me/${process.env.LIFF_MEMBER_ID || ''}` } }] }
    }
  };
}

/* ---------- 驗證 LIFF 的 ID token ---------- */
async function verifyLine(idToken) {
  if (!idToken) throw httpErr(401, '請從 LINE 開啟');
  const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: process.env.LINE_LOGIN_CHANNEL_ID })
  });
  const j = await r.json();
  if (!r.ok || !j.sub) throw httpErr(401, '登入已過期，請重新開啟');
  return { uid: j.sub, name: j.name || '' };
}
const httpErr = (code, msg) => Object.assign(new Error(msg), { code });

async function studentByLine(uid) {
  const q = await db.collection('students').where('lineUserId', '==', uid).limit(1).get();
  return q.empty ? null : { id: q.docs[0].id, ref: q.docs[0].ref, ...q.docs[0].data() };
}

// 用 LINE 記住客人：先找已綁定的，再用電話找舊學員綁上，都沒有就建新客人（0 堂）
async function rememberLineUser(uid, { name, phone, lineName, lineId }) {
  const bound = await studentByLine(uid);
  if (bound) return { student: bound, created: false };
  const p = normPhone(phone);
  const all = await db.collection('students').get();
  const hit = all.docs.find(d => p && normPhone(d.data().phone) === p);
  if (hit) {
    if (hit.data().lineUserId && hit.data().lineUserId !== uid) throw httpErr(409, '這支手機已經綁定其他 LINE，請聯絡教練');
    await hit.ref.update({ lineUserId: uid, lineName: lineName || '' });
    return { student: { id: hit.id, ref: hit.ref, ...hit.data(), lineUserId: uid }, created: false };
  }
  const ref = db.collection('students').doc();
  const data = { name, phone, lineId: lineId || '', note: 'LINE 新客人', credits: 0, prospect: true, lineUserId: uid, lineName: lineName || '', createdAt: FieldValue.serverTimestamp() };
  await ref.set(data);
  return { student: { id: ref.id, ref, ...data }, created: true };
}

async function siteConfig() {
  const s = await db.doc('site/config').get();
  const d = s.exists ? s.data() : {};
  return {
    classes: d.classes || [],
    booking: { daysAhead: 21, minHoursAhead: 12, lessonMinutes: 60, bufferMinutes: 30, startTimes: [], ...(d.booking || {}) },
    closedDates: d.closedDates || []
  };
}

// 這個時段能不能約（和前台同一套規則）
function slotOk(cfg, date, time) {
  const B = cfg.booking;
  if (!B.startTimes.includes(time)) return '這個時段沒有開放';
  if (cfg.closedDates.includes(date)) return '教練這天休假';
  const t = slotMs(date, time);
  if (t - Date.now() < B.minHoursAhead * 3600e3) return `最晚要在 ${B.minHoursAhead} 小時前預約`;
  if (t - Date.now() > (B.daysAhead + 1) * 864e5) return `只能預約 ${B.daysAhead} 天內`;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(), s = toMin(time), e = s + (B.lessonMinutes || 60);
  if (cfg.classes.some(c => c.day === dow && s < toMin(c.end) + B.bufferMinutes && e > toMin(c.start) - B.bufferMinutes)) return '和固定團課衝突';
  return null;
}

/* ---------- 學員 App API ---------- */
export const api = onRequest({ invoker: 'public', cors: [SITE, 'https://tupo-chongwei.firebaseapp.com', /localhost/] }, async (req, res) => {
  try {
    if (req.method !== 'POST') throw httpErr(405, 'POST only');
    const { action, idToken } = req.body || {};
    const me = await verifyLine(idToken);
    let st = await studentByLine(me.uid);

    if (action === 'me') {
      if (!st) return res.json({ bound: false, lineName: me.name });
      const today = twYmd(twNow());
      const les = await db.collection('lessons').where('studentIds', 'array-contains', st.id).get();
      const lessons = les.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(l => l.date >= today && l.status === 'scheduled')
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
        .map(l => ({ id: l.id, date: l.date, time: l.time, minutes: l.minutes || 60, paid: !!l.paid, canCancel: slotMs(l.date, l.time) - Date.now() > CANCEL_HOURS * 3600e3 && !!l.paid }));
      const led = await st.ref.collection('ledger').orderBy('at', 'desc').limit(30).get();
      const ledger = led.docs.map(d => { const x = d.data(); return { note: x.note || x.type, delta: x.delta || 0, at: x.at?.toMillis?.() || 0 }; });
      const pq = await db.collection('bookings').where('lineUserId', '==', me.uid).get();
      const pending = pq.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => b.status === 'pending' && b.date >= today)
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(b => ({ id: b.id, date: b.date, time: b.time }));
      return res.json({ bound: true, student: { name: st.name, credits: st.credits || 0, expiresAt: st.expiresAt || null, blocked: !!st.blocked, prospect: !!st.prospect }, lessons, pending, ledger, cancelHours: CANCEL_HOURS });
    }

    if (action === 'bind') {
      if (st) return res.json({ ok: true });
      const phone = String(req.body.phone || '').trim(), name = String(req.body.name || '').trim().slice(0, 30);
      if (normPhone(phone).length < 8 || !name) throw httpErr(400, '請填姓名和手機');
      const r = await rememberLineUser(me.uid, { name, phone, lineName: me.name });
      notifyAdmins(r.created ? `👋 新客人加入 LINE 預約：${name} ${phone}` : `🔗 ${r.student.name} 綁定了 LINE 預約`).catch(() => {});
      return res.json({ ok: true, created: r.created });
    }

    if (!st) throw httpErr(403, '請先綁定學員資料');

    if (action === 'book') {
      const { date, time } = req.body;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw httpErr(400, '時間格式錯誤');
      const cfg = await siteConfig();
      const bad = slotOk(cfg, date, time); if (bad) throw httpErr(400, bad);
      const busyRef = db.doc(`busy/${date}_${time.replace(':', '')}`);
      const lessonRef = db.collection('lessons').doc();
      const left = await db.runTransaction(async tx => {
        const [s, busy] = await Promise.all([tx.get(st.ref), tx.get(busyRef)]);
        const d = s.data();
        if (d.blocked) throw httpErr(403, '帳號暫停預約，請聯絡教練');
        if ((d.credits || 0) < 1) throw httpErr(400, '剩餘堂數不足，請先向教練購買方案');
        if (d.expiresAt && d.expiresAt < date) throw httpErr(400, `方案 ${d.expiresAt} 到期，這堂超過有效期限`);
        if (busy.exists) throw httpErr(409, '這個時段剛被約走了，請換一個時間');
        tx.set(busyRef, { date, time });
        tx.set(lessonRef, { date, time, minutes: cfg.booking.lessonMinutes || 60, studentIds: [st.id], studentNames: [d.name], status: 'scheduled', paid: true, source: 'line', seriesId: null, note: 'LINE 線上預約（已扣堂）', createdAt: FieldValue.serverTimestamp() });
        tx.update(st.ref, { credits: FieldValue.increment(-1) });
        tx.set(st.ref.collection('ledger').doc(), { type: 'deduct', delta: -1, lessonId: lessonRef.id, note: `預約 ${date} ${time}`, at: FieldValue.serverTimestamp() });
        return (d.credits || 0) - 1;
      });
      push(me.uid, [card('✓ 預約成功・扣除 1 堂', [`${md(date)} ${time}`, `剩餘 ${left} 堂`, `上課前 ${CANCEL_HOURS} 小時前可在 App 取消並退回堂數`])]).catch(() => {});
      notifyAdmins(`📅 LINE 預約：${md(date)} ${time}\n${st.name}（剩 ${left} 堂）`).catch(() => {});
      return res.json({ ok: true, credits: left, lessonId: lessonRef.id });
    }

    if (action === 'request') {
      const { date, time } = req.body;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw httpErr(400, '時間格式錯誤');
      if (st.blocked) throw httpErr(403, '帳號暫停預約，請聯絡教練');
      const cfg = await siteConfig();
      const bad = slotOk(cfg, date, time); if (bad) throw httpErr(400, bad);
      if ((await db.doc(`busy/${date}_${time.replace(':', '')}`).get()).exists) throw httpErr(409, '這個時段剛被約走了，請換一個時間');
      const mine = await db.collection('bookings').where('lineUserId', '==', me.uid).get();
      if (mine.docs.some(d => d.data().status === 'pending' && d.data().date === date && d.data().time === time)) throw httpErr(409, '這個時段已經申請過了，等教練確認喔');
      if (mine.docs.filter(d => d.data().status === 'pending').length >= 3) throw httpErr(429, '已經有 3 筆待確認的預約，請等教練確認後再申請');
      await db.collection('bookings').add({
        goals: [], level: st.prospect ? '新客人' : '學員', who: '', people: 1, date, time,
        name: st.name, phone: st.phone || '', lineId: st.lineId || '', note: String(req.body.note || '').slice(0, 200),
        status: 'pending', source: 'line-app', lineUserId: me.uid, lineName: me.name, createdAt: FieldValue.serverTimestamp()
      });
      return res.json({ ok: true });
    }

    if (action === 'cancel') {
      const ref = db.doc(`lessons/${req.body.lessonId}`);
      const left = await db.runTransaction(async tx => {
        const [l, s] = await Promise.all([tx.get(ref), tx.get(st.ref)]);
        const d = l.data();
        if (!l.exists || !d.studentIds.includes(st.id) || d.status !== 'scheduled') throw httpErr(404, '找不到這堂課');
        if (!d.paid) throw httpErr(400, '這堂是教練排的課，請直接聯絡教練');
        if (slotMs(d.date, d.time) - Date.now() < CANCEL_HOURS * 3600e3) throw httpErr(400, `上課前 ${CANCEL_HOURS} 小時內無法線上取消，請聯絡教練`);
        tx.update(ref, { status: 'cancelled', cancelledBy: 'student' });
        tx.delete(db.doc(`busy/${d.date}_${d.time.replace(':', '')}`));
        tx.update(st.ref, { credits: FieldValue.increment(1) });
        tx.set(st.ref.collection('ledger').doc(), { type: 'undo', delta: 1, lessonId: ref.id, note: `取消 ${d.date} ${d.time}（退回）`, at: FieldValue.serverTimestamp() });
        return { credits: (s.data().credits || 0) + 1, date: d.date, time: d.time };
      });
      push(me.uid, [card('已取消・退回 1 堂', [`${md(left.date)} ${left.time}`, `剩餘 ${left.credits} 堂`], '#555555')]).catch(() => {});
      notifyAdmins(`❌ 取消：${md(left.date)} ${left.time}\n${st.name}（剩 ${left.credits} 堂）`).catch(() => {});
      return res.json({ ok: true, credits: left.credits });
    }

    throw httpErr(400, 'unknown action');
  } catch (e) {
    if (!e.code || typeof e.code !== 'number') logger.error(e);
    res.status(typeof e.code === 'number' ? e.code : 500).json({ error: typeof e.code === 'number' ? e.message : '系統忙碌，請稍後再試' });
  }
});

/* ---------- 官方帳號 Webhook ---------- */
export const lineWebhook = onRequest({ invoker: 'public' }, async (req, res) => {
  const sig = req.get('x-line-signature') || '';
  const mac = crypto.createHmac('sha256', process.env.LINE_MSG_SECRET).update(req.rawBody).digest('base64');
  if (!sig || sig.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac))) return res.status(401).send('bad signature');
  res.status(200).send('ok');
  for (const ev of req.body.events || []) {
    try {
      if (ev.type === 'postback') { await onPostback(ev); continue; }
      if (ev.type !== 'message' || ev.message.type !== 'text') continue;
      const t = ev.message.text.trim(), uid = ev.source.userId;
      const m = /^通知綁定\s*(\S+)$/.exec(t);
      if (m) {
        if (m[1] !== process.env.NOTIFY_CODE) { await reply(ev.replyToken, [text('密碼不對喔')]); continue; }
        await db.doc('notify/config').set({ lineUserIds: FieldValue.arrayUnion(uid) }, { merge: true });
        await reply(ev.replyToken, [text('✅ 綁定完成！之後有新預約、線上預約或取消都會通知你。\n（傳「取消通知」可以停止）')]);
      } else if (t === '取消通知') {
        await db.doc('notify/config').set({ lineUserIds: FieldValue.arrayRemove(uid) }, { merge: true });
        await reply(ev.replyToken, [text('已停止通知')]);
      } else if (/^(查堂數|剩幾堂|我的堂數)$/.test(t)) {
        const st = await studentByLine(uid);
        await reply(ev.replyToken, [text(st ? `${st.name} 你好！目前剩餘 ${st.credits || 0} 堂${st.expiresAt ? `，${st.expiresAt} 到期` : ''}。` : '還沒有綁定學員資料，請點下方選單「預約私人課」完成綁定。')]);
      }
    } catch (e) { logger.error('webhook', e); }
  }
});

/* ---------- 預約單卡片 ---------- */
function bookingCard(b, { title, color, note, buttons }) {
  const row = (k, v) => ({ type: 'box', layout: 'baseline', spacing: 'md', contents: [
    { type: 'text', text: k, size: 'sm', color: '#999999', flex: 2 },
    { type: 'text', text: String(v || '—'), size: 'sm', color: '#222222', flex: 5, wrap: true }] });
  const bubble = {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '16px', contents: [
      { type: 'text', text: title, color: '#ffffff', weight: 'bold', size: 'lg' },
      { type: 'text', text: '突破重圍・私人課預約單', color: '#ffffffcc', size: 'xs', margin: 'sm' }] },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
      { type: 'text', text: `${md(b.date)} ${b.time}`, weight: 'bold', size: 'xxl' },
      { type: 'separator', margin: 'md' },
      row('姓名', b.name), row('電話', b.phone), row('人數', `${b.people || 1} 人`), row('程度', `${b.level || ''}・${b.who || ''}`),
      row('想練', (b.goals || []).join('、')), ...(b.note ? [row('備註', b.note)] : []),
      ...(note ? [{ type: 'text', text: note, size: 'xs', color: '#888888', wrap: true, margin: 'lg' }] : [])] }
  };
  if (buttons) bubble.footer = { type: 'box', layout: 'horizontal', spacing: 'sm', contents: buttons };
  return { type: 'flex', altText: `${title}｜${md(b.date)} ${b.time} ${b.name}`, contents: bubble };
}
const pbBtn = (label, data, color) => ({ type: 'button', style: color ? 'primary' : 'secondary', color, height: 'sm', action: { type: 'postback', label, data, displayText: label } });

async function adminIds() {
  const snap = await db.doc('notify/config').get();
  return snap.exists ? snap.data().lineUserIds || [] : [];
}

/* 網站／LIFF 新預約 → 客人收預約單、管理員收可直接確認的預約單 */
export const onBookingCreated = onDocumentCreated('bookings/{id}', async ev => {
  const b = ev.data?.data(); if (!b) return;
  b.id = ev.params.id;
  if (b.lineUserId && b.phone) await rememberLineUser(b.lineUserId, { name: b.name, phone: b.phone, lineName: b.lineName, lineId: b.lineId }).catch(e => logger.warn('remember', e.message));
  if (b.lineUserId) await push(b.lineUserId, [bookingCard(b, { title: '📝 預約單已送出', color: '#d7262e', note: '教練確認後會再傳 LINE 通知你。要改時間或取消，直接在這裡傳訊息給教練。' })]);
  const card = bookingCard(b, { title: '🥊 新的預約（待確認）', color: '#d7262e', note: b.lineUserId ? '客人已綁 LINE，確認後會自動通知他' : '客人沒有從 LINE 預約，確認後請用電話聯絡',
    buttons: [pbBtn('✅ 確認', `bk=confirm&id=${b.id}`, '#2fbf71'), pbBtn('❌ 婉拒', `bk=reject&id=${b.id}`)] });
  await Promise.all((await adminIds()).map(id => push(id, [card])));
});

/* 預約狀態改變（後台或 LINE 按鈕）→ 通知客人 */
export const onBookingUpdated = onDocumentUpdated('bookings/{id}', async ev => {
  const before = ev.data.before.data(), b = ev.data.after.data();
  if (before.status === b.status || !b.lineUserId) return;
  if (b.status === 'confirmed') await push(b.lineUserId, [bookingCard(b, { title: '✅ 預約成功', color: '#2fbf71', note: '當天見！上課前一晚會再提醒你。想改時間請直接傳訊息給教練。' })]);
  if (b.status === 'cancelled') await push(b.lineUserId, [bookingCard(b, { title: '這個時段無法安排', color: '#555555', note: '抱歉這次沒辦法安排，歡迎再選其他時段，或直接傳訊息跟教練討論。' })]);
});

/* 管理員在 LINE 按「確認／婉拒」 */
async function onBookingPostback(ev, q) {
  const uid = ev.source.userId;
  if (!(await adminIds()).includes(uid)) return reply(ev.replyToken, [text('只有教練可以操作喔')]);
  const ref = db.doc(`bookings/${q.get('id')}`);
  const res = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { msg: '找不到這筆預約' };
    const b = snap.data();
    if (b.status !== 'pending') return { msg: `這筆預約已經是「${b.status === 'confirmed' ? '已確認' : '已取消'}」了` };
    if (q.get('bk') === 'reject') { tx.update(ref, { status: 'cancelled', handledBy: 'line' }); return { msg: `已婉拒 ${b.name} ${md(b.date)} ${b.time}${b.lineUserId ? '，已通知客人' : ''}` }; }
    const busyRef = db.doc(`busy/${b.date}_${b.time.replace(':', '')}`);
    if ((await tx.get(busyRef)).exists) return { msg: `⚠️ ${md(b.date)} ${b.time} 已經有其他課了，請到後台處理` };
    const students = await tx.get(db.collection('students'));
    const p = normPhone(b.phone);
    const hit = students.docs.find(d => p && normPhone(d.data().phone) === p);
    let sid;
    if (hit) { sid = hit.id; if (b.lineUserId && !hit.data().lineUserId) tx.update(hit.ref, { lineUserId: b.lineUserId, lineName: b.lineName || '' }); }
    else {
      const sref = db.collection('students').doc(); sid = sref.id;
      tx.set(sref, { name: b.name, phone: b.phone, lineId: b.lineId || '', note: '網站預約', credits: 0, createdAt: FieldValue.serverTimestamp(), ...(b.lineUserId ? { lineUserId: b.lineUserId, lineName: b.lineName || '' } : {}) });
    }
    tx.update(ref, { status: 'confirmed', handledBy: 'line' });
    tx.set(busyRef, { date: b.date, time: b.time });
    tx.set(db.doc(`lessons/bk_${ref.id}`), { date: b.date, time: b.time, minutes: 60, studentIds: [sid], studentNames: [b.name], status: 'scheduled', seriesId: null,
      note: `網站預約${b.people > 1 ? `・${b.people} 人` : ''}`, bookingId: ref.id, createdAt: FieldValue.serverTimestamp() });
    return { msg: `✅ 已確認 ${b.name} ${md(b.date)} ${b.time}，已排進課表${b.lineUserId ? '、已通知客人' : '（客人沒綁 LINE，請電話聯絡 ' + b.phone + '）'}` };
  });
  await reply(ev.replyToken, [text(res.msg)]);
}


/* ---------- 上課前一晚提醒（每天 20:00 台灣時間） ---------- */
function reminderCard(l, st) {
  const btn = (label, data, color) => ({ type: 'button', style: color ? 'primary' : 'secondary', color, height: 'sm', action: { type: 'postback', label, data, displayText: label } });
  return {
    type: 'flex', altText: `明天 ${l.time} 有課喔！`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#d7262e', paddingAll: '14px', contents: [{ type: 'text', text: '🥊 明天上課提醒', color: '#ffffff', weight: 'bold' }] },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'text', text: `${md(l.date)} ${l.time}`, weight: 'bold', size: 'xl' },
        { type: 'text', text: `${st.name}・私人課 ${l.minutes || 60} 分`, size: 'sm', color: '#555555' },
        { type: 'text', text: `目前剩餘 ${st.credits || 0} 堂`, size: 'sm', color: '#888888' }
      ] },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        btn('✅ 我會準時到', `attend=yes&l=${l.id}&s=${st.id}`, '#d7262e'),
        btn('🙋 我要請假', `attend=leave&l=${l.id}&s=${st.id}`)
      ] }
    }
  };
}

export const nightlyReminder = onSchedule({ schedule: '0 20 * * *', timeZone: 'Asia/Taipei' }, async () => {
  const t = twNow(); t.setUTCDate(t.getUTCDate() + 1);
  const tomorrow = twYmd(t);
  const snap = await db.collection('lessons').where('date', '==', tomorrow).get();
  let sent = 0;
  const lines = [];
  for (const d of snap.docs) {
    const l = { id: d.id, ...d.data() };
    if (l.status !== 'scheduled') continue;
    const names = [];
    for (const sid of l.studentIds || []) {
      const s = await db.doc(`students/${sid}`).get();
      if (!s.exists) continue;
      const st = { id: s.id, ...s.data() };
      names.push(st.name + (st.lineUserId ? '' : '（未綁 LINE）'));
      if (st.lineUserId) { await push(st.lineUserId, [reminderCard(l, st)]); sent++; }
    }
    lines.push(`${l.time} ${names.join('、')}`);
  }
  if (lines.length) await notifyAdmins(`📋 明天 ${md(tomorrow)} 的課（已提醒 ${sent} 位學員）\n${lines.sort().join('\n')}`);
  logger.info('reminders', tomorrow, sent);
});

async function onPostback(ev) {
  const q = new URLSearchParams(ev.postback.data || '');
  if (q.get('bk')) return onBookingPostback(ev, q);
  const attend = q.get('attend'), lid = q.get('l'), sid = q.get('s');
  if (!attend || !lid || !sid) return;
  const [lSnap, sSnap] = await Promise.all([db.doc(`lessons/${lid}`).get(), db.doc(`students/${sid}`).get()]);
  if (!lSnap.exists || !sSnap.exists || sSnap.data().lineUserId !== ev.source.userId) return reply(ev.replyToken, [text('找不到這堂課，請直接聯絡教練')]);
  const l = lSnap.data(), st = sSnap.data();
  if (l.status !== 'scheduled') return reply(ev.replyToken, [text('這堂課已經有變動了，請直接聯絡教練')]);
  await lSnap.ref.update({ [`attend.${sid}`]: attend, [`attendAt.${sid}`]: FieldValue.serverTimestamp() });
  if (attend === 'yes') {
    await reply(ev.replyToken, [text(`收到！${md(l.date)} ${l.time} 見 💪`)]);
  } else {
    await reply(ev.replyToken, [text('已經幫你通知教練，教練會再跟你確認 🙏')]);
    await notifyAdmins(`🙋 請假：${st.name}\n${md(l.date)} ${l.time}\n（後台這堂課已標記請假，請決定要取消／改期）`);
  }
}

/* ---------- 教練完課扣堂 → 通知學員 ---------- */
export const onLessonDone = onDocumentUpdated('lessons/{id}', async ev => {
  const before = ev.data.before.data(), after = ev.data.after.data();
  if (before.status === 'done' || after.status !== 'done' || after.paid) return; // LINE 預約時已通知過
  for (const sid of after.studentIds || []) {
    const s = await db.doc(`students/${sid}`).get();
    if (!s.exists || !s.data().lineUserId) continue;
    const st = s.data();
    await push(st.lineUserId, [card('✓ 完課・扣除 1 堂', [`${md(after.date)} ${after.time} 辛苦了！`, `剩餘 ${st.credits || 0} 堂${st.expiresAt ? `（${st.expiresAt} 到期）` : ''}`], '#2b2420')]);
  }
});
