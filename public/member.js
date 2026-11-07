// 學員 LINE 預約 App（LIFF）：選時段 → 線上預約（伺服器扣 1 堂）→ 我的課可取消退堂
import { firebaseConfig } from './firebase-config.js';

const S = window.SITE;
const API = 'https://asia-east1-tupo-chongwei.cloudfunctions.net/api';
const LIFF_ID = '2012453936-jc7TPoii';
const $ = q => document.querySelector(q);
const $$ = q => [...document.querySelectorAll(q)];
const DAY = ['日', '一', '二', '三', '四', '五', '六'];
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const md = s => { const d = new Date(`${s}T00:00:00`); return `${d.getMonth() + 1}/${d.getDate()}（${DAY[d.getDay()]}）`; };
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const addMin = (t, n) => { const m = toMin(t) + n; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let idToken = null, me = null, cfg = null, busy = new Set(), packages = [];

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
}

async function call(action, body = {}) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, idToken, ...body }) });
  const j = await r.json().catch(() => ({ error: '連線失敗' }));
  if (!r.ok) throw new Error(j.error || '系統忙碌');
  return j;
}

/* ---------- 公開資料：預約設定、已被約走的時段、方案 ---------- */
async function loadPublic() {
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const F = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const db = F.getFirestore(initializeApp(firebaseConfig));
  cfg = { classes: S.classes, booking: { ...S.booking }, closedDates: [], contact: S.contact };
  const lim = pr => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 5000))]);
  const [c, b, p] = await Promise.allSettled([
    lim(F.getDoc(F.doc(db, 'site', 'config'))),
    lim(F.getDocs(F.query(F.collection(db, 'busy'), F.where('date', '>=', ymd(new Date()))))),
    lim(F.getDocs(F.collection(db, 'packages')))
  ]);
  if (c.status === 'fulfilled' && c.value.exists()) {
    const d = c.value.data();
    if (Array.isArray(d.classes)) cfg.classes = d.classes;
    if (d.booking) Object.assign(cfg.booking, d.booking);
    if (Array.isArray(d.closedDates)) cfg.closedDates = d.closedDates;
    if (d.contact) cfg.contact = { ...cfg.contact, ...d.contact };
  }
  busy = new Set(b.status === 'fulfilled' ? b.value.docs.map(x => `${x.data().date} ${x.data().time}`) : []);
  packages = p.status === 'fulfilled' ? p.value.docs.map(x => x.data()).filter(x => x.active !== false).sort((a, b) => a.credits - b.credits) : [];
}

function slotState(date, time) {
  const B = cfg.booking, d = ymd(date);
  const t = new Date(`${d}T${time}:00`);
  if (t - Date.now() < B.minHoursAhead * 3600e3) return 'past';
  if (cfg.closedDates.includes(d)) return 'off';
  const s = toMin(time), e = s + (B.lessonMinutes || 60);
  if (cfg.classes.some(c => c.day === date.getDay() && s < toMin(c.end) + B.bufferMinutes && e > toMin(c.start) - B.bufferMinutes)) return 'class';
  if (busy.has(`${d} ${time}`)) return 'full';
  return 'open';
}

/* ---------- 預約分頁 ---------- */
let weekStart = new Date(); weekStart.setHours(0, 0, 0, 0);
let chosen = new Date(weekStart);
const lastDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + cfg.booking.daysAhead); return d; };

function renderWeek() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  $('#weekDays').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i);
    const out = d < today || d > lastDay();
    const has = !out && cfg.booking.startTimes.some(t => slotState(d, t) === 'open');
    return `<button class="wd ${ymd(d) === ymd(chosen) ? 'active' : ''} ${has ? 'has' : ''}" data-d="${ymd(d)}" ${out ? 'disabled' : ''}><small>${DAY[d.getDay()]}</small><b>${d.getDate()}</b><span class="dot"></span></button>`;
  }).join('');
  $('#prevWeek').disabled = weekStart <= today;
  const nextStart = new Date(weekStart); nextStart.setDate(nextStart.getDate() + 7);
  $('#nextWeek').disabled = nextStart > lastDay();
  renderSlots();
}

