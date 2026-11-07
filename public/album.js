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
    ${reels.length ? `<h2 class="al-h">影片</h2><div class="reels" id="reelList">${reels.map(u => `<div class="reel"><blockquote class="instagram-media" data-instgrm-permalink="${u}?utm_source=ig_embed" data-instgrm-version="14"><a href="${u}" target="_blank" rel="noopener" class="reel-ph">在 Instagram 觀看</a></blockquote></div>`).join('')}</div>` : ''}
    ${photos.length ? `<h2 class="al-h">照片</h2><div class="al-grid">${photos.map((p, i) => `<figure data-i="${i}"><img src="${p.url}" alt="${esc(p.caption || title)}" loading="lazy">${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}
    ${others.length ? `<h2 class="al-h">其他相簿</h2><div class="al-next">${others.map(k => `<a href="/album?id=${k}" style="background-image:url('${(d.albums?.[k] || [])[0]?.url || ''}')"><span>${esc(d.albumTitles?.[k] || NAMES[k])}</span></a>`).join('')}</div>` : ''}`;
  if (reels.length) {
    const sc = document.createElement('script'); sc.async = true; sc.src = 'https://www.instagram.com/embed.js';
    sc.onload = () => window.instgrm?.Embeds.process(); document.body.appendChild(sc);
  }
}

/* 燈箱 */
const lb = $('#lightbox'); let cur = 0;
const show = i => { cur = (i + photos.length) % photos.length; $('#lbImg').src = photos[cur].url; $('#lbCap').textContent = `${photos[cur].caption || ''}　${cur + 1} / ${photos.length}`; lb.hidden = false; };
document.addEventListener('click', e => { const f = e.target.closest('.al-grid figure'); if (f) show(Number(f.dataset.i)); });
lb.addEventListener('click', e => { const a = e.target.closest('[data-lb]')?.dataset.lb; if (a === 'prev') show(cur - 1); else if (a === 'next') show(cur + 1); else if (a === 'close' || e.target === lb) lb.hidden = true; });
addEventListener('keydown', e => { if (lb.hidden) return; if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1); if (e.key === 'Escape') lb.hidden = true; });
let tx = 0; lb.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
lb.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1)); });
