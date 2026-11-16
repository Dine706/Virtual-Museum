// Minimal static server for dist/ with gzip (Vercel serves brotli, slightly smaller), for Lighthouse and
// manual tests of the production build:  node scripts/serve-dist.mjs [port=4175]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST = path.resolve('dist');
const PORT = Number(process.argv[2] ?? 4175);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.geojson', '.svg']);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let f = path.join(DIST, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) f = path.join(f, 'index.html');
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(f);
  let body = fs.readFileSync(f);
  const headers = { 'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=604800',
    'X-Content-Type-Options': 'nosniff' };
  if (COMPRESS.has(ext) && /gzip/.test(req.headers['accept-encoding'] ?? '')) { body = zlib.gzipSync(body, { level: 9 }); headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(body);
}).listen(PORT, () => console.log(`dist/ on http://localhost:${PORT}/`));
