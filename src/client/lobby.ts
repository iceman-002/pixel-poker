// Home screen (name/avatar/create/join) and lobby (seats, synced rules, presets).
import type { RoomView, RoomSummary } from '../shared/protocol.js';
import { PRESETS, type Rules } from '../shared/rules.js';
import type { Net } from './net';
import { avatar } from './sprites';
import { openCustomize, backCanvas } from './customize';
import { textSprite } from './font';
import { profile, saveProfile, store } from './settings';
import { sfx } from './audio';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function avatarCanvas(i: number, cls = 'av'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  c.className = cls;
  c.getContext('2d')!.drawImage(avatar(i), 0, 0);
  return c;
}

export function renderHome(el: HTMLElement, net: Net, room: string, settings: () => void) {
  el.innerHTML = `
    <div class="home">
      <canvas class="title" width="90" height="16"></canvas>
      <div class="sub">POKER WITH FRIENDS</div>
      <label class="field">NAME<input id="name" maxlength="12" autocomplete="off" placeholder="YOUR NAME"></label>
      <button class="mebtn" id="custom"></button>
      <button class="btn gold big" id="create">CREATE ROOM</button>
      <div class="row join"><input id="code" maxlength="4" placeholder="CODE" autocapitalize="characters" autocomplete="off">
        <button class="btn" id="join">JOIN</button></div>
      <button class="btn sm ghost" id="settings">SETTINGS</button>
      <div class="tables" id="tables"></div>
      <div class="hint" id="a2hs"></div>
    </div>`;
  const t = el.querySelector<HTMLCanvasElement>('.title')!.getContext('2d')!;
  t.imageSmoothingEnabled = false;
  t.drawImage(textSprite('PIXEL', 10, 2), 0, 0, 38, 12);
  t.drawImage(textSprite('POKER', 8, 2), 44, 0, 38, 12);
  const name = el.querySelector<HTMLInputElement>('#name')!;
  const code = el.querySelector<HTMLInputElement>('#code')!;
  name.value = profile.name;
  code.value = room;
  const cb = el.querySelector<HTMLButtonElement>('#custom')!;
  const paint = () => { cb.innerHTML = ''; cb.append(avatarCanvas(profile.avatar, 'av sel'), backCanvas(profile.back)); cb.insertAdjacentHTML('beforeend', '<span>CUSTOMIZE</span>'); };
  paint();
  cb.onclick = () => { sfx('click'); openCustomize(paint); };
  const ok = () => {
    profile.name = name.value.trim().slice(0, 12) || 'Player';
    saveProfile();
    sfx('click');
    return { name: profile.name, avatar: profile.avatar, back: profile.back };
  };
  el.querySelector<HTMLButtonElement>('#create')!.onclick = () => net.send({ t: 'create', ...ok() });
  const join = () => { const r = code.value.trim().toUpperCase(); if (r.length === 4) net.send({ t: 'join', room: r, ...ok() }); else code.focus(); };
  el.querySelector<HTMLButtonElement>('#join')!.onclick = join;
  code.onkeydown = (e) => { if (e.key === 'Enter') join(); };
  el.querySelector<HTMLButtonElement>('#settings')!.onclick = settings;
  if (room) el.querySelector('#create')!.classList.remove('gold');
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone;
  if (ios && !standalone) el.querySelector('#a2hs')!.innerHTML = 'INSTALL: TAP <b>SHARE</b> THEN <b>ADD TO HOME SCREEN</b>';
}

const VNAMES: Record<string, string> = { floor: 'FLOOR DEAL', holdem: "HOLD'EM", omaha: 'OMAHA', draw: '5-DRAW', short: 'SHORT DECK' };
/** OPEN TABLES list on the home screen. */
export function showRooms(el: HTMLElement, rooms: RoomSummary[], join: (code: string) => void) {
  const box = el.querySelector<HTMLElement>('#tables');
  if (!box) return;
  box.innerHTML = rooms.length
    ? '<h3>OPEN TABLES</h3>' + rooms.map((r) => `<button class="table-row" data-code="${r.code}"><b>${r.code}</b><span>${VNAMES[r.variant] ?? ''}<br><small>${esc(r.host)} · ${r.players}/8${r.playing ? ' · PLAYING' : ''}</small></span><i>JOIN</i></button>`).join('')
    : '<h3>OPEN TABLES</h3><p class="hint">NO OPEN TABLES RIGHT NOW</p>';
  box.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-code]');
    if (b) { sfx('click'); join(b.dataset.code!); }
  };
}

