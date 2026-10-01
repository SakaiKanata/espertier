#!/bin/sh
# 配布用の単一ファイル dist/index.html を作る
set -e
cd "$(dirname "$0")"
mkdir -p dist docs
python3 - <<'PY'
import io, re
html = io.open('index.html', encoding='utf-8').read()
css  = io.open('style.css',  encoding='utf-8').read()
mqtt = io.open('mqtt.min.js',encoding='utf-8').read()
app  = io.open('app.js',     encoding='utf-8').read()
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n'+css+'\n</style>')
html = html.replace('<script src="mqtt.min.js"></script>', '<script>\n'+mqtt+'\n</script>')
html = html.replace('<script src="app.js"></script>', '<script>\n'+app+'\n</script>')
io.open('dist/index.html','w',encoding='utf-8').write(html)
io.open('docs/index.html','w',encoding='utf-8').write(html)   # GitHub Pages 用
print('dist/index.html, docs/index.html  %.0f KB' % (len(html.encode('utf-8'))/1024))
PY
