// Table scene: display objects, layout, per-frame update and draw. Animations live in anim.ts.
import type { RoomView } from '../shared/protocol.js';
import { PAL } from './palette';
import { drawText, textWidth } from './font';
import { cardFace, CARD_BACK, MINI_BACK, avatar, drawChips, buildTable, LAMP, DEALER } from './sprites';
import { Tweens, Particles, Ticker, E } from './fx';
import { settings } from './settings';
import { sfx } from './audio';

export const W = 195, H = 422;
export interface P { x: number; y: number }
export interface CardObj { c: number; x: number; y: number; rot: number; sx: number; s: number; a: number; lift: number; glow: number; face: boolean }
export interface Flyer { fx: number; fy: number; tx: number; ty: number; k: number; amt: number; trail: boolean }
export interface Bubble { text: string; c: number; s: number; life: number }
export interface SeatFx { stack: Ticker; bet: Ticker; bounce: number; bubble: Bubble | null; blink: number; folded: boolean; flame: boolean }

const SLOTS: P[] = [[16, 336], [38, 272], [13, 168], [38, 64], [97, 40], [157, 64], [182, 168], [157, 272]].map(([x, y]) => ({ x, y }));
export const CENTER: P = { x: 97, y: 168 }, POT: P = { x: 118, y: 132 }, DECK: P = { x: 76, y: 132 };

