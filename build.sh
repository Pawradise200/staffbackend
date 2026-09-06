#!/bin/bash
# Pawradise 員工系統 build（2026-09-06 起）
# 前端源碼喺 app.jsx（JSX）；改完必須行呢個 script 重新編譯出 app.js 先 push。
# 同時記得：改咗任何殼檔案（index.html / app.js / 圖）→ sw.js 個 VERSION 要行前一格，
# 同 index.html 入面 app.js?v=… 個 v 都要一齊改，員工先唔會食舊 cache。
set -e
cd "$(dirname "$0")"
if ! command -v npx >/dev/null; then echo "需要 node/npm"; exit 1; fi
TMP=$(mktemp -d)
npm install --prefix "$TMP" --silent @babel/core@7 @babel/cli@7 @babel/preset-react@7
(cd "$TMP" && ./node_modules/.bin/babel --presets @babel/preset-react "$OLDPWD/app.jsx" -o "$OLDPWD/app.js")
node --check app.js
echo "✅ app.js 已重新編譯（$(wc -c < app.js | tr -d ' ') bytes）"
