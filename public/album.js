// 相簿頁：/album?id=<coach|g1|g2|g3>，資料在 site/config（albums、albumTitles、albumDesc、albumReels）
import { firebaseConfig } from './firebase-config.js';

const $ = q => document.querySelector(q);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NAMES = { coach: '教練', g1: '訓練照片 1', g2: '訓練照片 2', g3: '訓練照片 3' };
const id = new URLSearchParams(location.search).get('id');

let d = {};
try {
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const F = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const snap = await Promise.race([F.getDoc(F.doc(F.getFirestore(initializeApp(firebaseConfig)), 'site', 'config')), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 6000))]);
  d = snap.exists() ? snap.data() : {};
} catch (e) { console.warn(e); }

const photos = (d.albums?.[id] || []).filter(x => x && x.url);
const reels = (d.albumReels?.[id] || []).filter(u => /^https:\/\/www\.instagram\.com\/(reel|p)\/[\w-]+\/$/.test(u));
const title = d.albumTitles?.[id] || NAMES[id] || '相簿';
const desc = d.albumDesc?.[id] || '';
document.title = `${title}｜突破重圍 BREAK THROUGH`;

if (!NAMES[id] || (!photos.length && !reels.length)) {
  $('#alBody').innerHTML = `<h1 class="al-title">${esc(title)}</h1><p class="al-empty">這本相簿還沒有內容</p>`;
} else {
  const others = Object.keys(NAMES).filter(k => k !== id && ((d.albums?.[k] || []).length || (d.albumReels?.[k] || []).length));
  $('#alBody').innerHTML = `
    <h1 class="al-title">${esc(title)}</h1>
    <div class="al-tags"><span>突破重圍</span>${photos.length ? `<span>照片 ${photos.length}</span>` : ''}${reels.length ? `<span>影片 ${reels.length}</span>` : ''}</div>
    ${desc ? `<p class="al-desc">${esc(desc)}</p>` : ''}
    ${reels.length ? `<h2 class="al-h">影片</h2><div class="reels" id="reelList"></div>` : ''}
    ${photos.length ? `<h2 class="al-h">照片</h2>
    <div class="al-show${photos.length < 2 ? ' one' : ''}"><div class="al-track">${photos.map((p, i) => `<figure data-i="${i}" style="--bg:url('${p.url}')"><img src="${p.url}" alt="${esc(p.caption || title)}" ${i > 1 ? 'loading="lazy"' : ''}>${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}</figure>`).join('')}</div>
      <button class="al-nav al-prev" aria-label="上一張">‹</button><button class="al-nav al-next" aria-label="下一張">›</button><span class="al-count">1 / ${photos.length}</span></div>
    ${photos.length > 1 ? `<div class="al-thumbs">${photos.map((p, i) => `<button data-t="${i}" class="${i ? '' : 'on'}" style="background-image:url('${p.url}')" aria-label="第 ${i + 1} 張"></button>`).join('')}</div>` : ''}` : ''}
    ${others.length ? `<h2 class="al-h">其他相簿</h2><div class="al-next">${others.map(k => `<a href="/album?id=${k}" style="background-image:url('${(d.albums?.[k] || [])[0]?.url || ''}')"><span>${esc(d.albumTitles?.[k] || NAMES[k])}</span></a>`).join('')}</div>` : ''}`;
}

if (reels.length && document.getElementById('reelList')) window.renderReels(document.getElementById('reelList'), reels, d.reelCovers);

/* 燈箱 */
const lb = $('#lightbox'); let cur = 0;
const show = i => { cur = (i + photos.length) % photos.length; $('#lbImg').src = photos[cur].url; $('#lbCap').textContent = `${photos[cur].caption || ''}　${cur + 1} / ${photos.length}`; lb.hidden = false; };
document.addEventListener('click', e => { const f = e.target.closest('.al-track figure'); if (f) show(Number(f.dataset.i)); });

/* 照片輪播：左右滑、箭頭、縮圖，7 秒自動換下一張（滑鼠移上去、手指碰到、看大圖時暫停） */
const show_ = document.querySelector('.al-show');
if (show_ && photos.length > 1) {
  const track = show_.querySelector('.al-track'), thumbs = [...document.querySelectorAll('.al-thumbs button')];
  const at = () => Math.round(track.scrollLeft / track.clientWidth);
  const go = i => { i = (i + photos.length) % photos.length; track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' }); };
  show_.querySelector('.al-prev').addEventListener('click', () => go(at() - 1));
  show_.querySelector('.al-next').addEventListener('click', () => go(at() + 1));
  document.querySelector('.al-thumbs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) go(Number(b.dataset.t)); });
  let st; track.addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(() => {
    const i = at(); show_.querySelector('.al-count').textContent = `${i + 1} / ${photos.length}`;
    thumbs.forEach((t, j) => t.classList.toggle('on', j === i)); thumbs[i]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, 80); }, { passive: true });
  let hold = false;
  show_.addEventListener('mouseenter', () => hold = true); show_.addEventListener('mouseleave', () => hold = false);
  track.addEventListener('touchstart', () => { hold = true; }, { passive: true });
  setInterval(() => { if (!hold && lb.hidden && !document.hidden) go(at() + 1); }, 7000);
}
lb.addEventListener('click', e => { const a = e.target.closest('[data-lb]')?.dataset.lb; if (a === 'prev') show(cur - 1); else if (a === 'next') show(cur + 1); else if (a === 'close' || e.target === lb) lb.hidden = true; });
addEventListener('keydown', e => { if (lb.hidden) return; if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1); if (e.key === 'Escape') lb.hidden = true; });
let tx = 0; lb.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
lb.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1)); });
