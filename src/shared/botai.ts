// Simple bot policies shared by server-side bots and the test scripts.
import { floorScore, floorLegal, CHIP, type Floor, type FAction } from './floor.js';
import { legal, type Hand, type Action } from './engine.js';

const r10 = (n: number) => Math.floor(n / CHIP) * CHIP;

/** Floor Deal: skip weak hands sometimes, stake a bit over the high, counter and duel with strong hands. */
export function botFloor(f: Floor, seat: number): FAction | null {
  const L = floorLegal(f, seat), me = f.seats[seat];
  if (!L || !me) return null;
  const cat = Math.floor(floorScore(me.hole).score / 16 ** 4);
  const r = Math.random();
  switch (L.phase) {
    case 'stake':
      if (L.canSkip && cat === 0 && r < 0.6) return { type: 'skip' };
      if (!L.canStake) return { type: 'allin' };
      return { type: 'stake', amount: Math.min(me.stack, L.min + r10(Math.random() * me.stack * (0.05 + cat * 0.05))) };
    case 'offer': return { type: 'offer', share: r10(L.max * (0.2 + r * 0.4)) };
    case 'respond': return cat >= 2 && r < 0.6 ? { type: 'counter', amount: r10(L.max * (0.4 + r * 0.3)) } : { type: 'accept' };
    case 'decide': return cat >= 2 || r < 0.4 ? { type: 'duel' } : { type: 'agree' };
    default: return null;
  }
}

/** Poker: mostly check/call, occasional raise or fold, random draws. */
export function botPoker(h: Hand, seat: number): Action | null {
  const L = legal(h, seat);
  if (!L) return null;
  const r = Math.random();
  if (L.draw) return { type: 'draw', discard: [0, 1, 2, 3, 4].filter(() => Math.random() < 0.3) };
  if (L.raise && r < 0.18) return { type: 'raise', to: r < 0.03 ? L.raise.max : L.raise.min };
  if (L.check) return { type: 'check' };
  if (r < 0.15) return { type: 'fold' };
  return { type: 'call' };
}
