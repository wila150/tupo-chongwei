import { firebaseConfig } from './firebase-config.js';

const $ = q => document.querySelector(q);
const DAY = ['日', '一', '二', '三', '四', '五', '六'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

if (!firebaseConfig) {
  $('#noConfig').hidden = false;
  throw new Error('no firebase config');
}

const V = '10.12.2';
const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
const A = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
const F = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
const ST = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-storage.js`);
const app = initializeApp(firebaseConfig);
const auth = A.getAuth(app);
const db = F.getFirestore(app);
const storage = ST.getStorage(app);

// 閒置就休息（2026/11/09）：後台分頁在背景超過 5 分鐘、或 20 分鐘沒動滑鼠鍵盤，就暫停 Firestore 連線；
// 回到分頁或一動滑鼠就恢復（恢復時即時監聽會自動補上這段時間的變更）。
// 背景門檻用 5 分鐘不用 1 分鐘：每次恢復都會重讀監聽中的資料，切分頁太頻繁反而多花讀取次數。
{
  const IDLE_MS = 20 * 60 * 1000, HIDDEN_MS = 5 * 60 * 1000;
  let paused = false, idleTimer = null, hideTimer = null, last = 0;
  const pause = () => { if (!paused) { paused = true; F.disableNetwork(db).catch(() => {}); } };
  const resume = () => { if (paused) { paused = false; F.enableNetwork(db).catch(() => {}); } };
  const active = () => {
    const now = Date.now();
    if (!paused && now - last < 5000) return; // mousemove 很密，5 秒內只重設一次
    last = now;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(pause, IDLE_MS);
    if (!document.hidden) resume();
  };
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hideTimer);
    if (document.hidden) hideTimer = setTimeout(pause, HIDDEN_MS);
    else active();
  });
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(ev => window.addEventListener(ev, active, { passive: true }));
  active();
}

let all = [], filter = 'pending', unsub = null, pendingCount = 0;

$('#logout').addEventListener('click', () => A.signOut(auth));
$('#logout2').addEventListener('click', () => A.signOut(auth));
$('#googleLogin').addEventListener('click', async () => {
  $('#loginError').textContent = '';
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try { await A.signInWithPopup(auth, provider); }
  catch (err) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(err.code)) return A.signInWithRedirect(auth, provider);
    if (err.code !== 'auth/popup-closed-by-user') $('#loginError').textContent = 'Google 登入失敗：' + err.code;
  }
});

let crm = null;
async function startCrm() {
  if (crm) return;
  const { initCrm } = await import(`./admin-crm.js${new URL(import.meta.url).search}`);
  crm = initCrm({ F, db, esc, $ });
  render(); // 讓鈴鐺先記住目前的預約，之後新進來的才會跳提醒
}
A.onAuthStateChanged(auth, user => {
  $('#loginView').hidden = !!user;
  $('#appView').hidden = !user;
  unsub?.(); unsub = null;
  if (!user) return;
  $('#userName').textContent = user.displayName || '教練';
  $('#userEmail').textContent = user.email || '';
  if (user.photoURL) $('#userPhoto').src = user.photoURL;
  const goV = new URLSearchParams(location.search).get('view'); // LINE 教練選單直接開某一頁（?view=lessons）
  if (goV) setTimeout(() => { if (TITLES[goV]) showView(goV); }, 0);
  const q = F.query(F.collection(db, 'bookings'), F.orderBy('date'));
  unsub = F.onSnapshot(q, snap => {
    startCrm();
    all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    render();
  }, err => {
    $('#list').innerHTML = `<p class="empty">讀取失敗：這個帳號可能沒有管理權限。</p>`;
    console.error(err);
  });
});

$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x === b));
  render();
});

const isPast = b => new Date(`${b.date}T${b.time}:00`) < new Date();
// 工程師專用：刪除預約（清測試資料），只有這個帳號看得到按鈕
const ENGINEER = 'xiechengfang1@gmail.com';
const isEngineer = () => (auth.currentUser?.email || '').toLowerCase() === ENGINEER;
let curGroup = [];
async function deleteBookings(list) {
  for (let i = 0; i < list.length; i += 150) {
    const batch = F.writeBatch(db);
    for (const b of list.slice(i, i + 150)) {
      batch.delete(F.doc(db, 'bookings', b.id));
      if (b.status === 'confirmed') { batch.delete(F.doc(db, 'busy', `${b.date}_${b.time.replace(':', '')}`)); batch.delete(F.doc(db, 'lessons', `bk_${b.id}`)); }
    }
    await batch.commit();
  }
}

function render() {
  const groups = {
    pending: all.filter(b => b.status === 'pending' && !isPast(b)),
    upcoming: all.filter(b => b.status === 'confirmed' && !isPast(b)),
    past: all.filter(b => b.status !== 'cancelled' && isPast(b)).reverse(),
    cancelled: all.filter(b => b.status === 'cancelled').reverse()
  };
  $('#cPending').textContent = groups.pending.length;
  pendingCount = groups.pending.length; crm?.setPending?.(groups.pending);
  const nb = document.querySelector('[data-badge=bookings]'); nb.hidden = !pendingCount; nb.textContent = pendingCount;
  $('#cUpcoming').textContent = groups.upcoming.length;
  const items = groups[filter];
  curGroup = items;
  const eb = $('#engDelAll'); if (eb) { eb.hidden = !isEngineer() || !items.length; eb.textContent = `🗑 刪除這個分頁全部 ${items.length} 筆（工程師）`; }
  $('#list').innerHTML = items.length ? items.map(card).join('') : `<div class="empty-state"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18"/></svg><b>${{ pending: '沒有待確認的預約', upcoming: '還沒有即將上課的預約', past: '還沒有上過的課', cancelled: '沒有取消的預約' }[filter]}</b>學員從網站預約後會出現在這裡，也會傳 LINE 通知你</div>`;
}

function card(b) {
  const d = new Date(`${b.date}T00:00:00`);
  const tel = esc(b.phone).replace(/[^0-9+]/g, '');
  const actions = [];
  if (b.status === 'pending') actions.push(`<button class="btn" data-act="confirm" data-id="${b.id}">確認</button>`);
  if (b.status !== 'cancelled') actions.push(`<button class="btn btn-ghost" data-act="cancel" data-id="${b.id}">取消</button>`);
  if (isEngineer()) actions.push(`<button class="btn btn-ghost eng-del" data-act="delete" data-id="${b.id}" title="工程師專用">🗑 刪除</button>`);
  return `<div class="bk ${esc(b.status)}">
    <div>
      <div class="bk-when">${d.getMonth() + 1}/${d.getDate()}（${DAY[d.getDay()]}）${esc(b.time)}</div>
      ${crm?.flag(b.phone) || ''}<div class="bk-who">${esc(b.name)}　<a href="tel:${tel}">📞 ${esc(b.phone)}</a>${b.lineId ? `　LINE：${esc(b.lineId)}` : ''}</div>
      <div class="bk-meta">${esc(b.who)}・${esc(b.level)}・${esc(b.people)} 人${b.goals?.length ? `・想練：${b.goals.map(esc).join('、')}` : ''}</div>
      ${b.note ? `<div class="bk-meta">📝 ${esc(b.note)}</div>` : ''}
    </div>
    <div class="bk-actions">${actions.join('')}</div>
  </div>`;
}

