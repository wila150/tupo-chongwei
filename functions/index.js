// 突破重圍 Cloud Functions
// - api：學員 LINE 預約 App（LIFF）用：查自己的堂數、綁定、線上預約（扣 1 堂）、取消（退堂）
// - lineWebhook：官方帳號 Webhook（「通知綁定 密碼」→ 之後收新預約通知；「查堂數」）
// - onBookingCreated：網站有新預約 → LINE 通知教練／管理員
// 設定在 functions/.env（不進 git）：LINE_MSG_CHANNEL_ID、LINE_MSG_SECRET、LINE_LOGIN_CHANNEL_ID、NOTIFY_CODE
import { onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
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
export const api = onRequest({ cors: [SITE, 'https://tupo-chongwei.firebaseapp.com', /localhost/] }, async (req, res) => {
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
      return res.json({ bound: true, student: { name: st.name, credits: st.credits || 0, expiresAt: st.expiresAt || null, blocked: !!st.blocked }, lessons, ledger, cancelHours: CANCEL_HOURS });
    }

    if (action === 'bind') {
      if (st) return res.json({ ok: true });
      const phone = normPhone(req.body.phone), name = String(req.body.name || '').trim();
      if (phone.length < 8 || !name) throw httpErr(400, '請填姓名和手機');
      const all = await db.collection('students').get();
      const hit = all.docs.find(d => normPhone(d.data().phone) === phone && d.data().name.replace(/\s/g, '') === name.replace(/\s/g, ''));
      if (!hit) throw httpErr(404, '找不到這位學員。第一次上課請先用「首次預約」，或請教練幫你建立資料');
      if (hit.data().lineUserId && hit.data().lineUserId !== me.uid) throw httpErr(409, '這位學員已經綁定其他 LINE，請聯絡教練');
      await hit.ref.update({ lineUserId: me.uid, lineName: me.name });
      notifyAdmins(`🔗 ${name} 綁定了 LINE 預約`).catch(() => {});
      return res.json({ ok: true });
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
export const lineWebhook = onRequest(async (req, res) => {
  const sig = req.get('x-line-signature') || '';
  const mac = crypto.createHmac('sha256', process.env.LINE_MSG_SECRET).update(req.rawBody).digest('base64');
  if (!sig || sig.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac))) return res.status(401).send('bad signature');
  res.status(200).send('ok');
  for (const ev of req.body.events || []) {
    try {
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

/* ---------- 網站新預約 → 通知 ---------- */
export const onBookingCreated = onDocumentCreated('bookings/{id}', async ev => {
  const b = ev.data?.data(); if (!b) return;
  await notifyAdmins(`🥊 新的私人課預約（待確認）\n${md(b.date)} ${b.time}\n${b.name} ${b.phone}${b.people > 1 ? `・${b.people} 人` : ''}\n${(b.goals || []).join('、')}${b.note ? `\n📝 ${b.note}` : ''}\n👉 ${SITE}/admin.html`);
});
