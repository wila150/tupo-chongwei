import { firebaseConfig } from './firebase-config.js';

const S = window.SITE;
const $ = (q, el = document) => el.querySelector(q);
const $$ = (q, el = document) => [...el.querySelectorAll(q)];
const DAY = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* ---------- Firebase (optional until config is filled) ---------- */
let db = null, fs = null;
if (firebaseConfig) {
  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    fs = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    db = fs.getFirestore(initializeApp(firebaseConfig));
  } catch (e) { console.error('Firebase init failed', e); }
}

/* ---------- 後台「網站內容」覆蓋 data.js 的預設值 ---------- */
S.closedDates = [];
if (db) {
  try {
    const snap = await Promise.race([
      fs.getDoc(fs.doc(db, 'site', 'config')),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
    ]);
    if (snap.exists()) {
      const d = snap.data();
      if (d.contact) Object.assign(S.contact, d.contact);
      if (Array.isArray(d.classes)) S.classes = d.classes;
      if (d.booking) Object.assign(S.booking, d.booking);
      if (Array.isArray(d.closedDates)) S.closedDates = d.closedDates;
      if (d.photos) S.photos = d.photos;
      if (Array.isArray(d.reels)) S.reels = d.reels;
      if (d.reelCovers) S.reelCovers = d.reelCovers;
      if (d.heroBg) S.heroBg = d.heroBg;
      if (d.heroArt) S.heroArt = d.heroArt;
      if (d.albums) S.albums = d.albums;
      if (d.albumTitles) S.albumTitles = d.albumTitles;
      if (d.albumReels) S.albumReels = d.albumReels;
    }
  } catch (e) { console.warn('site config not loaded, using data.js', e); }
}

/* ---------- nav ---------- */
const nav = $('#nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 40), { passive: true });
$('.nav-toggle').addEventListener('click', e => {
  const open = nav.classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', open);
});
$$('.nav-links a').forEach(a => a.addEventListener('click', () => nav.classList.remove('open')));
$('#year').textContent = new Date().getFullYear();

/* ---------- contact links ---------- */
$$('[data-contact]').forEach(a => {
  const key = a.dataset.contact, v = S.contact[key];
  if (!v) { a.classList.add('hidden'); if (a.closest('.cta')) a.remove(); return; }
  a.href = key === 'phone' ? `tel:${v}` : v;
});

/* ---------- photos: show only when the file exists ---------- */
$$('.photo-slot').forEach(el => {
  const m = /url\('(.+?)'\)/.exec(el.getAttribute('style') || '');
  if (!m) return;
  const img = new Image();
  img.onload = () => { if (!el.dataset.cover) el.classList.add('has-photo'); };
  img.onerror = () => { if (!el.dataset.cover) el.style.setProperty('--photo', 'none'); };
  img.src = m[1];
});

/* ---------- 燈箱（看相簿） ---------- */
const lb = $('#lightbox');
let lbList = [], lbCur = 0;
function openLightbox(list, i = 0) { lbList = list; showLb(i); lb.hidden = false; }
function showLb(i) { lbCur = (i + lbList.length) % lbList.length; $('#lbImg').src = lbList[lbCur].url; $('#lbCap').textContent = `${lbList[lbCur].caption || ''}${lbList.length > 1 ? `　${lbCur + 1} / ${lbList.length}` : ''}`; }
lb.addEventListener('click', e => {
  const a = e.target.closest('[data-lb]')?.dataset.lb;
  if (a === 'prev') showLb(lbCur - 1); else if (a === 'next') showLb(lbCur + 1); else if (a === 'close' || e.target === lb) lb.hidden = true;
});
addEventListener('keydown', e => { if (lb.hidden) return; if (e.key === 'ArrowLeft') showLb(lbCur - 1); if (e.key === 'ArrowRight') showLb(lbCur + 1); if (e.key === 'Escape') lb.hidden = true; });
let lbX = 0; lb.addEventListener('touchstart', e => { lbX = e.touches[0].clientX; }, { passive: true });
lb.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - lbX; if (Math.abs(dx) > 50) showLb(lbCur + (dx < 0 ? 1 : -1)); });