type Field = { k: keyof Rules; l: string; o?: [string, string][]; n?: boolean; b?: boolean; show?: (r: Rules) => boolean };
const poker = (r: Rules) => r.variant !== 'floor';
const FIELDS: Field[] = [
  { k: 'variant', l: 'GAME', o: [['floor', 'FLOOR DEAL'], ['holdem', "HOLD'EM"], ['omaha', 'OMAHA'], ['draw', '5-CARD DRAW'], ['short', 'SHORT DECK']] },
  { k: 'betting', l: 'LIMIT', o: [['nl', 'NO-LIMIT'], ['pl', 'POT-LIMIT'], ['fl', 'FIXED']], show: poker },
  { k: 'stack', l: 'STACK', n: true },
  { k: 'goal', l: 'WIN AT (0 = LAST ONE LEFT)', n: true, show: (r) => !poker(r) },
  { k: 'sb', l: 'SMALL BLIND', n: true, show: poker },
  { k: 'bb', l: 'BIG BLIND', n: true, show: poker },
  { k: 'ante', l: 'ANTE', n: true, show: poker },
  { k: 'straddle', l: 'STRADDLE', b: true, show: poker },
  { k: 'blindMode', l: 'BLINDS', o: [['static', 'STATIC'], ['hands', 'RISE BY HANDS'], ['minutes', 'RISE BY MINS']], show: poker },
  { k: 'blindEvery', l: 'RISE EVERY', n: true, show: (r) => poker(r) && r.blindMode !== 'static' },
  { k: 'rebuys', l: 'REBUYS', b: true, show: poker },
  { k: 'maxRebuys', l: 'MAX REBUYS', n: true, show: (r) => poker(r) && r.rebuys },
  { k: 'runItTwice', l: 'RUN IT TWICE', b: true, show: poker },
  { k: 'bombEvery', l: 'BOMB POT EVERY', n: true, show: poker },
  { k: 'wild', l: 'WILD CARDS', o: [['none', 'NONE'], ['jokers', 'JOKERS'], ['deuces', 'DEUCES']], show: poker },
  { k: 'listed', l: 'PUBLIC ROOM', b: true },
  { k: 'timer', l: 'ACTION TIMER', o: [['0', 'OFF'], ['15', '15 SEC'], ['30', '30 SEC'], ['60', '60 SEC']] },
];

const customPresets = (): Record<string, Rules> => { try { return JSON.parse(localStorage.getItem('pp.presets') ?? '{}'); } catch { return {}; } };

export class Lobby {
  private built = false;
  private s: RoomView | null = null;
  constructor(private el: HTMLElement, private net: Net, private toast: (m: string) => void) {}

