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