$('#list').addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const b = all.find(x => x.id === btn.dataset.id); if (!b) return;
  const slot = F.doc(db, 'busy', `${b.date}_${b.time.replace(':', '')}`);
  if (btn.dataset.act === 'delete') {
    if (!isEngineer() || !confirm(`刪除 ${b.name} ${b.date} ${b.time} 這筆預約？\n（直接從資料庫刪掉，救不回來）`)) return;
    btn.disabled = true; await deleteBookings([b]).catch(err => { alert('刪除失敗：' + err.message); btn.disabled = false; }); return;
  }
  btn.disabled = true;
  try {
    const batch = F.writeBatch(db);
    if (btn.dataset.act === 'confirm') {
      batch.update(F.doc(db, 'bookings', b.id), { status: 'confirmed' });
      batch.set(slot, { date: b.date, time: b.time, minutes: 60 });
      await crm?.bookingConfirmed(b, batch);
    } else {
      if (!confirm(`取消 ${b.name} 的預約？`)) { btn.disabled = false; return; }
      batch.update(F.doc(db, 'bookings', b.id), { status: 'cancelled' });
      if (b.status === 'confirmed') batch.delete(slot);
      if (b.status === 'confirmed') crm?.bookingCancelled(b, batch);
    }
    await batch.commit();
  } catch (err) {
    alert('更新失敗：' + err.message);
    btn.disabled = false;
  }
});

/* ================= 網站內容編輯 ================= */
const TITLES = { home: '總覽', bookings: '網站預約', lessons: '課務扣堂', students: '學員', report: '報表', content: '網站內容', media: '媒體庫', messages: 'LINE 訊息' };
function showView(v) {
  document.querySelectorAll('#views button').forEach(x => x.classList.toggle('active', x.dataset.v === v));
  for (const k of Object.keys(TITLES)) { const el = document.getElementById(`${k}View`); if (el) el.hidden = k !== v; }
  $('#pageTitle').textContent = TITLES[v];
  const d = new Date(); $('#pageSub').textContent = v === 'home' ? `${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${DAY[d.getDay()]}・${greet()}，${(auth.currentUser?.displayName || '教練').split(' ')[0]}` : '';
  if (v === 'content' && !cfg) loadContent();
  if (v === 'content' && !photosLoaded) loadPhotos();
  if (v === 'media') loadMedia();
  if (v !== 'messages') window.__closeThread?.();
  if (v === 'report') crm?.renderReport();
  if (v === 'home') crm?.renderHome?.();
  scrollTo(0, 0);
}
const greet = () => { const h = new Date().getHours(); return h < 11 ? '早安' : h < 18 ? '午安' : '晚安'; };
$('#views').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showView(b.dataset.v); });
document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto]'); if (g) { showView(g.dataset.goto); return; }
  const q = e.target.closest('[data-quick]'); if (!q) return;
  if (q.dataset.quick === 'lesson') { showView('lessons'); $('#lessonForm').hidden = false; }
  if (q.dataset.quick === 'student') { showView('students'); $('#addStudentBtn').click(); }
  if (q.dataset.quick === 'sell') { showView('students'); $('#stSearch').focus(); }
});
showView('home');

const DAYS_FULL = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
const ALL_TIMES = Array.from({ length: 17 }, (_, i) => `${String(i + 6).padStart(2, '0')}:00`); // 06:00–22:00
const clone = o => JSON.parse(JSON.stringify(o));
let cfg = null;

async function loadContent() {
  const base = clone(window.SITE);
  try {
    const snap = await F.getDoc(F.doc(db, 'site', 'config'));
    const d = snap.exists() ? snap.data() : {};
    cfg = {
      contact: { ...base.contact, ...(d.contact || {}) },
      classes: d.classes || base.classes,
      booking: { ...base.booking, ...(d.booking || {}) },
      closedDates: d.closedDates || [],
      reels: d.reels || base.reels || []
    };
    reelCovers = d.reelCovers || {};
  } catch (err) {
    console.warn(err);
    cfg = { contact: base.contact, classes: base.classes, booking: base.booking, closedDates: [], reels: base.reels || [] };
    $('#saveMsg').textContent = '（目前顯示網站預設內容）';
  }
  renderContent();
}

function renderContent() {
  $('#cLineOA').value = cfg.contact.lineOA || '';
  $('#cIg').value = cfg.contact.instagram || '';
  $('#cPhone').value = cfg.contact.phone || '';
  renderClasses(); renderTimes(); renderOff(); renderReels();
  $('#bDays').value = cfg.booking.daysAhead;
  $('#bMinH').value = cfg.booking.minHoursAhead;
  $('#bBuf').value = cfg.booking.bufferMinutes;
}

function renderClasses() {
  $('#clsList').innerHTML = cfg.classes.map((c, i) => `<div class="cls" data-i="${i}">
    <select data-k="day">${DAYS_FULL.map((d, n) => `<option value="${n}" ${n === c.day ? 'selected' : ''}>${d}</option>`).join('')}</select>
    <input type="time" data-k="start" value="${esc(c.start)}">
    <input type="time" data-k="end" value="${esc(c.end)}">
    <input data-k="venue" value="${esc(c.venue)}" placeholder="例：VAVA漾">
    <input data-k="name" value="${esc(c.name)}" placeholder="例：拳擊課">
    <input data-k="place" value="${esc(c.place)}" placeholder="例：台中">
    <button type="button" class="del" data-del="${i}" title="刪除">✕</button>
  </div>`).join('') || '<p class="hint">還沒有固定課</p>';
}
$('#clsList').addEventListener('input', e => {
  const row = e.target.closest('.cls'); const k = e.target.dataset.k; if (!row || !k) return;
  cfg.classes[row.dataset.i][k] = k === 'day' ? Number(e.target.value) : e.target.value;
});
$('#clsList').addEventListener('click', e => {
  const i = e.target.dataset.del; if (i === undefined) return;
  cfg.classes.splice(Number(i), 1); renderClasses();
});
$('#addCls').addEventListener('click', () => {
  cfg.classes.push({ day: 1, start: '19:00', end: '20:00', venue: '', name: '拳擊課', place: '' }); renderClasses();
});

function renderTimes() {
  const on = new Set(cfg.booking.startTimes);
  $('#timeGrid').innerHTML = ALL_TIMES.map(t => `<button type="button" data-t="${t}" class="${on.has(t) ? 'on' : ''}">${t}</button>`).join('');
}
$('#timeGrid').addEventListener('click', e => {
  const t = e.target.dataset.t; if (!t) return;
  const set = new Set(cfg.booking.startTimes);
  set.has(t) ? set.delete(t) : set.add(t);
  cfg.booking.startTimes = [...set].sort(); renderTimes();
});

function renderOff() {
  const n = new Date(), today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  cfg.closedDates = cfg.closedDates.filter(d => d >= today).sort();
  $('#offList').innerHTML = cfg.closedDates.map(d => {
    const x = new Date(`${d}T00:00:00`);
    return `<span>${x.getMonth() + 1}/${x.getDate()}（${DAY[x.getDay()]}）<button type="button" data-off="${d}" aria-label="移除">✕</button></span>`;
  }).join('') || '<span class="hint" style="border:0;background:none;padding:0">目前沒有休假日</span>';
}
$('#addOff').addEventListener('click', () => {
  const v = $('#offDate').value; if (!v || cfg.closedDates.includes(v)) return;
  cfg.closedDates.push(v); $('#offDate').value = ''; renderOff();
});
$('#offList').addEventListener('click', e => {
  const d = e.target.dataset.off; if (!d) return;
  cfg.closedDates = cfg.closedDates.filter(x => x !== d); renderOff();
});

