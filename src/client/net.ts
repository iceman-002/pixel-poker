// WebSocket client with session token + exponential-backoff reconnect (iOS backgrounding safe).
import type { C2S, S2C } from '../shared/protocol.js';
import { profile, store } from './settings';

export interface Session { room: string; token: string }
export type NetStatus = 'online' | 'offline' | 'connecting';

export class Net {
  private ws: WebSocket | null = null;
  private tries = 0;
  private timer = 0;
  private queue: C2S[] = [];
  private want = false;

  constructor(private onMsg: (m: S2C) => void, private onStatus: (s: NetStatus) => void) {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.kick(); });
    addEventListener('pageshow', () => this.kick());
    addEventListener('online', () => this.kick());
    setInterval(() => { if (this.ws?.readyState === WebSocket.OPEN) this.raw({ t: 'ping' }); }, 20000);
  }

  get session(): Session | null {
    try { return JSON.parse(localStorage.getItem('pp.session') ?? 'null'); } catch { return null; }
  }
  set session(v: Session | null) {
    if (v) store('pp.session', v);
    else try { localStorage.removeItem('pp.session'); } catch { /* ignore */ }
  }

  start() { this.want = true; this.open(); }

  /** Reconnect now if the socket is dead (called on resume / visibility). */
  kick() {
    if (!this.want) return;
    if (!this.ws || this.ws.readyState > WebSocket.OPEN) { this.tries = 0; this.open(); }
  }

  private open() {
    clearTimeout(this.timer);
    this.onStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      this.onStatus('online');
      const s = this.session;
      const q = this.queue;
      this.queue = [];
      if (s && !q.some((m) => m.t === 'create' || m.t === 'join')) {
        this.raw({ t: 'join', room: s.room, token: s.token, name: profile.name, avatar: profile.avatar });
      }
      q.forEach((m) => this.raw(m));
    };
    ws.onmessage = (e) => {
      let m: S2C;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'joined') this.session = { room: m.room, token: m.token };
      if (m.t === 'left') this.session = null;
      this.onMsg(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.onStatus('offline');
      if (!this.want) return;
      const d = Math.min(10000, 500 * 2 ** this.tries++) * (0.7 + Math.random() * 0.6);
      this.timer = window.setTimeout(() => this.open(), d);
    };
  }

  private raw(m: C2S) { this.ws?.send(JSON.stringify(m)); }

  /** Send an intent. Room create/join is queued while offline; game actions are dropped (server state wins). */
  send(m: C2S): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) { this.raw(m); return true; }
    if (m.t === 'create' || m.t === 'join') this.queue.push(m);
    this.kick();
    return false;
  }
}