function renderSlots() {
  $('#dayTitle').textContent = `${chosen.getMonth() + 1} 月 ${chosen.getDate()} 日 星期${DAY[chosen.getDay()]}`;
  const mins = cfg.booking.lessonMinutes || 60;
  const list = cfg.booking.startTimes.map(t => ({ t, st: slotState(chosen, t) })).filter(x => x.st === 'open' || x.st === 'full');
  const credits = me?.student?.credits ?? 0;
  $('#slotList').innerHTML = list.map(({ t, st }) => `<div class="slot-card ${st === 'full' ? 'full' : ''}">
      <div class="t">${t}<small>– ${addMin(t, mins)}</small></div>
      <div><h4>私人課・一對一</h4><p>呂淙維 教練</p><span class="chip">使用 1 堂</span></div>
      ${st === 'full' ? '<button class="btn btn-ghost" disabled>已額滿</button>'
        : credits > 0 ? `<button class="btn" data-book="${t}">線上預約</button>`
        : '<button class="btn btn-ghost" data-go="plans">堂數不足</button>'}
    </div>`).join('') || '<p class="center-box" style="padding-top:3rem">這天沒有可預約的時段</p>';
}

$('#weekDays').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (!b) return; chosen = new Date(`${b.dataset.d}T00:00:00`); renderWeek(); });
$('#prevWeek').addEventListener('click', () => { weekStart.setDate(weekStart.getDate() - 7); const t = new Date(); t.setHours(0, 0, 0, 0); if (weekStart < t) weekStart = t; chosen = new Date(weekStart); renderWeek(); });
$('#nextWeek').addEventListener('click', () => { weekStart.setDate(weekStart.getDate() + 7); chosen = new Date(weekStart); renderWeek(); });

let pending = null;
$('#slotList').addEventListener('click', e => {
  const t = e.target.dataset.book; if (!t) return;
  pending = { date: ymd(chosen), time: t };
  const c = me.student.credits;
  $('#sheetWhen').textContent = `${md(pending.date)} ${t}`;
  $('#sheetInfo').textContent = `私人課 ${cfg.booking.lessonMinutes || 60} 分鐘，將使用 1 堂（剩 ${c} → ${c - 1} 堂）。上課前 ${me.cancelHours} 小時前可以取消並退回。`;
  $('#sheetErr').textContent = ''; $('#sheet').hidden = false;
});
$('#sheetNo').addEventListener('click', () => { $('#sheet').hidden = true; });
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('#sheet').hidden = true; });
$('#sheetYes').addEventListener('click', async () => {
  const btn = $('#sheetYes'); btn.disabled = true; btn.textContent = '預約中…';
  try {
    const r = await call('book', pending);
    busy.add(`${pending.date} ${pending.time}`);
    $('#sheet').hidden = true;
    toast(`✓ 扣除 1 堂，預約成功（剩 ${r.credits} 堂）`);
    await refreshMe();
  } catch (err) { $('#sheetErr').textContent = err.message; if (/約走/.test(err.message)) { busy.add(`${pending.date} ${pending.time}`); renderSlots(); } }
  btn.disabled = false; btn.textContent = '確認預約';
});

/* ---------- 我的課 / 我的 / 方案 ---------- */
function renderMe() {
  const s = me.student;
  $('#creditNum').textContent = s.credits; $('#creditPill').hidden = false;
  $('#meCredits').textContent = s.credits;
  $('#meExp').textContent = s.expiresAt ? s.expiresAt.slice(5).replace('-', '/') : '不限期';
  $('#lessonList').innerHTML = me.lessons.map(l => `<div class="les"><div><b>${md(l.date)} ${l.time}</b><small>私人課 ${l.minutes} 分${l.paid ? '・已扣堂' : '・教練安排'}</small></div>
    ${l.canCancel ? `<button class="btn btn-ghost" data-cancel="${l.id}">取消</button>` : ''}</div>`).join('') || '<p class="muted">目前沒有預約，去「預約」選個時間吧！</p>';
  $('#cancelNote').textContent = `線上預約的課，上課前 ${me.cancelHours} 小時前可以自己取消並退回堂數；之後請直接聯絡教練。`;
  $('#ledgerList').innerHTML = me.ledger.map(x => { const d = new Date(x.at); return `<div class="row-log"><span>${x.at ? `${d.getMonth() + 1}/${d.getDate()}` : ''}</span><span>${esc(x.note)}</span><b class="${x.delta < 0 ? 'neg' : 'pos'}">${x.delta > 0 ? '+' : ''}${x.delta || ''}</b></div>`; }).join('') || '<p class="muted">還沒有紀錄</p>';
  renderSlots();
}

