import { randomUUID, randomInt } from 'node:crypto';
import { WebSocket } from 'ws';
import { startHand, applyAction, autoAction, legal, viewFor, type Hand } from '../shared/engine.js';
import { DEFAULT_RULES, sanitizeRules, levelAt, type Rules } from '../shared/rules.js';
import { MAX_SEATS, AVATARS, MAX_NAME, type C2S, type RoomView, type S2C } from '../shared/protocol.js';

export interface Member {
  id: string; token: string; name: string; avatar: number; seat: number;
  stack: number; bought: boolean; rebuys: number; ready: boolean; ws: WebSocket | null; leaving: boolean;
}
export interface RoomOpts { handDelay: number; grace: number }

export const cleanName = (v: unknown) => String(v ?? '').replace(/[^\w .!?'-]/g, '').trim().slice(0, MAX_NAME) || 'Player';
export const cleanAvatar = (v: unknown) => Math.abs(Math.floor(Number(v)) || 0) % AVATARS;

export class Room {
  members = new Map<string, Member>();
  seats: (string | null)[] = Array(MAX_SEATS).fill(null);
  phase: 'lobby' | 'playing' = 'lobby';
  rules: Rules = { ...DEFAULT_RULES };
  host = '';
  hand: Hand | null = null;
  handNo = 0;
  dealer = -1;
  startedAt = 0;
  lastActive = Date.now();
  private evSent = 0;
  private deadline = 0;
  private timerMs = 0;
  private actTimer?: NodeJS.Timeout;
  private nextTimer?: NodeJS.Timeout;

  constructor(public code: string, private opts: RoomOpts) {}

  addMember(name: unknown, avatar: unknown): Member {
    const m: Member = {
      id: randomUUID().slice(0, 8), token: randomUUID(), name: cleanName(name), avatar: cleanAvatar(avatar),
      seat: -1, stack: 0, bought: false, rebuys: 0, ready: false, ws: null, leaving: false,
    };
    this.members.set(m.id, m);
    if (!this.host) this.host = m.id;
    return m;
  }

  attach(m: Member, ws: WebSocket) { m.ws = ws; this.lastActive = Date.now(); this.broadcast(); }

  detach(m: Member) {
    m.ws = null;
    this.lastActive = Date.now();
    if (this.isTurn(m)) this.armTimer();
    this.broadcast();
  }

  connected = () => [...this.members.values()].some((m) => m.ws);

  private isTurn = (m: Member) => !!this.hand && !this.hand.done && m.seat >= 0 && this.hand.toAct === m.seat;
  private inLiveHand = (m: Member) => {
    const p = this.hand && !this.hand.done && m.seat >= 0 ? this.hand.seats[m.seat] : null;
    return !!p && p.id === m.id && !p.folded;
  };
  private levelIdx() {
    const r = this.rules;
    if (r.blindMode === 'hands') return Math.floor(Math.max(0, this.handNo - 1) / r.blindEvery);
    if (r.blindMode === 'minutes' && this.startedAt) return Math.floor((Date.now() - this.startedAt) / 60000 / r.blindEvery);
    return 0;
  }

  /** Handle an intent. Returns an error string if rejected. */
  handle(m: Member, msg: C2S): string | void {
    const playing = this.phase === 'playing';
    switch (msg.t) {
      case 'rules':
        if (m.id !== this.host) return 'Only the host can change rules';
        if (playing) return 'Rules are locked during play';
        this.rules = sanitizeRules({ ...this.rules, ...(msg.rules ?? {}) });
        for (const id of this.seats) { const s = id && this.members.get(id); if (s) { s.stack = this.rules.stack; s.rebuys = 0; } }
        break;
      case 'sit': {
        const s = Math.floor(Number(msg.seat));
        if (!(s >= 0 && s < MAX_SEATS)) return 'Bad seat';
        if (this.seats[s]) return 'Seat taken';
        if (m.seat >= 0) {
          if (playing) return 'Cannot switch seats during play';
          this.seats[m.seat] = null;
        }
        if (!m.bought) { m.stack = this.rules.stack; m.bought = true; }
        this.seats[s] = m.id;
        m.seat = s;
        break;
      }
      case 'stand':
        if (m.seat < 0) return;
        if (this.inLiveHand(m)) return 'Finish the hand first';
        this.seats[m.seat] = null;
        m.seat = -1;
        break;
      case 'ready': m.ready = !!msg.ready; break;
      case 'start': {
        if (m.id !== this.host) return 'Only the host can start';
        if (playing) return 'Already playing';
        const seated = this.seated();
        if (seated.length < 2) return 'Need at least 2 seated players';
        if (seated.filter((s) => s.stack > 0).length < 2) for (const s of seated) { s.stack = this.rules.stack; s.rebuys = 0; }
        this.phase = 'playing';
        this.startedAt = Date.now();
        this.handNo = 0;
        this.nextHand();
        return;
      }
      case 'act': {
        if (!this.hand || this.hand.done || m.seat < 0) return 'No hand in progress';
        if (this.hand.seats[m.seat]?.id !== m.id) return 'Not in this hand';
        try { this.hand = applyAction(this.hand, m.seat, msg.action); } catch (e) { return (e as Error).message; }
        this.afterAction();
        return;
      }
      case 'rebuy':
        if (!this.rules.rebuys) return 'Rebuys are off';
        if (m.rebuys >= this.rules.maxRebuys) return 'No rebuys left';
        if (m.stack > 0 || this.inLiveHand(m)) return 'You still have chips';
        m.stack = this.rules.stack;
        m.rebuys++;
        break;
      case 'leave': this.remove(m); break;
      default: return;
    }
    this.broadcast();
  }

  private seated(): Member[] {
    return this.seats.map((id) => (id ? this.members.get(id) : undefined)).filter((x): x is Member => !!x);
  }

  remove(m: Member) {
    m.ws = null;
    if (this.inLiveHand(m)) {
      m.leaving = true;
      if (this.isTurn(m)) this.armTimer();
      return;
    }
    if (m.seat >= 0) this.seats[m.seat] = null;
    this.members.delete(m.id);
    if (this.host === m.id) {
      const next = [...this.members.values()].find((x) => x.ws) ?? this.members.values().next().value;
      this.host = next?.id ?? '';
    }
  }

  private nextHand() {
    clearTimeout(this.nextTimer);
    clearTimeout(this.actTimer);
    for (const m of [...this.members.values()]) if (m.leaving) { m.leaving = false; this.remove(m); }
    if (this.phase !== 'playing') return;
    const players = this.seats.map((id) => {
      const m = id ? this.members.get(id) : undefined;
      return m && m.stack > 0 ? { id: m.id, name: m.name, stack: m.stack } : null;
    });
    if (players.filter(Boolean).length < 2) {
      this.phase = 'lobby';
      this.hand = null;
      this.deadline = 0;
      for (const m of this.members.values()) m.ready = false;
      this.broadcast();
      return;
    }
    this.handNo++;
    for (let i = 1; i <= MAX_SEATS; i++) {
      const s = (this.dealer + i + MAX_SEATS) % MAX_SEATS;
      if (players[s]) { this.dealer = s; break; }
    }
    const r = this.rules;
    const bomb = r.bombEvery > 0 && this.handNo % r.bombEvery === 0;
    this.hand = startHand(r, players, this.dealer, levelAt(r, this.levelIdx()), { seed: randomInt(2 ** 47), bomb });
    this.evSent = 0;
    this.afterAction();
  }

  private afterAction() {
    const h = this.hand!;
    clearTimeout(this.actTimer);
    if (h.done) {
      for (const p of h.seats) { const m = p && this.members.get(p.id); if (m) m.stack = p.stack; }
      this.deadline = this.timerMs = 0;
      const delay = this.opts.handDelay * (h.boards.length > 1 ? 1.5 : 1);
      this.nextTimer = setTimeout(() => this.nextHand(), delay);
    } else this.armTimer();
    this.broadcast();
  }

  private armTimer() {
    clearTimeout(this.actTimer);
    const h = this.hand;
    if (!h || h.done) return;
    const seat = h.toAct;
    const m = this.members.get(h.seats[seat]!.id);
    let ms = this.rules.timer * 1000;
    if (!m || m.leaving) ms = 50;
    else if (!m.ws) ms = ms ? Math.min(ms, this.opts.grace) : this.opts.grace;
    this.timerMs = ms;
    this.deadline = ms ? Date.now() + ms : 0;
    if (!ms) return;
    this.actTimer = setTimeout(() => {
      if (this.hand !== h) return;
      this.hand = applyAction(h, seat, autoAction(h, seat));
      this.afterAction();
    }, ms);
  }

  view(m: Member): RoomView {
    const h = this.hand;
    return {
      code: this.code,
      host: this.host,
      phase: this.phase,
      rules: this.rules,
      seats: this.seats.map((id, i) => {
        const s = id ? this.members.get(id) : undefined;
        if (!s) return null;
        const hp = h && !h.done ? h.seats[i] : null;
        return {
          id: s.id, name: s.name, avatar: s.avatar, stack: hp && hp.id === s.id ? hp.stack : s.stack,
          connected: !!s.ws, ready: s.ready, rebuys: s.rebuys,
        };
      }),
      members: [...this.members.values()].map((x) => ({ id: x.id, name: x.name, avatar: x.avatar, connected: !!x.ws, seat: x.seat })),
      you: m.id,
      seat: m.seat,
      hand: h ? viewFor(h, m.seat) : null,
      handNo: this.handNo,
      legal: h && m.seat >= 0 && h.seats[m.seat]?.id === m.id ? legal(h, m.seat) : null,
      level: levelAt(this.rules, this.levelIdx()),
      levelIdx: this.levelIdx(),
      timeLeft: this.deadline ? Math.max(0, this.deadline - Date.now()) : 0,
      timerMs: this.timerMs,
      canRebuy: this.rules.rebuys && m.seat >= 0 && m.stack === 0 && m.rebuys < this.rules.maxRebuys && !this.inLiveHand(m),
    };
  }

  broadcast() {
    const ev = this.hand ? this.hand.events.slice(this.evSent) : [];
    if (this.hand) this.evSent = this.hand.events.length;
    for (const m of this.members.values()) send(m.ws, { t: 'state', s: this.view(m), ev });
  }

  dispose() { clearTimeout(this.actTimer); clearTimeout(this.nextTimer); }
}

export function send(ws: WebSocket | null, msg: S2C) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
