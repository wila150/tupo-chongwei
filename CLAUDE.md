# 突破重圍 BREAK THROUGH — 呂淙維 拳擊・綜合體能教練網站

純靜態網站（無 build）＋ Firebase（Hosting / Firestore / Auth）。

- `public/index.html` 形象網站＋私人課預約；`public/admin.html` 教練後台（只用 Google 登入；LINE/IG 內建瀏覽器不能用 Google 登入）：預約／課務扣堂／學員／網站內容
- `public/admin-crm.js` 課務扣堂＋學員名冊（第一階段）：`students/{id}`（credits 剩餘堂數）＋`ledger` 子集合、`lessons/{id}`（studentIds 多人、status scheduled|done|cancelled、doneAtMs 24h 內可復原）。網站預約按確認 → 依電話找/建學員＋建 `lessons/bk_{bookingId}`。BookFast 式功能已加：`packages`（課程方案）、`sales`（銷售紀錄，報表用）、學員 expiresAt 到期日＋請假延期、tags 標籤、blocked 黑名單（預約卡片警告）、沉睡（60 天沒上課）、報表分頁。LIFF `2012453936-wvzYI7qS`（LINE Login channel 2012453936）→ 預約頁帶入 LINE 名字、booking 存 lineUserId，確認時寫進學員。第二階段（扣堂通知、課前提醒、候補通知、分群推播、學員查堂數頁，需 Cloud Functions）、第三階段（定型化契約、退費試算、報表、Google 行事曆）尚未做
- 管理員：`admins/{uid}` 或 `admins/{已驗證 Email}` 有文件即可（firestore.rules／storage.rules 都認兩種）
- 後台「網站內容」分頁可改聯絡方式、固定課表、私人課開放時段、休假日 → 存 Firestore `site/config`，前台載入後覆蓋 `data.js`（讀不到就用 data.js 預設）
- `public/data.js` 預設資料：固定課表（取自海報 `../素材/20261107-180958_拳擊.jpg`）、聯絡方式（LINE @043ixcyx、IG _cwl1127._ 已填；電話待補）、私人課可預約時段
- `public/firebase-config.js` 為 null 時是示範模式（預約不會存）
- Firestore：`bookings`（學員只能 create）、`busy`（教練確認後寫入的時段，公開讀，前台用來灰掉已約時段）、`site/config`（網站內容，公開讀、管理員寫）、`admins/{uid 或 Email}`（只能從 console 建）
- 照片＝固定位置相簿（coach/g1/g2/g3；hero 只一張）：後台「網站內容 → 照片」每格可多張上傳、取相簿名、說明、排序（第一張＝封面）→ Storage `photos/albums/<位置>/*.webp`，清單 `site/config.albums.<位置>`、名稱 `site/config.albumTitles`；前台封面顯示名稱＋照片/影片數，點進 **相簿頁 `/album?id=<位置>`**（`album.html`＋`album.js`：標題、說明 `albumDesc`、IG Reels `albumReels`、照片牆＋燈箱、其他相簿；參考光塵 collectionItemDetail 簡化）（舊 `site/config.photos` 仍當封面備援）
- **媒體庫**（後台「媒體庫」分頁，參考光塵 views/cms/media.js＋mediaPicker.js 簡化）：Firestore `media/{id}`（url, path, name, folder, alt, w, h, size, createdAt；admin only）、檔案 Storage `media/<id>.webp`。資料夾＝`folder` 字串（資料夾上傳/拖放自動帶入）。相簿項目存 `{url, mediaId, caption}`，從相簿移除不刪檔；媒體庫刪除會同時從相簿拿掉。每格「從媒體庫選」開選擇器；每格直接上傳也會進媒體庫（folder＝相簿名）。舊相簿照片（有 path 沒 mediaId）第一次開媒體庫時自動登記進來
- IG Reels 作品集：後台「網站內容 → IG 影片」貼網址 → `site/config.reels`，前台 `#reels` 區塊（沒影片就隱藏），滑到附近才載入 instagram embed.js
- Logo 原稿在 `logo/`，定稿 `tupo-chongwei-v4.svg`（文字還沒轉曲線）
- 本機預覽：`cd public && python3 -m http.server 8080`
- 網址不帶 .html（firebase.json cleanUrls）：後台 `/admin`、學員 App `/member`、說明書 `/guide`（`public/guide.html`，功能有改要同步更新）；後台可加入主畫面（`admin.webmanifest`）；後台在 LINE 開會自動 `?openExternalBrowser=1`
- 部署：`./deploy.sh`（會自動替 CSS/JS 換版本號，不要直接 firebase deploy）
- Logo 已改用白色剪影熊頭像（`素材/20261107-201604_疤眼熊拳手頭像.png` 去背 → `public/img/logo-bear.png`、`icon-192.png`、`apple-touch-icon.png`）；舊 svg Logo 不再使用
- LINE 官方帳號「突破Boxing」`@043ixcyx`（Messaging API channel 2012453121，secret 不進 git）。`line/`：圖文選單原稿 `richmenu.html` → `richmenu.jpg`（2500×1686）、區塊設定 `richmenu.json`、大頭貼 `line-avatar.png`。目前預設選單 6 格 `richmenu-aba0016ace76f63aedabd01019f7a086`（原稿 `line/richmenu6.html`／`.json`）：預約私人課（學員 App）、我的堂數（App ?tab=me）、固定課表、首次體驗（LIFF 預約頁，會帶 LINE 身分）、關於教練、聯絡教練（傳訊息）
- 預約人資料記在學員手機 localStorage `tupo_profile_v1`，回頭客收起個人資料欄（`.returning`），只選日期時段
- `/?book`：只顯示預約表單（html 加 `book-only` class），給 LINE 圖文選單用
- 網站預約完成 → 跳「等一下會打開 LINE」視窗，用 `https://line.me/R/oaMessage/@043ixcyx/?訊息` 預填；預約區上方另有「立即預約（LINE）」
- 學員 LINE 預約 App：`public/member.html`＋`member.js`（LIFF `2012453936-jc7TPoii`）：綁定（姓名＋手機對學員）、週曆選時段→線上預約（伺服器扣 1 堂、lessons.paid=true、source=line、寫 busy）、我的課（上課前 12 小時可取消退堂）、方案（packages 公開讀）、我的（堂數紀錄）。後台：paid 的課完課不再扣、教練取消會退堂；教練排課也寫 busy
- `functions/`（Node 22、asia-east1）：`api`（學員 App，用 LIFF ID token 向 LINE 驗證）、`lineWebhook`（「通知綁定 密碼」加入 `notify/config.lineUserIds`、「取消通知」、「查堂數」）、`onBookingCreated`（新預約通知）。設定在 `functions/.env`（不進 git）。部署：`firebase deploy --only functions`（第一次要先給 compute SA `roles/cloudbuild.builds.builder`）
- 自動推播：`nightlyReminder` 每天 20:00（台灣）推明天的課提醒卡（✅準時到／🙋請假 postback → lessons.attend.{sid}，請假會通知管理員）並傳明日課表給管理員；`onLessonDone` 教練完課扣堂（非 paid）→ 傳剩餘堂數給學員
- LINE 記住客人：學員 App 第一次留姓名＋手機 → `rememberLineUser`（電話對到舊學員就綁定，否則建 `prospect: true`、0 堂的新客人）；網站/LIFF 預約有 lineUserId 也會自動記住。0 堂的人在 App 按「申請預約」→ api `request` 建 pending booking（走預約單確認流程），我的課顯示待確認

