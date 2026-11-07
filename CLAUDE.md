# 突破重圍 BREAK THROUGH — 呂淙維 拳擊・綜合體能教練網站

純靜態網站（無 build）＋ Firebase（Hosting / Firestore / Auth）。

- `public/index.html` 形象網站＋私人課預約；`public/admin.html` 教練後台（Email 登入，看／確認／取消預約）
- `public/data.js` **可改資料都在這**：固定課表（取自海報 `../素材/20261107-180958_拳擊.jpg`）、聯絡方式（LINE/IG/電話待補）、私人課可預約時段
- `public/firebase-config.js` 為 null 時是示範模式（預約不會存）
- Firestore：`bookings`（學員只能 create）、`busy`（教練確認後寫入的時段，公開讀，前台用來灰掉已約時段）、`admins/{uid}`（有這筆文件的帳號才是管理員，只能從 console 建）
- 照片：放進 `public/img/` 用固定檔名就會自動顯示：`hero.jpg` `coach.jpg` `g1.jpg` `g2.jpg` `g3.jpg` `og.jpg`（分享縮圖 1200×630）
- Logo 原稿在 `logo/`，定稿 `tupo-chongwei-v4.svg`（文字還沒轉曲線）
- 本機預覽：`cd public && python3 -m http.server 8080`
- 部署：`./deploy.sh`（會自動替 CSS/JS 換版本號，不要直接 firebase deploy）
