# 突破重圍 BREAK THROUGH — 呂淙維 拳擊・綜合體能教練網站

純靜態網站（無 build）＋ Firebase（Hosting / Firestore / Auth）。

- `public/index.html` 形象網站＋私人課預約；`public/admin.html` 教練後台（只用 Google 登入；LINE/IG 內建瀏覽器不能用 Google 登入）：預約／課務扣堂／學員／網站內容
- `public/admin-crm.js` 課務扣堂＋學員名冊（第一階段）：`students/{id}`（credits 剩餘堂數）＋`ledger` 子集合、`lessons/{id}`（studentIds 多人、status scheduled|done|cancelled、doneAtMs 24h 內可復原）。網站預約按確認 → 依電話找/建學員＋建 `lessons/bk_{bookingId}`。BookFast 式功能已加：`packages`（課程方案）、`sales`（銷售紀錄，報表用）、學員 expiresAt 到期日＋請假延期、tags 標籤、blocked 黑名單（預約卡片警告）、沉睡（60 天沒上課）、報表分頁。LIFF `2012453936-wvzYI7qS`（LINE Login channel 2012453936）→ 預約頁帶入 LINE 名字、booking 存 lineUserId，確認時寫進學員。第二階段（扣堂通知、課前提醒、候補通知、分群推播、學員查堂數頁，需 Cloud Functions）、第三階段（定型化契約、退費試算、報表、Google 行事曆）尚未做
- 管理員：`admins/{uid}` 或 `admins/{已驗證 Email}` 有文件即可（firestore.rules／storage.rules 都認兩種）
- 後台「網站內容」分頁可改聯絡方式、固定課表、私人課開放時段、休假日 → 存 Firestore `site/config`，前台載入後覆蓋 `data.js`（讀不到就用 data.js 預設）
- `public/data.js` 預設資料：固定課表（取自海報 `../素材/20261107-180958_拳擊.jpg`）、聯絡方式（LINE @043ixcyx、IG _cwl1127._ 已填；電話待補）、私人課可預約時段
- `public/firebase-config.js` 為 null 時是示範模式（預約不會存）
- Firestore：`bookings`（學員只能 create）、`busy`（教練確認後寫入的時段，公開讀，前台用來灰掉已約時段）、`site/config`（網站內容，公開讀、管理員寫）、`admins/{uid 或 Email}`（只能從 console 建）
- IG Reels 作品集：後台「網站內容 → IG 影片」貼網址 → `site/config.reels`，前台 `#reels` 區塊（沒影片就隱藏），滑到附近才載入 instagram embed.js
- 照片：後台「網站內容 → 照片」上傳（瀏覽器縮成 webp → Firebase Storage `photos/{coach,g1,g2,g3,hero}.webp`，下載網址存 `site/config.photos`；`storage.rules` 用 firestore.exists 檢查 admins），或放進 `public/img/` 用固定檔名
- Logo 原稿在 `logo/`，定稿 `tupo-chongwei-v4.svg`（文字還沒轉曲線）
- 本機預覽：`cd public && python3 -m http.server 8080`
- 網址不帶 .html（firebase.json cleanUrls）：後台 `/admin`、學員 App `/member`
- 部署：`./deploy.sh`（會自動替 CSS/JS 換版本號，不要直接 firebase deploy）
- Logo 已改用白色剪影熊頭像（`素材/20261107-201604_疤眼熊拳手頭像.png` 去背 → `public/img/logo-bear.png`、`icon-192.png`、`apple-touch-icon.png`）；舊 svg Logo 不再使用
- LINE 官方帳號「突破Boxing」`@043ixcyx`（Messaging API channel 2012453121，secret 不進 git）。`line/`：圖文選單原稿 `richmenu.html` → `richmenu.jpg`（2500×1686）、區塊設定 `richmenu.json`、大頭貼 `line-avatar.png`。目前預設選單 `richmenu-b33b765bb648af12472809b638413d16`（左格「預約私人課」→ `/?book` 精簡預約頁）
- 預約人資料記在學員手機 localStorage `tupo_profile_v1`，回頭客收起個人資料欄（`.returning`），只選日期時段
- `/?book`：只顯示預約表單（html 加 `book-only` class），給 LINE 圖文選單用
- 網站預約完成 → 跳「等一下會打開 LINE」視窗，用 `https://line.me/R/oaMessage/@043ixcyx/?訊息` 預填；預約區上方另有「立即預約（LINE）」
- 學員 LINE 預約 App：`public/member.html`＋`member.js`（LIFF `2012453936-jc7TPoii`）：綁定（姓名＋手機對學員）、週曆選時段→線上預約（伺服器扣 1 堂、lessons.paid=true、source=line、寫 busy）、我的課（上課前 12 小時可取消退堂）、方案（packages 公開讀）、我的（堂數紀錄）。後台：paid 的課完課不再扣、教練取消會退堂；教練排課也寫 busy
- `functions/`（Node 22、asia-east1）：`api`（學員 App，用 LIFF ID token 向 LINE 驗證）、`lineWebhook`（「通知綁定 密碼」加入 `notify/config.lineUserIds`、「取消通知」、「查堂數」）、`onBookingCreated`（新預約通知）。設定在 `functions/.env`（不進 git）。部署：`firebase deploy --only functions`（第一次要先給 compute SA `roles/cloudbuild.builds.builder`）
