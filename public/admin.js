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
const app = initializeApp(firebaseConfig);
const auth = A.getAuth(app);
const db = F.getFirestore(app);

let all = [], filter = 'pending', unsub = null;

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginError').textContent = '';
  const f = new FormData(e.target);
  try { await A.signInWithEmailAndPassword(auth, f.get('email'), f.get('password')); }
  catch { $('#loginError').textContent = '帳號或密碼錯誤'; }
});
$('#logout').addEventListener('click', () => A.signOut(auth));

A.onAuthStateChanged(auth, user => {
  $('#loginView').hidden = !!user;
  $('#appView').hidden = !user;
  unsub?.(); unsub = null;
  if (!user) return;
  const q = F.query(F.collection(db, 'bookings'), F.orderBy('date'));
  unsub = F.onSnapshot(q, snap => {
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
  $('#cUpcoming').textContent = groups.upcoming.length;
  const items = groups[filter];
  $('#list').innerHTML = items.length ? items.map(card).join('') : '<p class="empty">目前沒有資料</p>';
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
      <div class="bk-who">${esc(b.name)}　<a href="tel:${tel}">📞 ${esc(b.phone)}</a>${b.lineId ? `　LINE：${esc(b.lineId)}` : ''}</div>
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
    } else {
      if (!confirm(`取消 ${b.name} 的預約？`)) { btn.disabled = false; return; }
      batch.update(F.doc(db, 'bookings', b.id), { status: 'cancelled' });
      if (b.status === 'confirmed') batch.delete(slot);
    }
    await batch.commit();
  } catch (err) {
    alert('更新失敗：' + err.message);
    btn.disabled = false;
  }
});

/* ================= 網站內容編輯 ================= */
$('#views').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#views button').forEach(x => x.classList.toggle('active', x === b));
  $('#bookingsView').hidden = b.dataset.v !== 'bookings';
  $('#contentView').hidden = b.dataset.v !== 'content';
  if (b.dataset.v === 'content' && !cfg) loadContent();
  if (b.dataset.v === 'content' && !photosLoaded) loadPhotos();
});

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
      closedDates: d.closedDates || []
    };
  } catch (err) {
    console.warn(err);
    cfg = { contact: base.contact, classes: base.classes, booking: base.booking, closedDates: [] };
    $('#saveMsg').textContent = '（目前顯示網站預設內容）';
  }
  renderContent();
}

function renderContent() {
  $('#cLineOA').value = cfg.contact.lineOA || '';
  $('#cIg').value = cfg.contact.instagram || '';
  $('#cPhone').value = cfg.contact.phone || '';
  renderClasses(); renderTimes(); renderOff();
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

/* ---------- 照片：瀏覽器端壓縮後存 Firestore photos/{slot}（免 Storage／付費方案） ---------- */
const SLOTS = [
  { id: 'coach', name: '教練照片', where: '「關於教練」', max: 1400 },
  { id: 'g1', name: '訓練照片 1', where: '私人課相簿（大張）', max: 1600 },
  { id: 'g2', name: '訓練照片 2', where: '私人課相簿', max: 1200 },
  { id: 'g3', name: '訓練照片 3', where: '私人課相簿', max: 1200 },
  { id: 'hero', name: '首頁背景', where: '首頁最上方（會壓暗）', max: 1920 }
];
let photosLoaded = false;

async function loadPhotos() {
  photosLoaded = true;
  $('#photoGrid').innerHTML = SLOTS.map(s => `<div class="ph" data-slot="${s.id}">
    <div class="ph-img">讀取中…</div>
    <div class="ph-body"><b>${s.name}</b><small>${s.where}</small>
      <div class="ph-actions"><label class="btn btn-sm">上傳<input type="file" accept="image/*" hidden></label>
      <button type="button" class="btn btn-ghost btn-sm" data-rm hidden>移除</button></div>
      <small class="ph-msg"></small></div></div>`).join('');
  await Promise.all(SLOTS.map(async s => {
    const card = $(`.ph[data-slot="${s.id}"]`);
    let url = '';
    try { const snap = await F.getDoc(F.doc(db, 'photos', s.id)); url = snap.exists() ? snap.data().data : ''; } catch {}
    showPhoto(card, url);
  }));
}

function showPhoto(card, url) {
  const box = card.querySelector('.ph-img');
  box.style.backgroundImage = url ? `url('${url}')` : '';
  box.textContent = url ? '' : '尚未上傳';
  card.querySelector('[data-rm]').hidden = !url;
}

async function compress(file, max) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  for (let q = 0.82; q >= 0.4; q -= 0.08) {
    const url = c.toDataURL('image/webp', q);
    if (url.length < 900000) return url;
  }
  throw new Error('照片太大，請換一張');
}

$('#photoGrid').addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  const card = e.target.closest('.ph'), slot = SLOTS.find(s => s.id === card.dataset.slot), msg = card.querySelector('.ph-msg');
  msg.textContent = '壓縮上傳中…';
  try {
    const url = await compress(file, slot.max);
    await F.setDoc(F.doc(db, 'photos', slot.id), { data: url, updatedAt: F.serverTimestamp() });
    await F.setDoc(F.doc(db, 'site', 'config'), { photoVer: { [slot.id]: Date.now() } }, { merge: true });
    showPhoto(card, url); msg.textContent = `已更新 ✓（${Math.round(url.length * 0.75 / 1024)} KB）`;
  } catch (err) {
    msg.textContent = err.code === 'permission-denied' ? '失敗：這個帳號還沒有管理員權限' : '失敗：' + err.message;
  } finally { e.target.value = ''; }
});

$('#photoGrid').addEventListener('click', async e => {
  if (!e.target.matches('[data-rm]')) return;
  const card = e.target.closest('.ph'), msg = card.querySelector('.ph-msg');
  if (!confirm('移除這張照片？')) return;
  try {
    await F.deleteDoc(F.doc(db, 'photos', card.dataset.slot));
    await F.setDoc(F.doc(db, 'site', 'config'), { photoVer: { [card.dataset.slot]: F.deleteField() } }, { merge: true });
    showPhoto(card, ''); msg.textContent = '已移除';
  }
  catch (err) { msg.textContent = '失敗：' + err.message; }
});