$('#saveContent').addEventListener('click', async () => {
  const msg = $('#saveMsg'), btn = $('#saveContent');
  const bad = cfg.classes.find(c => !c.start || !c.end || c.start >= c.end || !c.venue.trim());
  if (bad) { msg.textContent = '課表有一堂課的時間或地點沒填好（結束要晚於開始）'; return; }
  let oa = $('#cLineOA').value.trim();
  if (oa && !oa.startsWith('@')) oa = '@' + oa;
  const ig = $('#cIg').value.trim();
  if (ig && !/^https:\/\//.test(ig)) { msg.textContent = 'Instagram 請貼完整網址（https:// 開頭）'; return; }
  const num = (id, min, max) => Math.min(max, Math.max(min, Number($(id).value) || 0));
  const data = {
    contact: { lineOA: oa, line: oa ? `https://line.me/R/ti/p/${oa}` : '', instagram: ig, phone: $('#cPhone').value.trim() },
    classes: cfg.classes.map(c => ({ day: c.day, start: c.start, end: c.end, venue: c.venue.trim(), name: c.name.trim(), place: c.place.trim() })),
    booking: { ...cfg.booking, daysAhead: num('#bDays', 1, 90), minHoursAhead: num('#bMinH', 0, 168), bufferMinutes: num('#bBuf', 0, 180) },
    closedDates: cfg.closedDates,
    reels: cfg.reels,
    updatedAt: F.serverTimestamp()
  };
  btn.disabled = true; msg.textContent = '儲存中…';
  try {
    await F.setDoc(F.doc(db, 'site', 'config'), data, { merge: true });
    cfg = { ...data }; renderContent();
    msg.textContent = '已儲存 ✓ 網站重新整理就會看到';
  } catch (err) {
    msg.textContent = err.code === 'permission-denied' ? '儲存失敗：這個帳號還沒有管理員權限' : '儲存失敗：' + err.message;
  } finally { btn.disabled = false; }
});

/* ---------- 照片：每個固定位置是一本相簿 → Storage photos/albums/<位置>/*.webp，清單 site/config.albums.<位置>（第一張是封面） ---------- */
const SLOTS = [
  { id: 'coach', name: '教練照片', where: '「關於教練」', max: 1600 },
  { id: 'g1', name: '訓練照片 1', where: '私人課區', max: 1600 },
  { id: 'g2', name: '訓練照片 2', where: '私人課區', max: 1600 },
  { id: 'g3', name: '訓練照片 3', where: '私人課區', max: 1600 },
  { id: 'hero', name: '首頁主圖', where: '首頁最上方右邊（取代熊的位置，熊會變背景；只用一張）', max: 1920, single: true }
];
let reelCovers = {};
let photosLoaded = false, albums = {}, albumTitles = {}, albumDesc = {}, albumReels = {}, legacyPhotos = {};

async function loadPhotos() {
  photosLoaded = true;
  try {
    const snap = await F.getDoc(F.doc(db, 'site', 'config'));
    const d = snap.exists() ? snap.data() : {};
    albums = d.albums || {}; albumTitles = d.albumTitles || {}; albumDesc = d.albumDesc || {}; albumReels = d.albumReels || {}; legacyPhotos = d.photos || {}; reelCovers = d.reelCovers || reelCovers; heroBg = { ...HB0, ...(d.heroBg || {}) }; heroArt = { ...HA0, ...(d.heroArt || {}) };
  } catch {}
  // 舊版單張照片轉成相簿第一張
  for (const s of SLOTS) if (!albums[s.id]?.length && legacyPhotos[s.id]) albums[s.id] = [{ url: legacyPhotos[s.id], path: `photos/${s.id}.webp`, caption: '' }];
  $('#photoGrid').innerHTML = SLOTS.map(s => `<div class="ph" data-slot="${s.id}"></div>`).join('');
  SLOTS.forEach(s => renderSlot(s.id));
  drawHb();
}

function renderSlot(id) {
  if (id === 'hero') setTimeout(() => { const f = $('#hbFrame'); if (f?.src) f.src = '/?heroPreview=1&t=' + Date.now(); drawHb(); });
  const s = SLOTS.find(x => x.id === id), card = $(`.ph[data-slot="${id}"]`), list = albums[id] || [];
  const open = card.classList.contains('open');
  card.innerHTML = `
    <div class="alb-head"><button type="button" class="alb-back" data-manage>‹ 返回</button><b>${esc(albumTitles[id] || s.name)}</b><small class="muted">${list.length} 張・${(albumReels[id] || []).length} 影片</small></div>
    <div class="ph-img" style="${list[0] ? `background-image:url('${list[0].url}')` : ''}">${list[0] ? '' : '尚未上傳'}${list.length > 1 ? `<span class="cnt">📷 ${list.length} 張</span>` : ''}</div>
    <div class="ph-body"><b>${s.name}</b><small>${s.where}</small>
      ${s.single ? '' : `<input class="inp" data-title value="${esc(albumTitles[id] || '')}" placeholder="相簿名稱（例：比賽紀錄）" maxlength="20">`}
      <div class="ph-actions"><label class="btn btn-sm">${s.single ? (list.length ? '換一張' : '上傳') : '＋ 加照片'}<input type="file" accept="image/*" ${s.single ? '' : 'multiple'} hidden></label><button type="button" class="btn btn-ghost btn-sm" data-pick>從媒體庫選</button>
      ${!s.single ? `<button type="button" class="btn btn-ghost btn-sm" data-manage>${open ? '收起' : `管理相簿（${list.length} 照片・${(albumReels[id] || []).length} 影片）`}</button>` : ''}
      ${s.single && list.length ? '<button type="button" class="btn btn-ghost btn-sm" data-rmall>移除</button>' : ''}</div>
      <small class="ph-msg"></small></div>
    ${open && !s.single ? `<div class="alb-extra">
      <label class="field">相簿說明（顯示在相簿頁最上面）<textarea class="inp" data-desc rows="3" maxlength="600" placeholder="例：2026 全國拳擊錦標賽，帶學員出賽的紀錄。">${esc(albumDesc[id] || '')}</textarea></label>
      <div class="field">IG Reels 影片<div style="display:flex;gap:.5rem;margin-top:.3rem"><input class="inp" data-reelurl placeholder="貼上 Reels 連結"><button type="button" class="btn btn-ghost btn-sm" data-addreel>加入</button></div></div>
      ${(albumReels[id] || []).map((u, i) => `<div class="reel-row"><button type="button" class="cov${reelCovers[u] ? ' has' : ''}" data-cover="${esc(u)}" title="選封面（從媒體庫）" style="${reelCovers[u] ? `background-image:url('${reelCovers[u]}')` : ''}">${reelCovers[u] ? '' : '封面'}</button><a href="${esc(u)}" target="_blank" rel="noopener">▶ ${esc(u.replace('https://www.instagram.com', ''))}</a><button type="button" data-rmreel="${i}" title="刪除">✕</button></div>`).join('')}
      <a class="btn btn-ghost btn-sm" href="/album?id=${id}" target="_blank" style="justify-self:start">預覽相簿頁 →</a>
    </div>` : ''}
    ${open && !s.single ? `<div class="alb-list">${list.map((g, i) => `<div class="gal-item">
      <div class="ph-img" style="background-image:url('${g.url}')">${i === 0 ? '<span class="cnt">封面</span>' : ''}</div>
      <input data-cap="${i}" value="${esc(g.caption || '')}" placeholder="說明" maxlength="60">
      <div class="gal-acts">${i ? `<button data-tocover="${i}" title="設為封面">★</button>` : ''}<button data-move="${i}" data-d="-1" title="往前">←</button><button data-move="${i}" data-d="1" title="往後">→</button><button data-del="${i}" title="刪除">✕</button></div>
    </div>`).join('')}</div>` : ''}`;
}

const slotMsg = (card, t) => { const m = card.querySelector('.ph-msg'); if (m) m.textContent = t; };
const errText = err => ['permission-denied', 'storage/unauthorized'].includes(err.code) ? '沒有管理員權限' : err.message;
const saveAlbum = id => F.setDoc(F.doc(db, 'site', 'config'), { albums: { [id]: albums[id] || [] } }, { merge: true });

async function compress(file, max) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob(b => b ? ok(Object.assign(b, { w: c.width, h: c.height })) : no(new Error('照片轉檔失敗')), 'image/webp', 0.85));
}

