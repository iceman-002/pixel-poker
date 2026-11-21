// Simple Floor Deal bot policy shared by the bot scripts.
import { floorScore, CHIP, type FAction } from '../shared/floor.js';
import type { RoomView } from '../shared/protocol.js';

const r10 = (n: number) => Math.floor(n / CHIP) * CHIP;

export function floorKey(s: RoomView): string {
  const f = s.floor!;
  return `${s.handNo}|${f.phase}|${f.toAct}|${f.high}|${f.queue.length}|${JSON.stringify(f.offer)}|${f.seats.map((p) => p?.resp ?? "").join()}`;
}

export function floorMove(s: RoomView): FAction | null {
  const f = s.floor, L = s.flegal;
  if (!f || !L || f.done || f.toAct !== s.seat) return null;
  const me = f.seats[s.seat]!;
  const cat = Math.floor(floorScore(me.hole).score / 16 ** 4);
  const r = Math.random();
  switch (L.phase) {
    case 'stake':
      if (L.canSkip && cat === 0 && r < 0.6) return { type: 'skip' };
      if (!L.canStake) return { type: 'allin' };
      return { type: 'stake', amount: Math.min(L.max, L.min + r10(Math.random() * me.stack * 0.15)) };
    case 'offer': return { type: 'offer', share: r10(L.max * (0.2 + r * 0.4)) };
    case 'respond': return cat >= 2 && r < 0.6 ? { type: 'counter', amount: r10(L.max * 0.6) } : { type: 'accept' };
    case 'decide': return cat >= 2 || r < 0.4 ? { type: 'duel' } : { type: 'agree' };
    default: return null;
  }
}