function renderPlans() {
  const oa = cfg.contact.lineOA;
  $('#planList').innerHTML = packages.map(p => `<div class="pk"><div><b>${esc(p.name)}</b><small>${p.credits} 堂${p.days ? `・${p.days} 天內使用` : ''}${p.credits > 1 ? `・每堂 $${Math.round(p.price / p.credits)}` : ''}</small></div>
    <div style="text-align:right"><div class="price">$${Number(p.price).toLocaleString()}</div>${oa ? `<a class="btn btn-sm" style="margin-top:.3rem" href="https://line.me/R/oaMessage/${oa}/?${encodeURIComponent(`教練你好，我想購買「${p.name}」（${p.credits} 堂 $${p.price}）`)}">購買</a>` : ''}</div></div>`).join('') || '<p class="muted">方案請直接詢問教練</p>';
  $('#contactCoach').href = oa ? `https://line.me/R/oaMessage/${oa}/?` : (cfg.contact.line || '#');
}

$('#lessonList').addEventListener('click', async e => {
  const id = e.target.dataset.cancel; if (!id) return;
  const l = me.lessons.find(x => x.id === id);
  if (!confirm(`取消 ${md(l.date)} ${l.time} 的課？會退回 1 堂。`)) return;
  e.target.disabled = true;
  try {
    const r = await call('cancel', { lessonId: id });
    busy.delete(`${l.date} ${l.time}`);
    toast(`已取消，退回 1 堂（剩 ${r.credits} 堂）`);
    await refreshMe();
  } catch (err) { alert(err.message); e.target.disabled = false; }
});

/* ---------- 分頁 ---------- */
function go(tab) {
  $$('[data-tab]').forEach(s => { s.hidden = s.id !== `tab-${tab}`; });
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.go === tab));
  scrollTo(0, 0);
}
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

async function refreshMe() {
  me = await call('me');
  if (!me.bound) return showBind();
  $('#bindView').hidden = true; $('#tabbar').hidden = false;
  renderMe();
}

function showBind() {
  $('#loading').hidden = true; $('#tabbar').hidden = true;
  $$('[data-tab]').forEach(s => { s.hidden = true; });
  $('#lineName').textContent = me.lineName || '';
  $('#bindView').hidden = false;
}
$('#bindForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; $('#bindErr').textContent = '';
  const btn = f.querySelector('button'); btn.disabled = true;
  try {
    await call('bind', { name: f.name.value, phone: f.phone.value });
    await refreshMe(); go('book'); toast('綁定完成！');
  } catch (err) { $('#bindErr').textContent = err.message; }
  btn.disabled = false;
});

/* ---------- 啟動 ---------- */
(async () => {
  try {
    await new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js'; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); });
    await Promise.all([window.liff.init({ liffId: LIFF_ID }), loadPublic()]);
    if (!window.liff.isLoggedIn()) { window.liff.login({ redirectUri: location.href }); return; }
    idToken = window.liff.getIDToken();
    renderPlans(); renderWeek();
    await refreshMe();
    if (me.bound) { $('#loading').hidden = true; go('book'); }
  } catch (err) {
    console.error(err);
    $('#loading').innerHTML = `無法載入：${esc(err.message)}<br><br><a class="btn btn-ghost" href="./?book">改用網頁預約</a>`;
  }
})();