$('#photoGrid').addEventListener('change', async e => {
  const card = e.target.closest('.ph'); if (!card) return;
  const id = card.dataset.slot, s = SLOTS.find(x => x.id === id);
  if (e.target.matches('[data-title]')) {
    albumTitles[id] = e.target.value.trim();
    await F.setDoc(F.doc(db, 'site', 'config'), { albumTitles: { [id]: albumTitles[id] } }, { merge: true }).then(() => slotMsg(card, '名稱已儲存 ✓')).catch(err => slotMsg(card, '失敗：' + errText(err)));
    return;
  }
  if (e.target.matches('[data-desc]')) {
    albumDesc[id] = e.target.value.trim();
    await F.setDoc(F.doc(db, 'site', 'config'), { albumDesc: { [id]: albumDesc[id] } }, { merge: true }).then(() => slotMsg(card, '說明已儲存 ✓')).catch(err => slotMsg(card, '失敗：' + errText(err)));
    return;
  }
  if (e.target.matches('[data-reelurl]')) return;
  if (e.target.matches('[data-cap]')) {
    albums[id][e.target.dataset.cap].caption = e.target.value.trim();
    await saveAlbum(id).then(() => slotMsg(card, '說明已儲存 ✓')).catch(err => slotMsg(card, '失敗：' + errText(err)));
    return;
  }
  const files = [...(e.target.files || [])]; e.target.value = '';
  if (!files.length) return;
  const old = s.single ? (albums[id] || []) : [];
  if (s.single) albums[id] = [];
  albums[id] = albums[id] || [];
  let done = 0;
  for (const file of files) {
    slotMsg(card, `上傳中 ${done + 1}/${files.length}…`);
    try {
      const m = await uploadMedia(file, albumTitles[id] || s.name, s.max);
      albums[id].push({ url: m.url, mediaId: m.id, caption: '' });
      done++;
    } catch (err) { slotMsg(card, '上傳失敗：' + errText(err)); }
  }
  try {
    await saveAlbum(id);
    old.forEach(g => g.path && ST.deleteObject(ST.ref(storage, g.path)).catch(() => {}));
    renderSlot(id); slotMsg($(`.ph[data-slot="${id}"]`), `已加入 ${done} 張 ✓`);
  } catch (err) { slotMsg(card, '儲存失敗：' + errText(err)); }
});

$('#photoGrid').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const card = b.closest('.ph'), id = card.dataset.slot, list = albums[id] || [];
  if (b.matches('[data-manage]')) { card.classList.toggle('open'); document.body.style.overflow = card.classList.contains('open') ? 'hidden' : ''; renderSlot(id); if (!card.classList.contains('open')) card.scrollIntoView({ block: 'nearest' }); return; }
  if (b.matches('[data-pick]')) {
    const s = SLOTS.find(x => x.id === id);
    const picked = await openPicker({ single: !!s.single, title: `加到「${albumTitles[id] || s.name}」` });
    if (!picked.length) return;
    await addToAlbum(id, picked);
    renderSlot(id); slotMsg($(`.ph[data-slot="${id}"]`), `已加入 ${picked.length} 張 ✓`); return;
  }
  if (b.matches('[data-addreel]')) {
    const u = normReel(card.querySelector('[data-reelurl]').value);
    if (!u) return slotMsg(card, '這不是 IG Reels 或貼文的網址');
    albumReels[id] = [...new Set([...(albumReels[id] || []), u])];
    await F.setDoc(F.doc(db, 'site', 'config'), { albumReels: { [id]: albumReels[id] } }, { merge: true }).catch(err => slotMsg(card, '失敗：' + errText(err)));
    renderSlot(id); slotMsg($(`.ph[data-slot="${id}"]`), '影片已加入 ✓'); return;
  }
  if (b.dataset.rmreel !== undefined) {
    albumReels[id].splice(Number(b.dataset.rmreel), 1);
    await F.setDoc(F.doc(db, 'site', 'config'), { albumReels: { [id]: albumReels[id] } }, { merge: true }).catch(() => {});
    renderSlot(id); return;
  }
  if (b.matches('[data-rmall]')) {
    if (!confirm('移除這張照片？')) return;
    const old = list.splice(0); await saveAlbum(id).catch(() => {}); old.forEach(g => g.path && ST.deleteObject(ST.ref(storage, g.path)).catch(() => {}));
    renderSlot(id); return;
  }
  if (b.dataset.tocover !== undefined) {
    const [g] = list.splice(Number(b.dataset.tocover), 1); list.unshift(g);
    await saveAlbum(id).catch(() => {}); renderSlot(id); slotMsg($(`.ph[data-slot="${id}"]`), '已設為封面 ✓'); return;
  }
  if (b.dataset.move !== undefined) {
    const i = Number(b.dataset.move), j = i + Number(b.dataset.d);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await saveAlbum(id).catch(() => {}); renderSlot(id); slotMsg($(`.ph[data-slot="${id}"]`), j === 0 ? '已設為封面 ✓' : '順序已儲存 ✓');
  } else if (b.dataset.del !== undefined) {
    if (!confirm('刪除這張照片？')) return;
    const [g] = list.splice(Number(b.dataset.del), 1);
    await saveAlbum(id).catch(() => {}); if (g.path) ST.deleteObject(ST.ref(storage, g.path)).catch(() => {});
    if (!list.length) { card.classList.remove('open'); document.body.style.overflow = ''; }
    renderSlot(id);
  }
});

/* ---------- IG Reels ---------- */
function normReel(u) {
  const m = /instagram\.com\/(?:[\w.]+\/)?(reel|reels|p)\/([\w-]+)/.exec(u.trim());
  return m ? `https://www.instagram.com/${m[1] === 'p' ? 'p' : 'reel'}/${m[2]}/` : null;
}
function renderReels() {
  $('#reelRows').innerHTML = cfg.reels.map((u, i) => `<div class="reel-row">
    <button type="button" class="cov${reelCovers[u] ? ' has' : ''}" data-cover="${esc(u)}" title="選封面（從媒體庫）" style="${reelCovers[u] ? `background-image:url('${reelCovers[u]}')` : ''}">${reelCovers[u] ? '' : '封面'}</button><a href="${esc(u)}" target="_blank" rel="noopener">${i + 1}. ${esc(u.replace('https://www.instagram.com', ''))}</a>
    <button type="button" data-up="${i}" title="往前" ${i === 0 ? 'disabled' : ''}>↑</button>
    <button type="button" data-down="${i}" title="往後" ${i === cfg.reels.length - 1 ? 'disabled' : ''}>↓</button>
    <button type="button" data-rmreel="${i}" title="刪除">✕</button></div>`).join('') || '<p class="hint">還沒有影片</p>';
}
$('#addReel').addEventListener('click', () => {
  const u = normReel($('#reelUrl').value);
  $('#reelErr').textContent = '';
  if (!u) { $('#reelErr').textContent = '這不是 IG 貼文或 Reels 的網址'; return; }
  if (cfg.reels.includes(u)) { $('#reelErr').textContent = '這支已經在清單裡了'; return; }
  cfg.reels.push(u); $('#reelUrl').value = ''; renderReels();
  $('#saveMsg').textContent = '有修改，記得按儲存';
});
$('#reelRows').addEventListener('click', e => {
  const d = e.target.dataset, r = cfg.reels;
  if (d.up) { const i = +d.up; [r[i - 1], r[i]] = [r[i], r[i - 1]]; }
  else if (d.down) { const i = +d.down; [r[i + 1], r[i]] = [r[i], r[i + 1]]; }
  else if (d.rmreel) r.splice(+d.rmreel, 1);
  else return;
  renderReels(); $('#saveMsg').textContent = '有修改，記得按儲存';
});

