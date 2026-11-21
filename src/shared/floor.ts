// Floor Deal: pure, server-authoritative rules engine (house game).
// Stakes go around once (must beat the high stake, go all in, or skip - max 2 skips in a row).
// Biggest stake is the boss and offers a split of their stake (house money). Players accept or counter;
// the boss agrees or duels each counter (biggest stake first). 4-card hands, no straights/flushes.
import { type Card, HIDDEN, rankOf, shuffle, rng } from './cards.js';
import type { Rules } from './rules.js';

export const CHIP = 10;
export type FStatus = 'wait' | 'staked' | 'allin' | 'skip' | 'beaten';
export type FPhase = 'stake' | 'offer' | 'respond' | 'decide' | 'done';
export interface FP {
  id: string; name: string; stack: number; hole: Card[]; stake: number; status: FStatus;
  skips: number; resp: 'accept' | 'counter' | 'locked' | null; want: number; shown: boolean;
}
export interface FSeatIn { id: string; name: string; stack: number; skips: number }
export interface Split { seat: number; amount: number }
export type FAction =
  | { type: 'stake'; amount: number } | { type: 'allin' } | { type: 'skip' }
  | { type: 'offer'; share: number }
  | { type: 'accept' } | { type: 'counter'; amount: number }
  | { type: 'agree' } | { type: 'duel' };
export type FEv =
  | { t: 'fdeal' }
  | { t: 'fstake'; seat: number; amount: number; allIn: boolean }
  | { t: 'fskip'; seat: number }
  | { t: 'fboss'; seat: number; tie: number[] }
  | { t: 'foffer'; seat: number; split: Split[] }
  | { t: 'freply'; seat: number; accept: boolean; amount: number }
  | { t: 'fagree'; seat: number; split: Split[] }
  | { t: 'fduel'; boss: number; vs: number; winner: number; bossHand: string; vsHand: string }
  | { t: 'fpay'; pay: Split[]; reason: 'deal' | 'counter' | 'bosslost' | 'solo' | 'void' };
export interface Floor {
  rules: Rules; seats: (FP | null)[]; starter: number; toAct: number; phase: FPhase; high: number;
  boss: number; offer: Split[] | null; queue: number[]; deck: Card[]; winnings: number; done: boolean; events: FEv[];
}
export interface FLegal { phase: FPhase; min: number; max: number; canSkip: boolean; canStake: boolean; vs: number; want: number }

export const FLOOR_HANDS = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Four of a Kind'];
const SHAPE: Record<string, number> = { '4': 4, '31': 3, '22': 2, '211': 1 };
const down = (n: number) => Math.floor(n / CHIP) * CHIP;
const onFloor = (p: FP | null): p is FP => !!p && (p.status === 'staked' || p.status === 'allin');

/** A K Q J for up to 4 players; each extra player adds the next rank down. */
export const floorRanks = (players: number) => Math.max(4, players);
export function floorDeck(players: number): Card[] {
  const d: Card[] = [];
  for (let r = 14; r > 14 - floorRanks(players); r--) for (let s = 0; s < 4; s++) d.push(r * 4 + s);
  return d;
}

export function floorScore(cards: Card[]): { score: number; name: string } {
  const cnt = new Map<number, number>();
  for (const c of cards) cnt.set(rankOf(c), (cnt.get(rankOf(c)) ?? 0) + 1);
  const g = [...cnt].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const cat = SHAPE[g.map((x) => x[1]).join('')] ?? 0;
  const tb = g.flatMap(([r, n]) => Array(n).fill(r) as number[]);
  let score = cat;
  for (let i = 0; i < 4; i++) score = score * 16 + (tb[i] ?? 0);
  return { score, name: FLOOR_HANDS[cat] };
}

function nextSeat(f: Floor, from: number, pred: (p: FP, i: number) => boolean): number {
  const n = f.seats.length;
  for (let k = 1; k <= n; k++) { const i = (from + k) % n, p = f.seats[i]; if (p && pred(p, i)) return i; }
  return -1;
}
const rel = (f: Floor, s: number) => (s - f.starter + f.seats.length) % f.seats.length;

export function startFloor(rules: Rules, seatsIn: (FSeatIn | null)[], starter: number, opts: { seed?: number; deck?: Card[] } = {}): Floor {
  const seats: (FP | null)[] = seatsIn.map((s) => s && s.stack > 0
    ? { id: s.id, name: s.name, stack: s.stack, hole: [], stake: 0, status: 'wait', skips: s.skips, resp: null, want: 0, shown: false }
    : null);
  const n = seats.filter(Boolean).length;
  if (n < 2) throw new Error('need 2 players');
  const f: Floor = {
    rules, seats, starter, toAct: -1, phase: 'stake', high: 0, boss: -1, offer: null, queue: [],
    deck: opts.deck ? [...opts.deck] : shuffle(floorDeck(n), rng(opts.seed ?? Date.now())), winnings: 0, done: false, events: [],
  };
  if (!seats[starter]) f.starter = nextSeat(f, starter, () => true);
  for (let k = 0, s = f.starter; k < n; k++, s = nextSeat(f, s, () => true)) seats[s]!.hole = f.deck.splice(0, 4);
  f.toAct = f.starter;
  f.events.push({ t: 'fdeal' });
  return f;
}

