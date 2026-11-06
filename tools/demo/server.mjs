import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const ext = join(here, '..', '..', 'extension');
const port = Number(process.env.PORT || 8480);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.startsWith('/__demo/') ? join(here, path.slice(8)) : join(ext, normalize(path === '/' ? '/panel.html' : path));
  if (!file.startsWith(here) && !file.startsWith(ext)) return res.writeHead(403).end();
  try {
    let body = await readFile(file);
    if (file.endsWith('panel.html')) body = body.toString().replace('<script type="module"', '<script type="module" src="/__demo/mock.js"></script>\n  <script type="module"');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`Pulsecheck demo on http://localhost:${port}/panel.html`));
