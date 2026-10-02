// Minimal static file server (no dependencies).  Usage: node server.js [port]
const http = require('http'), fs = require('fs'), path = require('path');
const port = +process.argv[2] || 8080;
const root = __dirname;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.json':'application/json', '.svg':'image/svg+xml',
  '.wav':'audio/wav', '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.ico':'image/x-icon' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.normalize(path.join(root, p));
  if (!f.startsWith(root) || f.includes('node_modules')) { res.writeHead(403); return res.end('forbidden'); }
  // dev server: the menu always shows 'dev' (the build stamps the git hash instead)
  if (p === '/src/version.js') { res.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store' }); return res.end("export const VERSION = 'dev';\n"); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, () => console.log('Serving on http://localhost:' + port));