export const fmt = (n: number) =>
  n >= 1e6 ? +(n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'M' : n >= 1e4 ? +(n / 1e3).toFixed(n < 1e5 ? 1 : 0) + 'K' : String(n);
export const newCard = (c: number, at: P, s = 0.6): CardObj => ({ c, x: at.x, y: at.y, rot: 0, sx: 1, s, a: 1, lift: 0, glow: 0, face: false });

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
  private bg = buildTable(W, H);

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

  private drawCard(ctx: CanvasRenderingContext2D, o: CardObj) {
    if (o.a <= 0.01) return;
    const face = o.face && o.c >= 0, mini = !face && o.s < 0.8;
    const img = face ? cardFace(o.c, settings.fourColor, this.s?.rules.wild === 'deuces') : mini ? MINI_BACK : CARD_BACK;
    const k = mini ? o.s / 0.6 : o.s;
    ctx.save();
    ctx.globalAlpha = o.a;
    ctx.translate(o.x, o.y + o.lift);
    ctx.rotate(o.rot);
    ctx.scale(o.sx * k, k);
    if (o.glow > 0) {
      ctx.globalAlpha = o.a * (0.55 + 0.45 * Math.sin(this.t * 10));
      ctx.fillStyle = PAL[10];
      ctx.fillRect(-img.width / 2 - 1, -img.height / 2 - 1, img.width + 2, img.height + 2);
      ctx.globalAlpha = o.a;
    }
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }

  private label(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, c: number) {
    const w = textWidth(str);
    drawText(ctx, str, Math.max(w / 2 + 1, Math.min(W - w / 2 - 1, x)), y, c, 'c', 1, 0);
  }

  private drawSeat(ctx: CanvasRenderingContext2D, i: number) {
    const s = this.s!, sv = s.seats[i];
    if (!sv) return;
    const p = this.seatPos(i), f = this.fx[i], h = s.hand, hp = h?.seats[i];
    const live = !!h && !h.done;
    const active = live && h!.toAct === i;
    if (active) {
      const r = 12 + Math.sin(this.t * 8) * 1.2;
      ctx.fillStyle = PAL[Math.sin(this.t * 8) > 0 ? 10 : 9];
      for (let a = 0; a < 28; a++) {
        const an = (a / 28) * Math.PI * 2;
        ctx.fillRect(Math.round(p.x + Math.cos(an) * r), Math.round(p.y + Math.sin(an) * r), 1, 1);
      }
    }
    ctx.globalAlpha = (live && (!hp || f.folded)) || !sv.connected ? 0.45 : 1;
    ctx.drawImage(avatar(sv.avatar, f.blink < 0), p.x - 8, p.y - 8);
    ctx.globalAlpha = 1;
    this.label(ctx, sv.name.slice(0, 8), p.x, p.y + 10, i === s.seat ? 10 : 7);
    this.label(ctx, fmt(f.stack.n), p.x, p.y + 16, 11);
    if (!sv.connected) drawText(ctx, 'ZZ', p.x + 5, p.y - 13 + Math.sin(this.t * 3) * 1.5, 12, 'l', 1, 0);
    if (active && s.timerMs) {
      const fr = Math.max(0, Math.min(1, (this.recvAt + s.timeLeft - performance.now()) / s.timerMs));
      ctx.fillStyle = PAL[1];
      ctx.fillRect(p.x - 11, p.y + 23, 22, 2);
      ctx.fillStyle = PAL[fr > 0.5 ? 11 : fr > 0.25 ? 10 : 8];
      ctx.fillRect(p.x - 11, p.y + 23, Math.round(22 * fr), 2);
    }
    if (h && h.dealer === i) {
      const d = this.dir(i);
      ctx.drawImage(DEALER, Math.round(p.x + d.x * 16 - d.y * 14 - 3), Math.round(p.y + d.y * 16 + d.x * 14 - 3));
    }
  }

  private drawBubble(ctx: CanvasRenderingContext2D, p: P, b: Bubble) {
    const w = textWidth(b.text) + 6, h = 9;
    ctx.save();
    ctx.globalAlpha = Math.min(1, b.life / 0.25);
    ctx.translate(Math.round(Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, p.x))), Math.round(p.y - 12));
    ctx.scale(b.s, b.s);
    const x = -Math.round(w / 2), y = -h;
    ctx.fillStyle = PAL[0];
    ctx.fillRect(x - 1, y, w + 2, h); ctx.fillRect(x, y - 1, w, h + 2); ctx.fillRect(-2, 0, 5, 2); ctx.fillRect(0, 2, 1, 1);
    ctx.fillStyle = PAL[7];
    ctx.fillRect(x, y, w, h); ctx.fillRect(-1, 0, 3, 1); ctx.fillRect(0, 1, 1, 1);
    drawText(ctx, b.text, 0, y + 2, b.c, 'c');
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    if (this.shake > 0 && !settings.reduced) ctx.translate(Math.round((Math.random() - 0.5) * this.shake), Math.round((Math.random() - 0.5) * this.shake));
    ctx.drawImage(this.bg, 0, 0);
    const g = ctx.createLinearGradient(0, 8, 0, 210);
    g.addColorStop(0, `rgba(255,236,39,${0.16 * this.lamp})`);
    g.addColorStop(1, 'rgba(255,236,39,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(91, 8); ctx.lineTo(104, 8); ctx.lineTo(190, 210); ctx.lineTo(5, 210); ctx.fill();
    ctx.drawImage(LAMP, 91, 0);
    const s = this.s;
    if (!s) { ctx.restore(); return; }
    if (s.hand) { ctx.drawImage(MINI_BACK, DECK.x - 4, DECK.y - 5); ctx.drawImage(MINI_BACK, DECK.x - 5, DECK.y - 7); }
    if (this.pot.n > 0) { drawChips(ctx, POT.x, POT.y + 4, this.pot.n); drawText(ctx, 'POT ' + fmt(this.pot.n), 97, 113, 10, 'c', 1, 0); }
    this.fx.forEach((f, i) => {
      if (f.bet.n <= 0 || !s.seats[i]) return;
      const b = this.betPos(i);
      drawChips(ctx, b.x, b.y + f.bounce, f.bet.n);
      drawText(ctx, fmt(f.bet.n), b.x + 5, b.y - 3, 7, 'l', 1, 0);
    });
    for (let i = 0; i < 8; i++) this.drawSeat(ctx, i);
    this.hole.forEach((arr, i) => { if (i !== this.me) arr.forEach((o) => this.drawCard(ctx, o)); });
    this.boards.flat().forEach((o) => this.drawCard(ctx, o));
    if (this.me >= 0) this.hole[this.me].forEach((o) => this.drawCard(ctx, o));
    this.loose.forEach((o) => this.drawCard(ctx, o));
    for (const fl of this.flyers) { const p = this.flyerPos(fl); drawChips(ctx, p.x, p.y, fl.amt, 4); }
    this.px.draw(ctx);
    if (this.dim.v > 0.01) {
      const v = ctx.createRadialGradient(97, 190, 20, 97, 190, 240);
      v.addColorStop(0, `rgba(0,0,0,${0.3 * this.dim.v})`);
      v.addColorStop(1, `rgba(0,0,0,${0.85 * this.dim.v})`);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
      [...this.hole.flat(), ...this.boards.flat()].filter((o) => o.glow > 0).forEach((o) => this.drawCard(ctx, o));
    }
    this.fx.forEach((f, i) => { if (f.bubble && s.seats[i]) this.drawBubble(ctx, this.seatPos(i), f.bubble); });
    if (this.banner) {
      const b = this.banner;
      ctx.globalAlpha = Math.min(1, b.life / 0.3);
      ctx.fillStyle = PAL[0];
      ctx.fillRect(0, CENTER.y - 52, W, 16 * b.s);
      drawText(ctx, b.text, 97, CENTER.y - 49, b.c, 'c', 2 * b.s, 2);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}
