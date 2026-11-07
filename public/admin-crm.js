// 課務扣堂＋學員名冊（只給管理員用）
// Firestore：
//   students/{id}         { name, phone, lineId, credits, note, createdAt }
//   students/{id}/ledger  { type: buy|deduct|undo|adjust|import, delta, amount, lessonId, note, at }
//   lessons/{id}          { date, time, minutes, studentIds[], studentNames[], status: scheduled|done|cancelled, doneAtMs, seriesId, note }

const RENEW_AT = 2;          // 剩幾堂以下標「建議續約」
const UNDO_MS = 24 * 3600e3; // 扣堂 24 小時內可復原
const DAY = ['日', '一', '二', '三', '四', '五', '六'];
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const md = s => { const d = new Date(`${s}T00:00:00`); return `${d.getMonth() + 1}/${d.getDate()}（${DAY[d.getDay()]}）`; };
const endMs = l => new Date(`${l.date}T${l.time}:00`).getTime() + (l.minutes || 60) * 60e3;

export function initCrm({ F, db, esc, $ }) {
  let students = [], lessons = [];
  const byId = id => students.find(s => s.id === id);
  const todayStr = () => ymd(new Date());
  const addDays = (str, n) => { const d = new Date(`${str}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
  const daysLeft = s => s.expiresAt ? Math.round((new Date(`${s.expiresAt}T00:00:00`) - new Date(`${todayStr()}T00:00:00`)) / 864e5) : null;
  const lastLesson = sid => lessons.filter(l => l.status === 'done' && l.studentIds.includes(sid)).map(l => l.date).sort().at(-1) || null;
  const isSleeping = s => !s.blocked && !lastLesson(s.id) && (!s.createdAt?.toDate || Date.now() - s.createdAt.toDate() > 14 * 864e5);
  const statusTags = s => {
    const t = [], dl = daysLeft(s);
    if (s.blocked) t.push('<span class="tag bad">黑名單</span>');
    if (s.credits <= RENEW_AT) t.push('<span class="tag warn">建議續約</span>');
    if (dl !== null && dl < 0) t.push('<span class="tag bad">已過期</span>');
    else if (dl !== null && dl <= 14) t.push(`<span class="tag warn">${dl} 天後到期</span>`);
    if (isSleeping(s)) t.push('<span class="tag">60 天沒上課</span>');
    (s.tags || []).forEach(x => t.push(`<span class="tag tag-u">#${esc(x)}</span>`));
    if (s.lineUserId) t.push('<span class="tag line">LINE 已綁定</span>');
    return t.join(' ');
  };
  let stFilter = 'all';
  const FILTERS = [
    ['all', '全部', () => true],
    ['renew', '建議續約', s => s.credits <= RENEW_AT && !s.blocked],
    ['expiring', '快到期', s => { const d = daysLeft(s); return d !== null && d >= 0 && d <= 14; }],
    ['expired', '已過期', s => { const d = daysLeft(s); return d !== null && d < 0; }],
    ['sleep', '沉睡', s => isSleeping(s)],
    ['blocked', '黑名單', s => s.blocked]
  ];

  const normPhone = p => String(p || '').replace(/[^0-9]/g, '');

  /* ---------- live data ---------- */
  F.onSnapshot(F.query(F.collection(db, 'students'), F.orderBy('name')), snap => {
    students = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStudents(); renderLessons(); renderPicker();
  }, err => console.warn('students', err));
  let packages = [];
  F.onSnapshot(F.query(F.collection(db, 'packages'), F.orderBy('credits')), snap => {
    packages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPackages();
  }, err => console.warn('packages', err));
  const since = new Date(); since.setDate(since.getDate() - 60);
  F.onSnapshot(F.query(F.collection(db, 'lessons'), F.where('date', '>=', ymd(since))), snap => {
    lessons = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    renderLessons();
  }, err => console.warn('lessons', err));

  /* ================= 課務扣堂 ================= */
  const lessonCard = l => {
    const now = Date.now();
    const names = l.studentIds.map((id, i) => {
      const s = byId(id); const name = s?.name || l.studentNames?.[i] || '（已刪除）';
      const low = s && s.credits <= RENEW_AT ? ` <span class="tag warn">剩 ${s.credits}</span>` : s ? ` <span class="tag">剩 ${s.credits}</span>` : '';
      return esc(name) + low;
    }).join('、') || '<span class="muted">（未指定學員）</span>';
    const acts = [];
    if (l.status === 'scheduled') {
      acts.push(`<button class="btn btn-sm" data-deduct="${l.id}">完課扣堂</button>`);
      acts.push(`<button class="btn btn-ghost btn-sm" data-cancel="${l.id}">取消這堂</button>`);
    } else if (l.status === 'done' && now - (l.doneAtMs || 0) < UNDO_MS) {
      acts.push(`<button class="btn btn-ghost btn-sm" data-undo="${l.id}">復原扣堂</button>`);
    }
    const src = l.source === 'line' ? ' <span class="tag line">LINE 預約・已扣堂</span>' : '';
    const badge = l.status === 'done' ? '<span class="tag ok">已扣堂</span>' : l.status === 'cancelled' ? '<span class="tag">已取消</span>' : '';
    return `<div class="bk ${l.status === 'done' ? 'confirmed' : l.status === 'cancelled' ? 'cancelled' : 'pending'}">
      <div><div class="bk-when">${md(l.date)} ${esc(l.time)} <small class="muted">${l.minutes || 60} 分</small> ${badge}${src}</div>
      <div class="bk-who">${names}</div>${l.note ? `<div class="bk-meta">📝 ${esc(l.note)}</div>` : ''}</div>
      <div class="bk-actions">${acts.join('')}</div></div>`;
  };

  function renderLessons() {
    const now = Date.now(), today = ymd(new Date());
    const wk = new Date(); wk.setDate(wk.getDate() + 7); const week = ymd(wk);
    const missed = lessons.filter(l => l.status === 'scheduled' && endMs(l) < now);
    const todayL = lessons.filter(l => l.date === today && !(l.status === 'scheduled' && endMs(l) < now));
    const upcoming = lessons.filter(l => l.date > today && l.date <= week && l.status === 'scheduled');
    const recent = lessons.filter(l => l.status === 'done' && now - (l.doneAtMs || 0) < UNDO_MS && l.date !== today);
    const sec = (title, list, empty, cls = '') => `<div class="panel ${cls}"><h2>${title}${list.length ? `<b class="cnt">${list.length}</b>` : ''}</h2>
      <div class="list">${list.length ? list.map(lessonCard).join('') : `<p class="hint">${empty}</p>`}</div></div>`;
    $('#lessonsBody').innerHTML =
      (missed.length ? sec('⚠️ 漏扣提醒：上課時間已過、還沒扣堂', missed, '', 'alert') : '') +
      sec('今天的課', todayL, '今天沒有排課') +
      sec('未來 7 天', upcoming, '未來 7 天沒有排課') +
      (recent.length ? sec('最近扣堂（24 小時內可復原）', recent, '') : '');
  }

  $('#lessonsBody').addEventListener('click', async e => {
    const t = e.target.dataset; const id = t.deduct || t.undo || t.cancel; if (!id) return;
    const l = lessons.find(x => x.id === id); if (!l) return;
    e.target.disabled = true;
    try {
      if (t.deduct) await deduct(l);
      else if (t.undo) await undo(l);
      else if (confirm(`取消 ${md(l.date)} ${l.time} 這堂課？${l.paid ? '（學員線上預約時已扣 1 堂，會退回）' : '（不會扣堂）'}`)) {
        const b = F.writeBatch(db);
        b.update(F.doc(db, 'lessons', l.id), { status: 'cancelled', cancelledBy: 'coach' });
        if (!lessons.some(x => x.id !== l.id && x.status === 'scheduled' && x.date === l.date && x.time === l.time)) b.delete(busyRef(l));
        if (l.paid) for (const sid of l.studentIds) {
          if (!byId(sid)) continue;
          b.update(F.doc(db, 'students', sid), { credits: F.increment(1) });
          b.set(F.doc(F.collection(db, 'students', sid, 'ledger')), { type: 'undo', delta: 1, lessonId: l.id, note: `教練取消 ${l.date} ${l.time}（退回）`, at: F.serverTimestamp() });
        }
        await b.commit();
      }
    } catch (err) { alert('失敗：' + err.message); }
    e.target.disabled = false;
  });

  const busyRef = l => F.doc(db, 'busy', `${l.date}_${l.time.replace(':', '')}`);
  async function deduct(l) {
    if (!l.studentIds.length) return alert('這堂課沒有學員，請先刪掉重排');
    if (l.paid) { const b = F.writeBatch(db); b.update(F.doc(db, 'lessons', l.id), { status: 'done', doneAtMs: Date.now() }); return b.commit(); }
    const zero = l.studentIds.map(byId).filter(s => s && s.credits <= 0);
    const exp = l.studentIds.map(byId).filter(s => s && daysLeft(s) !== null && daysLeft(s) < 0);
    if (exp.length && !confirm(`${exp.map(s => `${s.name}（${s.expiresAt} 到期）`).join('、')} 方案已過期，仍要扣嗎？`)) return;
    if (zero.length && !confirm(`${zero.map(s => s.name).join('、')} 已經沒有剩餘堂數，仍要扣嗎？（會變成負數）`)) return;
    const b = F.writeBatch(db);
    b.update(F.doc(db, 'lessons', l.id), { status: 'done', doneAtMs: Date.now() });
    if (l.paid) { await b.commit(); return; } // LINE 線上預約時已扣過
    for (const sid of l.studentIds) {
      if (!byId(sid)) continue;
      b.update(F.doc(db, 'students', sid), { credits: F.increment(-1) });
      b.set(F.doc(F.collection(db, 'students', sid, 'ledger')), { type: 'deduct', delta: -1, lessonId: l.id, note: `${l.date} ${l.time} 上課`, at: F.serverTimestamp() });
    }
    await b.commit();
  }

  async function undo(l) {
    if (Date.now() - (l.doneAtMs || 0) > UNDO_MS) return alert('超過 24 小時，不能復原了');
    if (!confirm(`復原 ${md(l.date)} ${l.time} 的扣堂？堂數會加回去。`)) return;
    const b = F.writeBatch(db);
    b.update(F.doc(db, 'lessons', l.id), { status: 'scheduled', doneAtMs: F.deleteField() });
    if (l.paid) { await b.commit(); return; }
    for (const sid of l.studentIds) {
      if (!byId(sid)) continue;
      b.update(F.doc(db, 'students', sid), { credits: F.increment(1) });
      b.set(F.doc(F.collection(db, 'students', sid, 'ledger')), { type: 'undo', delta: 1, lessonId: l.id, note: `復原 ${l.date} ${l.time} 扣堂`, at: F.serverTimestamp() });
    }
    await b.commit();
  }

  /* ---------- 排課表單 ---------- */
  let picked = new Set();
  function renderPicker() {
    const q = ($('#pickSearch')?.value || '').trim();
    $('#pickList').innerHTML = students.filter(s => !q || s.name.includes(q) || normPhone(s.phone).includes(q))
      .map(s => `<label class="pick ${picked.has(s.id) ? 'on' : ''}"><input type="checkbox" value="${s.id}" ${picked.has(s.id) ? 'checked' : ''} hidden>${esc(s.name)} <small>剩 ${s.credits}</small></label>`).join('')
      || '<p class="hint">還沒有學員，先到「學員」新增</p>';
  }
  $('#pickSearch').addEventListener('input', renderPicker);
  $('#pickList').addEventListener('change', e => {
    e.target.checked ? picked.add(e.target.value) : picked.delete(e.target.value); renderPicker();
  });
  $('#addLessonBtn').addEventListener('click', () => { $('#lessonForm').hidden = !$('#lessonForm').hidden; });
  $('#lfDate').value = ymd(new Date());

  $('#lessonForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#lfMsg'); msg.textContent = '';
    const date = $('#lfDate').value, time = $('#lfTime').value, minutes = Number($('#lfMin').value) || 60;
    const days = [...document.querySelectorAll('#lfDays input:checked')].map(i => Number(i.value));
    const weeks = Math.min(26, Math.max(1, Number($('#lfWeeks').value) || 1));
    if (!date || !time) return msg.textContent = '請填日期和時間';
    if (!picked.size) return msg.textContent = '請至少選一位學員';
    const ids = [...picked], names = ids.map(id => byId(id)?.name || '');
    let dates = [date];
    if (days.length) {
      dates = [];
      const start = new Date(`${date}T00:00:00`);
      for (let i = 0; i < weeks * 7; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        if (days.includes(d.getDay())) dates.push(ymd(d));
      }
    }
    if (!dates.length) return msg.textContent = '選的星期在這段期間內沒有日期';
    if (dates.length > 1 && !confirm(`會建立 ${dates.length} 堂課（${md(dates[0])} ～ ${md(dates.at(-1))}），確定？`)) return;
    const seriesId = dates.length > 1 ? `s${Date.now()}` : null;
    const b = F.writeBatch(db);
    for (const d of dates) b.set(F.doc(db, 'busy', `${d}_${time.replace(':', '')}`), { date: d, time });
    for (const d of dates) b.set(F.doc(F.collection(db, 'lessons')), {
      date: d, time, minutes, studentIds: ids, studentNames: names, status: 'scheduled', seriesId, note: $('#lfNote').value.trim(), createdAt: F.serverTimestamp()
    });
    try {
      await b.commit();
      msg.textContent = `已排 ${dates.length} 堂 ✓`;
      picked = new Set(); renderPicker(); $('#lfNote').value = '';
      document.querySelectorAll('#lfDays input').forEach(i => i.checked = false);
    } catch (err) { msg.textContent = '失敗：' + err.message; }
  });

  /* ================= 學員 ================= */
  function renderStudents() {
    const q = ($('#stSearch').value || '').trim();
    const tags = [...new Set(students.flatMap(s => s.tags || []))].sort();
    const fl = [...FILTERS, ...tags.map(t => [`#${t}`, `#${t}`, s => (s.tags || []).includes(t)])];
    $('#stFilters').innerHTML = fl.map(([k, label, fn]) => { const n = students.filter(fn).length; return (k === 'all' || n) ? `<button type="button" data-f="${esc(k)}" class="${stFilter === k ? 'active' : ''}">${esc(label)}<b>${n}</b></button>` : ''; }).join('');
    const fn = (fl.find(x => x[0] === stFilter) || FILTERS[0])[2];
    const list = students.filter(s => fn(s) && (!q || s.name.includes(q) || normPhone(s.phone).includes(q) || (s.tags || []).some(t => t.includes(q))));
    const renew = students.filter(s => s.credits <= RENEW_AT).length;
    $('#stSummary').textContent = `共 ${students.length} 位學員${renew ? `・${renew} 位建議續約` : ''}・顯示 ${list.length} 位`;
    $('#stList').innerHTML = list.map(s => `<div class="st ${s.blocked ? 'blocked' : ''}">
      <div class="st-main"><b>${esc(s.name)}</b> ${statusTags(s)}
        <div class="bk-meta">${esc(s.phone || '')}${s.lineId ? `・LINE ${esc(s.lineId)}` : ''}${s.expiresAt ? `・到期 ${s.expiresAt}` : ''}${lastLesson(s.id) ? `・上次上課 ${lastLesson(s.id).slice(5)}` : ''}${s.note ? `・${esc(s.note)}` : ''}</div></div>
      <div class="st-credits ${s.credits <= RENEW_AT ? 'low' : ''}"><b>${s.credits}</b><small>剩餘堂數</small></div>
      <div class="st-acts">
        <button class="btn btn-sm" data-buy="${s.id}">賣方案／加堂</button>
        <button class="btn btn-ghost btn-sm" data-extend="${s.id}">延期</button>
        <button class="btn btn-ghost btn-sm" data-log="${s.id}">紀錄</button>
        <button class="btn btn-ghost btn-sm" data-edit="${s.id}">編輯</button>
      </div>
      <div class="st-log" id="log-${s.id}" hidden></div>
    </div>`).join('') || '<p class="empty">沒有符合的學員</p>';
  }
  $('#stFilters').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; stFilter = b.dataset.f; renderStudents(); });
  $('#stSearch').addEventListener('input', renderStudents);

  $('#stList').addEventListener('click', async e => {
    const t = e.target.dataset;
    if (t.buy) {
      const st = byId(t.buy);
      const act = packages.filter(p => p.active !== false);
      const menu = act.map((p, i) => `${i + 1}. ${p.name}（${p.credits} 堂 $${p.price}${p.days ? `・${p.days} 天` : ''}）`).join('\n');
      const pick = prompt(`${st.name}：選方案輸入編號，或直接輸入要加幾堂（負數＝修正）\n${menu || '（還沒有方案，可到下方「課程方案」新增）'}`, act.length ? '1' : '10');
      if (pick === null || pick.trim() === '') return;
      let n, amount = 0, days = 0, label;
      const pi = /^#?\d+$/.test(pick.trim()) && act.length && Number(pick) >= 1 && Number(pick) <= act.length && !pick.trim().startsWith('-') ? act[Number(pick) - 1] : null;
      if (pi && confirm(`賣「${pi.name}」給 ${st.name}：+${pi.credits} 堂、收 $${pi.price}${pi.days ? `、有效 ${pi.days} 天` : ''}？\n（按取消＝把 ${pick} 當成堂數）`)) {
        n = pi.credits; amount = pi.price; days = pi.days || 0; label = pi.name;
      } else {
        n = parseInt(pick, 10); if (!n) return;
        if (n > 0) { amount = Number(prompt('收費金額（元，可留空）', '') || 0); days = Number(prompt('有效天數（留空＝不改到期日）', '') || 0); }
        label = n > 0 ? `購買 ${n} 堂` : `修正 ${n} 堂`;
      }
      const upd = { credits: F.increment(n) };
      if (days > 0) { const base = st.expiresAt && st.expiresAt > todayStr() ? st.expiresAt : todayStr(); upd.expiresAt = addDays(base, days); }
      const bt = F.writeBatch(db);
      bt.update(F.doc(db, 'students', st.id), upd);
      bt.set(F.doc(F.collection(db, 'students', st.id, 'ledger')), { type: n > 0 ? 'buy' : 'adjust', delta: n, amount, note: label + (upd.expiresAt ? `（到期 ${upd.expiresAt}）` : ''), at: F.serverTimestamp() });
      if (amount > 0) bt.set(F.doc(F.collection(db, 'sales')), { studentId: st.id, name: st.name, label, credits: n, amount, month: todayStr().slice(0, 7), date: todayStr(), at: F.serverTimestamp() });
      await bt.commit().catch(err => alert('失敗：' + err.message));
    } else if (t.extend) {
      const st = byId(t.extend);
      if (!st.expiresAt) return alert(`${st.name} 沒有設定到期日（賣有天數的方案，或在「編輯」設定）`);
      const d = parseInt(prompt(`${st.name} 目前 ${st.expiresAt} 到期。請假要延後幾天？`, '7'), 10); if (!d) return;
      const exp = addDays(st.expiresAt, d), bt = F.writeBatch(db);
      bt.update(F.doc(db, 'students', st.id), { expiresAt: exp });
      bt.set(F.doc(F.collection(db, 'students', st.id, 'ledger')), { type: 'extend', delta: 0, note: `請假延期 ${d} 天（到期 ${exp}）`, at: F.serverTimestamp() });
      await bt.commit().catch(err => alert('失敗：' + err.message));
    } else if (t.log) {
      const box = $(`#log-${t.log}`);
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false; box.innerHTML = '<p class="hint">讀取中…</p>';
      const snap = await F.getDocs(F.query(F.collection(db, 'students', t.log, 'ledger'), F.orderBy('at', 'desc'), F.limit(50)));
      box.innerHTML = snap.docs.map(d => {
        const x = d.data(), at = x.at?.toDate?.();
        return `<div class="log"><span>${at ? `${at.getMonth() + 1}/${at.getDate()} ${pad(at.getHours())}:${pad(at.getMinutes())}` : ''}</span><span>${esc(x.note || x.type)}</span><b class="${x.delta < 0 ? 'neg' : 'pos'}">${x.delta > 0 ? '+' : ''}${x.delta}</b>${x.amount ? `<small>$${x.amount}</small>` : '<small></small>'}</div>`;
      }).join('') || '<p class="hint">沒有紀錄</p>';
    } else if (t.edit) openStudentForm(byId(t.edit));
  });

  function openStudentForm(s) {
    const f = $('#stForm'); f.hidden = false; f.dataset.id = s?.id || '';
    f.name.value = s?.name || ''; f.phone.value = s?.phone || ''; f.lineId.value = s?.lineId || ''; f.note.value = s?.note || '';
    f.credits.value = s ? s.credits : 0; f.credits.disabled = !!s;
    f.tags.value = (s?.tags || []).join('、'); f.expiresAt.value = s?.expiresAt || ''; f.blocked.checked = !!s?.blocked;
    $('#stFormTitle').textContent = s ? `編輯 ${s.name}` : '新增學員';
    $('#stDelete').hidden = !s;
    f.scrollIntoView({ behavior: 'smooth', block: 'center' }); f.name.focus();
  }
  $('#addStudentBtn').addEventListener('click', () => openStudentForm(null));
  $('#stCancel').addEventListener('click', () => { $('#stForm').hidden = true; });

  $('#stForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, id = f.dataset.id;
    const data = { name: f.name.value.trim(), phone: f.phone.value.trim(), lineId: f.lineId.value.trim(), note: f.note.value.trim(),
      tags: [...new Set(f.tags.value.split(/[、,，\s#]+/).map(x => x.trim()).filter(Boolean))].slice(0, 10), expiresAt: f.expiresAt.value || null, blocked: f.blocked.checked };
    if (!data.name) return alert('請填姓名');
    try {
      if (id) await F.updateDoc(F.doc(db, 'students', id), data);
      else {
        const credits = parseInt(f.credits.value, 10) || 0;
        const ref = F.doc(F.collection(db, 'students'));
        const b = F.writeBatch(db);
        b.set(ref, { ...data, credits, createdAt: F.serverTimestamp() });
        if (credits) b.set(F.doc(F.collection(db, 'students', ref.id, 'ledger')), { type: 'adjust', delta: credits, note: '建立時的剩餘堂數', at: F.serverTimestamp() });
        await b.commit();
      }
      f.hidden = true;
    } catch (err) { alert('失敗：' + err.message); }
  });

  $('#stDelete').addEventListener('click', async () => {
    const id = $('#stForm').dataset.id, s = byId(id);
    if (!confirm(`刪除學員 ${s.name}？（扣堂紀錄也看不到了，無法復原）`)) return;
    await F.deleteDoc(F.doc(db, 'students', id)).catch(err => alert('失敗：' + err.message));
    $('#stForm').hidden = true;
  });

  /* ---------- 從 Excel 貼上匯入 ---------- */
  const parseImport = txt => txt.split(/\r?\n/).map(r => r.split(/\t|,/).map(c => c.trim())).filter(r => r[0] && !/^(姓名|名字|name)$/i.test(r[0]))
    .map(([name, phone = '', credits = '0', note = '']) => ({ name, phone, credits: parseInt(credits, 10) || 0, note }));
  $('#importBtn').addEventListener('click', () => { $('#importBox').hidden = !$('#importBox').hidden; });
  $('#importText').addEventListener('input', () => {
    const rows = parseImport($('#importText').value);
    const dup = rows.filter(r => r.phone && students.some(s => normPhone(s.phone) === normPhone(r.phone)));
    $('#importPreview').textContent = rows.length ? `讀到 ${rows.length} 位${dup.length ? `（其中 ${dup.length} 位電話已經存在，會略過）` : ''}：${rows.slice(0, 5).map(r => `${r.name} 剩${r.credits}`).join('、')}${rows.length > 5 ? '…' : ''}` : '';
  });
  $('#importGo').addEventListener('click', async () => {
    const rows = parseImport($('#importText').value).filter(r => !(r.phone && students.some(s => normPhone(s.phone) === normPhone(r.phone))));
    if (!rows.length) return alert('沒有可以匯入的資料');
    if (!confirm(`匯入 ${rows.length} 位學員？`)) return;
    try {
      for (let i = 0; i < rows.length; i += 200) {
        const b = F.writeBatch(db);
        for (const r of rows.slice(i, i + 200)) {
          const ref = F.doc(F.collection(db, 'students'));
          b.set(ref, { name: r.name, phone: r.phone, lineId: '', note: r.note, credits: r.credits, createdAt: F.serverTimestamp() });
          b.set(F.doc(F.collection(db, 'students', ref.id, 'ledger')), { type: 'import', delta: r.credits, note: '匯入舊資料', at: F.serverTimestamp() });
        }
        await b.commit();
      }
      $('#importText').value = ''; $('#importPreview').textContent = `已匯入 ${rows.length} 位 ✓`;
    } catch (err) { alert('匯入失敗：' + err.message); }
  });


  /* ---------- 課程方案 ---------- */
  function renderPackages() {
    const box = $('#pkList'); if (!box) return;
    box.innerHTML = packages.map(p => `<div class="reel-row pk-row ${p.active === false ? 'off' : ''}">
      <a>${esc(p.name)}・${p.credits} 堂・$${p.price}${p.days ? `・${p.days} 天` : '・不限期'}${p.credits ? `・每堂 $${Math.round(p.price / p.credits)}` : ''}</a>
      <button type="button" data-pkoff="${p.id}" class="txt">${p.active === false ? '上架' : '停售'}</button>
      <button type="button" data-pkdel="${p.id}" title="刪除">✕</button></div>`).join('') || '<p class="hint">還沒有方案</p>';
  }
  $('#pkForm').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    const d = { name: f.pkName.value.trim(), credits: parseInt(f.pkCredits.value, 10) || 0, price: parseInt(f.pkPrice.value, 10) || 0, days: parseInt(f.pkDays.value, 10) || 0, active: true };
    if (!d.name || d.credits <= 0) return alert('請填方案名稱和堂數');
    await F.setDoc(F.doc(F.collection(db, 'packages')), d).catch(err => alert('失敗：' + err.message));
    f.reset();
  });
  $('#pkList').addEventListener('click', async e => {
    const t = e.target.dataset;
    if (t.pkoff) { const p = packages.find(x => x.id === t.pkoff); await F.updateDoc(F.doc(db, 'packages', p.id), { active: p.active === false }); }
    if (t.pkdel && confirm('刪除這個方案？（已賣出的不受影響）')) await F.deleteDoc(F.doc(db, 'packages', t.pkdel));
  });

  /* ================= 報表 ================= */
  $('#rpMonth').value = todayStr().slice(0, 7);
  $('#rpMonth').addEventListener('change', renderReport);
  async function renderReport() {
    const m = $('#rpMonth').value; if (!m) return;
    const [y, mo] = m.split('-').map(Number);
    const next = `${mo === 12 ? y + 1 : y}-${pad(mo === 12 ? 1 : mo + 1)}`;
    const start6 = new Date(y, mo - 6, 1), m6 = `${start6.getFullYear()}-${pad(start6.getMonth() + 1)}`;
    $('#rpBody').innerHTML = '<p class="hint">計算中…</p>';
    try {
      const [salesSnap, lesSnap] = await Promise.all([
        F.getDocs(F.query(F.collection(db, 'sales'), F.where('month', '>=', m6))),
        F.getDocs(F.query(F.collection(db, 'lessons'), F.where('date', '>=', `${m}-01`)))
      ]);
      const sales = salesSnap.docs.map(d => d.data());
      const monthSales = sales.filter(x => x.month === m);
      const revenue = monthSales.reduce((a, x) => a + (x.amount || 0), 0);
      const done = lesSnap.docs.map(d => d.data()).filter(l => l.date < `${next}-01` && l.status === 'done');
      const doneSeats = done.reduce((a, l) => a + l.studentIds.length, 0);
      const allSalesCredits = sales.reduce((a, x) => a + (x.credits || 0), 0), allSalesAmt = sales.reduce((a, x) => a + (x.amount || 0), 0);
      const avg = allSalesCredits ? allSalesAmt / allSalesCredits : 0;
      const unused = students.reduce((a, s) => a + Math.max(0, s.credits || 0), 0);
      const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(y, mo - 6 + i, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; });
      const perMonth = months.map(k => sales.filter(x => x.month === k).reduce((a, x) => a + (x.amount || 0), 0));
      const max = Math.max(1, ...perMonth);
      const money = n => '$' + Math.round(n).toLocaleString();
      $('#rpBody').innerHTML = `
        <div class="kpis">
          <div class="kpi"><small>${mo} 月收入</small><b>${money(revenue)}</b><small>${monthSales.length} 筆</small></div>
          <div class="kpi"><small>${mo} 月已上課（扣堂）</small><b>${doneSeats} 堂</b><small>${done.length} 個時段</small></div>
          <div class="kpi"><small>${mo} 月已核銷金額（估）</small><b>${avg ? money(doneSeats * avg) : '—'}</b><small>${avg ? `以平均每堂 ${money(avg)} 估算` : '還沒有銷售紀錄'}</small></div>
          <div class="kpi"><small>目前未上完（預收）</small><b>${unused} 堂</b><small>${avg ? `約 ${money(unused * avg)}` : ''}</small></div>
        </div>
        <div class="panel"><h2>近 6 個月收入</h2><div class="bars">${months.map((k, i) => `<div class="bar-col"><span class="bar-val">${perMonth[i] ? money(perMonth[i]) : ''}</span><div class="bar-fill" style="height:${Math.round(perMonth[i] / max * 100)}%"></div><small>${Number(k.slice(5))}月</small></div>`).join('')}</div></div>
        <div class="panel"><h2>${mo} 月銷售明細</h2>${monthSales.sort((a, b) => a.date.localeCompare(b.date)).map(x => `<div class="log"><span>${x.date.slice(5)}</span><span>${esc(x.name)}・${esc(x.label)}</span><b class="pos">+${x.credits}</b><small>${money(x.amount)}</small></div>`).join('') || '<p class="hint">這個月還沒有銷售</p>'}</div>`;
    } catch (err) { $('#rpBody').innerHTML = `<p class="hint">讀取失敗：${esc(err.message)}</p>`; }
  }

  /* ---------- 網站預約確認 → 自動建學員＋排課 ---------- */
  return {
    renderReport,
    flag(phone) {
      const p = normPhone(phone); const st = p && students.find(x => normPhone(x.phone) === p);
      if (!st) return '';
      return st.blocked ? `<span class="tag bad">⚠️ 黑名單學員</span>` : `<span class="tag">舊學員・剩 ${st.credits} 堂</span>`;
    },
    async bookingConfirmed(bk, batch) {
      const p = normPhone(bk.phone);
      let s = students.find(x => p && normPhone(x.phone) === p);
      let sid = s?.id;
      if (!sid) {
        const ref = F.doc(F.collection(db, 'students'));
        sid = ref.id;
        batch.set(ref, { name: bk.name, phone: bk.phone, lineId: bk.lineId || '', note: '網站預約', credits: 0, createdAt: F.serverTimestamp(), ...(bk.lineUserId ? { lineUserId: bk.lineUserId, lineName: bk.lineName || '' } : {}) });
      } else if (bk.lineUserId && !s.lineUserId) {
        batch.update(F.doc(db, 'students', sid), { lineUserId: bk.lineUserId, lineName: bk.lineName || '' });
      }
      batch.set(F.doc(db, 'lessons', `bk_${bk.id}`), {
        date: bk.date, time: bk.time, minutes: 60, studentIds: [sid], studentNames: [bk.name], status: 'scheduled', seriesId: null,
        note: `網站預約${bk.people > 1 ? `・${bk.people} 人` : ''}`, bookingId: bk.id, createdAt: F.serverTimestamp()
      });
    },
    bookingCancelled(bk, batch) {
      batch.set(F.doc(db, 'lessons', `bk_${bk.id}`), { status: 'cancelled' }, { merge: true });
    }
  };
}
