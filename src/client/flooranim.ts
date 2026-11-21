// Floor Deal: state adapter (so the table scene can render it) and event animations.
import type { FEv } from '../shared/floor.js';
import type { HandView, RoomView } from '../shared/protocol.js';
import type { Animator } from './anim';
import { POT, newCard, fmt, type CardObj } from './scene';
import { E } from './fx';
import { sfx } from './audio';

/** Present a Floor Deal round as a hand-shaped view: stakes are bets, skips/beaten are folds. */
export function floorAsHand(s: RoomView): HandView {
  const f = s.floor!;
  const onFloor = (st: string) => st === 'staked' || st === 'allin';
  return {
    rules: f.rules, level: s.level, dealer: f.starter, boards: [[]], street: 0, toAct: f.toAct, currentBet: f.high,
    minRaise: 0, raises: 0, bomb: false, done: f.done, awards: [],
    seats: f.seats.map((p) => p && {
      id: p.id, name: p.name, stack: p.stack, hole: p.hole, bet: onFloor(p.status) && !f.done ? p.stake : 0,
      total: onFloor(p.status) && !f.done ? p.stake : 0, folded: p.status === 'skip' || p.status === 'beaten',
      allIn: p.status === 'allin', acted: false, shown: p.shown,
    }),
  };
}

const nm = (s: RoomView, i: number) => (s.seats[i]?.name ?? '').toUpperCase();

export async function floorEvent(an: Animator, s: RoomView, e: FEv) {
  const sc = an.sc;
  switch (e.t) {
    case 'fdeal':
      sc.boss = -1;
      sc.crown.a = 0;
      await an.deal(s);
      break;
    case 'fstake':
      sc.bubble(e.seat, e.allIn ? 'ALL IN!' : 'STAKE ' + fmt(e.amount), e.allIn ? 8 : 1);
      sfx(e.allIn ? 'allin' : 'chip');
      await an.chips(e.seat, e.amount, false);
      if (e.allIn) { sc.fx[e.seat].flame = true; sc.shake = Math.max(sc.shake, 2); }
      break;
    case 'fskip':
      sc.bubble(e.seat, 'SKIP', 5);
      sfx('fold');
      sc.fx[e.seat].folded = true;
      an.flick(e.seat);
      await an.wait(0.3);
      break;
    case 'fboss': {
      if (e.tie.length) { an.banner('TIE! BEST HAND IS BOSS', 9); await an.wait(1); }
      an.banner('BOSS: ' + nm(s, e.seat), 10);
      sc.boss = e.seat;
      sc.crown.a = 1;
      sc.crown.y = -40;
      sfx('win');
      await sc.tw.to(sc.crown, { y: 0 }, 0.55, E.outBack);
      const p = sc.seatPos(e.seat);
      sc.px.sparkle(p.x, p.y - 10, 14);
      sc.shake = 2;
      await an.wait(0.5);
      break;
    }
    case 'foffer':
      sc.bubble(e.seat, s.floor?.seats.some((p) => p?.resp === 'locked') ? 'NEW OFFER' : 'MY OFFER', 10);
      sfx('click');
      for (const x of e.split) {
        if (x.seat === e.seat) continue;
        const b = sc.betPos(x.seat);
        sc.px.sparkle(b.x, b.y, 6);
        sc.bubble(x.seat, '+' + fmt(x.amount), 3);
        sfx('tap');
        await an.wait(0.18);
      }
      await an.wait(0.3);
      break;
    case 'freply':
      sc.bubble(e.seat, e.accept ? 'DEAL!' : 'I WANT ' + fmt(e.amount), e.accept ? 3 : 8);
      sfx(e.accept ? 'check' : 'allin');
      if (!e.accept) sc.shake = 1.5;
      await an.wait(0.4);
      break;
    case 'fagree':
      an.banner(nm(s, e.seat) + ' LOCKED IN!', 11);
      sfx('win');
      await an.wait(0.8);
      break;
    case 'fduel': await duel(an, s, e); break;
    case 'fpay': await pay(an, s, e); break;
  }
}

