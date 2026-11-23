// Room registry and per-connection protocol handling, independent of the transport (Node `ws` or Cloudflare).
import { Room, send, type Member, type Sock } from './room.js';
import { sanitizeRules } from '../shared/rules.js';
import type { C2S, RoomSummary } from '../shared/protocol.js';

export interface HubOpts { handDelay?: number; grace?: number }
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const IDLE_MS = 10 * 60 * 1000;

export class Hub {
  rooms = new Map<string, Room>();
  private byToken = new Map<string, { room: Room; member: Member }>();
  private opts: { handDelay: number; grace: number };

  constructor(o: HubOpts = {}) { this.opts = { handDelay: o.handDelay ?? 6000, grace: o.grace ?? 30000 }; }

  private newCode() {
    for (;;) {
      const r = crypto.getRandomValues(new Uint32Array(4));
      const c = Array.from(r, (n) => LETTERS[n % LETTERS.length]).join('');
      if (!this.rooms.has(c)) return c;
    }
  }

  /** Attach a new socket; the returned handlers are wired to its message and close events. */
  connect(ws: Sock): { message: (raw: string) => void; close: () => void } {
    let cur: { room: Room; member: Member } | null = null;
    const bind = (room: Room, m: Member) => {
      if (m.ws && m.ws !== ws) m.ws.close(4000, 'replaced');
      cur = { room, member: m };
      this.byToken.set(m.token, cur);
      send(ws, { t: 'joined', room: room.code, token: m.token, id: m.id });
      room.attach(m, ws);
    };
    const message = (raw: string) => {
      let msg: C2S;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      const err = (e: string) => send(ws, { t: 'error', msg: e });
      if (msg.t === 'ping') return send(ws, { t: 'pong' });
      if (msg.t === 'list') return send(ws, { t: 'rooms', rooms: this.list() });
      if (msg.t === 'create' || msg.t === 'join') {
        if (cur) { cur.room.detach(cur.member); cur = null; }
        if (msg.t === 'create') {
          const room = new Room(this.newCode(), this.opts);
          if (msg.rules && typeof msg.rules === 'object') room.rules = sanitizeRules(msg.rules);
          this.rooms.set(room.code, room);
          return bind(room, room.addMember(msg.name, msg.avatar, msg.back));
        }
        const room = this.rooms.get(String(msg.room ?? '').toUpperCase().slice(0, 4));
        if (!room) return err('Room not found');
        const prev = typeof msg.token === 'string' ? this.byToken.get(msg.token) : undefined;
        if (prev && prev.room === room && room.members.get(prev.member.id) === prev.member) return bind(room, prev.member);
        if (room.members.size >= 16) return err('Room is full');
        return bind(room, room.addMember(msg.name, msg.avatar, msg.back));
      }
      if (!cur) return err('Join a room first');
      if (msg.t === 'leave') {
        cur.room.handle(cur.member, msg);
        this.byToken.delete(cur.member.token);
        cur = null;
        return send(ws, { t: 'left' });
      }
      const e = cur.room.handle(cur.member, msg);
      if (e) err(e);
    };
    const close = () => { if (cur && cur.member.ws === ws) cur.room.detach(cur.member); };
    return { message, close };
  }

  /** Public rooms with people in them and a free seat, busiest first. */
  list(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => r.rules.listed && r.connected() && r.seats.some((x) => !x))
      .map((r) => ({
        code: r.code, host: r.members.get(r.host)?.name ?? '', players: r.seats.filter(Boolean).length,
        variant: r.rules.variant, playing: r.phase === 'playing',
      }))
      .sort((a, b) => b.players - a.players)
      .slice(0, 20);
  }

  /** Drop rooms nobody has touched for a while. */
  sweep() {
    for (const [code, room] of this.rooms) {
      if (!room.connected() && Date.now() - room.lastActive > IDLE_MS) {
        room.dispose();
        for (const m of room.members.values()) this.byToken.delete(m.token);
        this.rooms.delete(code);
      }
    }
  }

  dispose() { for (const r of this.rooms.values()) r.dispose(); }
}
