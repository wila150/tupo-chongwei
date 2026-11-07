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
  img.onload = () => el.classList.add('has-photo');
  img.onerror = () => el.style.setProperty('--photo', 'none');
  img.src = m[1];
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

/* ---------- reveal on scroll ---------- */
$$('.card, .about-photo, .about-text, .gallery .photo-slot, details').forEach(el => el.classList.add('reveal'));
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: .12 });
$$('.reveal').forEach(el => io.observe(el));

/* ---------- booking ---------- */
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
    btn.addEventListener('click', () => {
      $$('.slot', wrap).forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); form.time.value = t;
    });
    wrap.appendChild(btn);
  });
}

function showError(msg) { $('#formError').textContent = msg; }

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
      await fs.addDoc(fs.collection(db, 'bookings'), { ...data, status: 'pending', createdAt: fs.serverTimestamp() });
    } else {
      console.info('[demo] booking (Firebase 尚未設定)', data);
    }
    const d = new Date(`${data.date}T00:00:00`);
    $('#doneSummary').textContent = `${data.name}，你預約了 ${d.getMonth() + 1}/${d.getDate()}（${DAY[d.getDay()]}）${data.time} 的私人課。`;
    const msg = `教練你好，我在網站預約了私人課：\n${d.getMonth() + 1}/${d.getDate()}（${DAY[d.getDay()]}）${data.time}\n${data.name} ${data.phone}`;
    const line = $('#doneLine');
    if (S.contact.line) {
      line.hidden = false; line.href = S.contact.line;
      line.onclick = () => { navigator.clipboard?.writeText(msg).catch(() => {}); };
      line.textContent = '傳 LINE 告訴教練（自動複製預約內容）';
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

$('#bookAgain').addEventListener('click', () => {
  form.reset(); form.hidden = false; $('#bookingDone').hidden = true;
  chosenDate = null; renderDays();
  $('#slotPicker').innerHTML = '<p class="muted">請先選擇日期</p>';
});

renderDays();
loadBusy().then(() => { renderDays(); });
