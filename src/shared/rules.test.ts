import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from './cards.js';
import { bestHand, type EvalCfg } from './eval.js';
import { DEFAULT_RULES, type Rules } from './rules.js';
import { startHand, applyAction, legal, viewFor, type Hand } from './engine.js';
import { buildPots } from './showdown.js';
import { startFloor, applyFloor, floorLegal, floorScore, floorDeck, type Floor, type FAction } from './floor.js';

const std: EvalCfg = { wild: 'none', short: false, omaha: false };
const ev = (hole: string, board: string, cfg = std) => bestHand(parseCards(hole), parseCards(board), cfg);

test('hand ranking basics', () => {
  assert.equal(ev('As Ks', 'Qs Js Ts 2d 3c').name, 'Straight Flush');
  assert.ok(ev('As Ks', 'Qs Js Ts 2d 3c').score > ev('Ac Ad', 'Ah As Ts 2d 3c').score);
  assert.equal(ev('Ah 2c', '3d 4s 5h 9c Kd').name, 'Straight');
  assert.ok(ev('6h 2c', '3d 4s 5h 9c Kd').score > ev('Ah 2c', '3d 4s 5h 9c Kd').score, '6-high beats wheel');
  assert.ok(ev('Ah Kc', 'Ad 7s 4h 3c 9d').score > ev('As Qc', 'Ad 7s 4h 3c 9d').score, 'kicker');
  assert.equal(ev('Ah Kc', 'Ts Jd Qh 2c 3d').score, ev('Ad Ks', 'Ts Jd Qh 2c 3d').score, 'tie');
});

test('short deck, wilds, omaha', () => {
  const sd: EvalCfg = { ...std, short: true };
  assert.ok(ev('As Ks', 'Qs 9s 7s 7d 7c', sd).score > ev('Ah Ad', 'Ac 7h 7s 2d 3c', sd).score, 'flush > full house');
  assert.equal(ev('Ah 6c', '7d 8s 9h Kc Kd', sd).name, 'Straight');
  assert.equal(ev('2c 2d', 'As Ad Ah 7c 8d', { ...std, wild: 'deuces' }).name, 'Five of a Kind');
  const jk = ev('X1 Ks', 'Qs Js Ts 3d 4c', { ...std, wild: 'jokers' });
  assert.equal(jk.name, 'Straight Flush');
  const om: EvalCfg = { ...std, omaha: true };
  assert.equal(ev('As Ks Qd Jd', 'Ts 9s 2s 3h 4c', om).name, 'Flush');
  assert.notEqual(ev('As Ks Qs Js', '2h 3h 4h 7c 8d', om).name, 'Flush', 'omaha uses exactly two hole cards');
});

const R: Rules = { ...DEFAULT_RULES, variant: 'holdem', sb: 5, bb: 10 };
const lvl = { sb: 5, bb: 10, ante: 0 };
const seats = (...stacks: number[]) => stacks.map((s, i) => ({ id: 'p' + i, name: 'P' + i, stack: s }));
const act = (h: Hand, ...acts: [number, string, number?][]) =>
  acts.reduce((x, [s, type, to]) => applyAction(x, s, (type === 'raise' ? { type, to } : { type }) as never), h);

test('holdem side pots: all-in three ways', () => {
  // dealer 0; deal order 1,2,0; board 2c 7d 9h Js 4c
  const deck = parseCards('As Ad Ks Kd Qs Qd 2c 7d 9h Js 4c 5h 6h');
  let h = startHand(R, seats(300, 50, 100), 0, lvl, { deck });
  assert.equal(h.toAct, 0);
  h = act(h, [0, 'raise', 300], [1, 'call'], [2, 'call']);
  assert.ok(h.done);
  assert.deepEqual(h.seats.map((p) => p!.stack), [200, 150, 100]);
  assert.equal(h.boards[0].length, 5);
  assert.deepEqual(buildPots([300, 50, 100], [false, false, false]).map((p) => p.amount), [150, 100, 200]);
});

