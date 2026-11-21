import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Hub } from './hub.js';
import { serveIcon } from './icons.js';

export interface ServerOpts { port: number; staticDir?: string; handDelay?: number; grace?: number }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(root: string | undefined, req: http.IncomingMessage, res: http.ServerResponse) {
  if (!root) { res.writeHead(404).end(); return; }
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.normalize(path.join(root, url));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('Build the client first: npm run build'); return; }
  const ext = path.extname(file);
  const immutable = url.startsWith('/assets/');
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

export function startServer(o: ServerOpts): Promise<{ port: number; close: () => void; rooms: Hub['rooms'] }> {
  const root = o.staticDir ? path.resolve(o.staticDir) : undefined;
  const hub = new Hub(o);
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
    if (serveIcon(req.url ?? '', res)) return;
    serveStatic(root, req, res);
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    const h = hub.connect(ws);
    ws.on('message', (raw) => h.message(String(raw)));
    ws.on('close', h.close);
  });

  const tick = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
    hub.sweep();
  }, 25000);
  tick.unref();

  return new Promise((resolve) => {
    server.listen(o.port, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, rooms: hub.rooms, close: () => { clearInterval(tick); hub.dispose(); wss.close(); server.close(); } });
    });
  });
}
