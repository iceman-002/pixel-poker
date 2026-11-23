// Room add-ons kept out of room.ts: chip gifts, round recaps, bot names.
import type { Room, Member } from './room.js';
import { applyFloor, autoFloor, type FEv } from '../shared/floor.js';
import { applyAction, autoAction } from '../shared/engine.js';
import { botFloor, botPoker } from '../shared/botai.js';
import { AVATARS, CARD_BACKS } from '../shared/protocol.js';

export const BOT_NAMES = ['Ace', 'Bluff', 'Chip', 'Dice', 'Echo', 'Fizz', 'Gus', 'Hex', 'Ivy', 'Jinx'];

const rnd = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;

/** Host adds a computer player to the first free seat (joins the next round if a game is running). */
export function addBot(r: Room, m: Member): string | void {
  if (m.id !== r.host) return 'Only the host can add bots';
  const free = r.seats.findIndex((x) => !x);
  if (free < 0) return 'The table is full';
  const used = new Set([...r.members.values()].map((x) => x.name));
  const b = r.addMember(BOT_NAMES.find((n) => !used.has(n)) ?? 'Bot', rnd(AVATARS), rnd(CARD_BACKS));
  Object.assign(b, { bot: true, ready: true });
  if (b.seat < 0) { Object.assign(b, { seat: free, stack: r.rules.stack, bought: true }); r.seats[free] = b.id; }
}

export function kickBot(r: Room, m: Member, id: unknown): string | void {
  if (m.id !== r.host) return 'Only the host can remove bots';
  const b = r.members.get(String(id));
  if (!b?.bot) return 'Only bots can be removed';
  r.remove(b);
}

/** Let the bot in `seat` make its move (falls back to the timeout default if its pick is rejected). */
export function botAct(r: Room, seat: number) {
  try {
    if (r.floor) r.floor = applyFloor(r.floor, seat, botFloor(r.floor, seat) ?? autoFloor(r.floor, seat));
    else if (r.hand) r.hand = applyAction(r.hand, seat, botPoker(r.hand, seat) ?? autoAction(r.hand, seat));
  } catch {
    if (r.floor) r.floor = applyFloor(r.floor, seat, autoFloor(r.floor, seat));
    else if (r.hand) r.hand = applyAction(r.hand, seat, autoAction(r.hand, seat));
  }
}

const k = (n: number) => {
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  return sign + (a >= 1e6 ? +(a / 1e6).toFixed(1) + 'M' : a >= 1e4 ? +(a / 1e3).toFixed(1) + 'K' : String(a));
};

/** True while this seat still has decisions to make in the live round (so it must keep at least 1 chip). */
function stillActing(r: Room, seat: number): boolean {
  if (r.floor && !r.floor.done) { const p = r.floor.seats[seat]; return !!p && r.floor.phase === 'stake' && p.status === 'wait'; }
  if (r.hand && !r.hand.done) { const p = r.hand.seats[seat]; return !!p && !p.folded && !p.allIn; }
  return false;
}

/** Give chips to another seated player, at any time during a game. Returns an error string if rejected. */
export function giveChips(r: Room, m: Member, seat: number, amount: unknown): string | void {
  if (r.phase !== 'playing') return 'Gifts open once the game starts';
  if (m.seat < 0) return 'Sit down first';
  const toId = r.seats[Math.floor(Number(seat))] ?? null;
  const to = toId ? r.members.get(toId) : undefined;
  if (!to || to === m) return 'Pick another player';
  const g = r.floor ?? r.hand;
  const live = g && !g.done ? g : null;
  const slot = (x: Member) => (live && live.seats[x.seat]?.id === x.id ? live.seats[x.seat]! : null);
  const from = slot(m), dest = slot(to);
  const have = from ? from.stack : m.stack;
  const a = Math.floor(Number(amount));
  if (!(a >= 1 && a <= have)) return have ? `You can give 1 to ${have}` : 'You have no chips to give';
  if (a === have && stillActing(r, m.seat)) return 'Keep at least 1 chip while you are still in this round';
  if (from) from.stack -= a; else m.stack -= a;
  if (dest) dest.stack += a; else to.stack += a;
  r.lastActive = Date.now();
  r.sendAll({ t: 'gift', from: m.seat, to: to.seat, amount: a, name: m.name, toName: to.name });
}

/** One-line summary of the round that just finished, for the recap log. */
export function recap(r: Room): string {
  const head = `#${r.handNo} `;
  if (r.floor) {
    const f = r.floor, ev = f.events as FEv[];
    const nm = (i: number) => (f.seats[i]?.name ?? '?').toUpperCase();
    const pay = ev.find((e): e is Extract<FEv, { t: 'fpay' }> => e.t === 'fpay');
    if (!pay || pay.reason === 'void') return head + 'EVERYONE SKIPPED';
    const parts: string[] = [];
    const boss = ev.find((e): e is Extract<FEv, { t: 'fboss' }> => e.t === 'fboss');
    if (boss) parts.push(`BOSS ${nm(boss.seat)} (${k(f.seats[boss.seat]!.stake)})`);
    for (const e of ev) {
      if (e.t === 'fduel') parts.push(`DUEL ${nm(e.vs)}: ${nm(e.winner)} WON WITH ${e.winner === e.boss ? e.bossHand : e.vsHand}`.toUpperCase());
      if (e.t === 'fagree') parts.push(`${nm(e.seat)} LOCKED ${k(f.seats[e.seat]!.want)}`);
    }
    if (pay.reason === 'deal' || pay.reason === 'counter') parts.push('DEAL DONE');
    const net = f.seats.map((p, i) => {
      if (!p || !(p.status === 'staked' || p.status === 'allin' || p.status === 'beaten')) return null;
      return { i, v: (pay.pay.find((x) => x.seat === i)?.amount ?? 0) - p.stake };
    }).filter((x): x is { i: number; v: number } => !!x && x.v !== 0).sort((a, b) => b.v - a.v);
    if (net.length) parts.push(net.map((x) => `${nm(x.i)} ${x.v > 0 ? '+' : ''}${k(x.v)}`).join(', '));
    return head + parts.join(' · ');
  }
  const h = r.hand;
  if (!h) return head;
  const won = new Map<number, { amt: number; hand?: string }>();
  for (const a of h.awards) {
    const w = won.get(a.seat) ?? { amt: 0, hand: a.hand };
    w.amt += a.amount;
    won.set(a.seat, w);
  }
  return head + [...won].map(([i, w]) => `${(h.seats[i]?.name ?? '?').toUpperCase()} WON ${k(w.amt)}${w.hand ? ` (${w.hand.toUpperCase()})` : ''}`).join(', ');
}
