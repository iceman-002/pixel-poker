// Tweens, easing, number tickers, particles.
import { PAL } from './palette';
import { settings } from './settings';

export type Ease = (t: number) => number;
export const E = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  outBack: (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
};

type Num = Record<string, number>;
interface Tw { o: Num; to: Num; from: Num | null; d: number; t: number; delay: number; e: Ease; done: () => void }

export class Tweens {
  private list: Tw[] = [];
  to<T extends object>(o: T, to: Partial<Record<keyof T, number>>, d: number, e: Ease = E.outQuad, delay = 0): Promise<void> {
    const k = settings.reduced ? 0.35 : 1;
    return new Promise((done) => this.list.push({ o: o as unknown as Num, to: to as Num, from: null, d: Math.max(0.001, d * k), t: 0, delay: delay * k, e, done }));
  }
  wait(s: number) { return this.to({ v: 0 }, { v: 1 }, s, E.linear); }
  update(dt: number) {
    const keep: Tw[] = [], fin: Tw[] = [];
    for (const w of this.list) {
      if (w.delay > 0) { w.delay -= dt; if (w.delay > 0) { keep.push(w); continue; } }
      if (!w.from) { w.from = {}; for (const k in w.to) w.from[k] = w.o[k]; }
      w.t += dt;
      const p = Math.min(1, w.t / w.d), v = w.e(p);
      for (const k in w.to) w.o[k] = w.from[k] + (w.to[k] - w.from[k]) * v;
      (p < 1 ? keep : fin).push(w);
    }
    this.list = keep;
    for (const w of fin) w.done();
  }
  /** Jump every running tween to its end. */
  flush() {
    const all = this.list;
    this.list = [];
    for (const w of all) { for (const k in w.to) w.o[k] = w.to[k]; w.done(); }
  }
}

/** Number that counts toward its target. */
export class Ticker {
  v = 0;
  t = 0;
  set(x: number, snap = false) { this.t = x; if (snap) this.v = x; }
  update(dt: number) {
    const d = this.t - this.v;
    if (Math.abs(d) < 0.5) this.v = this.t;
    else this.v += d * Math.min(1, dt * 6) + Math.sign(d) * Math.min(Math.abs(d), dt * 8);
  }
  get n() { return Math.round(this.v); }
}

interface Pt { x: number; y: number; vx: number; vy: number; g: number; drag: number; life: number; max: number; c: number; sz: number; al: number }
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export class Particles {
  list: Pt[] = [];
  add(p: Partial<Pt> & { x: number; y: number }) {
    if (settings.reduced || this.list.length > 500) return;
    const life = p.life ?? 1;
    this.list.push({ vx: 0, vy: 0, g: 0, drag: 0, c: 7, sz: 1, al: 1, ...p, life, max: life });
  }
  update(dt: number) {
    for (const p of this.list) {
      p.vx *= 1 - Math.min(1, p.drag * dt);
      p.vy = p.vy * (1 - Math.min(1, p.drag * dt)) + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }
  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.list) {
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 2) * p.al;
      ctx.fillStyle = PAL[p.c];
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.sz, p.sz);
    }
    ctx.globalAlpha = 1;
  }
  sparkle(x: number, y: number, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), s = rnd(8, 36);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.3, 0.7), c: pick([7, 10, 9]), drag: 2 });
    }
  }
  confetti(x: number, y: number, n = 40) {
    for (let i = 0; i < n; i++) {
      this.add({ x, y, vx: rnd(-70, 70), vy: rnd(-110, -30), g: 140, drag: 1.2, life: rnd(1.2, 2.2), c: pick([8, 9, 10, 11, 12, 14]), sz: pick([1, 2]) });
    }
  }
  flame(x: number, y: number) {
    this.add({ x: x + rnd(-7, 7), y, vx: rnd(-5, 5), vy: rnd(-38, -20), life: rnd(0.25, 0.55), c: pick([8, 9, 9, 10]), sz: pick([1, 2]) });
  }
  dust(x: number, y: number) {
    this.add({ x, y, vx: rnd(-3, 3), vy: rnd(1, 5), life: rnd(3, 6), c: pick([6, 7, 15]), al: 0.35 });
  }
}
