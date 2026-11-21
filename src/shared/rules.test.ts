import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from './cards.js';
import { bestHand, type EvalCfg } from './eval.js';
import { DEFAULT_RULES, type Rules } from './rules.js';
import { startHand, applyAction, legal, viewFor, type Hand } from './engine.js';
import { buildPots } from './showdown.js';

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

const R: Rules = { ...DEFAULT_RULES, sb: 5, bb: 10 };
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
