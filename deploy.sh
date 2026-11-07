#!/usr/bin/env bash
# 部署：先替 CSS/JS 加新版本號，避免瀏覽器吃到舊快取
set -e
cd "$(dirname "$0")"
v=$(date +%Y%m%d%H%M)
sed -i -E "s/(styles\.css|data\.js|app\.js|admin\.js|member\.js|album\.js)(\?v=[0-9]+)?\"/\1?v=$v\"/g" public/index.html public/admin.html public/member.html public/guide.html public/album.html
firebase deploy --only hosting --project tupo-chongwei
