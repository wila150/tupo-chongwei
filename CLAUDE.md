# 突破重圍 BREAK THROUGH — 呂淙維 拳擊・綜合體能教練網站

純靜態網站（無 build）＋ Firebase（Hosting / Firestore / Auth）。

- `public/index.html` 形象網站＋私人課預約；`public/admin.html` 教練後台（Email 登入，看／確認／取消預約）
- `public/data.js` **可改資料都在這**：固定課表（取自海報 `../素材/20261107-180958_拳擊.jpg`）、聯絡方式（LINE 官方帳號 @043ixcyx 已填；IG/電話待補）、私人課可預約時段
- `public/firebase-config.js` 為 null 時是示範模式（預約不會存）
- Firestore：`bookings`（學員只能 create）、`busy`（教練確認後寫入的時段，公開讀，前台用來灰掉已約時段）、`admins/{uid}`（有這筆文件的帳號才是管理員，只能從 console 建）
- 照片：放進 `public/img/` 用固定檔名就會自動顯示：`hero.jpg` `coach.jpg` `g1.jpg` `g2.jpg` `g3.jpg` `og.jpg`（分享縮圖 1200×630）
- Logo 原稿在 `logo/`，定稿 `tupo-chongwei-v4.svg`（文字還沒轉曲線）
- 本機預覽：`cd public && python3 -m http.server 8080`
- 部署：`./deploy.sh`（會自動替 CSS/JS 換版本號，不要直接 firebase deploy）
- Logo 已改用白色剪影熊頭像（`素材/20261107-201604_疤眼熊拳手頭像.png` 去背 → `public/img/logo-bear.png`、`icon-192.png`、`apple-touch-icon.png`）；舊 svg Logo 不再使用
- LINE 官方帳號「突破Boxing」`@043ixcyx`（Messaging API channel 2012453121，secret 不進 git）。`line/`：圖文選單原稿 `richmenu.html` → `richmenu.jpg`（2500×1686）、區塊設定 `richmenu.json`、大頭貼 `line-avatar.png`。目前預設選單 `richmenu-c5c202df2c8151c15866bdfcf12c2c2b`
- 網站預約完成 → 跳「等一下會打開 LINE」視窗，用 `https://line.me/R/oaMessage/@043ixcyx/?訊息` 預填；預約區上方另有「立即預約（LINE）」