/* ---------- 固定照片位置＝相簿：第一張當封面，點進去是相簿頁 /album?id=<位置>（照片＋Reels） ---------- */
const albums = S.albums || {}, albumTitles = S.albumTitles || {}, albumReels = S.albumReels || {}, legacyPhotos = S.photos || {};
$$('.photo-slot[data-photo]').forEach(el => {
  const slot = el.dataset.photo;
  const list = (albums[slot] || []).filter(x => x && x.url);
  const reels = (albumReels[slot] || []).filter(Boolean);
  const cover = list[0]?.url || legacyPhotos[slot];
  if (cover && slot === 'hero') {
    // 首頁主圖：上傳的照片放右邊（原本熊的位置），熊改當整個背景（壓暗）
    const img = new Image();
    img.onload = () => {
      el.dataset.cover = '1'; el.style.setProperty('--photo', 'none'); el.classList.add('has-photo', 'bear-bg');
      // 背景（預設是熊）：後台「首頁背景」可換圖、調左右/上下/放大/亮度 → site/config.heroBg
      const bg = document.createElement('img'); bg.className = 'hero-bear'; bg.alt = ''; el.appendChild(bg);
      const art = document.querySelector('.hero-art img'); art.src = cover; art.closest('.hero-art').classList.add('is-photo'); document.querySelector('.hero').classList.add('has-art');
      applyHero();
    };
    img.src = cover;
  } else if (cover) {
    const img = new Image();
    el.dataset.cover = '1'; // 後台照片優先，舊的檔案檢查不要覆蓋
    img.onload = () => { el.style.setProperty('--photo', `url('${cover}')`); el.classList.add('has-photo'); };
    img.src = cover;
  }
  if (slot === 'hero' || (!list.length && !reels.length)) return;
  if (list.length > 1) slotSlideshow(el, list.map(x => x.url));
  const title = albumTitles[slot] || '';
  const cap = document.createElement('div');
  cap.className = 'slot-cap';
  cap.innerHTML = `<b></b><span>${[list.length ? `📷 ${list.length}` : '', reels.length ? `▶ ${reels.length}` : ''].filter(Boolean).join('　')}</span>`;
  cap.querySelector('b').textContent = title || '看更多';
  el.appendChild(cap);
  if (!cover) el.classList.add('has-photo', 'no-cover');
  el.classList.add('clickable');
  el.setAttribute('role', 'link'); el.tabIndex = 0;
  const go = () => { location.href = `/album?id=${slot}`; };
  el.addEventListener('click', go);
  el.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
});

/* 首頁照片格輪播：相簿有多張就每 7 秒淡入下一張（各格錯開；看不到、或滑鼠移上去時暫停） */
function slotSlideshow(el, urls) {
  const layers = urls.map((u, i) => { const d = document.createElement('div'); d.className = 'slot-fade' + (i ? '' : ' on'); d.dataset.src = u; el.appendChild(d); return d; });
  const dots = document.createElement('div'); dots.className = 'slot-dots';
  dots.innerHTML = urls.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join(''); el.appendChild(dots);
  const load = d => { if (d.dataset.src) { d.style.backgroundImage = `url('${d.dataset.src}')`; delete d.dataset.src; } };
  load(layers[0]); load(layers[1]);
  let i = 0, hover = false, seen = false;
  el.addEventListener('mouseenter', () => hover = true); el.addEventListener('mouseleave', () => hover = false);
  new IntersectionObserver(es => { seen = es[0].isIntersecting; }).observe(el);
  const delay = 1300 * (slotSlideshow.n = (slotSlideshow.n || 0) + 1);
  setTimeout(() => setInterval(() => {
    if (hover || !seen || document.hidden) return;
    layers[i].classList.remove('on'); dots.children[i].classList.remove('on');
    i = (i + 1) % layers.length;
    layers[i].classList.add('on'); dots.children[i].classList.add('on');
    load(layers[(i + 1) % layers.length]);
  }, 7000), delay);
}

/* 首頁主圖／背景位置（site/config.heroArt、heroBg）；後台預覽用 postMessage 即時套用 */
function applyHero() {
  const hb = S.heroBg || {}, ha = S.heroArt || {};
  const bg = document.querySelector('.hero-bear');
  if (bg) {
    const src = hb.url || 'img/bear-hero.webp'; if (bg.getAttribute('src') !== src) bg.src = src;
    bg.style.setProperty('--x', (hb.x ?? 50) + '%'); bg.style.setProperty('--y', (hb.y ?? 100) + '%');
    bg.style.setProperty('--z', (hb.zoom ?? 100) / 100); bg.style.setProperty('--o', (hb.dim ?? 50) / 100);
  }
  const art = document.querySelector('.hero-art.is-photo img');
  if (art) {
    art.style.objectPosition = `${ha.x ?? 50}% ${ha.y ?? 50}%`; art.style.transformOrigin = art.style.objectPosition;
    art.style.transform = (ha.zoom ?? 100) > 100 ? `scale(${ha.zoom / 100})` : '';
  }
}
addEventListener('message', e => {
  if (e.origin !== location.origin || e.data?.type !== 'heroPreview') return;
  S.heroArt = e.data.heroArt; S.heroBg = e.data.heroBg; applyHero();
});

