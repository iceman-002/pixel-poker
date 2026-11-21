// Action bar + sliding amount sheet (DOM over the canvas), for poker and Floor Deal.
import type { RoomView } from '../shared/protocol.js';
import type { FAction } from '../shared/floor.js';
import type { Net } from './net';
import { type Scene, fmt } from './scene';
import { sfx } from './audio';

type Btn = { label: string; cls?: string; on: () => void; disabled?: boolean; hidden?: boolean };
interface SheetCfg {
  title: string; min: number; max: number; step: number; start: number;
  quick: [string, number][]; label?: (v: number) => string; note?: (v: number) => string; confirm: (v: number) => void;
}

export class Controls {
  private s: RoomView | null = null;
  private v = 0;
  private cfg: SheetCfg | null = null;
  private key = '';
  private $ = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;

  constructor(private root: HTMLElement, private net: Net, private sc: Scene, private toast: (m: string) => void) {
    root.insertAdjacentHTML('beforeend', `
      <div class="info" id="info"></div>
      <div class="bar" id="bar"></div>
      <div class="sheet" id="sheet">
        <div class="amt"><span id="stitle"></span><b id="amt">0</b><i id="snote"></i></div>
        <input type="range" id="slider" min="0" max="1" step="1">
        <div class="quick" id="quick"></div>
        <div class="row"><button class="btn" data-a="back">BACK</button><button class="btn gold" data-a="confirm">CONFIRM</button></div>
      </div>`);
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || !root.contains(b)) return;
      const a = b.dataset.a, q = b.dataset.q;
      if (a === 'back') { sfx('click'); this.sheet(null); }
      else if (a === 'confirm' && this.cfg) { sfx('click'); this.cfg.confirm(this.v); }
      else if (a === 'sit' && this.s) { const i = this.s.seats.findIndex((x) => !x); if (i >= 0) this.net.send({ t: 'sit', seat: i }); }
      else if (a === 'rebuy') this.net.send({ t: 'rebuy' });
      else if (q !== undefined && this.cfg) { sfx('tap'); this.set(this.cfg.quick[Number(q)][1]); }
    });
    this.$<HTMLInputElement>('#slider').addEventListener('input', (e) => this.set(Number((e.target as HTMLInputElement).value), true));
    sc.onSelect = () => this.update(this.s);
  }

  private send(m: Parameters<Net['send']>[0]) {
    if (!this.net.send(m)) this.toast('Offline - reconnecting');
    this.$('#bar').classList.remove('show');
    this.sheet(null);
  }
  private act = (action: Extract<Parameters<Net['send']>[0], { t: 'act' }>['action']) => this.send({ t: 'act', action });
  private fact = (a: FAction) => this.act(a);

  private set(v: number, snap = false) {
    const c = this.cfg;
    if (!c) return;
    if (snap && v < c.max) v = Math.round(v / c.step) * c.step;
    this.v = Math.max(c.min, Math.min(c.max, Math.round(v)));
    this.$<HTMLInputElement>('#slider').value = String(this.v);
    this.$('#amt').textContent = c.label ? c.label(this.v) : fmt(this.v);
    this.$('#snote').textContent = c.note?.(this.v) ?? '';
  }

  private sheet(c: SheetCfg | null) {
    this.cfg = c;
    if (c) {
      const sl = this.$<HTMLInputElement>('#slider');
      sl.min = String(c.min);
      sl.max = String(c.max);
      sl.step = String(c.step);
      this.$('#stitle').textContent = c.title;
      this.$('#quick').innerHTML = c.quick.map(([l], i) => `<button class="btn sm${i === c.quick.length - 1 ? ' red' : ''}" data-q="${i}">${l}</button>`).join('');
      this.set(c.start);
    }
    this.$('#sheet').classList.toggle('open', !!c);
  }

  private bar(btns: Btn[] | null) {
    const bar = this.$('#bar');
    if (!btns) { bar.classList.remove('show'); this.key = ''; return; }
    if (!bar.classList.contains('show')) sfx('turn');
    bar.innerHTML = '';
    for (const b of btns) {
      if (b.hidden) continue;
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls ?? '');
      el.textContent = b.label;
      el.disabled = !!b.disabled;
      el.onclick = () => { sfx('click'); b.on(); };
      bar.append(el);
    }
    bar.classList.add('show');
  }

  private pokerBtns(s: RoomView): Btn[] {
    const h = s.hand!, L = s.legal!;
    const n = this.sc.selected.size, verb = h.currentBet === 0 ? 'BET' : 'RAISE';
    if (L.draw) return [{ label: n ? `DISCARD ${n}` : 'STAND PAT', cls: 'gold', on: () => this.act({ type: 'draw', discard: [...this.sc.selected] }) }];
    const pot = h.seats.reduce((a, p) => a + (p?.total ?? 0), 0) + L.toCall, R = L.raise;
    return [
      { label: 'FOLD', cls: 'red', on: () => this.act({ type: 'fold' }) },
      { label: L.check ? 'CHECK' : `CALL ${fmt(L.call)}`, on: () => this.act({ type: L.check ? 'check' : 'call' }) },
      {
        label: R && R.min === R.max ? `${verb} ${fmt(R.min)}` : verb, cls: 'gold', disabled: !R,
        on: () => {
          if (!R) return;
          if (R.min === R.max) return this.act({ type: 'raise', to: R.min });
          const cb = h.currentBet;
          this.sheet({
            title: verb === 'BET' ? 'BET' : 'RAISE TO', min: R.min, max: R.max, step: Math.max(1, s.level.sb), start: R.min,
            quick: [['MIN', R.min], ['1/2 POT', cb + Math.round(pot / 2)], ['POT', cb + pot], ['ALL IN', R.max]],
            label: (v) => (v === R.max ? `${fmt(v)} ALL IN` : fmt(v)), confirm: (v) => this.act({ type: 'raise', to: v }),
          });
        },
      },
    ];
  }

  private floorBtns(s: RoomView): Btn[] {
    const L = s.flegal!, f = s.floor!, me = f.seats[s.seat]!;
    const nm = (i: number) => (s.seats[i]?.name ?? '').toUpperCase();
    switch (L.phase) {
      case 'stake': {
        const quick: [string, number][] = [['MIN', L.min], ['x2', L.min * 2], ['HALF', Math.floor(me.stack / 20) * 10], ['ALL IN', me.stack]];
        return [
          { label: L.canSkip ? `SKIP (${2 - me.skips})` : 'NO SKIPS', cls: 'red', disabled: !L.canSkip, on: () => this.fact({ type: 'skip' }) },
          { label: L.canStake ? 'STAKE' : `ALL IN ${fmt(me.stack)}`, cls: 'gold', on: () => {
            if (!L.canStake) return this.fact({ type: 'allin' });
            this.sheet({
              title: 'PUT ON FLOOR', min: L.min, max: me.stack, step: 10, start: L.min, quick: quick.filter(([, v]) => v >= L.min && v <= me.stack),
              label: (v) => (v === me.stack ? `${fmt(v)} ALL IN` : fmt(v)), note: () => `HIGH IS ${fmt(f.high)}`,
              confirm: (v) => this.fact(v >= me.stack ? { type: 'allin' } : { type: 'stake', amount: v }),
            });
          } },
        ];
      }
      case 'offer': {
        const n = f.seats.filter((p, i) => p && i !== f.boss && (p.status === 'staked' || p.status === 'allin') && p.resp !== 'locked').length || 1;
        const each = (v: number) => Math.floor((L.max - v) / n / 10) * 10;
        const fair = Math.floor(L.max / (n + 1) / 10) * 10;
        return [{ label: 'MAKE OFFER', cls: 'gold', on: () => this.sheet({
          title: 'YOU KEEP', min: 0, max: L.max, step: 10, start: fair, quick: [['NONE', 0], ['FAIR', fair], ['HALF', Math.floor(L.max / 20) * 10], ['ALL', L.max]],
          note: (v) => `OTHERS GET +${fmt(each(v))} EACH`, confirm: (v) => this.fact({ type: 'offer', share: v }),
        }) }];
      }
      case 'respond': {
        const mine = f.offer?.find((x) => x.seat === s.seat)?.amount ?? 0;
        return [
          { label: 'COUNTER', cls: 'red', on: () => this.sheet({
            title: 'I WANT', min: 0, max: L.max, step: 10, start: Math.min(L.max, mine * 2 || 10),
            quick: [['x1.5', Math.floor(mine * 1.5 / 10) * 10], ['x2', mine * 2], ['HALF', Math.floor(L.max / 20) * 10], ['ALL', L.max]],
            note: () => `OR DUEL ${nm(f.boss)}`, confirm: (v) => this.fact({ type: 'counter', amount: v }),
          }) },
          { label: `ACCEPT +${fmt(mine)}`, cls: 'gold', on: () => this.fact({ type: 'accept' }) },
        ];
      }
      case 'decide':
        return [
          { label: 'DUEL!', cls: 'red', on: () => this.fact({ type: 'duel' }) },
          { label: `GIVE ${fmt(L.want)}`, cls: 'gold', on: () => this.fact({ type: 'agree' }) },
        ];
      default: return [];
    }
  }

  private infoText(s: RoomView, mine: boolean): string {
    const h = s.hand, f = s.floor, L = s.flegal;
    if (s.seat < 0) return `SPECTATING ${s.seats.some((x) => !x) ? '<button class="btn sm gold" data-a="sit">SIT IN</button>' : ''}`;
    if (s.canRebuy) return `BUSTED <button class="btn sm gold" data-a="rebuy">REBUY ${fmt(s.rules.stack)}</button>`;
    const who = (i: number) => s.seats[i]?.name ?? '';
    if (f && !f.done) {
      if (mine && L) {
        if (L.phase === 'stake') return f.high ? `BEAT ${fmt(f.high)} TO BE BOSS` : 'OPEN THE FLOOR';
        if (L.phase === 'offer') return f.seats.some((p) => p?.resp === 'locked') ? `SPLIT THE REST: ${fmt(L.max)}` : 'YOU ARE BOSS! SPLIT THE HOUSE';
        if (L.phase === 'respond') return `${who(f.boss)} OFFERS YOU THIS`;
        if (L.phase === 'decide') return `${who(L.vs)} WANTS ${fmt(L.want)}`;
      }
      const me = f.seats[s.seat];
      if (!me) return 'NEXT ROUND...';
      if (me.status === 'skip') return 'SKIPPED THIS ROUND';
      if (me.status === 'beaten') return 'BEATEN IN A DUEL';
      const act = f.toAct >= 0 ? who(f.toAct) : '';
      return { stake: `${act} STAKING`, offer: `${act} IS MAKING AN OFFER`, respond: `${act} IS DECIDING`, decide: `${act} WEIGHS THE COUNTER`, done: '' }[f.phase];
    }
    if (mine && s.legal?.draw) return 'TAP CARDS TO DISCARD';
    if (h && !h.done && !mine) {
      const me = h.seats[s.seat];
      return !me ? 'NEXT HAND...' : me.folded ? 'FOLDED' : h.toAct >= 0 ? `${who(h.toAct)} TO ACT` : '';
    }
    return '';
  }

  update(s: RoomView | null) {
    this.s = s;
    if (!s) return;
    const h = s.hand;
    const mine = !!(h && !h.done && h.toAct === s.seat && (s.floor ? s.flegal : s.legal));
    if (!mine) { this.bar(null); this.sheet(null); }
    else {
      const k = JSON.stringify([s.handNo, s.floor?.phase, s.flegal, s.legal, this.sc.selected.size]);
      if (k !== this.key) { this.bar(s.floor ? this.floorBtns(s) : this.pokerBtns(s)); this.key = k; }
    }
    const info = this.$('#info'), html = this.infoText(s, mine);
    if (info.innerHTML !== html) info.innerHTML = html;
    info.classList.toggle('show', !!html && (!mine || !!s.legal?.draw || !!s.floor));
  }
}