/* ================= 媒體庫：Firestore media/{id}（url, path, name, folder, alt, w, h, size, createdAt），檔案 Storage media/<id>.webp =================
   照片先進媒體庫，再「加到相簿」；相簿裡存 { url, mediaId, caption }，從相簿移除不會刪檔，在媒體庫刪才會真的刪。 */
let media = null, mdFolder = '', mdSel = new Set(), mdQuery = '';
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const NONE = '__none__', UNUSED = '__unused__';

async function fetchMedia() {
  if (media) return media;
  const snap = await F.getDocs(F.collection(db, 'media'));
  media = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!photosLoaded) await loadPhotos();
  await migrateAlbums();
  return media;
}
// 舊的相簿照片（直接存在 photos/…）登記進媒體庫，之後統一管理
async function migrateAlbums() {
  const changed = new Set();
  for (const s of SLOTS) for (const g of albums[s.id] || []) {
    if (g.mediaId || !g.url) continue;
    const ex = media.find(m => m.url === g.url);
    const m = ex || { id: newId(), url: g.url, path: g.path || '', name: `${s.name}.webp`, folder: albumTitles[s.id] || s.name, alt: g.caption || '', createdAt: Date.now() };
    if (!ex) { await F.setDoc(F.doc(db, 'media', m.id), (({ id, ...x }) => x)(m)); media.unshift(m); }
    g.mediaId = m.id; delete g.path; changed.add(s.id);
  }
  for (const id of changed) await saveAlbum(id).catch(() => {});
}

async function uploadMedia(file, folder = '', max = 1920) {
  const blob = await compress(file, max);
  const id = newId(), path = `media/${id}.webp`, r = ST.ref(storage, path);
  await ST.uploadBytes(r, blob, { contentType: 'image/webp', cacheControl: 'public, max-age=31536000' });
  const m = { url: await ST.getDownloadURL(r), path, name: file.name.replace(/\.[^.]+$/, ''), folder, alt: '', w: blob.w, h: blob.h, size: blob.size, createdAt: Date.now() };
  await F.setDoc(F.doc(db, 'media', id), m);
  if (media) media.unshift({ id, ...m });
  return { id, ...m };
}

