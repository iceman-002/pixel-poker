import { bestHand, type EvalCfg, type HandValue } from './eval.js';
import type { Card } from './cards.js';
import type { Rules } from './rules.js';

export interface Award { seat: number; amount: number; pot: number; run: number; hand?: string; cards?: Card[] }
export interface Pot { amount: number; eligible: number[] }

interface SettleInput {
  rules: Rules;
  dealer: number;
  boards: Card[][];
  seats: ({ hole: Card[]; total: number; folded: boolean } | null)[];
}

export const evalCfg = (r: Rules): EvalCfg => ({ wild: r.wild, short: r.variant === 'short', omaha: r.variant === 'omaha' });

/** Split contributions into main + side pots. Folded chips are dead money; only live players are eligible. */
export function buildPots(totals: number[], folded: boolean[]): Pot[] {
  const rem = [...totals];
  const pots: Pot[] = [];
  for (;;) {
    const lv = rem.map((_, i) => i).filter((i) => !folded[i] && rem[i] > 0);
    if (!lv.length) break;
    const level = Math.min(...lv.map((i) => rem[i]));
    let amount = 0;
    for (let i = 0; i < rem.length; i++) {
      const t = Math.min(rem[i], level);
      amount += t;
      rem[i] -= t;
    }
    const last = pots[pots.length - 1];
    if (last && last.eligible.join() === lv.join()) last.amount += amount;
    else pots.push({ amount, eligible: lv });
  }
  const left = rem.reduce((a, b) => a + b, 0);
  if (left && pots.length) pots[pots.length - 1].amount += left;
  return pots;
}

/** Award every pot (per run when run-it-twice). Ties split evenly; odd chips go clockwise from the dealer. */
export function settle(h: SettleInput): Award[] {
  const n = h.seats.length;
  const pots = buildPots(h.seats.map((p) => p?.total ?? 0), h.seats.map((p) => !p || p.folded));
  const rel = (s: number) => (s - h.dealer - 1 + n) % n;
  const cfg = evalCfg(h.rules);
  const cache = new Map<string, HandValue>();
  const hv = (s: number, r: number) => {
    const k = s + ':' + r;
    if (!cache.has(k)) cache.set(k, bestHand(h.seats[s]!.hole, h.boards[r], cfg));
    return cache.get(k)!;
  };
  const out: Award[] = [];
  pots.forEach((pt, pi) => {
    const contested = pt.eligible.length > 1;
    const runs = contested ? h.boards.length : 1;
    for (let r = 0; r < runs; r++) {
      const amt = Math.floor(pt.amount / runs) + (r === 0 ? pt.amount % runs : 0);
      let win = pt.eligible;
      if (contested) {
        const best = Math.max(...win.map((s) => hv(s, r).score));
        win = win.filter((s) => hv(s, r).score === best);
      }
      win = [...win].sort((a, b) => rel(a) - rel(b));
      const share = Math.floor(amt / win.length);
      let odd = amt - share * win.length;
      for (const s of win) {
        const v = contested ? hv(s, r) : undefined;
        out.push({ seat: s, amount: share + (odd-- > 0 ? 1 : 0), pot: pi, run: r, hand: v?.name, cards: v?.cards });
      }
    }
  });
  return out;
}
