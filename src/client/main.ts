import './style.css';
import type { RoomView, S2C } from '../shared/protocol.js';
import { Net, type NetStatus } from './net';
import { Scene, W, H } from './scene';
import { Animator } from './anim';
import { Controls } from './controls';
import { Lobby, renderHome } from './lobby';
import { settings, saveSettings } from './settings';
import { unlockAudio, sfx } from './audio';

const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="stage">
    <canvas id="cv"></canvas>
    <div id="hud" class="layer" hidden>
      <div class="top"><button class="btn sm" id="tcode"></button><span id="tlevel"></span>
        <button class="btn sm" id="tset">SET</button><button class="btn sm red" id="tleave">X</button></div>
      <div id="ctl"></div>
    </div>
    <div id="screen" class="layer"></div>
    <div id="modal" class="layer"></div>
    <div id="net"></div>
  </div>
  <div id="wipe"></div><div id="toast"></div><div id="rotate">ROTATE TO PORTRAIT</div>`;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const stage = $('#stage'), cv = $<HTMLCanvasElement>('#cv'), ctx = cv.getContext('2d')!;
const screenEl = $('#screen');

// --- Integer scaling when it fits, best-fit otherwise; canvas backing at scale * min(DPR, 2).
let K = 1;
function fit() {
  const cs = getComputedStyle(app);
  const w = app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = app.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const f = Math.min(w / W, h / H);
  const scale = f >= 1 && Math.floor(f) / f > 0.8 ? Math.floor(f) : f;
  stage.style.width = `${W * scale}px`;
  stage.style.height = `${H * scale}px`;
  document.documentElement.style.setProperty('--s', String(scale));
  K = scale * Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(W * K);
  cv.height = Math.round(H * K);
  ctx.setTransform(K, 0, 0, K, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', fit);
fit();

let tt = 0;
function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg.toUpperCase();
  t.classList.add('show');
  clearTimeout(tt);
  tt = window.setTimeout(() => t.classList.remove('show'), 2200);
}

function wipe(swap: () => void) {
  const w = $('#wipe');
  w.className = 'in';
  setTimeout(() => { swap(); w.className = 'out'; }, 300);
}

// --- Screens
type Scr = 'home' | 'lobby' | 'table';
let screen: Scr | null = null, target: Scr | null = null, pending: (() => void) | null = null;
function show(n: Scr, render?: () => void) {
  if (target === n) {
    if (screen === n) render?.();
    else if (render) pending = render;
    return;
  }
  const first = target === null;
  target = n;
  pending = render ?? null;
  const swap = () => {
    screen = n;
    screenEl.hidden = n === 'table';
    $('#hud').hidden = n !== 'table';
    if (n === 'home') renderHome(screenEl, net, roomParam, openSettings);
    pending?.();
    pending = null;
  };
  first ? swap() : wipe(swap);
}

function openSettings() {
  const m = $('#modal');
  const row = (k: keyof typeof settings, l: string) => `<label class="rule"><span>${l}</span><input type="checkbox" data-s="${k}" ${settings[k] ? 'checked' : ''}></label>`;
  m.innerHTML = `<div class="panel"><h2>SETTINGS</h2>${row('sound', 'SOUND')}${row('reduced', 'REDUCED MOTION')}${row('fourColor', '4-COLOR DECK')}
    <button class="btn gold" id="mclose">DONE</button></div>`;
  m.classList.add('open');
  m.onchange = (e) => {
    const t = e.target as HTMLInputElement;
    settings[t.dataset.s as keyof typeof settings] = t.checked;
    saveSettings();
  };
  m.onclick = (e) => { if (e.target === m || (e.target as HTMLElement).id === 'mclose') { sfx('click'); m.classList.remove('open'); } };
}

function hud(s: RoomView) {
  $('#tcode').textContent = s.code;
  const lv = s.level;
  $('#tlevel').textContent = `#${s.handNo} BLINDS ${lv.sb}/${lv.bb}${lv.ante ? ` ANTE ${lv.ante}` : ''}${s.levelIdx ? ` LV${s.levelIdx + 1}` : ''}`;
}

// --- Wiring
const params = new URLSearchParams(location.search);
const roomParam = (params.get('room') ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const sc = new Scene();
const net = new Net(onMsg, onStatus);
const controls = new Controls($('#ctl'), net, sc, toast);
const lobby = new Lobby(screenEl, net, toast);
const anim = new Animator(sc, (s) => { controls.update(s); hud(s); });

function onMsg(m: S2C) {
  switch (m.t) {
    case 'state':
      anim.push(m.s, m.ev);
      if (m.s.phase === 'lobby') show('lobby', () => lobby.update(m.s));
      else show('table');
      break;
    case 'joined': history.replaceState(null, '', `?room=${m.room}`); break;
    case 'error':
      toast(m.msg);
      if (m.msg === 'Room not found') { net.session = null; show('home'); }
      break;
    case 'left': history.replaceState(null, '', location.pathname); show('home'); break;
  }
}

function onStatus(st: NetStatus) {
  const el = $('#net');
  el.textContent = st === 'online' ? '' : st === 'connecting' ? 'CONNECTING...' : 'OFFLINE - RETRYING';
  el.classList.toggle('show', st !== 'online');
}

$('#tcode').onclick = async () => {
  try { await navigator.clipboard.writeText(`${location.origin}/?room=${sc.s?.code ?? ''}`); toast('Invite link copied'); } catch { /* ignore */ }
};
$('#tset').onclick = () => { sfx('click'); openSettings(); };
$('#tleave').onclick = () => { if (confirm('Leave the table?')) net.send({ t: 'leave' }); };
cv.addEventListener('pointerdown', (e) => {
  const r = cv.getBoundingClientRect();
  sc.hit(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
});
addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('gesturestart', (e) => e.preventDefault());

const sess = net.session;
if (sess && roomParam && sess.room !== roomParam) net.session = null;
show('home');
if (net.session) toast('Rejoining table...');
net.start();

// --- Frame loop: delta time, paused while hidden (rAF stops in background tabs).
let lastT = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (!document.hidden) {
    sc.update(dt);
    if (screen === 'table') { ctx.clearRect(0, 0, W, H); sc.draw(ctx); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.addEventListener('visibilitychange', () => { lastT = performance.now(); });

// Debug hook (?debug): step frames manually when rAF is throttled.
if (params.has('debug')) {
  Object.assign(window, {
    pp: { sc, step: (sec: number) => { for (let t = 0; t < sec; t += 1 / 60) sc.update(1 / 60); ctx.clearRect(0, 0, W, H); sc.draw(ctx); } },
  });
}