// 用在哪些相簿：mediaId（或網址）→ [相簿名稱]
function usage() {
  const u = {};
  for (const s of SLOTS) for (const g of albums[s.id] || []) {
    const k = g.mediaId || g.url; (u[k] = u[k] || []).push(s.single ? s.name : (albumTitles[s.id] || s.name));
  }
  return u;
}
const folders = () => [...new Set(media.map(m => m.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));

function filtered(folder, q) {
  const u = usage();
  return media.filter(m => (folder === '' || (folder === NONE ? !m.folder : folder === UNUSED ? !u[m.id] : m.folder === folder))
    && (!q || `${m.name} ${m.alt} ${m.folder}`.toLowerCase().includes(q)));
}
function folderChips(cur, withUnused) {
  const u = usage(), n = f => media.filter(m => m.folder === f).length;
  return `<button data-f="" class="${cur === '' ? 'on' : ''}">全部<small>${media.length}</small></button>`
    + folders().map(f => `<button data-f="${esc(f)}" class="${cur === f ? 'on' : ''}">📁 ${esc(f)}<small>${n(f)}</small></button>`).join('')
    + (media.some(m => !m.folder) ? `<button data-f="${NONE}" class="${cur === NONE ? 'on' : ''}">未分類<small>${media.filter(m => !m.folder).length}</small></button>` : '')
    + (withUnused ? `<button data-f="${UNUSED}" class="${cur === UNUSED ? 'on' : ''}">沒用到的<small>${media.filter(m => !u[m.id]).length}</small></button>` : '');
}
function tile(m, sel, u, edit) {
  return `<div class="md-item ${sel ? 'sel' : ''}" data-id="${m.id}">
    <div class="md-img" style="background-image:url('${m.url}')"><span class="md-ck">${sel ? '✓' : ''}</span>${u[m.id] ? `<span class="md-used" title="${esc(u[m.id].join('、'))}">使用中・${esc(u[m.id][0])}${u[m.id].length > 1 ? ` 等 ${u[m.id].length}` : ''}</span>` : ''}</div>
    ${edit ? `<input data-alt="${m.id}" value="${esc(m.alt || '')}" placeholder="說明（選填）" maxlength="60"><div class="md-name">${esc(m.name || '')}${m.folder ? '・' + esc(m.folder) : ''}</div>` : ''}
  </div>`;
}

async function loadMedia() {
  if (!media) { $('#mdGrid').innerHTML = '<p class="hint">載入中…</p>'; try { await fetchMedia(); } catch (err) { $('#mdGrid').innerHTML = `<p class="hint">讀取失敗：${esc(errText(err))}</p>`; return; } }
  renderMedia();
}
function renderMedia() {
  if (!media) return;
  if (mdFolder && mdFolder !== NONE && mdFolder !== UNUSED && !folders().includes(mdFolder)) mdFolder = '';
  const list = filtered(mdFolder, mdQuery), u = usage();
  const mb = media.reduce((t, m) => t + (m.size || 0), 0) / 1048576;
  $('#mdTotal').textContent = `共 ${media.length} 張${mb ? `・${mb.toFixed(1)} MB` : ''}`;
  const real = mdFolder && mdFolder !== NONE && mdFolder !== UNUSED;
  $('#mdFoldersBar').innerHTML = folderChips(mdFolder, true) + (real ? `<button class="md-ren" data-ren>✎ 改資料夾名稱</button>` : '');
  $('#mdGrid').innerHTML = list.map(m => tile(m, mdSel.has(m.id), u, true)).join('') || `<div class="empty-state" style="grid-column:1/-1"><b>${media.length ? '這裡沒有照片' : '媒體庫還是空的'}</b>${media.length ? '' : '把照片拖到上面，或按「選擇照片」'}</div>`;
  for (const id of mdSel) if (!media.some(m => m.id === id)) mdSel.delete(id);
  $('#mdBar').dataset.n = mdSel.size;
  $('#mdSel').textContent = mdSel.size ? `已選 ${mdSel.size} 張` : '';
  $('#mdAll').checked = list.length > 0 && list.every(m => mdSel.has(m.id));
  $('#mdMoveTo').innerHTML = `<option value="">移到資料夾…</option>${folders().map(f => `<option value="f:${esc(f)}">📁 ${esc(f)}</option>`).join('')}<option value="new">＋ 新資料夾…</option><option value="none">未分類</option>`;
  $('#mdToAlbum').innerHTML = `<option value="">加到網站相簿…</option>${SLOTS.map(s => `<option value="${s.id}">${esc(s.single ? s.name + '（換成這張）' : (albumTitles[s.id] || s.name))}</option>`).join('')}`;
}

// ---- 上傳（檔案、資料夾、拖放）----
async function uploadBatch(entries) {
  const imgs = entries.filter(e => /^image\//.test(e.file.type) || /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(e.file.name));
  if (!imgs.length) { $('#mdStatus').textContent = '沒有可以上傳的照片'; return; }
  if (!media) await fetchMedia();
  const here = mdFolder && mdFolder !== NONE && mdFolder !== UNUSED ? mdFolder : '';
  let ok = 0; const bad = [];
  for (const [i, e] of imgs.entries()) {
    $('#mdStatus').textContent = `上傳中 ${i + 1} / ${imgs.length}…`;
    try { await uploadMedia(e.file, e.dir || here); ok++; } catch (err) { bad.push(e.file.name); console.warn(err); }
    if (i % 4 === 3) renderMedia();
  }
  $('#mdStatus').textContent = `完成，上傳 ${ok} 張 ✓` + (bad.length ? `；${bad.length} 張失敗（${bad.slice(0, 3).join('、')}${bad.length > 3 ? '…' : ''}，iPhone 的 HEIC 請先轉 JPG）` : '');
  const dirs = [...new Set(imgs.map(e => e.dir).filter(Boolean))];
  if (dirs.length === 1) mdFolder = dirs[0];
  renderMedia();
}
const lastDir = path => { const p = path.split('/'); return p.length > 1 ? p[p.length - 2] : ''; };
$('#mdFiles').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; uploadBatch(f.map(file => ({ file, dir: '' }))); });
$('#mdFolder').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; uploadBatch(f.map(file => ({ file, dir: lastDir(file.webkitRelativePath || '') }))); });
const drop = $('#mdDrop');
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
drop.addEventListener('drop', async e => {
  e.preventDefault();
  const items = [...(e.dataTransfer.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!items.length) return uploadBatch([...e.dataTransfer.files].map(file => ({ file, dir: '' })));
  $('#mdStatus').textContent = '讀取中…';
  const out = [];
  const walk = async (ent, dir) => {
    if (ent.isFile) { out.push({ file: await new Promise((ok, no) => ent.file(ok, no)), dir }); return; }
    const rd = ent.createReader(); let batch;
    do { batch = await new Promise((ok, no) => rd.readEntries(ok, no)); for (const c of batch) await walk(c, ent.name); } while (batch.length);
  };
  for (const it of items) await walk(it, '');
  uploadBatch(out);
});

// ---- 篩選、選取、批次動作 ----
$('#mdSearch').addEventListener('input', e => { mdQuery = e.target.value.trim().toLowerCase(); renderMedia(); });
$('#mdFoldersBar').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.ren !== undefined) {
    const name = prompt('新的資料夾名稱', mdFolder)?.trim(); if (!name || name === mdFolder) return;
    const list = media.filter(m => m.folder === mdFolder);
    await Promise.all(list.map(m => F.updateDoc(F.doc(db, 'media', m.id), { folder: name }).then(() => { m.folder = name; })));
    mdFolder = name; renderMedia(); return;
  }
  mdFolder = b.dataset.f; renderMedia();
});
$('#mdGrid').addEventListener('click', e => {
  const it = e.target.closest('.md-item'); if (!it || e.target.matches('input')) return;
  const id = it.dataset.id; mdSel.has(id) ? mdSel.delete(id) : mdSel.add(id); renderMedia();
});
$('#mdGrid').addEventListener('change', async e => {
  const id = e.target.dataset.alt; if (!id) return;
  const m = media.find(x => x.id === id); m.alt = e.target.value.trim();
  await F.updateDoc(F.doc(db, 'media', id), { alt: m.alt }).then(() => { $('#mdStatus').textContent = '說明已儲存 ✓'; }).catch(err => { $('#mdStatus').textContent = '儲存失敗：' + errText(err); });
});
$('#mdAll').addEventListener('change', e => { const list = filtered(mdFolder, mdQuery); list.forEach(m => e.target.checked ? mdSel.add(m.id) : mdSel.delete(m.id)); renderMedia(); });
$('#mdMoveTo').addEventListener('change', async e => {
  const v = e.target.value; if (!v || !mdSel.size) return;
  const folder = v === 'new' ? prompt('新資料夾名稱')?.trim() : v === 'none' ? '' : v.slice(2);
  if (folder === undefined || (v === 'new' && !folder)) return renderMedia();
  await Promise.all([...mdSel].map(id => F.updateDoc(F.doc(db, 'media', id), { folder }).then(() => { media.find(m => m.id === id).folder = folder; })));
  $('#mdStatus').textContent = `已移動 ${mdSel.size} 張 ✓`; mdSel.clear(); if (folder) mdFolder = folder; renderMedia();
});
$('#mdToAlbum').addEventListener('change', async e => {
  const id = e.target.value; if (!id || !mdSel.size) return;
  const picked = media.filter(m => mdSel.has(m.id));
  await addToAlbum(id, picked);
  const s = SLOTS.find(x => x.id === id);
  $('#mdStatus').textContent = `已加到「${albumTitles[id] || s.name}」✓（到 網站內容 → 照片 可以排順序）`; mdSel.clear(); renderMedia();
});
$('#mdDel').addEventListener('click', async () => {
  if (!mdSel.size) return;
  const u = usage(), used = [...mdSel].filter(id => u[id]);
  if (!confirm(`刪除 ${mdSel.size} 張照片？${used.length ? `\n其中 ${used.length} 張正用在網站相簿，會一起從相簿拿掉。` : ''}\n刪了就救不回來。`)) return;
  const ids = new Set(mdSel), changed = new Set();
  for (const s of SLOTS) { const before = (albums[s.id] || []).length; albums[s.id] = (albums[s.id] || []).filter(g => !ids.has(g.mediaId)); if (albums[s.id].length !== before) changed.add(s.id); }
  for (const id of changed) { await saveAlbum(id).catch(() => {}); renderSlot(id); }
  for (const id of ids) {
    const m = media.find(x => x.id === id);
    await F.deleteDoc(F.doc(db, 'media', id)).catch(() => {});
    if (m?.path) ST.deleteObject(ST.ref(storage, m.path)).catch(() => {});
  }
  media = media.filter(m => !ids.has(m.id)); mdSel.clear();
  $('#mdStatus').textContent = `已刪除 ${ids.size} 張`; renderMedia();
});

async function addToAlbum(id, picked) {
  const s = SLOTS.find(x => x.id === id);
  if (s.single) albums[id] = [];
  albums[id] = albums[id] || [];
  for (const m of s.single ? picked.slice(0, 1) : picked) if (!albums[id].some(g => g.mediaId === m.id)) albums[id].push({ url: m.url, mediaId: m.id, caption: m.alt || '' });
  await saveAlbum(id);
  if ($(`.ph[data-slot="${id}"]`)) renderSlot(id);
}

// ---- 從媒體庫選（相簿用）----
function openPicker({ single = false, title = '從媒體庫選' } = {}) {
  return new Promise(async done => {
    const ov = document.createElement('div'); ov.className = 'mp-ov';
    ov.innerHTML = `<div class="mp-box"><div class="mp-head"><h3>${esc(title)}</h3><input type="search" class="inp" placeholder="搜尋" data-q><button class="mp-x" data-x>✕</button></div>
      <div class="md-folders" data-fs></div><div class="md-grid" data-g><p class="hint">載入中…</p></div>
      <div class="mp-foot"><span class="muted" data-n></span><label class="btn btn-ghost btn-sm">＋ 上傳新的<input type="file" accept="image/*" multiple hidden data-up></label><button class="btn btn-sm" data-ok disabled>加入</button></div></div>`;
    document.body.appendChild(ov);
    const q = s => ov.querySelector(s), sel = new Map();
    let folder = localStorage.getItem('mp_folder') || '', query = '';
    const close = r => { ov.remove(); done(r); };
    const draw = () => {
      if (folder && !folders().includes(folder) && folder !== NONE) folder = '';
      const u = usage(), list = filtered(folder, query);
      q('[data-fs]').innerHTML = folderChips(folder, false);
      q('[data-g]').innerHTML = list.map(m => tile(m, sel.has(m.id), u, false)).join('') || `<p class="hint" style="grid-column:1/-1">${media.length ? '這裡沒有照片' : '媒體庫還是空的，按右下「上傳新的」'}</p>`;
      q('[data-n]').textContent = sel.size ? `已選 ${sel.size} 張` : (single ? '選一張' : '可以選多張');
      q('[data-ok]').disabled = !sel.size; q('[data-ok]').textContent = sel.size ? `加入 ${sel.size} 張` : '加入';
    };
    try { await fetchMedia(); } catch (err) { q('[data-g]').innerHTML = `<p class="hint">讀取失敗：${esc(errText(err))}</p>`; }
    if (media) draw();
    ov.addEventListener('click', e => {
      if (e.target === ov || e.target.closest('[data-x]')) return close([]);
      if (e.target.closest('[data-ok]')) return close([...sel.values()]);
      const f = e.target.closest('[data-f]'); if (f) { folder = f.dataset.f; localStorage.setItem('mp_folder', folder); return draw(); }
      const it = e.target.closest('.md-item'); if (!it) return;
      const m = media.find(x => x.id === it.dataset.id);
      if (single) { sel.clear(); sel.set(m.id, m); } else sel.has(m.id) ? sel.delete(m.id) : sel.set(m.id, m);
      draw();
    });
    q('[data-q]').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); draw(); });
    q('[data-up]').addEventListener('change', async e => {
      const files = [...e.target.files]; e.target.value = '';
      const here = folder && folder !== NONE ? folder : '';
      for (const [i, file] of files.entries()) {
        q('[data-n]').textContent = `上傳中 ${i + 1} / ${files.length}…`;
        try { const m = await uploadMedia(file, here); if (single) sel.clear(); sel.set(m.id, media.find(x => x.id === m.id)); } catch (err) { q('[data-n]').textContent = '上傳失敗：' + errText(err); }
      }
      draw();
    });
  });
}

