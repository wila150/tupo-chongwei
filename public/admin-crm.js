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
  const normPhone = p => String(p || '').replace(/[^0-9]/g, '');

  /* ---------- live data ---------- */
  F.onSnapshot(F.query(F.collection(db, 'students'), F.orderBy('name')), snap => {
    students = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStudents(); renderLessons(); renderPicker();
  }, err => console.warn('students', err));
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
    const badge = l.status === 'done' ? '<span class="tag ok">已扣堂</span>' : l.status === 'cancelled' ? '<span class="tag">已取消</span>' : '';
    return `<div class="bk ${l.status === 'done' ? 'confirmed' : l.status === 'cancelled' ? 'cancelled' : 'pending'}">
      <div><div class="bk-when">${md(l.date)} ${esc(l.time)} <small class="muted">${l.minutes || 60} 分</small> ${badge}</div>
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
      else if (confirm(`取消 ${md(l.date)} ${l.time} 這堂課？（不會扣堂）`)) await F.updateDoc(F.doc(db, 'lessons', l.id), { status: 'cancelled' });
    } catch (err) { alert('失敗：' + err.message); }
    e.target.disabled = false;
  });

  async function deduct(l) {
    if (!l.studentIds.length) return alert('這堂課沒有學員，請先刪掉重排');
    const zero = l.studentIds.map(byId).filter(s => s && s.credits <= 0);
    if (zero.length && !confirm(`${zero.map(s => s.name).join('、')} 已經沒有剩餘堂數，仍要扣嗎？（會變成負數）`)) return;
    const b = F.writeBatch(db);
    b.update(F.doc(db, 'lessons', l.id), { status: 'done', doneAtMs: Date.now() });
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
    const list = students.filter(s => !q || s.name.includes(q) || normPhone(s.phone).includes(q));
    const renew = students.filter(s => s.credits <= RENEW_AT).length;
    $('#stSummary').textContent = `共 ${students.length} 位學員${renew ? `・${renew} 位建議續約` : ''}`;
    $('#stList').innerHTML = list.map(s => `<div class="st">
      <div class="st-main"><b>${esc(s.name)}</b> ${s.credits <= RENEW_AT ? '<span class="tag warn">建議續約</span>' : ''}
        <div class="bk-meta">${esc(s.phone || '')}${s.lineId ? `・LINE ${esc(s.lineId)}` : ''}${s.note ? `・${esc(s.note)}` : ''}</div></div>
      <div class="st-credits ${s.credits <= RENEW_AT ? 'low' : ''}"><b>${s.credits}</b><small>剩餘堂數</small></div>
      <div class="st-acts">
        <button class="btn btn-sm" data-buy="${s.id}">加堂數</button>
        <button class="btn btn-ghost btn-sm" data-log="${s.id}">紀錄</button>
        <button class="btn btn-ghost btn-sm" data-edit="${s.id}">編輯</button>
      </div>
      <div class="st-log" id="log-${s.id}" hidden></div>
    </div>`).join('') || '<p class="empty">還沒有學員</p>';
  }
  $('#stSearch').addEventListener('input', renderStudents);

  $('#stList').addEventListener('click', async e => {
    const t = e.target.dataset;
    if (t.buy) {
      const s = byId(t.buy);
      const n = parseInt(prompt(`${s.name} 加幾堂？（輸入負數可以修正）`, '10'), 10); if (!n) return;
      const amount = n > 0 ? Number(prompt('收費金額（元，可留空）', '') || 0) : 0;
      const b = F.writeBatch(db);
      b.update(F.doc(db, 'students', s.id), { credits: F.increment(n) });
      b.set(F.doc(F.collection(db, 'students', s.id, 'ledger')), { type: n > 0 ? 'buy' : 'adjust', delta: n, amount, note: n > 0 ? `購買 ${n} 堂` : `修正 ${n} 堂`, at: F.serverTimestamp() });
      await b.commit().catch(err => alert('失敗：' + err.message));
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
    $('#stFormTitle').textContent = s ? `編輯 ${s.name}` : '新增學員';
    $('#stDelete').hidden = !s;
    f.scrollIntoView({ behavior: 'smooth', block: 'center' }); f.name.focus();
  }
  $('#addStudentBtn').addEventListener('click', () => openStudentForm(null));
  $('#stCancel').addEventListener('click', () => { $('#stForm').hidden = true; });

  $('#stForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, id = f.dataset.id;
    const data = { name: f.name.value.trim(), phone: f.phone.value.trim(), lineId: f.lineId.value.trim(), note: f.note.value.trim() };
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

  /* ---------- 網站預約確認 → 自動建學員＋排課 ---------- */
  return {
    async bookingConfirmed(bk, batch) {
      const p = normPhone(bk.phone);
      let s = students.find(x => p && normPhone(x.phone) === p);
      let sid = s?.id;
      if (!sid) {
        const ref = F.doc(F.collection(db, 'students'));
        sid = ref.id;
        batch.set(ref, { name: bk.name, phone: bk.phone, lineId: bk.lineId || '', note: '網站預約', credits: 0, createdAt: F.serverTimestamp() });
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
