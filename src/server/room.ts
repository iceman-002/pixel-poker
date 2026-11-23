import { startHand, applyAction, autoAction, type Hand, type Action, type Ev } from '../shared/engine.js';
import { startFloor, applyFloor, autoFloor, type Floor, type FAction, type FEv } from '../shared/floor.js';
import { DEFAULT_RULES, sanitizeRules, levelAt, type Rules } from '../shared/rules.js';
import { MAX_SEATS, MAX_NAME, AVATAR_MAX, CARD_BACKS, type C2S, type RoomView, type S2C } from '../shared/protocol.js';
import { giveChips, recap, addBot, kickBot, botAct } from './extras.js';
import { roomView } from './view.js';

/** Minimal socket shape shared by Node's `ws` and the Workers WebSocket. */
export interface Sock { readyState: number; send(data: string): void; close(code?: number, reason?: string): void }
const randomUUID = () => crypto.randomUUID();
const randomInt = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;

export interface Member {
  id: string; token: string; name: string; avatar: number; back: number; seat: number;
  stack: number; bought: boolean; rebuys: number; skips: number; ready: boolean; ws: Sock | null; leaving: boolean; bot: boolean;
}
export interface RoomOpts { handDelay: number; grace: number }
type Game = { done: boolean; toAct: number; events: unknown[]; seats: ({ id: string; stack: number } | null)[] };