async function duel(an: Animator, s: RoomView, e: Extract<FEv, { t: 'fduel' }>) {
  const sc = an.sc, f = s.floor!;
  an.banner('DUEL!', 8);
  sc.shake = 4;
  sfx('allin');
  await an.wait(0.5);
  await sc.tw.to(sc.dim, { v: 1 }, 0.3);
  const rows: [number, number][] = [[e.boss, 150], [e.vs, 190]];
  const ps: Promise<void>[] = [];
  for (const [seat, y] of rows) {
    const vals = f.seats[seat]!.hole, objs = sc.hole[seat];
    vals.forEach((c, j) => {
      const o: CardObj = objs[j] ?? (objs[j] = newCard(c, sc.seatPos(seat), 0.6, s.seats[seat]?.back ?? 0));
      o.c = c;
      o.lift = 0;
      o.glow = 0;
      ps.push(sc.tw.to(o, { x: 72 + j * 17, y, s: 1, rot: 0, a: 1 }, 0.45, E.outBack, j * 0.06).then(() => (o.face ? undefined : sc.flip(o, 0.05))));
    });
  }
  await Promise.all(ps);
  an.banner(`${e.bossHand} VS ${e.vsHand}`.toUpperCase(), 7);
  await an.wait(1.1);
  const win = e.winner, lose = win === e.boss ? e.vs : e.boss;
  sc.hole[win].forEach((o) => { o.glow = 1; });
  for (const o of sc.hole[lose]) {
    for (let k = 0; k < 6; k++) sc.px.add({ x: o.x, y: o.y, vx: (Math.random() - 0.5) * 90, vy: -Math.random() * 70, g: 160, life: 0.8, c: [7, 8, 6][k % 3], sz: 2 });
    void sc.tw.to(o, { a: 0.3, rot: (Math.random() - 0.5) * 0.6 }, 0.3);
  }
  sc.shake = 6;
  sfx('win');
  sc.px.confetti(97, 170, 50);
  an.banner(`${nm(s, win)} WINS THE DUEL!`, win === e.boss ? 10 : 11);
  await an.wait(1.3);
  sc.clearGlow();
  await Promise.all(rows.map(([seat]) => Promise.all(sc.hole[seat].map((o, j, arr) => {
    const t = sc.holePos(seat, j, arr.length, true);
    return sc.tw.to(o, { x: t.x, y: t.y, s: t.s, rot: 0 }, 0.35, E.inOutQuad);
  }))));
  if (lose === e.vs) an.flick(lose);
  await sc.tw.to(sc.dim, { v: 0 }, 0.3);
}

async function pay(an: Animator, s: RoomView, e: Extract<FEv, { t: 'fpay' }>) {
  const sc = an.sc, f = s.floor!;
  await an.gather();
  if (e.reason === 'void') { an.banner('EVERYONE SKIPPED', 6); await an.wait(0.9); return; }
  const house = e.reason === 'deal' || e.reason === 'counter' ? f.seats[f.boss]?.stake ?? 0 : 0;
  if (house) {
    an.banner('HOUSE PAYS ' + fmt(house) + '!', 10);
    sfx('win');
    void sc.tw.to(sc.house, { a: 1 }, 0.2).then(() => sc.tw.to(sc.house, { a: 0 }, 1));
    const n = 6, part = Math.floor(house / n);
    await Promise.all(Array.from({ length: n }, (_, k) => {
      const amt = k < n - 1 ? part : house - part * (n - 1);
      const fl = { fx: 80 + Math.random() * 35, fy: -8, tx: POT.x, ty: POT.y, k: 0, amt, trail: true };
      sc.flyers.push(fl);
      return sc.tw.to(fl, { k: 1 }, 0.5, E.inQuad, k * 0.09).then(() => {
        sc.flyers = sc.flyers.filter((x) => x !== fl);
        sc.pot.t += amt;
        sc.px.sparkle(POT.x, POT.y, 4);
        sfx('chip');
      });
    }));
  }
  if (e.reason === 'bosslost') {
    an.banner('BOSS DETHRONED!', 8);
    void sc.tw.to(sc.crown, { y: 30, a: 0 }, 0.7, E.inQuad);
    await an.wait(0.6);
  }
  const pays = e.pay.filter((x) => x.amount > 0).sort((a, b) => a.amount - b.amount);
  for (const x of pays) await an.sweep(x.seat, x.amount);
  const top = pays[pays.length - 1];
  if (top) { const p = sc.seatPos(top.seat); sc.px.confetti(p.x, p.y - 6, house ? 50 : 30); }
  await an.wait(0.8);
}
