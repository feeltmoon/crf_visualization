const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream');

const root = path.join(__dirname, 'public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.yaml': 'text/yaml; charset=utf-8', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };
// Enumerate only bundled public assets; never expose repository or server files.
const assets = new Map();
function collect(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}/${entry.name}`;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file, name);
    else if (entry.isFile() && types[path.extname(entry.name)]) assets.set(name, file);
  }
}
collect(root);

function createServer() {
  return http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(req.url.split('?')[0]); }
    catch { res.writeHead(400); res.end(); return; }
    const file = assets.get(pathname === '/' ? '/index.html' : pathname);
    if (!file) { res.writeHead(404); res.end(); return; }
    fs.stat(file, (error, stat) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)],
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache'
      });
      if (req.method === 'HEAD') { res.end(); return; }
      pipeline(fs.createReadStream(file), res, () => {});
    });
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createServer();
  server.listen(port, '0.0.0.0', () => console.log(`Formcraft listening on port ${port}`));
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  });
}
module.exports = { createServer };