  private build() {
    this.el.innerHTML = `
      <div class="lobby">
        <div class="hdr"><div class="code">ROOM <b id="lcode"></b></div><button class="btn sm" id="me">ME</button>
          <button class="btn sm gold" id="share">INVITE</button><button class="btn sm red" id="leave">LEAVE</button></div>
        <div class="seats" id="lseats"></div>
        <button class="btn sm" id="addbot">+ ADD BOT</button>
        <div class="presets" id="presets"></div>
        <div class="rules" id="rules">${FIELDS.map((f) => `<label class="rule" data-row="${f.k}"><span>${f.l}</span>${
          f.o ? `<select data-k="${f.k}">${f.o.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`
          : f.b ? `<input type="checkbox" data-k="${f.k}">` : `<input type="number" inputmode="numeric" min="0" data-k="${f.k}">`}</label>`).join('')}
        </div>
        <div class="foot"><button class="btn" id="ready">READY</button><button class="btn gold" id="start">START</button></div>
        <div class="msg" id="lmsg"></div>
      </div>`;
    const $ = (id: string) => this.el.querySelector<HTMLElement>('#' + id)!;
    $('leave').onclick = () => this.net.send({ t: 'leave' });
    $('share').onclick = () => this.share();
    $('me').onclick = () => { sfx('click'); openCustomize(() => this.net.send({ t: 'profile', name: profile.name || 'Player', avatar: profile.avatar, back: profile.back })); };
    $('ready').onclick = () => { sfx('click'); this.net.send({ t: 'ready', ready: !this.meSeat()?.ready }); };
    $('start').onclick = () => { sfx('click'); this.net.send({ t: 'start' }); };
    $('addbot').onclick = () => { sfx('click'); this.net.send({ t: 'addbot' }); };
    $('rules').addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement, k = t.dataset.k as keyof Rules;
      if (!k) return;
      const v = t.type === 'checkbox' ? t.checked : t.type === 'number' || k === 'timer' ? Number(t.value) : t.value;
      this.net.send({ t: 'rules', rules: { [k]: v } });
    });
    $('presets').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || !this.s) return;
      sfx('click');
      if (b.dataset.save !== undefined) {
        const name = prompt('Preset name?')?.trim().slice(0, 12);
        if (name) { store('pp.presets', { ...customPresets(), [name]: this.s.rules }); this.renderPresets(true); this.toast('Preset saved'); }
        return;
      }
      const p = PRESETS[b.dataset.p!] ?? customPresets()[b.dataset.p!];
      if (p) this.net.send({ t: 'rules', rules: p });
    });
    this.built = true;
  }

  private meSeat() { return this.s && this.s.seat >= 0 ? this.s.seats[this.s.seat] : null; }

  private async share() {
    if (!this.s) return;
    const url = `${location.origin}/?room=${this.s.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Pixel Poker', text: `Join my poker table! Code ${this.s.code}`, url });
      else { await navigator.clipboard.writeText(url); this.toast('Link copied'); }
    } catch { /* cancelled */ }
  }

  private renderPresets(host: boolean) {
    const names = [...Object.keys(PRESETS), ...Object.keys(customPresets())];
    this.el.querySelector('#presets')!.innerHTML = host
      ? names.map((n) => `<button class="btn sm" data-p="${esc(n)}">${esc(n.toUpperCase())}</button>`).join('') + '<button class="btn sm ghost" data-save>+ SAVE</button>'
      : '';
  }

  update(s: RoomView) {
    if (!this.built || !this.el.querySelector('.lobby')) this.build();
    const host = s.host === s.you;
    const first = !this.s;
    this.s = s;
    this.el.querySelector('#lcode')!.textContent = s.code;
    const seats = this.el.querySelector('#lseats')!;
    seats.innerHTML = '';
    s.seats.forEach((sv, i) => {
      const b = document.createElement('button');
      b.className = 'seat' + (sv ? ' taken' : '') + (i === s.seat ? ' me' : '') + (sv?.ready ? ' ready' : '');
      if (sv) {
        b.appendChild(avatarCanvas(sv.avatar));
        b.insertAdjacentHTML('beforeend', `<span>${esc(sv.name)}</span><small>${sv.bot ? (host ? 'BOT · TAP X' : 'BOT') : sv.id === s.host ? 'HOST' : sv.ready ? 'READY' : sv.connected ? '' : 'AWAY'}</small>`);
      } else b.innerHTML = '<span class="empty">SIT</span>';
      b.onclick = () => {
        sfx('tap');
        if (!sv) this.net.send({ t: 'sit', seat: i });
        else if (i === s.seat) this.net.send({ t: 'stand' });
        else if (sv.bot && host) this.net.send({ t: 'kick', id: sv.id });
      };
      seats.appendChild(b);
    });
    if (first || host !== this.el.querySelector('#presets')!.hasChildNodes()) this.renderPresets(host);
    for (const f of FIELDS) {
      const inp = this.el.querySelector<HTMLInputElement>(`[data-k="${f.k}"]`)!;
      inp.disabled = !host;
      if (document.activeElement !== inp) {
        if (f.b) inp.checked = !!s.rules[f.k];
        else inp.value = String(s.rules[f.k]);
      }
      this.el.querySelector<HTMLElement>(`[data-row="${f.k}"]`)!.hidden = !!f.show && !f.show(s.rules);
    }
    this.el.querySelector('[data-row="stack"] span')!.textContent = poker(s.rules) ? 'STACK' : 'STARTING MONEY';
    this.el.querySelector('[data-row="blindEvery"] span')!.textContent = s.rules.blindMode === 'minutes' ? 'RISE EVERY (MIN)' : 'RISE EVERY (HANDS)';
    const seated = s.seats.filter(Boolean).length;
    this.el.querySelector<HTMLElement>('#addbot')!.hidden = !host || seated >= 8;
    const startBtn = this.el.querySelector<HTMLButtonElement>('#start')!;
    startBtn.hidden = !host;
    startBtn.disabled = seated < 2;
    const ready = this.el.querySelector<HTMLButtonElement>('#ready')!;
    ready.hidden = s.seat < 0;
    ready.textContent = this.meSeat()?.ready ? 'NOT READY' : 'READY';
    const win = s.winner ? `${s.winner.toUpperCase()} WON THE LAST GAME! ` : '';
    this.el.querySelector('#lmsg')!.textContent = win + (s.seat < 0 ? 'TAP A SEAT TO SIT' : seated < 2 ? 'WAITING FOR PLAYERS...' : host ? 'START WHEN READY' : 'WAITING FOR HOST...');
  }
}