/* ---------- schedule ---------- */
const order = d => (d + 6) % 7; // Monday first
$('#scheduleList').innerHTML = [...S.classes]
  .sort((a, b) => order(a.day) - order(b.day) || toMin(a.start) - toMin(b.start))
  .map(c => `<div class="class reveal">
      <div class="class-day">${DAY[c.day]}</div>
      <div><div class="class-time">${c.start} – ${c.end}</div>
      <div class="class-name">${c.venue} ${c.name}</div>
      <div class="class-place">${c.place}</div></div>
    </div>`).join('');

/* ---------- IG Reels 作品集（後台設定；沒有影片就整區隱藏） ---------- */
const reels = (S.reels || []).filter(u => /^https:\/\/www\.instagram\.com\/(reel|p)\/[\w-]+\/$/.test(u));
if (reels.length) {
  $('#reels').hidden = false;
  $$('[data-reels-link]').forEach(a => a.hidden = false);
  window.renderReels($('#reelList'), reels, S.reelCovers);
}

/* ---------- reveal on scroll ---------- */
$$('.card, .about-photo, .about-text, .gallery .photo-slot, details').forEach(el => el.classList.add('reveal'));
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: .12 });
$$('.reveal').forEach(el => io.observe(el));

/* ---------- LIFF：在 LINE 裡開預約頁時，帶入 LINE 名字並記下 LINE 身分（之後通知用） ---------- */
let lineProfile = null;
if (S.contact.liffId && (/[?&]book\b/.test(location.search) || /liff\.state|liffClientId/.test(location.search) || /Line\//i.test(navigator.userAgent))) {
  (async () => {
    try {
      await new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js'; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); });
      await window.liff.init({ liffId: S.contact.liffId });
      if (!window.liff.isLoggedIn()) return;
      lineProfile = await window.liff.getProfile();
      const f = document.querySelector('#bookingForm');
      if (f && !f.name.value) f.name.value = lineProfile.displayName.slice(0, 30);
    } catch (e) { console.warn('LIFF', e); }
  })();
}

/* ---------- booking ---------- */
const quick = $('#quickLine');
if (S.contact.lineOA) quick.href = `https://line.me/R/oaMessage/${S.contact.lineOA}/?${encodeURIComponent('教練你好，我想預約私人課 🥊\n想上課的時間：\n想練的項目：')}`;
else quick.closest('p').remove();
const B = S.booking;
const form = $('#bookingForm');
const busy = new Set(); // "YYYY-MM-DD HH:MM" taken by confirmed bookings

async function loadBusy() {
  if (!db) return;
  try {
    const today = ymd(new Date());
    const q = fs.query(fs.collection(db, 'busy'), fs.where('date', '>=', today));
    (await fs.getDocs(q)).forEach(d => busy.add(`${d.data().date} ${d.data().time}`));
  } catch (e) { console.warn('load busy failed', e); }
}

function slotState(date, time) {
  const start = toMin(time), end = start + B.lessonMinutes;
  const dt = new Date(`${ymd(date)}T${time}:00`);
  if (dt - Date.now() < B.minHoursAhead * 3600e3) return false;
  if (busy.has(`${ymd(date)} ${time}`)) return false;
  if (S.closedDates.includes(ymd(date))) return false;
  return !S.classes.some(c => c.day === date.getDay() &&
    start < toMin(c.end) + B.bufferMinutes && end > toMin(c.start) - B.bufferMinutes);
}

let chosenDate = null;
function renderDays() {
  const wrap = $('#dayPicker');
  wrap.innerHTML = '';
  const base = new Date(); base.setHours(0, 0, 0, 0);
  for (let i = 0; i <= B.daysAhead; i++) {
    const d = new Date(base); d.setDate(base.getDate() + i);
    const any = B.startTimes.some(t => slotState(d, t));
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'day'; btn.disabled = !any;
    if (chosenDate && ymd(chosenDate) === ymd(d)) btn.classList.add('active');
    btn.innerHTML = `<small>${i === 0 ? '今天' : DAY[d.getDay()]}</small><b>${d.getDate()}</b><small>${d.getMonth() + 1}月</small>`;
    btn.addEventListener('click', () => {
      $$('.day', wrap).forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); chosenDate = d;
      form.date.value = ymd(d); form.time.value = '';
      renderSlots();
    });
    wrap.appendChild(btn);
  }
}

function renderSlots() {
  const wrap = $('#slotPicker');
  wrap.innerHTML = '';
  B.startTimes.forEach(t => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'slot'; btn.textContent = t;
    btn.disabled = !slotState(chosenDate, t);
    if (btn.disabled && form.time.value === t) form.time.value = '';
    if (form.time.value === t) btn.classList.add('active');
    btn.addEventListener('click', () => {
      $$('.slot', wrap).forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); form.time.value = t;
    });
    wrap.appendChild(btn);
  });
}

