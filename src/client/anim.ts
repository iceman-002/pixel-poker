// Turns server events into animations, then snaps the scene to the authoritative state.
import type { Ev } from '../shared/engine.js';
import type { FEv } from '../shared/floor.js';
import { floorEvent } from './flooranim';
import type { RoomView } from '../shared/protocol.js';
import { VARIANTS } from '../shared/rules.js';
import { Scene, POT, DECK, newCard, fmt, type P } from './scene';
import { E } from './fx';
import { sfx } from './audio';

type Item = { s: RoomView; ev: (Ev | FEv)[]; at: number };
type ActEv = Extract<Ev, { t: 'act' }>;
type ShowEv = Extract<Ev, { t: 'showdown' }>;
type StreetEv = Extract<Ev, { t: 'street' }>;

export class Animator {
  private q: Item[] = [];
  private busy = false;
  private pending: Promise<void>[] = [];
  private lastLevel = '';
  constructor(public sc: Scene, private onSynced: (s: RoomView) => void) {}

  push(s: RoomView, ev: (Ev | FEv)[]) {
    this.q.push({ s, ev, at: performance.now() });
    if (!this.busy) void this.run();
  }

  private async run() {
    this.busy = true;
    while (this.q.length) {
      const it = this.q.shift()!;
      const fast = this.q.length > 2 || document.hidden || !this.sc.s || it.s.phase !== 'playing';
      if (!fast && it.ev.length) {
        try { await this.play(it); } catch (e) { console.error(e); }
      }
      this.sc.sync(it.s, it.at, fast);
      this.onSynced(it.s);
    }
    this.busy = false;
  }

  wait = (s: number) => this.sc.tw.wait(s);
  private async settle() { await Promise.all(this.pending); this.pending = []; }

  private async play({ s, ev }: Item) {
    this.sc.me = s.seat;
    // Hide the stale turn ring while streets / showdown animate.
    if (this.sc.s?.hand && ev.some((e) => ['street', 'showdown', 'deal', 'fdeal', 'fpay', 'fduel', 'fboss'].includes(e.t))) this.sc.s.hand.toAct = -1;
    if (ev.some((e) => e.t === 'deal' || e.t === 'fdeal')) { this.sc.resetHand(); this.sc.dim.v = 0; this.sc.pot.set(0, true); }
    let bomb = false;
    for (const e of ev) {
      switch (e.t) {
        case 'post': {
          if (e.kind === 'bomb' && !bomb) { bomb = true; this.banner('BOMB POT!', 9); this.sc.shake = 4; await this.wait(0.5); }
          const p = this.chips(e.seat, e.amount, e.kind === 'ante' || e.kind === 'bomb');
          this.pending.push(p);
          if (e.kind === 'straddle') this.sc.bubble(e.seat, 'STRADDLE', 2);
          await this.wait(0.06);
          break;
        }
        case 'deal': {
          await this.settle();
          const lv = s.hand ? `${s.hand.level.sb}/${s.hand.level.bb}` : '';
          if (this.lastLevel && lv && lv !== this.lastLevel) { this.banner(`BLINDS ${lv}`, 12); await this.wait(0.9); }
          this.lastLevel = lv;
          await this.deal(s);
          break;
        }
        case 'act': await this.settle(); await this.act(s, e); break;
        case 'street': await this.settle(); await this.street(s, e); break;
        case 'twice': this.banner('RUN IT TWICE!', 14); await this.wait(0.8); break;
        case 'showdown': await this.settle(); await this.showdown(s, e); break;
        default: await this.settle(); await floorEvent(this, s, e); break;
      }
    }
    await this.settle();
  }

  banner(text: string, c = 10) {
    const b = { text, c, s: 0, life: 1.4 };
    this.sc.banner = b;
    void this.sc.tw.to(b, { s: 1 }, 0.25, E.outBack);
  }

  /** Chips toss in an arc from a seat to its bet spot (or the pot). */
  async chips(seat: number, amt: number, toPot: boolean) {
    if (amt <= 0) return;
    const sc = this.sc, f = sc.fx[seat];
    f.stack.t -= amt;
    const from = sc.seatPos(seat), to = toPot ? POT : sc.betPos(seat);
    const fl = { fx: from.x, fy: from.y, tx: to.x, ty: to.y, k: 0, amt, trail: false };
    sc.flyers.push(fl);
    sfx('chip');
    await sc.tw.to(fl, { k: 1 }, 0.3, E.inOutQuad);
    sc.flyers = sc.flyers.filter((x) => x !== fl);
    if (toPot) sc.pot.t += amt;
    else {
      f.bet.t += amt;
      f.bounce = -4;
      void sc.tw.to(f, { bounce: 0 }, 0.3, E.outBack);
    }
  }