/* ---------- IG 影片封面：site/config.reelCovers[網址] = 圖片網址（從媒體庫選）；有封面的影片卡網站上只顯示封面＋播放鍵，大小一致 ---------- */
function redrawReelRows() { if (cfg) renderReels(); for (const s of SLOTS) if ($(`.ph[data-slot="${s.id}"].open`)) renderSlot(s.id); }
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-cover]'); if (!b) return;
  e.stopPropagation();
  const u = b.dataset.cover;
  if (reelCovers[u] && !confirm('換一張封面？（按「取消」可以選擇移除封面）')) {
    if (!confirm('移除這支影片的封面？')) return;
    delete reelCovers[u];
    await F.setDoc(F.doc(db, 'site', 'config'), { reelCovers: { [u]: F.deleteField() } }, { merge: true }).catch(err => alert('失敗：' + errText(err)));
    return redrawReelRows();
  }
  const [m] = await openPicker({ single: true, title: '選影片封面（直的照片最好看）' });
  if (!m) return;
  reelCovers[u] = m.url;
  await F.setDoc(F.doc(db, 'site', 'config'), { reelCovers: { [u]: m.url } }, { merge: true }).catch(err => alert('失敗：' + errText(err)));
  redrawReelRows();
}, true);

/* ---------- 首頁主圖與背景位置：site/config.heroArt = { x, y, zoom }（主圖）、heroBg = { url, x, y, zoom, dim }（背景，預設熊） ---------- */
const HB0 = { url: '', x: 50, y: 100, zoom: 100, dim: 50 }, HA0 = { x: 50, y: 50, zoom: 100 };
let heroBg = { ...HB0 }, heroArt = { ...HA0 }, hbWhich = 'art', hbT = null;
const hbCur = () => hbWhich === 'art' ? heroArt : heroBg;
function setVars(el, o) { el.style.setProperty('--x', o.x + '%'); el.style.setProperty('--y', o.y + '%'); el.style.setProperty('--z', o.zoom / 100); if (o.dim != null) el.style.setProperty('--o', o.dim / 100); }
// 預覽＝真正的首頁（iframe），用這台電腦螢幕的寬高縮小顯示，所以跟網站上看到的一樣
const HBV = { w: Math.max(1280, Math.min(screen.availWidth || 1440, 2560)), h: 0 };
HBV.h = Math.max(700, Math.min((screen.availHeight || 900) - 130, HBV.w * .75));
function hbLayout() {
  const pv = $('#hbPrev'), fr = $('#hbFrame'); if (!pv || !pv.clientWidth) return 0;
  const k = pv.clientWidth / HBV.w;
  pv.style.height = HBV.h * k + 'px';
  fr.style.width = HBV.w + 'px'; fr.style.height = HBV.h + 'px'; fr.style.transform = `scale(${k})`;
  $('#hbArtBox').style.width = Math.min(HBV.w * .55, 860) * k + 'px';
  return k;
}
function drawHb() {
  const fr = $('#hbFrame'); if (!fr) return;
  if (!fr.src) { fr.src = '/?heroPreview=1'; fr.addEventListener('load', () => setTimeout(drawHb, 300)); }
  hbLayout();
  fr.contentWindow?.postMessage({ type: 'heroPreview', heroArt, heroBg }, location.origin);
  const c = hbCur(); $('#hbX').value = c.x; $('#hbY').value = c.y; $('#hbZ').value = c.zoom; $('#hbD').value = heroBg.dim;
  $('#hbDL').hidden = hbWhich === 'art'; $('#hbPrev').classList.toggle('edit-art', hbWhich === 'art');
  $('#hbBear').hidden = !heroBg.url;
  const a = (albums.hero || [])[0]?.url || legacyPhotos.hero || '';
  if (!a) $('#hbMsg').textContent = '還沒上傳「首頁主圖」，先到上面照片區上傳（預覽要重新整理才會出現）';
}
addEventListener('resize', () => hbLayout());
function saveHb(now) {
  clearTimeout(hbT); $('#hbMsg').textContent = '儲存中…';
  hbT = setTimeout(() => F.setDoc(F.doc(db, 'site', 'config'), { heroBg, heroArt }, { merge: true })
    .then(() => { $('#hbMsg').textContent = '已儲存 ✓（網站重新整理就看得到）'; })
    .catch(err => { $('#hbMsg').textContent = '儲存失敗：' + errText(err); }), now ? 0 : 600);
}
$('#hbWhich').addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (!b) return; hbWhich = b.dataset.w; document.querySelectorAll('#hbWhich button').forEach(x => x.classList.toggle('active', x === b)); $('#hbMsg').textContent = ''; drawHb(); });
[['hbX', 'x'], ['hbY', 'y'], ['hbZ', 'zoom']].forEach(([id, k]) => $('#' + id).addEventListener('input', e => { hbCur()[k] = Number(e.target.value); drawHb(); saveHb(); }));
$('#hbD').addEventListener('input', e => { heroBg.dim = Number(e.target.value); drawHb(); saveHb(); });
$('#hbPick').addEventListener('click', async () => { const [m] = await openPicker({ single: true, title: '選首頁背景圖' }); if (!m) return; heroBg.url = m.url; drawHb(); saveHb(true); });
$('#hbBear').addEventListener('click', () => { heroBg.url = ''; drawHb(); saveHb(true); });
$('#hbReset').addEventListener('click', () => { if (hbWhich === 'art') heroArt = { ...HA0 }; else heroBg = { ...HB0, url: heroBg.url }; drawHb(); saveHb(true); });
// 在預覽上拖曳：往右拖＝圖往右移
(() => {
  const pv = $('#hbDrag'); let st = null;
  pv.addEventListener('pointerdown', e => { const c = hbCur(); st = { px: e.clientX, py: e.clientY, x: c.x, y: c.y }; pv.setPointerCapture(e.pointerId); });
  pv.addEventListener('pointermove', e => {
    if (!st) return; const c = hbCur(), k = hbLayout(), z = c.zoom / 100;
    const w = (hbWhich === 'art' ? Math.min(HBV.w * .55, 860) : HBV.w) * k, h = HBV.h * k;
    c.x = Math.round(Math.min(100, Math.max(0, st.x - (e.clientX - st.px) / w * 100 / z)));
    c.y = Math.round(Math.min(100, Math.max(0, st.y - (e.clientY - st.py) / h * 100 / z)));
    drawHb();
  });
  const end = () => { if (st) { st = null; saveHb(); } };
  pv.addEventListener('pointerup', end); pv.addEventListener('pointercancel', end);
})();