function showError(msg) { $('#formError').textContent = msg; }

/* ---------- 記住預約人：第一次填，之後直接選時間 ---------- */
const PROFILE_KEY = 'tupo_profile_v1';
const loadProfile = () => { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null; } catch { return null; } };
function applyProfile() {
  const pf = loadProfile();
  if (!pf || !pf.name || !pf.phone) { form.classList.remove('returning'); $('#welcomeBar').hidden = true; return; }
  form.name.value = pf.name; form.phone.value = pf.phone; form.lineId.value = pf.lineId || '';
  if (pf.level) form.level.value = pf.level;
  if (pf.who) form.who.value = pf.who;
  if (pf.people) form.people.value = String(pf.people);
  (pf.goals || []).forEach(g => { const c = form.querySelector(`input[name=goals][value="${CSS.escape(g)}"]`); if (c) c.checked = true; });
  $('#welcomeName').textContent = `歡迎回來，${pf.name}！`;
  $('#welcomeInfo').textContent = `${pf.phone}・${pf.level || ''}・${pf.who || ''}　直接選日期和時段就可以預約`;
  $('#welcomeBar').hidden = false;
  form.classList.add('returning');
}
$('#editProfile').addEventListener('click', () => {
  form.classList.remove('returning'); $('#welcomeBar').hidden = true;
  form.querySelector('[data-profile]').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
applyProfile();

form.addEventListener('submit', async e => {
  e.preventDefault();
  showError('');
  const f = new FormData(form);
  const data = {
    goals: f.getAll('goals'),
    level: f.get('level'), who: f.get('who'), people: Number(f.get('people')),
    date: f.get('date'), time: f.get('time'),
    name: f.get('name').trim(), phone: f.get('phone').trim(),
    lineId: f.get('lineId').trim(), note: f.get('note').trim()
  };
  if (!data.date || !data.time) return showError('請選擇上課日期與時段');
  if (!data.name) return showError('請填寫姓名');
  if (!/^[0-9+\-\s()]{8,20}$/.test(data.phone)) return showError('請填寫正確的手機號碼');

  const btn = $('#submitBtn');
  btn.disabled = true; btn.textContent = '送出中…';
  try {
    if (db) {
      const line = lineProfile ? { lineUserId: lineProfile.userId, lineName: lineProfile.displayName.slice(0, 50) } : {};
      await fs.addDoc(fs.collection(db, 'bookings'), { ...data, ...line, status: 'pending', createdAt: fs.serverTimestamp() });
    } else {
      console.info('[demo] booking (Firebase 尚未設定)', data);
    }
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: data.name, phone: data.phone, lineId: data.lineId, level: data.level, who: data.who, people: data.people, goals: data.goals })); } catch {}
    const d = new Date(`${data.date}T00:00:00`);
    $('#doneSummary').textContent = `${data.name}，你預約了 ${d.getMonth() + 1}/${d.getDate()}（${DAY[d.getDay()]}）${data.time} 的私人課。`;
    const msg = `教練你好，我在網站預約了私人課：\n${d.getMonth() + 1}/${d.getDate()}（${DAY[d.getDay()]}）${data.time}\n${data.name} ${data.phone}`;
    const oa = lineProfile ? null : S.contact.lineOA; // 從 LINE 預約的人，伺服器會直接把預約單傳到他的 LINE
    $('#doneLine').hidden = !oa;
    if (lineProfile) $('#doneSummary').textContent += ' 預約單已經傳到你的 LINE，教練確認後會再通知你。';
    if (oa) {
      $('#lineMsg').textContent = msg;
      $('#lineGo').href = `https://line.me/R/oaMessage/${oa}/?${encodeURIComponent(msg)}`;
    }
    form.hidden = true; $('#bookingDone').hidden = false;
    $('#booking').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    showError('送出失敗，請稍後再試，或直接用 LINE 聯絡教練。');
  } finally {
    btn.disabled = false; btn.textContent = '送出預約';
  }
});

const modal = $('#lineModal');
$('#doneLine').addEventListener('click', () => { modal.hidden = false; });
modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) modal.hidden = true; });
$('#lineGo').addEventListener('click', () => { modal.hidden = true; });
addEventListener('keydown', e => { if (e.key === 'Escape') modal.hidden = true; });

$('#bookAgain').addEventListener('click', () => {
  form.reset(); form.hidden = false; $('#bookingDone').hidden = true;
  applyProfile();
  chosenDate = null; renderDays();
  $('#slotPicker').innerHTML = '<p class="muted">請先選擇日期</p>';
});

renderDays();
loadBusy().then(() => { renderDays(); if (chosenDate) renderSlots(); });