const clampInt = (v: unknown, max: number) => Math.min(max - 1, Math.max(0, Math.floor(Number(v)) || 0));
export const cleanName = (v: unknown) => String(v ?? '').replace(/[^\w .!?'-]/g, '').trim().slice(0, MAX_NAME) || 'Player';
export const cleanAvatar = (v: unknown) => clampInt(v, AVATAR_MAX);
export const cleanBack = (v: unknown) => clampInt(v, CARD_BACKS);

export class Room {
  members = new Map<string, Member>();
  seats: (string | null)[] = Array(MAX_SEATS).fill(null);
  phase: 'lobby' | 'playing' = 'lobby';
  rules: Rules = { ...DEFAULT_RULES };
  host = '';
  hand: Hand | null = null;
  floor: Floor | null = null;
  winner = '';
  handNo = 0;
  dealer = -1;
  startedAt = 0;
  lastActive = Date.now();
  log: string[] = [];
  private evSent = 0;
  deadline = 0;
  timerMs = 0;
  private actTimer?: NodeJS.Timeout;
  private nextTimer?: NodeJS.Timeout;

  constructor(public code: string, private opts: RoomOpts) {}

  game(): Game | null { return this.floor ?? this.hand; }

  addMember(name: unknown, avatar: unknown, back: unknown): Member {
    const m: Member = {
      id: randomUUID().slice(0, 8), token: randomUUID(), name: cleanName(name), avatar: cleanAvatar(avatar), back: cleanBack(back),
      seat: -1, stack: 0, bought: false, rebuys: 0, skips: 0, ready: false, ws: null, leaving: false, bot: false,
    };
    this.members.set(m.id, m);
    if (!this.host) this.host = m.id;
    const free = this.seats.findIndex((x) => !x);
    if (this.phase === 'lobby' && free >= 0) { this.seats[free] = m.id; m.seat = free; m.stack = this.rules.stack; m.bought = true; }
    return m;
  }

  attach(m: Member, ws: Sock) { m.ws = ws; this.lastActive = Date.now(); this.broadcast(); }

  detach(m: Member) {
    m.ws = null;
    this.lastActive = Date.now();
    if (this.isTurn(m)) this.armTimer();
    this.broadcast();
  }

  connected = () => [...this.members.values()].some((m) => m.ws);

  private isTurn = (m: Member) => { const g = this.game(); return !!g && !g.done && m.seat >= 0 && g.toAct === m.seat; };
  inLiveHand = (m: Member) => {
    if (m.seat < 0) return false;
    if (this.floor) { const p = this.floor.seats[m.seat]; return !this.floor.done && !!p && p.id === m.id && p.status !== 'skip' && p.status !== 'beaten'; }
    const p = this.hand && !this.hand.done ? this.hand.seats[m.seat] : null;
    return !!p && p.id === m.id && !p.folded;
  };
  levelIdx() {
    const r = this.rules;
    if (r.blindMode === 'hands') return Math.floor(Math.max(0, this.handNo - 1) / r.blindEvery);
    if (r.blindMode === 'minutes' && this.startedAt) return Math.floor((Date.now() - this.startedAt) / 60000 / r.blindEvery);
    return 0;
  }
  nextLevel(): RoomView['nextLevel'] {
    const r = this.rules, L = this.levelIdx();
    if (this.phase !== 'playing' || r.blindMode === 'static' || r.variant === 'floor') return null;
    if (r.blindMode === 'hands') return { in: (L + 1) * r.blindEvery - this.handNo, unit: 'hands' };
    return { in: Math.max(0, this.startedAt + (L + 1) * r.blindEvery * 60000 - Date.now()), unit: 'ms' };
  }

  /** Handle an intent. Returns an error string if rejected. */
  handle(m: Member, msg: C2S): string | void {
    const playing = this.phase === 'playing';
    switch (msg.t) {
      case 'rules':
        if (m.id !== this.host) return 'Only the host can change rules';
        if (playing) return 'Rules are locked during play';
        this.rules = sanitizeRules({ ...this.rules, ...(msg.rules ?? {}) });
        for (const s of this.seated()) { s.stack = this.rules.stack; s.rebuys = 0; }
        break;
      case 'profile': m.name = cleanName(msg.name); m.avatar = cleanAvatar(msg.avatar); m.back = cleanBack(msg.back); break;
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
        if (this.winner || seated.filter((s) => s.stack > 0).length < 2) for (const s of seated) { s.stack = this.rules.stack; s.rebuys = 0; s.skips = 0; }
        this.winner = '';
        this.phase = 'playing';
        this.startedAt = Date.now();
        this.handNo = 0;
        this.nextHand();
        return;
      }
      case 'act': {
        const g = this.game();
        if (!g || g.done || m.seat < 0) return 'No hand in progress';
        if (g.seats[m.seat]?.id !== m.id) return 'Not in this hand';
        try {
          if (this.floor) this.floor = applyFloor(this.floor, m.seat, msg.action as FAction);
          else this.hand = applyAction(this.hand!, m.seat, msg.action as Action);
        } catch (e) { return (e as Error).message; }
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
      case 'give': { const e = giveChips(this, m, msg.seat, msg.amount); if (e) return e; break; }
      case 'addbot': { const e = addBot(this, m); if (e) return e; break; }
      case 'kick': { const e = kickBot(this, m, msg.id); if (e) return e; break; }
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

  private gameOver(winner: string) {
    this.phase = 'lobby';
    this.hand = this.floor = null;
    this.deadline = 0;
    this.winner = winner;
    for (const m of this.members.values()) m.ready = false;
    this.broadcast();
  }

  private nextHand() {
    clearTimeout(this.nextTimer);
    clearTimeout(this.actTimer);
    for (const m of [...this.members.values()]) if (m.leaving) { m.leaving = false; this.remove(m); }
    if (this.phase !== 'playing') return;
    for (const b of this.members.values()) {
      if (b.bot && b.seat >= 0 && b.stack === 0 && this.rules.rebuys && b.rebuys < this.rules.maxRebuys) { b.stack = this.rules.stack; b.rebuys++; }
    }
    const live = this.seats.map((id) => { const m = id ? this.members.get(id) : undefined; return m && m.stack > 0 ? m : null; });
    const alive = live.filter((x): x is Member => !!x);
    const goal = this.rules.goal > 0 ? alive.find((x) => x.stack >= this.rules.goal) : undefined;
    if (goal) return this.gameOver(goal.name);
    if (alive.length < 2) return this.gameOver(alive.length === 1 && !this.rules.rebuys ? alive[0].name : '');
    this.handNo++;
    for (let i = 1; i <= MAX_SEATS; i++) {
      const s = (this.dealer + i + MAX_SEATS) % MAX_SEATS;
      if (live[s]) { this.dealer = s; break; }
    }
    const r = this.rules, seed = randomInt(2 ** 47);
    if (r.variant === 'floor') {
      this.hand = null;
      this.floor = startFloor(r, live.map((m) => m && { id: m.id, name: m.name, stack: m.stack, skips: m.skips }), this.dealer, { seed });
    } else {
      this.floor = null;
      const bomb = r.bombEvery > 0 && this.handNo % r.bombEvery === 0;
      this.hand = startHand(r, live.map((m) => m && { id: m.id, name: m.name, stack: m.stack }), this.dealer, levelAt(r, this.levelIdx()), { seed, bomb });
    }
    this.evSent = 0;
    this.afterAction();
  }

  afterAction() {
    const g = this.game()!;
    clearTimeout(this.actTimer);
    if (g.done) {
      for (const p of g.seats) { const m = p && this.members.get(p.id); if (m) m.stack = p.stack; }
      if (this.floor) for (const p of this.floor.seats) { const m = p && this.members.get(p.id); if (m) m.skips = p.skips; }
      this.log = [recap(this), ...this.log].slice(0, 15);
      this.deadline = this.timerMs = 0;
      const delay = this.opts.handDelay * (this.hand && this.hand.boards.length > 1 ? 1.5 : 1);
      this.nextTimer = setTimeout(() => this.nextHand(), delay);
    } else this.armTimer();
    this.broadcast();
  }

  private armTimer() {
    clearTimeout(this.actTimer);
    const g = this.game();
    if (!g || g.done) return;
    const seat = g.toAct;
    const m = this.members.get(g.seats[seat]!.id);
    let ms = this.rules.timer * 1000;
    if (m?.bot && !m.leaving && this.connected()) {
      this.deadline = this.timerMs = 0;
      this.actTimer = setTimeout(() => { if (this.game() === g) { botAct(this, seat); this.afterAction(); } }, 900 + randomInt(1300));
      return;
    }
    if (!m || m.leaving) ms = 50;
    else if (!m.ws) ms = ms ? Math.min(ms, this.opts.grace) : this.opts.grace;
    this.timerMs = ms;
    this.deadline = ms ? Date.now() + ms : 0;
    if (!ms) return;
    this.actTimer = setTimeout(() => {
      if (this.game() !== g) return;
      if (this.floor) this.floor = applyFloor(this.floor, seat, autoFloor(this.floor, seat));
      else this.hand = applyAction(this.hand!, seat, autoAction(this.hand!, seat));
      this.afterAction();
    }, ms);
  }

  view(m: Member): RoomView { return roomView(this, m); }

  broadcast() {
    const g = this.game();
    const ev = g ? g.events.slice(this.evSent) : [];
    if (g) this.evSent = g.events.length;
    for (const m of this.members.values()) send(m.ws, { t: 'state', s: this.view(m), ev: ev as (Ev | FEv)[] });
  }

  sendAll(msg: S2C) { for (const x of this.members.values()) send(x.ws, msg); }

  dispose() { clearTimeout(this.actTimer); clearTimeout(this.nextTimer); }
}

export function send(ws: Sock | null, msg: S2C) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}
