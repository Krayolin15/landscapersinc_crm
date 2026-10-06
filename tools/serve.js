// Tiny static server for local testing:  node tools/serve.js [port]
// (tools/test-browser.js starts the same server on a free port with startServer())
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.woff2': 'font/woff2' };

/** Serve the app folder on `port` (0 = any free port); host defaults to every interface, as before. Resolves with the http.Server once it listens. */
export function startServer(port = 8080, host) {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = normalize(join(root, p));
      if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
      await stat(file);
      res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  return new Promise(ok => (host ? server.listen(port, host, () => ok(server)) : server.listen(port, () => ok(server))));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = +process.argv[2] || 8080;
  startServer(port).then(() => console.log(`Landscapers Inc. HQ → http://localhost:${port}`));
}