test('split pot with odd chip goes left of dealer; folded blind is dead', () => {
  const deck = parseCards('2c 3d 4h 5s 6h 7s Ts Jd Qh Kc Ac 8d 8c');
  let h = startHand(R, seats(100, 100, 100), 0, lvl, { deck });
  h = act(h, [0, 'call'], [1, 'fold'], [2, 'check']);
  for (let i = 0; i < 3; i++) h = act(h, [2, 'check'], [0, 'check']);
  assert.ok(h.done);
  assert.deepEqual(h.seats.map((p) => p!.stack), [102, 95, 103]);
  assert.equal(h.awards[0].hand, 'Straight');
});

test('betting limits, heads-up order, hidden cards', () => {
  let h = startHand({ ...R, betting: 'pl' }, seats(1000, 1000, 1000), 0, lvl, { seed: 7 });
  assert.deepEqual(legal(h, 0)!.raise, { min: 20, max: 35 });
  h = startHand({ ...R, betting: 'fl' }, seats(1000, 1000), 0, lvl, { seed: 7 });
  assert.equal(h.toAct, 0, 'heads-up: dealer/SB acts first preflop');
  assert.deepEqual(legal(h, 0)!.raise, { min: 20, max: 20 });
  assert.throws(() => applyAction(h, 1, { type: 'fold' }));
  const v = viewFor(h, 0);
  assert.ok(v.seats[1]!.hole.every((c) => c === -1) && v.seats[0]!.hole.every((c) => c >= 0));
  assert.ok(!('deck' in v));
});

test('run it twice splits contested pot across two boards', () => {
  let h = startHand({ ...R, runItTwice: true }, seats(100, 100), 0, lvl, { seed: 3 });
  h = act(h, [0, 'raise', 100], [1, 'call']);
  assert.ok(h.done);
  assert.equal(h.boards.length, 2);
  assert.equal(h.seats[0]!.stack + h.seats[1]!.stack, 200);
});

// --- Floor Deal
const FR: Rules = { ...DEFAULT_RULES, variant: 'floor' };
const fseats = (...stacks: number[]) => stacks.map((s, i) => ({ id: 'p' + i, name: 'P' + i, stack: s, skips: 0 }));
const fact = (f: Floor, ...acts: [number, FAction][]) => acts.reduce((x, [s, a]) => applyFloor(x, s, a), f);
const total = (f: Floor) => f.seats.reduce((a, p) => a + (p?.stack ?? 0), 0);

test('floor: deck size, 4-card ranking', () => {
  assert.equal(floorDeck(3).length, 16);
  assert.equal(floorDeck(5).length, 20);
  assert.equal(floorDeck(8).length, 32);
  assert.ok(floorScore(parseCards('Kh Kd Kc Js')).score > floorScore(parseCards('Ah Ad Kc Ks')).score, 'trips > two pair');
  assert.ok(floorScore(parseCards('Ah Ad Kc Qs')).score > floorScore(parseCards('Kh Kd Ac Qs')).score, 'pair rank');
  assert.equal(floorScore(parseCards('As Ah Ad Ac')).name, 'Four of a Kind');
  assert.equal(floorScore(parseCards('As Kh Qd Jc')).name, 'A-K-Q-J');
  assert.ok(floorScore(parseCards('As Kh Qd Jc')).score > floorScore(parseCards('As Ah Ad Ac')).score, 'A-K-Q-J beats four of a kind');
  assert.equal(floorScore(parseCards('As Kh Qd Tc')).name, 'High Card', 'other all-different hands are high card');
});

test('floor: stakes, boss deal accepted, house pays the split', () => {
  let f = startFloor(FR, fseats(1000, 5000, 1000, 1000), 0, { seed: 1 });
  assert.throws(() => applyFloor(f, 1, { type: 'skip' }), /not your turn/);
  f = fact(f, [0, { type: 'stake', amount: 500 }]);
  assert.throws(() => applyFloor(f, 1, { type: 'stake', amount: 500 }), /at least 510/);
  f = fact(f, [1, { type: 'stake', amount: 3000 }], [2, { type: 'allin' }], [3, { type: 'skip' }]);
  assert.equal(f.boss, 1);
  f = fact(f, [1, { type: 'offer', share: 1000 }], [2, { type: 'accept' }], [0, { type: 'accept' }]);
  assert.ok(f.done);
  assert.deepEqual(f.seats.map((p) => p!.stack), [2000, 6000, 2000, 1000]);
  assert.equal(total(f), 8000 + 3000);
});