  async deal(s: RoomView) {
    const sc = this.sc, h = s.hand!;
    sc.resetHand();
    sc.dim.v = 0;
    const n = VARIANTS[h.rules.variant].hole, N = h.seats.length;
    const order = h.seats.map((_, i) => (h.dealer + 1 + i) % N).filter((i) => h.seats[i]);
    const ps: Promise<void>[] = [];
    let k = 0;
    for (let j = 0; j < n; j++) for (const seat of order) {
      const o = newCard(seat === s.seat ? h.seats[seat]!.hole[j] : -1, DECK);
      o.rot = -Math.PI * 1.5;
      sc.hole[seat][j] = o;
      const t = sc.holePos(seat, j, n, false);
      ps.push(sc.tw.to(o, { x: t.x, y: t.y, rot: 0, s: t.s }, 0.34, E.outQuad, k * 0.07));
      sfx('deal', k * 0.07);
      k++;
    }
    await Promise.all(ps);
    if (s.seat >= 0) await Promise.all(sc.hole[s.seat].map((o, j) => sc.flip(o, j * 0.08)));
  }

  /** 5-card draw: discards fly to the muck, kept cards close ranks, replacements deal in (and flip for you). */
  private async drawCards(s: RoomView, e: ActEv) {
    const sc = this.sc, n = e.amount, seat = e.seat, mine = seat === s.seat;
    const objs = sc.hole[seat], total = objs.length;
    if (!n || !total) return;
    const idx = mine && sc.selected.size === n ? [...sc.selected] : Array.from({ length: n }, (_, k) => total - n + k);
    const kept = objs.filter((_, j) => !idx.includes(j));
    for (const o of objs.filter((_, j) => idx.includes(j))) {
      sc.loose.push(o);
      void sc.tw.to(o, { x: DECK.x, y: DECK.y, rot: 3, a: 0, s: 0.6, lift: 0 }, 0.35, E.inQuad)
        .then(() => { sc.loose = sc.loose.filter((x) => x !== o); });
    }
    sc.selected.clear();
    sc.hole[seat] = kept;
    await this.wait(0.25);
    const final = s.hand?.seats[seat]?.hole ?? [];
    const ps: Promise<void>[] = kept.map((o, j) => {
      const t = sc.holePos(seat, j, total, false);
      return sc.tw.to(o, { x: t.x, y: t.y, lift: 0 }, 0.25);
    });
    for (let k = 0; k < n; k++) {
      const j = kept.length + k, t = sc.holePos(seat, j, total, false);
      const o = newCard(mine ? final[j] ?? -1 : -1, DECK);
      o.rot = -Math.PI;
      sc.hole[seat][j] = o;
      sfx('deal', k * 0.08);
      ps.push(sc.tw.to(o, { x: t.x, y: t.y, rot: 0, s: t.s }, 0.3, E.outQuad, k * 0.08).then(() => (mine ? sc.flip(o) : undefined)));
    }
    await Promise.all(ps);
  }

  private async act(s: RoomView, e: ActEv) {
    const sc = this.sc, f = sc.fx[e.seat];
    const label = e.type === 'fold' ? 'FOLD' : e.type === 'check' ? 'CHECK' : e.type === 'call' ? `CALL ${fmt(e.amount)}`
      : e.type === 'raise' ? `RAISE ${fmt(e.to)}` : e.amount ? `DRAW ${e.amount}` : 'STAND PAT';
    sc.bubble(e.seat, e.allIn ? 'ALL IN!' : label, e.allIn || e.type === 'raise' ? 8 : e.type === 'fold' ? 5 : 1);
    sfx(e.allIn ? 'allin' : e.type === 'fold' ? 'fold' : e.type === 'check' ? 'check' : 'click');
    if (e.type === 'draw') { await this.drawCards(s, e); await this.wait(0.15); }
    else if (e.amount > 0) await this.chips(e.seat, e.amount, false);
    else await this.wait(0.25);
    if (e.type === 'fold') { f.folded = true; this.flick(e.seat); }
    if (e.allIn) { f.flame = true; sc.shake = Math.max(sc.shake, 2); }
  }

  /** Folded cards flick toward the middle, spin and fade. */
  flick(seat: number) {
    const sc = this.sc, cards = sc.hole[seat], d = sc.dir(seat);
    sc.hole[seat] = [];
    for (const o of cards) {
      sc.loose.push(o);
      o.face = false;
      void sc.tw.to(o, { x: o.x + d.x * 26, y: o.y + d.y * 26 - 8, rot: o.rot + 2.5 * (Math.random() < 0.5 ? -1 : 1), a: 0, s: 0.6 }, 0.45, E.outQuad)
        .then(() => { sc.loose = sc.loose.filter((x) => x !== o); });
    }
  }

