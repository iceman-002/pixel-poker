// Builds the per-member RoomView: hides other players' cards unless the member is spectating.
import { viewFor, legal } from '../shared/engine.js';
import { floorView, floorLegal } from '../shared/floor.js';
import { levelAt } from '../shared/rules.js';
import type { RoomView } from '../shared/protocol.js';
import type { Room, Member } from './room.js';

export function roomView(r: Room, m: Member): RoomView {
  const h = r.hand, f = r.floor, g = r.game();
  const spec = r.phase === 'playing' && (m.seat < 0 || (m.stack === 0 && !(g && g.seats[m.seat]?.id === m.id)));
  return {
    code: r.code,
    host: r.host,
    phase: r.phase,
    rules: r.rules,
    seats: r.seats.map((id, i) => {
      const s = id ? r.members.get(id) : undefined;
      if (!s) return null;
      const gp = g && !g.done ? g.seats[i] : null;
      return {
        id: s.id, name: s.name, avatar: s.avatar, back: s.back, stack: gp && gp.id === s.id ? gp.stack : s.stack,
        connected: !!s.ws || s.bot, ready: s.ready, rebuys: s.rebuys, bot: s.bot,
      };
    }),
    members: [...r.members.values()].map((x) => ({ id: x.id, name: x.name, avatar: x.avatar, connected: !!x.ws || x.bot, seat: x.seat })),
    you: m.id,
    seat: m.seat,
    hand: h ? viewFor(h, m.seat, spec) : null,
    floor: f ? floorView(f, m.seat, spec) : null,
    flegal: f && m.seat >= 0 && f.seats[m.seat]?.id === m.id ? floorLegal(f, m.seat) : null,
    winner: r.winner,
    handNo: r.handNo,
    legal: h && m.seat >= 0 && h.seats[m.seat]?.id === m.id ? legal(h, m.seat) : null,
    level: levelAt(r.rules, r.levelIdx()),
    levelIdx: r.levelIdx(),
    nextLevel: r.nextLevel(),
    timeLeft: r.deadline ? Math.max(0, r.deadline - Date.now()) : 0,
    timerMs: r.timerMs,
    canRebuy: r.rules.rebuys && m.seat >= 0 && m.stack === 0 && m.rebuys < r.rules.maxRebuys && !r.inLiveHand(m),
    spectating: spec,
    log: r.log,
  };
}
