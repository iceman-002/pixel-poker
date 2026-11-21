// Drop N slow-thinking bots into an existing room on a running server (for manual testing).
// Usage: node dist-server/scripts/botjoin.js ROOM [count=3] [url=ws://localhost:8080/ws]
import WebSocket from 'ws';
import type { Action } from '../shared/engine.js';
import { floorMove, floorKey } from './floorbot.js';
import type { C2S, RoomView, S2C } from '../shared/protocol.js';

const [room = '', count = '3', url = 'ws://localhost:8080/ws'] = process.argv.slice(2);
if (!room) { console.error('room code required'); process.exit(1); }
const NAMES = ['Bluff', 'Chip', 'Dice', 'Echo', 'Fizz', 'Gus', 'Hex'];

for (let i = 0; i < Number(count); i++) {
  const ws = new WebSocket(url);
  const send = (m: C2S) => ws.send(JSON.stringify(m));
  let sat = false, lastKey = '', rebuyHand = -1;
  ws.on('open', () => send({ t: 'join', room, name: NAMES[i % NAMES.length], avatar: (i + 1) % 8 }));
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as S2C;
    if (m.t === 'error') { console.log(NAMES[i], 'error:', m.msg); if (m.msg === 'Seat taken') sat = false; }
    if (m.t !== 'state') return;
    const s: RoomView = m.s;
    if (!sat && s.seat >= 0 && s.phase === 'lobby') { sat = true; send({ t: 'ready', ready: true }); }
    if (!sat && s.seat < 0) {
      const free = s.seats.findIndex((x) => !x);
      if (free >= 0) { sat = true; send({ t: 'sit', seat: free }); send({ t: 'ready', ready: true }); }
      return;
    }
    if (s.canRebuy && rebuyHand !== s.handNo) { rebuyHand = s.handNo; send({ t: 'rebuy' }); }
    if (s.floor) {
      const fa = floorMove(s), fk = floorKey(s);
      if (!fa || fk === lastKey) return;
      lastKey = fk;
      setTimeout(() => send({ t: 'act', action: fa }), 900 + Math.random() * 1200);
      return;
    }
    const h = s.hand, L = s.legal;
    if (!h || !L || h.done || h.toAct !== s.seat) return;
    const key = `${s.handNo}|${h.street}|${h.currentBet}|${h.seats.reduce((a, p) => a + (p?.total ?? 0), 0)}`;
    if (key === lastKey) return;
    lastKey = key;
    const r = Math.random();
    let a: Action;
    if (L.draw) a = { type: 'draw', discard: [0, 1, 2, 3, 4].filter(() => Math.random() < 0.3) };
    else if (L.raise && r < 0.18) a = { type: 'raise', to: r < 0.03 ? L.raise.max : L.raise.min };
    else if (L.check) a = { type: 'check' };
    else if (r < 0.15) a = { type: 'fold' };
    else a = { type: 'call' };
    setTimeout(() => send({ t: 'act', action: a }), 700 + Math.random() * 900);
  });
  ws.on('close', () => console.log(NAMES[i], 'disconnected'));
}
