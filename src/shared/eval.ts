import { type Card, rankOf, suitOf, isJoker } from './cards.js';

export type Wild = 'none' | 'jokers' | 'deuces';
export interface EvalCfg { wild: Wild; short: boolean; omaha: boolean }
export interface HandValue { score: number; cat: number; name: string; cards: Card[] }

export const HAND_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Five of a Kind',
];
const SHAPES: Record<string, number> = { '5': 9, '41': 7, '32': 6, '311': 3, '221': 2, '2111': 1 };

export const isWild = (c: Card, w: Wild) =>
  w === 'jokers' ? isJoker(c) : w === 'deuces' ? rankOf(c) === 2 : false;

/** Score concrete ranks. Returns [score, category]. Short deck: flush beats full house, A-6-7-8-9 wheel. */
function score(ranks: number[], flush: boolean, short: boolean): [number, number] {
  const cnt = new Map<number, number>();
  for (const r of ranks) cnt.set(r, (cnt.get(r) ?? 0) + 1);
  const groups = [...cnt].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  let tb = groups.map((g) => g[0]);
  let cat = SHAPES[groups.map((g) => g[1]).join('')] ?? 0;
  if (ranks.length === 5 && groups.length === 5) {
    const low = short ? 6 : 2;
    const top = tb[0] - tb[4] === 4 ? tb[0] : tb[0] === 14 && tb[1] === low + 3 && tb[4] === low ? low + 3 : 0;
    if (top) { cat = flush ? 8 : 4; tb = [top]; }
  }
  if (flush && ranks.length === 5 && (cat < 5 || (short && cat === 6))) {
    cat = 5;
    tb = [...ranks].sort((a, b) => b - a);
  }
  let s = short && cat === 5 ? 6 : short && cat === 6 ? 5 : cat;
  for (let i = 0; i < 5; i++) s = s * 16 + (tb[i] ?? 0);
  return [s, cat];
}

/** Evaluate up to 5 cards, substituting wilds for their best ranks. */
export function evalCards(cards: Card[], cfg: EvalCfg): [number, number] {
  const nat = cards.filter((c) => !isWild(c, cfg.wild));
  const nr = nat.map(rankOf);
  const flush = cards.length === 5 && nat.every((c) => suitOf(c) === suitOf(nat[0]));
  const w = cards.length - nat.length;
  if (!w) return score(nr, flush, cfg.short);
  let best: [number, number] = [-1, 0];
  const acc: number[] = [];
  const sub = (k: number, from: number) => {
    if (!k) {
      const r = score([...nr, ...acc], flush, cfg.short);
      if (r[0] > best[0]) best = r;
      return;
    }
    for (let r = from; r <= 14; r++) { acc.push(r); sub(k - 1, r); acc.pop(); }
  };
  sub(w, cfg.short ? 6 : 2);
  return best;
}

export function combos<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const cur: T[] = [];
  const go = (i: number) => {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let j = i; j <= arr.length - (k - cur.length); j++) { cur.push(arr[j]); go(j + 1); cur.pop(); }
  };
  go(0);
  return out;
}

export function bestHand(hole: Card[], board: Card[], cfg: EvalCfg): HandValue {
  let sets: Card[][];
  if (cfg.omaha && board.length >= 3) {
    sets = [];
    for (const h of combos(hole, 2)) for (const b of combos(board, 3)) sets.push([...h, ...b]);
  } else {
    const all = [...hole, ...board];
    sets = combos(all, Math.min(5, all.length));
  }
  let best: HandValue = { score: -1, cat: 0, name: '', cards: [] };
  for (const s of sets) {
    const [sc, cat] = evalCards(s, cfg);
    if (sc > best.score) best = { score: sc, cat, name: HAND_NAMES[cat], cards: s };
  }
  return best;
}