- Storage 規則要讀 Firestore admins：Storage 服務帳號需要 roles/firebaserules.firestoreServiceAgent（2026-11-08 已加，少了會全部上傳失敗）

- IG 影片＝`public/reels.js` 共用輪播（首頁＋相簿頁）：電腦 3 張／平板 2／手機 1，scroll-snap＋箭頭＋圓點。封面 `site/config.reelCovers[網址]`（後台每支「封面」從媒體庫選），沒封面就用 IG `/embed/` iframe 裁掉上方 54px 帳號列與下方按讚區
- 相簿頁照片＝輪播（album.html `.al-show`：左右滑、箭頭、縮圖列、5 秒自動換、模糊背景補邊，點開燈箱）；首頁三格照片一樣大（手機橫滑）
- IG embed 會 postMessage `MEASURE` 總高：總高 = 54 + 影片 + 130 → reels.js 推算比例（4:5/1:1/16:9/1.91:1），扁的用 transform scale 放大填滿（左右裁）。有些 Reels 嵌入不能直接播（IG 規定，多半是用了版權音樂），只會顯示「在 Instagram 觀看」
- 首頁照片格：相簿多張時每 4 秒淡入輪播（app.js slotSlideshow，三格錯開，滑鼠移上去/看不到時暫停），左上小圓點