export function floorLegal(f: Floor, seat: number): FLegal | null {
  const p = f.seats[seat];
  if (!p || f.done || f.toAct !== seat) return null;
  const boss = f.seats[f.boss];
  const vs = f.queue[0] ?? -1;
  const min = f.high + CHIP;
  return {
    phase: f.phase, min, canSkip: p.skips < 2, canStake: p.stack >= min,
    max: f.phase === 'stake' ? p.stack : boss ? budget(f) : 0, vs, want: vs >= 0 ? f.seats[vs]!.want : 0,
  };
}

function finish(f: Floor, pay: Split[], reason: Extract<FEv, { t: 'fpay' }>['reason']) {
  for (const x of pay) f.seats[x.seat]!.stack += x.amount;
  f.done = true;
  f.phase = 'done';
  f.toAct = -1;
  f.events.push({ t: 'fpay', pay, reason });
}

/** Split `total` equally among `among` (in 10s); leftovers go to the boss. */
function split(f: Floor, total: number, among: number[], fixed: Split[]): Split[] {
  const each = among.length ? down(total / among.length) : 0;
  const out = [...fixed, ...among.map((seat) => ({ seat, amount: each }))];
  const left = total - each * among.length;
  const b = out.find((x) => x.seat === f.boss);
  if (b) b.amount += left; else out.push({ seat: f.boss, amount: left });
  return out;
}

function others(f: Floor, ...not: number[]): number[] {
  return f.seats.map((p, i) => (onFloor(p) && !not.includes(i) ? i : -1)).filter((i) => i >= 0).sort((a, b) => rel(f, a) - rel(f, b));
}
/** Players still negotiating with the boss (not the boss, not locked into an agreed counter). */
const open = (f: Floor) => others(f, f.boss).filter((i) => f.seats[i]!.resp !== 'locked');
const lockedSplits = (f: Floor): Split[] => others(f, f.boss).filter((i) => f.seats[i]!.resp === 'locked').map((i) => ({ seat: i, amount: f.seats[i]!.want }));
/** House money still to split: the boss's stake minus what agreed counters already locked in. */
function budget(f: Floor) { return (f.seats[f.boss]?.stake ?? 0) - lockedSplits(f).reduce((a, x) => a + x.amount, 0); }

/** Pay everyone on the floor their stake back plus their share (boss also collects duel winnings). */
function payDeal(f: Floor, shares: Split[], reason: 'deal' | 'counter') {
  const pay = f.seats.map((p, i) => (onFloor(p) ? { seat: i, amount: p.stake + (shares.find((x) => x.seat === i)?.amount ?? 0) } : null))
    .filter((x): x is Split => !!x);
  pay.find((x) => x.seat === f.boss)!.amount += f.winnings;
  finish(f, pay, reason);
}

function resolveBoss(f: Floor) {
  const fl = others(f);
  if (!fl.length) return finish(f, [], 'void');
  if (fl.length === 1) return finish(f, [{ seat: fl[0], amount: f.seats[fl[0]]!.stake }], 'solo');
  const top = Math.max(...fl.map((i) => f.seats[i]!.stake));
  const tied = fl.filter((i) => f.seats[i]!.stake === top);
  let boss = tied[0];
  for (const t of tied.slice(1)) if (floorScore(f.seats[t]!.hole).score > floorScore(f.seats[boss]!.hole).score) boss = t;
  if (tied.length > 1) for (const t of tied) f.seats[t]!.shown = true;
  f.boss = boss;
  f.events.push({ t: 'fboss', seat: boss, tie: tied.length > 1 ? tied : [] });
  toOffer(f);
}

function toOffer(f: Floor) {
  f.queue = [];
  const locked = lockedSplits(f);
  if (!open(f).length) {
    if (locked.length) return payDeal(f, split(f, budget(f), [], locked), 'counter');
    return finish(f, [{ seat: f.boss, amount: f.seats[f.boss]!.stake + f.winnings }], 'solo');
  }
  f.phase = 'offer';
  f.offer = null;
  f.toAct = f.boss;
}

