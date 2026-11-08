// IG 影片輪播（首頁「訓練影片」＋相簿頁共用）
// 每張卡固定同樣大小；電腦一次 3 張、平板 2 張、手機 1 張（露出下一張一點），左右滑或按箭頭換頁。
// 有封面（後台從媒體庫選，存在 site/config.reelCovers[網址]）→ 顯示封面＋播放鍵，點了開 IG；
// 沒封面 → 用 IG 的嵌入框當預覽圖（不能在網站上播），裁掉上面的帳號列（54px）和下面的按讚留言。
// 不管有沒有封面，點卡片一律開 IG 觀看。
window.renderReels = function (box, urls, covers) {
  covers = covers || {};
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  box.classList.add('rc');
  box.innerHTML = '<button class="rc-nav rc-prev" aria-label="上一組">‹</button><div class="rc-track">' + urls.map(function (u) {
    var c = covers[u];
    var media = c
      ? '<a class="reel-frame reel-cover" href="' + esc(u) + '" target="_blank" rel="noopener" style="background-image:url(\'' + esc(c) + '\')"><span class="reel-play"></span></a>'
      : '<a class="reel-frame" href="' + esc(u) + '" target="_blank" rel="noopener" aria-label="在 IG 觀看"><div class="reel-clip"><iframe src="' + esc(u) + 'embed/" loading="lazy" scrolling="no" tabindex="-1" title="IG 影片預覽"></iframe></div></a>';
    return '<div class="reel">' + media + '<a class="reel-link" href="' + esc(u) + '" target="_blank" rel="noopener">▶ 在 IG 觀看<span>↗</span></a></div>';
  }).join('') + '</div><button class="rc-nav rc-next" aria-label="下一組">›</button><div class="rc-dots"></div>';
  var track = box.querySelector('.rc-track'), dots = box.querySelector('.rc-dots');
  var prev = box.querySelector('.rc-prev'), next = box.querySelector('.rc-next');
  function perPage() { var r = track.querySelector('.reel'); return r ? Math.max(1, Math.round(track.clientWidth / r.getBoundingClientRect().width)) : 1; }
  function pages() { return Math.max(1, Math.ceil(urls.length / perPage())); }
  function cur() { return Math.round(track.scrollLeft / Math.max(1, track.scrollWidth - track.clientWidth) * (pages() - 1)) || 0; }
  function go(i) { var n = pages(); i = Math.max(0, Math.min(n - 1, i)); track.scrollTo({ left: n > 1 ? (track.scrollWidth - track.clientWidth) * i / (n - 1) : 0, behavior: 'smooth' }); }
  function update() {
    var n = pages(), c = cur();
    if (dots.children.length !== n) { var h = ''; for (var i = 0; i < n; i++) h += '<button aria-label="第 ' + (i + 1) + ' 組"></button>'; dots.innerHTML = h; }
    Array.prototype.forEach.call(dots.children, function (d, i) { d.classList.toggle('on', i === c); });
    box.classList.toggle('rc-single', n <= 1);
    prev.disabled = track.scrollLeft < 4; next.disabled = track.scrollLeft > track.scrollWidth - track.clientWidth - 4;
  }
  prev.addEventListener('click', function () { go(cur() - 1); });
  next.addEventListener('click', function () { go(cur() + 1); });
  dots.addEventListener('click', function (e) { var i = Array.prototype.indexOf.call(dots.children, e.target); if (i >= 0) go(i); });
  var t; track.addEventListener('scroll', function () { clearTimeout(t); t = setTimeout(update, 60); }, { passive: true });
  addEventListener('resize', update);
  update();
};

// IG 嵌入框載好會回傳總高度（MEASURE）。總高 = 上方帳號列 54 + 影片 + 下方固定 130 左右（按讚、留言）。
// 用它推算這支影片的比例（4:5、1:1、16:9、1.91:1），只露出影片本身；扁的影片等比放大填滿固定大小的框（左右裁掉），每張都滿版。
(function () {
  var RATIOS = [1.25, 1, 0.5625, 0.5236];
  // 一律到 IG 觀看：iframe 只當預覽圖（不能點），整張卡是連結；扁的影片以頂端為基準放大填滿
  function fit(f) {
    var k = +f.dataset.k || 1;
    f.style.transformOrigin = '50% 0';
    f.style.transform = k > 1.01 ? 'scale(' + k + ')' : '';
    f.style.top = (-54 * k) + 'px';
  }
  addEventListener('message', function (e) {
    if (!/instagram\.com$/.test(new URL(e.origin).hostname)) return;
    var d = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { return; } }
    if (!d || d.type !== 'MEASURE' || !d.details) return;
    var f = Array.prototype.find.call(document.querySelectorAll('.reel-clip iframe'), function (x) { return x.contentWindow === e.source; });
    if (!f) return;
    var clip = f.parentNode, w = clip.clientWidth, raw = (d.details.height - 54 - 130) / w;
    var r = RATIOS.filter(function (x) { return x <= raw + 0.02; })[0] || RATIOS[RATIOS.length - 1];
    // 扁的影片放大到填滿框（左右裁掉），每張卡都滿版
    var k = 1.25 / Math.min(r, 1.25);
    f.style.height = d.details.height + 'px';
    f.dataset.k = k;
    fit(f);
  });
})();