  /** Bets slide into the pot. */
  async gather() {
    const sc = this.sc, ps: Promise<void>[] = [];
    sc.fx.forEach((f, i) => {
      const amt = Math.round(f.bet.t);
      if (amt <= 0) return;
      const b = sc.betPos(i);
      f.bet.set(0, true);
      const fl = { fx: b.x, fy: b.y, tx: POT.x, ty: POT.y, k: 0, amt, trail: false };
      sc.flyers.push(fl);
      ps.push(sc.tw.to(fl, { k: 1 }, 0.3, E.inOutQuad).then(() => { sc.flyers = sc.flyers.filter((x) => x !== fl); sc.pot.t += amt; }));
    });
    if (ps.length) { sfx('chip'); await Promise.all(ps); }
  }

  private async street(s: RoomView, e: StreetEv) {
    const sc = this.sc;
    await this.gather();
    if (s.hand && VARIANTS[s.hand.rules.variant].streets[e.street]?.kind === 'draw') {
      this.banner(s.seat >= 0 && s.hand.seats[s.seat] && !s.hand.seats[s.seat]!.folded ? 'DRAW! TAP TO DISCARD' : 'DRAW!', 12);
      await this.wait(0.6);
      return;
    }
    const runs = e.boards.length;
    while (sc.boards.length < runs) {
      sc.boards.push(sc.boards[0].map((o) => ({ ...o })));
    }
    const moves: Promise<void>[] = [];
    sc.boards.forEach((b, r) => b.forEach((o, i) => { const t = sc.boardPos(r, i, runs); moves.push(sc.tw.to(o, { x: t.x, y: t.y }, 0.25, E.inOutQuad)); }));
    await Promise.all(moves);
    const ps: Promise<void>[] = [];
    let k = 0;
    e.boards.forEach((cards, r) => {
      for (let i = sc.boards[r].length; i < cards.length; i++) {
        const o = newCard(cards[i], DECK, 1);
        o.rot = -Math.PI;
        sc.boards[r][i] = o;
        const t = sc.boardPos(r, i, runs);
        sfx('deal', k * 0.12);
        ps.push(sc.tw.to(o, { x: t.x, y: t.y, rot: 0 }, 0.3, E.outQuad, k++ * 0.12).then(() => sc.flip(o)));
      }
    });
    await Promise.all(ps);
    await this.wait(0.2);
  }

  private async showdown(s: RoomView, e: ShowEv) {
    const sc = this.sc, h = s.hand!;
    await this.gather();
    const ps: Promise<void>[] = [];
    h.seats.forEach((p, i) => {
      if (!p || !p.shown || i === s.seat) return;
      p.hole.forEach((c, j) => {
        const t = sc.holePos(i, j, p.hole.length, true);
        const o = sc.hole[i][j] ?? (sc.hole[i][j] = newCard(c, t));
        o.c = c;
        ps.push(sc.tw.to(o, { x: t.x, y: t.y, s: 1 }, 0.25, E.outBack, j * 0.05).then(() => sc.flip(o)));
      });
    });
    await Promise.all(ps);
    const contested = e.awards.some((a) => a.hand);
    const total = e.awards.reduce((a, b) => a + b.amount, 0);
    const big = total >= 40 * s.level.bb || h.seats.some((p) => p?.allIn);
    if (contested) { await this.wait(0.3); await sc.tw.to(sc.dim, { v: 1 }, 0.35); }
    for (const a of e.awards) {
      if (a.hand && a.cards) { sc.setGlow(a.seat, a.run, a.cards); sc.bubble(a.seat, a.hand.toUpperCase(), 3); }
      await this.sweep(a.seat, a.amount);
      if (contested || a === e.awards[0]) { const p = sc.seatPos(a.seat); sc.px.confetti(p.x, p.y - 6, big ? 60 : 30); }
      if (big) sc.shake = 5;
      await this.wait(a.hand ? 0.9 : 0.4);
      sc.clearGlow();
    }
    await this.wait(0.4);
    await sc.tw.to(sc.dim, { v: 0 }, 0.4);
  }

  /** Pot sweeps to the winner with a sparkle trail; stack counts up. */
  async sweep(seat: number, amt: number) {
    const sc = this.sc, to: P = sc.seatPos(seat);
    sc.pot.t = Math.max(0, sc.pot.t - amt);
    const fl = { fx: POT.x, fy: POT.y, tx: to.x, ty: to.y, k: 0, amt, trail: true };
    sc.flyers.push(fl);
    sfx('win');
    await sc.tw.to(fl, { k: 1 }, 0.55, E.inOutQuad);
    sc.flyers = sc.flyers.filter((x) => x !== fl);
    sc.fx[seat].stack.t += amt;
    sc.px.sparkle(to.x, to.y, 12);
  }
}
