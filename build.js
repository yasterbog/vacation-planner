// Сборка: index.html — сайт для GitHub Pages, dist/artifact.html — версия для артефакта Claude.
const fs = require('fs');
const path = require('path');
const r = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const eng = r('src/engine.js'), tpl = r('src/app.html'), js = r('src/app.js');
const page = tpl.replace('/*ENGINE*/', () => eng) + js + '</script>\n';

// артефакт: Claude сам добавляет doctype, head и базовые стили
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/artifact.html'), page);

// сайт: title, шрифты и стили переносим в head
const split = page.indexOf('<div class="wrap">');
const head = page.slice(0, split), body = page.slice(split);
const site = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0e7c78">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Отпускные">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" type="image/png" href="icon-180.png">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px/1.45 system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
${head.trim()}
</head>
<body>
${body}</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'index.html'), site);
