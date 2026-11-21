// Simulates 4 bot players against an in-process server.
// Usage: node dist-server/scripts/bots.js [hands=3] [variant=holdem]
import WebSocket from 'ws';
import { startServer } from '../server/app.js';
import { cardStr } from '../shared/cards.js';
import type { Action, Ev } from '../shared/engine.js';
import type { C2S, RoomView, S2C } from '../shared/protocol.js';
import { PRESETS, type Rules, type Variant } from '../shared/rules.js';

const HANDS = Number(process.argv[2] ?? 3);
const variant = (process.argv[3] ?? 'holdem') as Variant;
const preset = process.argv[4] ?? '';
const extra: Partial<Rules> = PRESETS[preset] ?? (preset ? JSON.parse(preset) : {});
const fail = (m: string) => { console.error('FAIL:', m); process.exit(1); };
setTimeout(() => fail('timeout; phase=' + bots[0].s?.phase + ' errors=' + errors.join('; ') + ' seats=' + JSON.stringify(bots[0].s?.seats.map((x) => x && [x.name, x.stack, x.rebuys]))), 8000).unref();

const srv = await startServer({ port: 0, handDelay: 40, grace: 3000 });
const URL = `ws://localhost:${srv.port}/ws`;
let code = '';
let doneHands = 0;
let loggedHand = 0;
const errors: string[] = [];
const cs = (cards: number[]) => cards.map(cardStr).join(' ');
const until = (f: () => boolean) => new Promise<void>((r) => { const t = setInterval(() => { if (f()) { clearInterval(t); r(); } }, 10); });

class Bot {
  ws!: WebSocket;
  id = '';
  token = '';
  s: RoomView | null = null;
  lastKey = '';
  rebuyHand = -1;
  constructor(public name: string, public avatar: number) {}

  connect(first: C2S): Promise<void> {
    this.lastKey = '';
    return new Promise((res) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', () => this.send(first));
      this.ws.on('message', (raw) => {
        const m = JSON.parse(String(raw)) as S2C;
        if (m.t === 'joined') { this.id = m.id; this.token = m.token; code = m.room; res(); }
        else if (m.t === 'state') this.onState(m.s, m.ev);
        else if (m.t === 'error') errors.push(`${this.name}: ${m.msg}`);
      });
    });
  }

  send(m: C2S) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  onState(s: RoomView, ev: Ev[]) {
    this.s = s;
    s.hand?.seats.forEach((p, i) => {
      if (p && i !== s.seat && !p.shown && p.hole.some((c) => c !== -1)) fail(`${this.name} saw seat ${i} hole cards`);
    });
    if (this === bots[0]) observe(s, ev);
    if (s.canRebuy && this.rebuyHand !== s.handNo) { this.rebuyHand = s.handNo; this.send({ t: 'rebuy' }); }
    this.play(s);
  }

  play(s: RoomView) {
    const h = s.hand, L = s.legal;
    if (!h || !L || h.toAct !== s.seat) return;
    const pot = h.seats.reduce((a, p) => a + (p?.total ?? 0), 0);
    const key = `${s.handNo}|${h.street}|${h.toAct}|${h.currentBet}|${pot}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const r = Math.random();
    let a: Action;
    if (L.draw) a = { type: 'draw', discard: [0, 1, 2, 3, 4].filter(() => Math.random() < 0.3) };
    else if (L.raise && r < 0.2) a = { type: 'raise', to: r < 0.04 ? L.raise.max : L.raise.min };
    else if (L.check) a = { type: 'check' };
    else if (r < 0.12) a = { type: 'fold' };
    else a = { type: 'call' };
    setTimeout(() => this.send({ t: 'act', action: a }), 2);
  }
}

function observe(s: RoomView, ev: Ev[]) {
  if (s.phase === 'lobby' && doneHands > 0) { console.log(`Game over after ${doneHands} hands (no rebuys): ${s.seats.find((x) => x && x.stack > 0)?.name} wins`); return finish(); }
  const nm = (seat: number) => s.seats[seat]?.name ?? `#${seat}`;
  for (const e of ev) {
    if (e.t === 'post') console.log(`  ${nm(e.seat)} posts ${e.kind} ${e.amount}`);
    else if (e.t === 'act') console.log(`  ${nm(e.seat)} ${e.type}${e.amount ? ' ' + e.amount : ''}${e.allIn ? ' (ALL-IN)' : ''}`);
    else if (e.t === 'street') console.log(`  -- street ${e.street}: ${e.boards.map(cs).join(' | ')}`);
    else if (e.t === 'twice') console.log('  -- running it twice');
    else if (e.t === 'showdown') for (const a of e.awards)
      console.log(`  ** ${nm(a.seat)} wins ${a.amount} (pot ${a.pot}, run ${a.run})${a.hand ? ` with ${a.hand} [${cs(a.cards ?? [])}]` : ''}`);
  }
  const h = s.hand;
  if (h && !h.done && ev.some((e) => e.t === 'deal')) console.log(`Hand #${s.handNo} (${variant} ${s.rules.betting}${h.bomb ? ' BOMB' : ''}) dealer=${nm(h.dealer)} blinds ${s.level.sb}/${s.level.bb}`);
  if (h?.done && loggedHand !== s.handNo) {
    loggedHand = s.handNo;
    const seats = s.seats.filter((x) => x !== null);
    const total = seats.reduce((a, x) => a + x.stack, 0);
    const expected = s.rules.stack * (seats.length + seats.reduce((a, x) => a + x.rebuys, 0));
    h.seats.forEach((p, i) => p?.shown && console.log(`  ${nm(i)} shows ${cs(p.hole)}`));
    console.log(`  stacks: ${seats.map((x) => `${x.name}=${x.stack}`).join(' ')}  total=${total}`);
    if (total !== expected) fail(`chip total ${total} != ${expected}`);
    doneHands++;
    if (doneHands === 1) void reconnectTest();
    if (doneHands >= HANDS) finish();
  }
}

async function reconnectTest() {
  const b = bots[2];
  const { id, s } = b;
  b.ws.close();
  await new Promise((r) => setTimeout(r, 100));
  await b.connect({ t: 'join', room: code, name: b.name, avatar: b.avatar, token: b.token });
  await until(() => b.s !== s);
  if (b.id !== id || b.s?.seat !== s?.seat) fail('reconnect did not restore seat');
  console.log(`  [reconnect] ${b.name} rejoined seat ${b.s?.seat}`);
}

function finish() {
  if (errors.length) fail('server errors: ' + errors.join('; '));
  console.log(`OK: ${doneHands} hands, no hole-card leaks, chips conserved, reconnect works`);
  srv.close();
  process.exit(0);
}

const bots = ['Ace', 'Bluff', 'Chip', 'Dice'].map((n, i) => new Bot(n, i));
await bots[0].connect({ t: 'create', name: bots[0].name, avatar: 0, rules: { ...extra, variant, timer: 0 } });
for (const b of bots.slice(1)) await b.connect({ t: 'join', room: code, name: b.name, avatar: b.avatar });
bots.forEach((b, i) => b.send({ t: 'sit', seat: i * 2 }));
await until(() => bots[0].s?.seats.filter(Boolean).length === 4);
console.log(`Room ${code}: 4 bots seated, starting`);
bots[0].send({ t: 'start' });
