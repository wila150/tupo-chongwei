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
}
A.onAuthStateChanged(auth, user => {
  $('#loginView').hidden = !!user;
  $('#appView').hidden = !user;
  unsub?.(); unsub = null;
  if (!user) return;
  $('#userName').textContent = user.displayName || '教練';
  $('#userEmail').textContent = user.email || '';
  if (user.photoURL) $('#userPhoto').src = user.photoURL;
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
  $('#list').innerHTML = items.length ? items.map(card).join('') : `<div class="empty-state"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18"/></svg><b>${{ pending: '沒有待確認的預約', upcoming: '還沒有即將上課的預約', past: '還沒有上過的課', cancelled: '沒有取消的預約' }[filter]}</b>學員從網站預約後會出現在這裡，也會傳 LINE 通知你</div>`;
}

function card(b) {
  const d = new Date(`${b.date}T00:00:00`);
  const tel = esc(b.phone).replace(/[^0-9+]/g, '');
  const actions = [];
  if (b.status === 'pending') actions.push(`<button class="btn" data-act="confirm" data-id="${b.id}">確認</button>`);
  if (b.status !== 'cancelled') actions.push(`<button class="btn btn-ghost" data-act="cancel" data-id="${b.id}">取消</button>`);
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
  btn.disabled = true;
  try {
    const batch = F.writeBatch(db);
    if (btn.dataset.act === 'confirm') {
      batch.update(F.doc(db, 'bookings', b.id), { status: 'confirmed' });
      batch.set(slot, { date: b.date, time: b.time });
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
const TITLES = { home: '總覽', bookings: '網站預約', lessons: '課務扣堂', students: '學員', report: '報表', content: '網站內容' };
function showView(v) {
  document.querySelectorAll('#views button').forEach(x => x.classList.toggle('active', x.dataset.v === v));
  for (const k of Object.keys(TITLES)) { const el = document.getElementById(`${k}View`); if (el) el.hidden = k !== v; }
  $('#pageTitle').textContent = TITLES[v];
  const d = new Date(); $('#pageSub').textContent = v === 'home' ? `${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${DAY[d.getDay()]}・${greet()}，${(auth.currentUser?.displayName || '教練').split(' ')[0]}` : '';
  if (v === 'content' && !cfg) loadContent();
  if (v === 'content' && !photosLoaded) loadPhotos();
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
  { id: 'g1', name: '訓練照片 1', where: '私人課區（大張）', max: 1600 },
  { id: 'g2', name: '訓練照片 2', where: '私人課區', max: 1600 },
  { id: 'g3', name: '訓練照片 3', where: '私人課區', max: 1600 },
  { id: 'hero', name: '首頁背景', where: '首頁最上方（會壓暗，只用一張）', max: 1920, single: true }
];
let photosLoaded = false, albums = {}, albumTitles = {}, albumDesc = {}, albumReels = {}, legacyPhotos = {};

async function loadPhotos() {
  photosLoaded = true;
  try {
    const snap = await F.getDoc(F.doc(db, 'site', 'config'));
    const d = snap.exists() ? snap.data() : {};
    albums = d.albums || {}; albumTitles = d.albumTitles || {}; albumDesc = d.albumDesc || {}; albumReels = d.albumReels || {}; legacyPhotos = d.photos || {};
  } catch {}
  // 舊版單張照片轉成相簿第一張
  for (const s of SLOTS) if (!albums[s.id]?.length && legacyPhotos[s.id]) albums[s.id] = [{ url: legacyPhotos[s.id], path: `photos/${s.id}.webp`, caption: '' }];
  $('#photoGrid').innerHTML = SLOTS.map(s => `<div class="ph" data-slot="${s.id}"></div>`).join('');
  SLOTS.forEach(s => renderSlot(s.id));
}

function renderSlot(id) {
  const s = SLOTS.find(x => x.id === id), card = $(`.ph[data-slot="${id}"]`), list = albums[id] || [];
  const open = card.classList.contains('open');
  card.innerHTML = `
    <div class="ph-img" style="${list[0] ? `background-image:url('${list[0].url}')` : ''}">${list[0] ? '' : '尚未上傳'}${list.length > 1 ? `<span class="cnt">📷 ${list.length} 張</span>` : ''}</div>
    <div class="ph-body"><b>${s.name}</b><small>${s.where}</small>
      ${s.single ? '' : `<input class="inp" data-title value="${esc(albumTitles[id] || '')}" placeholder="相簿名稱（例：比賽紀錄）" maxlength="20">`}
      <div class="ph-actions"><label class="btn btn-sm">${s.single ? (list.length ? '換一張' : '上傳') : '＋ 加照片'}<input type="file" accept="image/*" ${s.single ? '' : 'multiple'} hidden></label>
      ${!s.single ? `<button type="button" class="btn btn-ghost btn-sm" data-manage>${open ? '收起' : `管理相簿（${list.length} 照片・${(albumReels[id] || []).length} 影片）`}</button>` : ''}
      ${s.single && list.length ? '<button type="button" class="btn btn-ghost btn-sm" data-rmall>移除</button>' : ''}</div>
      <small class="ph-msg"></small></div>
    ${open && !s.single ? `<div class="alb-extra">
      <label class="field">相簿說明（顯示在相簿頁最上面）<textarea class="inp" data-desc rows="3" maxlength="600" placeholder="例：2026 全國拳擊錦標賽，帶學員出賽的紀錄。">${esc(albumDesc[id] || '')}</textarea></label>
      <div class="field">IG Reels 影片<div style="display:flex;gap:.5rem;margin-top:.3rem"><input class="inp" data-reelurl placeholder="貼上 Reels 連結"><button type="button" class="btn btn-ghost btn-sm" data-addreel>加入</button></div></div>
      ${(albumReels[id] || []).map((u, i) => `<div class="reel-row"><a href="${esc(u)}" target="_blank" rel="noopener">▶ ${esc(u.replace('https://www.instagram.com', ''))}</a><button type="button" data-rmreel="${i}" title="刪除">✕</button></div>`).join('')}
      <a class="btn btn-ghost btn-sm" href="/album?id=${id}" target="_blank" style="justify-self:start">預覽相簿頁 →</a>
    </div>` : ''}
    ${open && !s.single ? `<div class="alb-list">${list.map((g, i) => `<div class="gal-item">
      <div class="ph-img" style="background-image:url('${g.url}')">${i === 0 ? '<span class="cnt">封面</span>' : ''}</div>
      <input data-cap="${i}" value="${esc(g.caption || '')}" placeholder="說明" maxlength="60">
      <div class="gal-acts"><button data-move="${i}" data-d="-1" title="往前">←</button><button data-move="${i}" data-d="1" title="往後">→</button><button data-del="${i}" title="刪除">✕</button></div>
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
  return new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('照片轉檔失敗')), 'image/webp', 0.85));
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
      const blob = await compress(file, s.max);
      const path = `photos/albums/${id}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.webp`;
      const r = ST.ref(storage, path);
      await ST.uploadBytes(r, blob, { contentType: 'image/webp', cacheControl: 'public, max-age=31536000' });
      albums[id].push({ url: await ST.getDownloadURL(r), path, caption: '' });
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
  if (b.matches('[data-manage]')) { card.classList.toggle('open'); renderSlot(id); return; }
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
  if (b.dataset.move !== undefined) {
    const i = Number(b.dataset.move), j = i + Number(b.dataset.d);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await saveAlbum(id).catch(() => {}); renderSlot(id); slotMsg($(`.ph[data-slot="${id}"]`), j === 0 ? '已設為封面 ✓' : '順序已儲存 ✓');
  } else if (b.dataset.del !== undefined) {
    if (!confirm('刪除這張照片？')) return;
    const [g] = list.splice(Number(b.dataset.del), 1);
    await saveAlbum(id).catch(() => {}); if (g.path) ST.deleteObject(ST.ref(storage, g.path)).catch(() => {});
    if (!list.length) card.classList.remove('open');
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
    <a href="${esc(u)}" target="_blank" rel="noopener">${i + 1}. ${esc(u.replace('https://www.instagram.com', ''))}</a>
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
