// Pure, data-driven hand engine. Every exported mutator returns a new Hand.
import { type Card, HIDDEN, makeDeck, rng, shuffle } from './cards.js';
import { type Rules, type Level, VARIANTS, BOMB_BB } from './rules.js';
import { settle, type Award } from './showdown.js';

export interface P {
  id: string; name: string; stack: number; hole: Card[];
  bet: number; total: number; folded: boolean; allIn: boolean; acted: boolean; shown: boolean;
}
export interface SeatIn { id: string; name: string; stack: number }
export type Action =
  | { type: 'fold' } | { type: 'check' } | { type: 'call' }
  | { type: 'raise'; to: number } | { type: 'draw'; discard: number[] };
export type Ev =
  | { t: 'post'; seat: number; amount: number; kind: 'ante' | 'bomb' | 'sb' | 'bb' | 'straddle' }
  | { t: 'deal' }
  | { t: 'act'; seat: number; type: Action['type']; amount: number; to: number; allIn: boolean }
  | { t: 'street'; street: number; boards: Card[][] }
  | { t: 'twice' }
  | { t: 'showdown'; awards: Award[] };
export interface Hand {
  rules: Rules; level: Level; seats: (P | null)[]; dealer: number; deck: Card[]; muck: Card[];
  boards: Card[][]; street: number; toAct: number; currentBet: number; minRaise: number; raises: number;
  bomb: boolean; done: boolean; awards: Award[]; events: Ev[];
}
export interface Legal {
  fold: boolean; check: boolean; call: number; toCall: number;
  raise: { min: number; max: number } | null; draw: boolean;
}

const vdef = (h: Hand) => VARIANTS[h.rules.variant];
const live = (p: P) => !p.folded;
const canBet = (p: P) => !p.folded && !p.allIn;
const any = () => true;
export const potTotal = (h: Hand) => h.seats.reduce((a, p) => a + (p?.total ?? 0), 0);
const flStep = (h: Hand) => (vdef(h).streets[h.street].big ? h.level.bb * 2 : h.level.bb);

export function nextSeat(h: Hand, from: number, pred: (p: P) => boolean): number {
  const n = h.seats.length;
  for (let i = 1; i <= n; i++) {
    const s = (from + i) % n;
    const p = h.seats[s];
    if (p && pred(p)) return s;
  }
  return -1;
}

function put(h: Hand, s: number, amt: number, bet = true): number {
  const p = h.seats[s]!;
  const a = Math.max(0, Math.min(amt, p.stack));
  p.stack -= a;
  p.total += a;
  if (bet) p.bet += a;
  if (!p.stack) p.allIn = true;
  return a;
}

function take(h: Hand, k: number): Card[] {
  if (h.deck.length < k) { h.deck.push(...h.muck); h.muck = []; }
  return h.deck.splice(0, k);
}

export function startHand(
  rules: Rules, seatsIn: (SeatIn | null)[], dealer: number, level: Level,
  opts: { seed?: number; deck?: Card[]; bomb?: boolean } = {},
): Hand {
  const v = VARIANTS[rules.variant];
  const seats: (P | null)[] = seatsIn.map((s) => s && s.stack > 0
    ? { id: s.id, name: s.name, stack: s.stack, hole: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, shown: false }
    : null);
  const count = seats.filter(Boolean).length;
  if (count < 2) throw new Error('need 2 players');
  const deck = opts.deck ? [...opts.deck] : shuffle(makeDeck(v.minRank, rules.wild === 'jokers'), rng(opts.seed ?? Date.now()));
  const h: Hand = {
    rules, level, seats, dealer, deck, muck: [], boards: [[]], street: 0, toAct: -1,
    currentBet: 0, minRaise: level.bb, raises: 0, bomb: !!opts.bomb, done: false, awards: [], events: [],
  };
  if (!seats[dealer]) h.dealer = nextSeat(h, dealer, any);
  const n = seats.length;
  const order = seats.map((_, i) => i).filter((i) => seats[i]).sort((a, b) => (a - h.dealer - 1 + n) % n - (b - h.dealer - 1 + n) % n);
  const ante = h.bomb ? BOMB_BB * level.bb : level.ante;
  if (ante) for (const s of order) h.events.push({ t: 'post', seat: s, amount: put(h, s, ante, false), kind: h.bomb ? 'bomb' : 'ante' });
  for (const s of order) h.seats[s]!.hole = take(h, v.hole);
  h.events.push({ t: 'deal' });
  if (h.bomb) { advance(h); return h; }

  const sb = count === 2 ? h.dealer : nextSeat(h, h.dealer, any);
  const bb = nextSeat(h, sb, any);
  h.events.push({ t: 'post', seat: sb, amount: put(h, sb, level.sb), kind: 'sb' });
  h.events.push({ t: 'post', seat: bb, amount: put(h, bb, level.bb), kind: 'bb' });
  h.currentBet = level.bb;
  h.raises = 1;
  let last = bb;
  if (rules.straddle && count >= 3) {
    const st = nextSeat(h, bb, any);
    h.events.push({ t: 'post', seat: st, amount: put(h, st, level.bb * 2), kind: 'straddle' });
    h.currentBet = h.minRaise = level.bb * 2;
    h.raises = 2;
    last = st;
  }
  proceed(h, last);
  return h;
}

function nextActor(h: Hand, from: number): number {
  const b = h.seats.filter((p): p is P => !!p && canBet(p));
  if (!b.length || (b.length === 1 && b[0].bet >= h.currentBet)) return -1;
  return nextSeat(h, from, (p) => canBet(p) && (!p.acted || p.bet < h.currentBet));
}