/* ---------- 網站內容：每區收成下拉式，一次只開一區 ---------- */
(() => {
  const META = {
    cPhotos: ['🖼', '照片相簿', '教練照、訓練照片、首頁主圖'],
    cHero: ['🐻', '首頁主圖位置', '調整主圖和背景熊的位置'],
    cReels: ['▶', 'IG 影片', '首頁「訓練影片」輪播'],
    cContact: ['☎', '聯絡方式', 'LINE、IG、電話'],
    cClasses: ['📅', '固定課表', '首頁課表'],
    cBooking: ['⏰', '私人課預約時段', '開放時段、幾天內可預約'],
    cOff: ['🌴', '休假日', '整天不開放預約的日期']
  };
  const panels = [...document.querySelectorAll('#contentView > .panel[id]')];
  panels.forEach(p => {
    const m = META[p.id]; if (!m) return;
    const body = document.createElement('div'); body.className = 'acc-b';
    while (p.firstChild) body.appendChild(p.firstChild);
    const h = document.createElement('button'); h.type = 'button'; h.className = 'acc-h';
    h.innerHTML = `<span class="acc-ic">${m[0]}</span><div><b>${m[1]}</b><small>${m[2]}</small></div>`;
    p.classList.add('acc'); p.append(h, body);
    h.addEventListener('click', () => {
      const open = !p.classList.contains('open');
      panels.forEach(x => x.classList.remove('open'));
      if (open) { p.classList.add('open'); setTimeout(() => p.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30); if (p.id === 'cHero') setTimeout(drawHb, 50); }
    });
  });
})();

/* ================= LINE 訊息收件匣：chats/{LINE uid}＋msgs（Functions 寫入），回覆走 adminChat ================= */
const CHAT_API = 'https://asia-east1-tupo-chongwei.cloudfunctions.net/adminChat';
let chats = [], chatUnsub = null, curChat = null, msgUnsub = null;
const ago = ms => { if (!ms) return ''; const d = (Date.now() - ms) / 6e4; if (d < 1) return '剛剛'; if (d < 60) return `${Math.floor(d)} 分`; if (d < 1440) return `${Math.floor(d / 60)} 小時`; const t = new Date(ms); return `${t.getMonth() + 1}/${t.getDate()}`; };
const tms = x => x?.toMillis?.() || x?._ms || 0;
const av = c => c.pic ? `<span class="ib-av" style="background-image:url('${esc(c.pic)}')"></span>` : `<span class="ib-av">${esc((c.name || '?').slice(0, 1))}</span>`;
function startInbox() {
  if (chatUnsub) return;
  chatUnsub = F.onSnapshot(F.collection(db, 'chats'), snap => {
    chats = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => tms(b.lastAt) - tms(a.lastAt));
    renderChatList();
    const unread = chats.filter(c => c.unread > 0 && c.lastDir === 'in');
    const nb = document.querySelector('[data-badge=messages]'); if (nb) { nb.hidden = !unread.length; nb.textContent = unread.length; }
    crm?.setChats?.(unread.map(c => ({ id: 'c' + c.id + tms(c.lastAt), t: `💬 ${c.studentName || c.name || 'LINE 好友'}`, s: c.last || '', go: 'messages', at: tms(c.lastAt) })));
  }, err => { $('#ibList').innerHTML = `<p class="hint" style="padding:1rem">讀取失敗：${esc(err.message)}</p>`; });
}
function renderChatList() {
  $('#ibList').innerHTML = chats.map(c => `<div class="ib-row ${curChat === c.id ? 'on' : ''}" data-chat="${c.id}">${av(c)}<div>
    <b><span>${esc(c.studentName ? `${c.studentName}（${c.name}）` : c.name || 'LINE 好友')}</span><small>${ago(tms(c.lastAt))}</small></b>
    <p>${c.lastDir === 'out' ? '你：' : ''}${esc(c.last || '')}</p></div>${c.unread > 0 && c.lastDir === 'in' ? `<span class="ib-u">${c.unread}</span>` : ''}</div>`).join('')
    || '<p class="hint" style="padding:1rem">還沒有訊息。有人傳訊息給官方帳號就會出現在這裡。</p>';
}
function openThread(id) {
  curChat = id; msgUnsub?.(); const c = chats.find(x => x.id === id) || { id };
  $('#inbox').classList.add('open'); renderChatList();
  $('#ibThread').innerHTML = `<div class="ib-head"><button class="icon-btn ib-back" data-ibback>‹</button>${av(c)}<div><b>${esc(c.studentName ? `${c.studentName}（${c.name}）` : c.name || 'LINE 好友')}</b><small>User ID：${esc(id)}</small></div></div>
    <div class="ib-msgs" id="ibMsgs"></div>
    <form class="ib-send" id="ibSend"><textarea id="ibText" rows="1" placeholder="輸入訊息…（Enter 送出，Shift+Enter 換行）" maxlength="2000"></textarea><button class="btn btn-sm">傳送</button></form>`;
  if (c.unread) F.setDoc(F.doc(db, 'chats', id), { unread: 0 }, { merge: true }).catch(() => {});
  msgUnsub = F.onSnapshot(F.collection(db, 'chats', id, 'msgs'), snap => {
    const ms = snap.docs.map(d => d.data()).sort((a, b) => tms(a.at) - tms(b.at)).slice(-200);
    const box = $('#ibMsgs'); if (!box) return;
    box.innerHTML = ms.map(m => `<div class="ib-m ${m.dir === 'out' ? 'out' : m.type === 'system' ? 'system' : 'in'}">${esc(m.text)}<time>${tms(m.at) ? new Date(tms(m.at)).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</time></div>`).join('') || '<div class="ib-empty">沒有訊息</div>';
    box.scrollTop = box.scrollHeight;
    if (curChat === id && chats.find(x => x.id === id)?.unread) F.setDoc(F.doc(db, 'chats', id), { unread: 0 }, { merge: true }).catch(() => {});
  });
}
function closeThread() { msgUnsub?.(); msgUnsub = null; curChat = null; $('#inbox')?.classList.remove('open'); }
$('#ibList').addEventListener('click', e => { const r = e.target.closest('[data-chat]'); if (r) openThread(r.dataset.chat); });
$('#ibThread').addEventListener('click', e => { if (e.target.closest('[data-ibback]')) { closeThread(); renderChatList(); } });
$('#ibThread').addEventListener('keydown', e => { if (e.target.id === 'ibText' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#ibSend').requestSubmit(); } });
$('#ibThread').addEventListener('submit', async e => {
  e.preventDefault(); const ta = $('#ibText'), t = ta.value.trim(); if (!t || !curChat) return;
  const btn = e.target.querySelector('button'); btn.disabled = true;
  try {
    const r = await fetch(CHAT_API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await auth.currentUser.getIdToken()}` }, body: JSON.stringify({ to: curChat, text: t }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '傳送失敗');
    ta.value = '';
  } catch (err) { alert(err.message); }
  btn.disabled = false; ta.focus();
});
A.onAuthStateChanged(auth, u => { if (u) startInbox(); else { chatUnsub?.(); chatUnsub = null; } });
window.__closeThread = closeThread;
$('#engDelAll').addEventListener('click', async () => {
  if (!isEngineer() || !curGroup.length) return;
  if (!confirm(`刪除這個分頁的 ${curGroup.length} 筆預約？\n（直接從資料庫刪掉，救不回來）`)) return;
  await deleteBookings(curGroup.slice()).catch(err => alert('刪除失敗：' + err.message));
});
