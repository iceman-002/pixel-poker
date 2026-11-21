// Card = rank*4 + suit (rank 2..14, suit 0..3 = s h d c). Jokers are 0 and 1. -1 = face down.
export type Card = number;
export const HIDDEN = -1;
export const rankOf = (c: Card) => c >> 2;
export const suitOf = (c: Card) => c & 3;
export const isJoker = (c: Card) => c >= 0 && c < 4;
export const mk = (rank: number, suit: number): Card => rank * 4 + suit;

const R = '??23456789TJQKA';
const S = 'shdc';

export function cardStr(c: Card): string {
  if (c < 0) return '??';
  if (isJoker(c)) return 'X' + (c + 1);
  return R[rankOf(c)] + S[suitOf(c)];
}

export function parseCard(s: string): Card {
  if (s[0] === 'X') return s[1] === '2' ? 1 : 0;
  const r = R.indexOf(s[0], 2);
  const su = S.indexOf(s[1]);
  if (r < 2 || su < 0) throw new Error('bad card ' + s);
  return mk(r, su);
}

export const parseCards = (s: string): Card[] => s.split(/\s+/).filter(Boolean).map(parseCard);

export function makeDeck(minRank: number, jokers: boolean): Card[] {
  const d: Card[] = [];
  for (let r = minRank; r <= 14; r++) for (let s = 0; s < 4; s++) d.push(mk(r, s));
  if (jokers) d.push(0, 1);
  return d;
}

/** mulberry32 PRNG */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