function proceed(h: Hand, from: number) {
  if (h.seats.filter((p) => p && live(p)).length === 1) return showdown(h);
  const s = nextActor(h, from);
  if (s >= 0) h.toAct = s;
  else advance(h);
}

function advance(h: Hand): void {
  for (const p of h.seats) if (p) { p.bet = 0; p.acted = false; }
  h.currentBet = 0;
  h.minRaise = h.level.bb;
  h.raises = 0;
  h.toAct = -1;
  const v = vdef(h);
  if (++h.street >= v.streets.length) return showdown(h);
  const st = v.streets[h.street];
  if (st.kind === 'draw') {
    h.events.push({ t: 'street', street: h.street, boards: h.boards.map((b) => [...b]) });
    h.toAct = nextSeat(h, h.dealer, live);
    return;
  }
  if (st.deal) {
    if (h.rules.runItTwice && h.boards.length === 1 && nextActor(h, h.dealer) < 0) {
      h.boards.push([...h.boards[0]]);
      h.events.push({ t: 'twice' });
    }
    for (const b of h.boards) b.push(...take(h, st.deal));
    h.events.push({ t: 'street', street: h.street, boards: h.boards.map((b) => [...b]) });
  }
  const s = nextActor(h, h.dealer);
  if (s < 0) return advance(h);
  h.toAct = s;
}

function showdown(h: Hand) {
  const liveP = h.seats.filter((p): p is P => !!p && live(p));
  if (liveP.length > 1) for (const p of liveP) p.shown = true;
  h.awards = settle(h);
  for (const a of h.awards) h.seats[a.seat]!.stack += a.amount;
  h.done = true;
  h.toAct = -1;
  h.events.push({ t: 'showdown', awards: h.awards });
}

export function legal(h: Hand, seat: number): Legal | null {
  const p = h.seats[seat];
  if (!p || h.done || h.toAct !== seat) return null;
  if (vdef(h).streets[h.street].kind === 'draw') return { fold: false, check: false, call: 0, toCall: 0, raise: null, draw: true };
  const toCall = Math.max(0, h.currentBet - p.bet);
  const maxTo = p.bet + p.stack;
  const others = h.seats.some((q, i) => q && i !== seat && canBet(q));
  const fl = h.rules.betting === 'fl';
  let raise: Legal['raise'] = null;
  if (!p.acted && others && maxTo > h.currentBet && !(fl && h.raises >= 4)) {
    const min = h.currentBet + (fl ? flStep(h) : h.minRaise);
    const max = fl ? min : h.rules.betting === 'pl' ? h.currentBet + potTotal(h) + toCall : maxTo;
    raise = { min: Math.min(min, maxTo), max: Math.min(max, maxTo) };
  }
  return { fold: true, check: toCall === 0, call: Math.min(toCall, p.stack), toCall, raise, draw: false };
}

export function applyAction(h0: Hand, seat: number, a: Action): Hand {
  const L = legal(h0, seat);
  if (!L) throw new Error('not your turn');
  const h = structuredClone(h0);
  const p = h.seats[seat]!;
  const ev = (amount: number) => h.events.push({ t: 'act', seat, type: a.type, amount, to: p.bet, allIn: p.allIn });

  if (L.draw) {
    if (a.type !== 'draw' || !Array.isArray(a.discard)) throw new Error('must draw');
    const idx = [...new Set(a.discard)].filter((i) => Number.isInteger(i) && i >= 0 && i < p.hole.length);
    const out = idx.map((i) => p.hole[i]);
    p.hole = [...p.hole.filter((_, i) => !idx.includes(i)), ...take(h, idx.length)];
    h.muck.push(...out);
    p.acted = true;
    ev(idx.length);
    const nx = nextSeat(h, seat, (q) => live(q) && !q.acted);
    if (nx >= 0) h.toAct = nx;
    else advance(h);
    return h;
  }

  let amount = 0;
  switch (a.type) {
    case 'fold': p.folded = true; break;
    case 'check': if (!L.check) throw new Error('cannot check'); break;
    case 'call': if (!L.call) throw new Error('nothing to call'); amount = put(h, seat, L.call); break;
    case 'raise': {
      const to = Math.floor(Number(a.to));
      if (!L.raise || !(to >= L.raise.min && to <= L.raise.max)) throw new Error('bad raise');
      const inc = to - h.currentBet;
      const fl = h.rules.betting === 'fl';
      const full = inc >= (fl ? flStep(h) : h.minRaise);
      amount = put(h, seat, to - p.bet);
      if (full) {
        if (!fl) h.minRaise = inc;
        for (const q of h.seats) if (q && q !== p) q.acted = false;
      }
      h.raises++;
      h.currentBet = to;
      break;
    }
    default: throw new Error('bad action');
  }
  p.acted = true;
  ev(amount);
  proceed(h, seat);
  return h;
}

/** Action used when the timer expires. */
export function autoAction(h: Hand, seat: number): Action {
  const L = legal(h, seat);
  if (L?.draw) return { type: 'draw', discard: [] };
  return L?.check ? { type: 'check' } : { type: 'fold' };
}

/** Per-player view: hides other hole cards (until shown) and the deck. */
/** Hide other players' unshown cards (unless `all`, used for spectators who are out of the game). */
export function viewFor(h: Hand, seat: number, all = false): Omit<Hand, 'deck' | 'muck' | 'events'> {
  const { deck: _d, muck: _m, events: _e, ...rest } = h;
  const v = structuredClone(rest);
  if (!all) v.seats.forEach((p, i) => { if (p && i !== seat && !p.shown) p.hole = p.hole.map(() => HIDDEN); });
  return v;
}
