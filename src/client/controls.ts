// Bet bar + sliding raise sheet (DOM over the canvas).
import type { RoomView } from '../shared/protocol.js';
import type { Net } from './net';
import { type Scene, fmt } from './scene';
import { sfx } from './audio';

export class Controls {
  private s: RoomView | null = null;
  private to = 0;
  private $ = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;

  constructor(private root: HTMLElement, private net: Net, private sc: Scene, private toast: (m: string) => void) {
    root.insertAdjacentHTML('beforeend', `
      <div class="info" id="info"></div>
      <div class="bar" id="bar">
        <button class="btn red" data-a="fold">FOLD</button>
        <button class="btn" data-a="call">CHECK</button>
        <button class="btn gold" data-a="raise">RAISE</button>
      </div>
      <div class="sheet" id="sheet">
        <div class="amt">RAISE TO <b id="amt">0</b></div>
        <input type="range" id="slider" min="0" max="1" step="1">
        <div class="quick">
          <button class="btn sm" data-q="min">MIN</button><button class="btn sm" data-q="half">1/2 POT</button>
          <button class="btn sm" data-q="pot">POT</button><button class="btn sm red" data-q="all">ALL IN</button>
        </div>
        <div class="row"><button class="btn" data-a="back">BACK</button><button class="btn gold" data-a="confirm">CONFIRM</button></div>
      </div>`);
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || !root.contains(b)) return;
      if (b.dataset.a) this.onAction(b.dataset.a);
      if (b.dataset.q) this.quick(b.dataset.q);
    });
    this.$<HTMLInputElement>('#slider').addEventListener('input', (e) => this.setTo(Number((e.target as HTMLInputElement).value), true));
    sc.onSelect = () => this.update(this.s);
  }

  private send(action: Parameters<Net['send']>[0]) {
    if (!this.net.send(action)) this.toast('Offline - reconnecting');
    this.$('#bar').classList.remove('show');
    this.sheet(false);
  }

  private onAction(a: string) {
    const s = this.s, L = s?.legal;
    sfx('click');
    if (a === 'sit' && s) { const i = s.seats.findIndex((x) => !x); if (i >= 0) this.net.send({ t: 'sit', seat: i }); return; }
    if (a === 'rebuy') { this.net.send({ t: 'rebuy' }); return; }
    if (!s || !L) return;
    switch (a) {
      case 'fold': return this.send({ t: 'act', action: { type: 'fold' } });
      case 'call':
        if (L.draw) return this.send({ t: 'act', action: { type: 'draw', discard: [...this.sc.selected] } });
        return this.send({ t: 'act', action: { type: L.check ? 'check' : 'call' } });
      case 'raise':
        if (!L.raise) return;
        if (L.raise.min === L.raise.max) return this.send({ t: 'act', action: { type: 'raise', to: L.raise.min } });
        return this.sheet(true);
      case 'back': return this.sheet(false);
      case 'confirm': return this.send({ t: 'act', action: { type: 'raise', to: this.to } });
    }
  }

  private pot() { return this.s?.hand?.seats.reduce((a, p) => a + (p?.total ?? 0), 0) ?? 0; }

  private quick(q: string) {
    const s = this.s, L = s?.legal;
    if (!s?.hand || !L?.raise) return;
    sfx('tap');
    const cb = s.hand.currentBet, base = this.pot() + L.toCall;
    this.setTo(q === 'min' ? L.raise.min : q === 'all' ? L.raise.max : cb + (q === 'half' ? Math.round(base / 2) : base));
  }

  private setTo(v: number, snap = false) {
    const L = this.s?.legal;
    if (!L?.raise) return;
    const unit = Math.max(1, this.s!.level.sb);
    if (snap && v < L.raise.max) v = Math.round(v / unit) * unit;
    this.to = Math.max(L.raise.min, Math.min(L.raise.max, Math.round(v)));
    this.$<HTMLInputElement>('#slider').value = String(this.to);
    this.$('#amt').textContent = this.to === L.raise.max ? `${fmt(this.to)} ALL IN` : fmt(this.to);
  }

  private sheet(open: boolean) {
    const L = this.s?.legal;
    if (open && L?.raise) {
      const sl = this.$<HTMLInputElement>('#slider');
      sl.min = String(L.raise.min);
      sl.max = String(L.raise.max);
      this.setTo(L.raise.min);
    }
    this.$('#sheet').classList.toggle('open', open && !!L?.raise);
  }

  update(s: RoomView | null) {
    this.s = s;
    if (!s) return;
    const h = s.hand, L = s.legal;
    const mine = !!(h && L && !h.done && h.toAct === s.seat);
    const bar = this.$('#bar');
    if (mine && !bar.classList.contains('show')) sfx('turn');
    bar.classList.toggle('show', mine);
    if (!mine) this.sheet(false);
    const [fold, call, raise] = [...bar.querySelectorAll('button')];
    if (mine && L) {
      fold.hidden = L.draw;
      raise.hidden = L.draw;
      const n = this.sc.selected.size;
      call.textContent = L.draw ? (n ? `DISCARD ${n}` : 'STAND PAT') : L.check ? 'CHECK' : `CALL ${fmt(L.call)}`;
      const verb = h!.currentBet === 0 ? 'BET' : 'RAISE';
      raise.textContent = L.raise && L.raise.min === L.raise.max ? `${verb} ${fmt(L.raise.min)}` : verb;
      (raise as HTMLButtonElement).disabled = !L.raise;
      this.$('.sheet .amt').firstChild!.textContent = verb === 'BET' ? 'BET ' : 'RAISE TO ';
    }
    const info = this.$('#info');
    let html = '';
    if (s.seat < 0) html = `SPECTATING ${s.seats.some((x) => !x) ? '<button class="btn sm gold" data-a="sit">SIT IN</button>' : ''}`;
    else if (s.canRebuy) html = `BUSTED <button class="btn sm gold" data-a="rebuy">REBUY ${fmt(s.rules.stack)}</button>`;
    else if (mine && L?.draw) html = 'TAP CARDS TO DISCARD';
    else if (h && !h.done && !mine) {
      const me = h.seats[s.seat];
      html = !me ? 'NEXT HAND...' : me.folded ? 'FOLDED' : h.toAct >= 0 ? `${s.seats[h.toAct]?.name ?? ''} TO ACT` : '';
    }
    if (info.innerHTML !== html) info.innerHTML = html;
    info.classList.toggle('show', !!html && (!mine || !!L?.draw));
  }
}