export function applyFloor(f0: Floor, seat: number, a: FAction): Floor {
  const L = floorLegal(f0, seat);
  if (!L) throw new Error('not your turn');
  const f = structuredClone(f0);
  const p = f.seats[seat]!;
  const boss = f.seats[f.boss];
  const amt = (v: unknown, max: number) => {
    const n = down(Number(v));
    if (!(n >= 0 && n <= max)) throw new Error('bad amount');
    return n;
  };
  switch (f.phase) {
    case 'stake': {
      if (a.type === 'skip') {
        if (!L.canSkip) throw new Error('you must play this round');
        p.status = 'skip';
        p.skips++;
        f.events.push({ t: 'fskip', seat });
      } else if (a.type === 'allin' || a.type === 'stake') {
        const v = a.type === 'allin' ? p.stack : amt(a.amount, p.stack);
        if (a.type === 'stake' && v < L.min && v !== p.stack) throw new Error(`stake at least ${L.min}`);
        p.stake = v;
        p.stack -= v;
        p.status = p.stack === 0 ? 'allin' : 'staked';
        p.skips = 0;
        f.high = Math.max(f.high, v);
        f.events.push({ t: 'fstake', seat, amount: v, allIn: p.stack === 0 });
      } else throw new Error('stake, all in or skip');
      const nx = nextSeat(f, seat, (q) => q.status === 'wait');
      if (nx >= 0) f.toAct = nx; else resolveBoss(f);
      return f;
    }
    case 'offer': {
      if (a.type !== 'offer') throw new Error('make an offer');
      const left = budget(f), share = amt(a.share, left);
      f.offer = [...lockedSplits(f), ...split(f, left - share, open(f), [{ seat, amount: share }])];
      f.events.push({ t: 'foffer', seat, split: f.offer });
      for (const i of open(f)) { f.seats[i]!.resp = null; f.seats[i]!.want = 0; }
      f.phase = 'respond';
      f.toAct = nextSeat(f, f.boss, (q, i) => onFloor(q) && i !== f.boss && q.resp === null);
      return f;
    }
    case 'respond': {
      if (a.type === 'accept') p.resp = 'accept';
      else if (a.type === 'counter') { p.resp = 'counter'; p.want = amt(a.amount, budget(f)); }
      else throw new Error('accept or counter');
      f.events.push({ t: 'freply', seat, accept: p.resp === 'accept', amount: p.want });
      const nx = nextSeat(f, seat, (q, i) => onFloor(q) && i !== f.boss && q.resp === null);
      if (nx >= 0) { f.toAct = nx; return f; }
      f.queue = open(f).filter((i) => f.seats[i]!.resp === 'counter')
        .sort((x, y) => f.seats[y]!.stake - f.seats[x]!.stake || rel(f, x) - rel(f, y));
      if (!f.queue.length) { payDeal(f, f.offer!, lockedSplits(f).length ? 'counter' : 'deal'); return f; }
      f.phase = 'decide';
      f.toAct = f.boss;
      return f;
    }
    case 'decide': {
      const c = f.queue[0], ch = f.seats[c]!;
      if (a.type === 'agree') {
        // The challenger is locked in at their price; the boss re-splits what is left and everyone else responds again.
        ch.resp = 'locked';
        f.events.push({ t: 'fagree', seat: c, split: lockedSplits(f) });
        toOffer(f);
        return f;
      }
      if (a.type !== 'duel') throw new Error('agree or duel');
      f.queue.shift();
      const hb = floorScore(boss!.hole), hc = floorScore(ch.hole);
      const bossWins = hb.score >= hc.score;
      boss!.shown = ch.shown = true;
      f.events.push({ t: 'fduel', boss: f.boss, vs: c, winner: bossWins ? f.boss : c, bossHand: hb.name, vsHand: hc.name });
      if (!bossWins) {
        const pay = others(f).map((i) => ({ seat: i, amount: i === c ? ch.stake + boss!.stake : i === f.boss ? f.winnings : f.seats[i]!.stake }));
        finish(f, pay, 'bosslost');
        return f;
      }
      ch.status = 'beaten';
      f.winnings += ch.stake;
      if (f.queue.length) return f;
      toOffer(f);
      return f;
    }
    default: throw new Error('round over');
  }
}

/** Timer default: skip if allowed (else the minimum / all in), equal split offer, accept, agree. */
export function autoFloor(f: Floor, seat: number): FAction {
  const L = floorLegal(f, seat)!;
  switch (L.phase) {
    case 'stake': return L.canSkip ? { type: 'skip' } : L.canStake ? { type: 'stake', amount: L.min } : { type: 'allin' };
    case 'offer': return { type: 'offer', share: down(L.max / (open(f).length + 1)) };
    case 'respond': return { type: 'accept' };
    default: return { type: 'agree' };
  }
}

export function floorView(f: Floor, seat: number): Omit<Floor, 'deck' | 'events'> {
  const { deck: _d, events: _e, ...rest } = f;
  const v = structuredClone(rest);
  v.seats.forEach((p, i) => { if (p && i !== seat && !p.shown) p.hole = p.hole.map(() => HIDDEN); });
  return v;
}
