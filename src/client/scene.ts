// Table scene: display objects, layout, per-frame update and draw. Animations live in anim.ts.
import type { RoomView } from '../shared/protocol.js';


import { buildTable } from './sprites';
import { Tweens, Particles, Ticker, E } from './fx';

import { sfx } from './audio';

export const W = 195, H = 422;
export interface P { x: number; y: number }
export interface CardObj { c: number; x: number; y: number; rot: number; sx: number; s: number; a: number; lift: number; glow: number; face: boolean; b: number }
export interface Flyer { fx: number; fy: number; tx: number; ty: number; k: number; amt: number; trail: boolean }
export interface Bubble { text: string; c: number; s: number; life: number }
export interface SeatFx { stack: Ticker; bet: Ticker; bounce: number; bubble: Bubble | null; blink: number; folded: boolean; flame: boolean }

const SLOTS: P[] = [[16, 336], [38, 272], [13, 168], [38, 64], [97, 40], [157, 64], [182, 168], [157, 272]].map(([x, y]) => ({ x, y }));
export const CENTER: P = { x: 97, y: 168 }, POT: P = { x: 118, y: 132 }, DECK: P = { x: 76, y: 132 };

export const fmt = (n: number) =>
  n >= 1e6 ? +(n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'M' : n >= 1e4 ? +(n / 1e3).toFixed(n < 1e5 ? 1 : 0) + 'K' : String(n);
export const newCard = (c: number, at: P, s = 0.6, b = 0): CardObj => ({ c, x: at.x, y: at.y, rot: 0, sx: 1, s, a: 1, lift: 0, glow: 0, face: false, b });

export class Scene {
  s: RoomView | null = null;
  recvAt = 0;
  me = -1;
  tw = new Tweens();
  px = new Particles();
  fx: SeatFx[] = Array.from({ length: 8 }, () => ({ stack: new Ticker(), bet: new Ticker(), bounce: 0, bubble: null, blink: Math.random() * 4, folded: false, flame: false }));
  hole: CardObj[][] = Array.from({ length: 8 }, () => []);
  boards: CardObj[][] = [[]];
  loose: CardObj[] = [];
  flyers: Flyer[] = [];
  pot = new Ticker();
  dim = { v: 0 };
  banner: Bubble | null = null;
  shake = 0;
  t = 0;
  lamp = 1;
  selected = new Set<number>();
  onSelect = () => {};
  bg = buildTable(W, H);
  boss = -1;
  crown = { y: 0, a: 0 };
  house = { a: 0 };

  slot(seat: number) { return this.me >= 0 ? (seat - this.me + 8) % 8 : seat; }
  seatPos(seat: number): P { return SLOTS[this.slot(seat)]; }
  dir(seat: number): P {
    const p = this.seatPos(seat), dx = CENTER.x - p.x, dy = CENTER.y - p.y, l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  }
  betPos(seat: number): P {
    if (this.slot(seat) === 0) return { x: 97, y: 266 };
    const p = this.seatPos(seat);
    return { x: p.x + (CENTER.x - p.x) * 0.42, y: p.y + (CENTER.y - p.y) * 0.42 };
  }
  holePos(seat: number, j: number, n: number, open: boolean): P & { s: number } {
    if (seat === this.me) { const sp = n <= 4 ? 32 : 28; return { x: 107 - ((n - 1) * sp) / 2 + j * sp, y: 338, s: 2 }; }
    const p = this.seatPos(seat), d = this.dir(seat);
    const dist = open ? 34 : 27, sp = open ? (n > 2 ? 7 : 12) : 4, off = (j - (n - 1) / 2) * sp;
    if (open && Math.abs(d.x) > 0.9) return { x: p.x + d.x * 16 + off, y: p.y + 38, s: 1 }; // side seats: below, clear of the board
    return { x: p.x + d.x * dist + off, y: p.y + d.y * dist, s: open ? 1 : 0.6 };
  }
  boardPos(r: number, i: number, runs: number): P { return { x: 63 + i * 17, y: runs > 1 ? 156 + r * 26 : 168 }; }
  flyerPos(f: Flyer): P { return { x: f.fx + (f.tx - f.fx) * f.k, y: f.fy + (f.ty - f.fy) * f.k - Math.sin(f.k * Math.PI) * 16 }; }

  bubble(seat: number, text: string, c = 0) {
    const b: Bubble = { text, c, s: 0, life: 1.5 };
    this.fx[seat].bubble = b;
    void this.tw.to(b, { s: 1 }, 0.22, E.outBack);
  }
  async flip(o: CardObj, delay = 0) {
    await this.tw.to(o, { sx: 0 }, 0.09, E.inQuad, delay);
    o.face = o.c >= 0;
    sfx('flip');
    await this.tw.to(o, { sx: 1 }, 0.14, E.outBack);
  }
  resetHand() {
    this.hole = this.hole.map(() => []);
    this.boards = [[]];
    this.loose = [];
    this.selected.clear();
    for (const f of this.fx) { f.folded = false; f.flame = false; f.bet.set(0, true); }
  }
  setGlow(seat: number, run: number, cards: number[]) {
    for (const o of [...this.hole[seat], ...(this.boards[run] ?? [])]) o.glow = cards.includes(o.c) ? 1 : 0;
  }
  clearGlow() { for (const o of [...this.hole.flat(), ...this.boards.flat()]) o.glow = 0; }

  /** Snap display to an authoritative state (tickers still count). */
  sync(s: RoomView, at: number, fast: boolean) {
    this.s = s;
    this.recvAt = at;
    this.me = s.seat;
    const h = s.hand;
    s.seats.forEach((sv, i) => {
      const f = this.fx[i], hp = h?.seats[i];
      f.stack.set(hp && h && !h.done && hp.id === sv?.id ? hp.stack : sv?.stack ?? 0, fast);
      f.bet.set(h && !h.done && hp ? hp.bet : 0, fast);
      f.folded = !!hp?.folded;
      f.flame = !!hp && hp.allIn && !hp.folded && !h!.done;
    });
    const fb = s.floor && s.floor.phase !== 'stake' ? s.floor.boss : -1;
    if (fb !== this.boss) { this.boss = fb; this.crown.a = fb >= 0 ? 1 : 0; this.crown.y = 0; }
    if (!h) { this.resetHand(); this.pot.set(0, true); return; }
    const sum = (k: 'total' | 'bet') => h.seats.reduce((a, p) => a + (p?.[k] ?? 0), 0);
    this.pot.set(h.done ? 0 : sum('total') - sum('bet'), fast);
    h.seats.forEach((hp, i) => {
      if (!hp || hp.folded) { this.hole[i] = []; return; }
      const arr = this.hole[i];
      const n = hp.hole.length;
      if (i === s.seat && arr.some((o, j) => o.c !== hp.hole[j])) this.selected.clear();
      arr.length = Math.min(arr.length, n);
      hp.hole.forEach((c, j) => {
        const open = hp.shown && i !== s.seat;
        const t = this.holePos(i, j, n, open);
        const o = arr[j] ?? (arr[j] = newCard(c, t, t.s));
        o.b = s.seats[i]?.back ?? 0;
        o.c = c;
        Object.assign(o, { x: t.x, y: t.y, s: t.s, rot: 0, sx: 1, a: 1, face: c >= 0 });
        if (i === s.seat) o.lift = this.selected.has(j) ? -6 : 0;
      });
    });
    this.boards = h.boards.map((b, r) => b.map((c, i) => {
      const o = this.boards[r]?.[i] ?? newCard(c, this.boardPos(r, i, h.boards.length), 1);
      return Object.assign(o, { c, ...this.boardPos(r, i, h.boards.length), s: 1, rot: 0, sx: 1, a: 1, face: true });
    }));
    if (fast) { this.tw.flush(); this.flyers = []; this.loose = []; this.dim.v = 0; }
  }

  /** Tap on own cards toggles lift / selection. */
  hit(x: number, y: number): boolean {
    if (this.me < 0) return false;
    const mine = this.hole[this.me];
    for (let j = mine.length - 1; j >= 0; j--) {
      const o = mine[j];
      if (Math.abs(x - o.x) < 7.5 * o.s && Math.abs(y - o.y - o.lift) < 10.5 * o.s) {
        const sel = !this.selected.has(j);
        sel ? this.selected.add(j) : this.selected.delete(j);
        void this.tw.to(o, { lift: sel ? -6 : 0 }, 0.18, E.outBack);
        sfx('tap');
        this.onSelect();
        return true;
      }
    }
    return false;
  }

  update(dt: number) {
    this.t += dt;
    this.tw.update(dt);
    this.px.update(dt);
    this.pot.update(dt);
    for (const f of this.fx) {
      f.stack.update(dt);
      f.bet.update(dt);
      f.blink -= dt;
      if (f.blink < -0.13) f.blink = 1.5 + Math.random() * 4;
      if (f.bubble && (f.bubble.life -= dt) <= 0) f.bubble = null;
    }
    if (this.banner && (this.banner.life -= dt) <= 0) this.banner = null;
    this.lamp = Math.random() < 0.006 ? 0.4 : this.lamp + (0.92 + Math.sin(this.t * 5) * 0.05 - this.lamp) * Math.min(1, dt * 8);
    if (Math.random() < dt * 2.5) this.px.dust(55 + Math.random() * 85, 14 + Math.random() * 70);
    this.fx.forEach((f, i) => {
      if (f.flame && this.s?.seats[i] && Math.random() < dt * 40) { const p = this.seatPos(i); this.px.flame(p.x, p.y + 4); }
    });
    for (const fl of this.flyers) if (fl.trail && Math.random() < dt * 45) { const p = this.flyerPos(fl); this.px.sparkle(p.x, p.y, 1); }
    this.shake = Math.max(0, this.shake - dt * 14);
  }

}

/** Where a seat's chip towers stand (beside the avatar, above it for side seats). */
export function towerPos(sc: Scene, seat: number, w: number): P {
  const p = sc.seatPos(seat), d = sc.dir(seat);
  if (sc.slot(seat) === 0) return { x: 174, y: 362 };
  if (Math.abs(d.x) > 0.9) return { x: p.x - w / 2 + 1, y: p.y - 11 };
  return p.x <= 97 ? { x: p.x + 10, y: p.y + 4 } : { x: p.x - 10 - w, y: p.y + 4 };
}