test('floor: counter refused and boss loses the duel', () => {
  const deck = parseCards('As Ah Ad Ac Ks Kh Kd Kc Qs Qh Qd Qc');
  let f = startFloor(FR, fseats(1000, 1000, 1000), 0, { deck });
  f = fact(f, [0, { type: 'stake', amount: 100 }], [1, { type: 'stake', amount: 500 }], [2, { type: 'skip' }],
    [1, { type: 'offer', share: 500 }], [0, { type: 'counter', amount: 500 }]);
  assert.equal(floorLegal(f, 1)!.want, 500);
  f = fact(f, [1, { type: 'duel' }]);
  assert.deepEqual(f.seats.map((p) => p!.stack), [1500, 500, 1000]);

  let g = startFloor(FR, fseats(1000, 1000, 150), 0, { deck });
  g = fact(g, [0, { type: 'stake', amount: 100 }], [1, { type: 'stake', amount: 600 }]);
  assert.throws(() => applyFloor(g, 2, { type: 'stake', amount: 100 }), /at least/);
  g = fact(g, [2, { type: 'allin' }]);
  assert.equal(g.seats[2]!.status, 'allin', 'short all-in below the high stake is allowed');
});

test('floor: two skips max; losing challenger pays the boss, who re-offers', () => {
  const deck = parseCards('Qs Qh Qd Qc Ks Kh Kd Kc As Ah Ad Ac');
  const s = fseats(1000, 1000, 1000);
  s[2].skips = 2;
  let f = startFloor(FR, s, 0, { deck });
  f = fact(f, [0, { type: 'stake', amount: 500 }], [1, { type: 'stake', amount: 600 }]);
  assert.equal(floorLegal(f, 2)!.canSkip, false);
  f = fact(f, [2, { type: 'stake', amount: 700 }]);
  assert.equal(f.boss, 2);
  f = fact(f, [2, { type: 'offer', share: 700 }], [0, { type: 'counter', amount: 300 }], [1, { type: 'accept' }], [2, { type: 'duel' }]);
  assert.equal(f.phase, 'offer');
  assert.equal(f.seats[0]!.status, 'beaten');
  f = fact(f, [2, { type: 'offer', share: 700 }], [1, { type: 'accept' }]);
  assert.deepEqual(f.seats.map((p) => p!.stack), [500, 1000, 2200]);
});

test('floor: agreed counter locks in, boss re-splits the rest, others respond again', () => {
  let f = startFloor(FR, fseats(20000, 20000, 20000, 3000), 0, { seed: 3 });
  f = fact(f, [0, { type: 'stake', amount: 1000 }], [1, { type: 'stake', amount: 2000 }], [2, { type: 'stake', amount: 10000 }], [3, { type: 'allin' }]);
  assert.equal(f.boss, 2);
  f = fact(f, [2, { type: 'offer', share: 7000 }], [3, { type: 'counter', amount: 2000 }], [0, { type: 'accept' }], [1, { type: 'accept' }]);
  f = fact(f, [2, { type: 'agree' }]);
  assert.equal(f.phase, 'offer', 'boss re-splits after agreeing');
  assert.equal(floorLegal(f, 2)!.max, 8000);
  f = fact(f, [2, { type: 'offer', share: 6000 }]);
  assert.equal(f.toAct, 0, 'locked player is skipped');
  f = fact(f, [0, { type: 'accept' }], [1, { type: 'accept' }]);
  assert.ok(f.done);
  assert.deepEqual(f.seats.map((p) => p!.stack), [21000, 21000, 26000, 5000]);
});
