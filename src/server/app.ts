import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room, send, type Member } from './room.js';
import { sanitizeRules } from '../shared/rules.js';
import type { C2S } from '../shared/protocol.js';
import { serveIcon } from './icons.js';

export interface ServerOpts { port: number; staticDir?: string; handDelay?: number; grace?: number }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const IDLE_MS = 10 * 60 * 1000;

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

export function startServer(o: ServerOpts): Promise<{ port: number; close: () => void; rooms: Map<string, Room> }> {
  const opts = { handDelay: o.handDelay ?? 6000, grace: o.grace ?? 30000 };
  const root = o.staticDir ? path.resolve(o.staticDir) : undefined;
  const rooms = new Map<string, Room>();
  const byToken = new Map<string, { room: Room; member: Member }>();
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
    if (serveIcon(req.url ?? '', res)) return;
    serveStatic(root, req, res);
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();

  const newCode = () => {
    for (;;) {
      const c = Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
      if (!rooms.has(c)) return c;
    }
  };

  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    let cur: { room: Room; member: Member } | null = null;

    const bind = (room: Room, m: Member) => {
      if (m.ws && m.ws !== ws) m.ws.close(4000, 'replaced');
      cur = { room, member: m };
      byToken.set(m.token, cur);
      send(ws, { t: 'joined', room: room.code, token: m.token, id: m.id });
      room.attach(m, ws);
    };

    ws.on('message', (raw) => {
      let msg: C2S;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      const err = (e: string) => send(ws, { t: 'error', msg: e });
      if (msg.t === 'ping') return send(ws, { t: 'pong' });
      if (msg.t === 'create' || msg.t === 'join') {
        if (cur) { cur.room.detach(cur.member); cur = null; }
        if (msg.t === 'create') {
          const room = new Room(newCode(), opts);
          if (msg.rules && typeof msg.rules === 'object') room.rules = sanitizeRules(msg.rules);
          rooms.set(room.code, room);
          return bind(room, room.addMember(msg.name, msg.avatar, msg.back));
        }
        const room = rooms.get(String(msg.room ?? '').toUpperCase().slice(0, 4));
        if (!room) return err('Room not found');
        const prev = typeof msg.token === 'string' ? byToken.get(msg.token) : undefined;
        if (prev && prev.room === room && room.members.get(prev.member.id) === prev.member) return bind(room, prev.member);
        if (room.members.size >= 16) return err('Room is full');
        return bind(room, room.addMember(msg.name, msg.avatar, msg.back));
      }
      if (!cur) return err('Join a room first');
      if (msg.t === 'leave') {
        cur.room.handle(cur.member, msg);
        byToken.delete(cur.member.token);
        cur = null;
        return send(ws, { t: 'left' });
      }
      const e = cur.room.handle(cur.member, msg);
      if (e) err(e);
    });

    ws.on('close', () => { if (cur && cur.member.ws === ws) cur.room.detach(cur.member); });
  });

  const tick = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
    for (const [code, room] of rooms) {
      if (!room.connected() && Date.now() - room.lastActive > IDLE_MS) {
        room.dispose();
        for (const m of room.members.values()) byToken.delete(m.token);
        rooms.delete(code);
      }
    }
  }, 25000);
  tick.unref();

  return new Promise((resolve) => {
    server.listen(o.port, () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port, rooms,
        close: () => { clearInterval(tick); for (const r of rooms.values()) r.dispose(); wss.close(); server.close(); },
      });
    });
  });
}
