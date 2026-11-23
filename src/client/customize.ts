// Customize screen: avatar builder, card back picker, card face style.
import { decodeAvatar, encodeAvatar, STYLES, SKINS, EXTRAS, avatar, type AvSpec } from './avatars';
import { BACKS, FACES, cardBack, cardFace } from './sprites';
import { profile, saveProfile, settings, saveSettings } from './settings';
import { sfx } from './audio';
import { CARPETS, FELTS, carpetTile } from './table';
import { PAL } from './palette';

function pix(src: HTMLCanvasElement, cls: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.className = cls;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}
export const backCanvas = (b: number, cls = 'cb') => pix(cardBack(b), cls);

const HAIR = [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 3];
const PARTS: { k: keyof AvSpec; l: string; n: number; name: (v: number) => string }[] = [
  { k: 'style', l: 'HEAD', n: STYLES.length, name: (v) => STYLES[v].toUpperCase() },
  { k: 'skin', l: 'SKIN', n: SKINS.length, name: (v) => String(v + 1) },
  { k: 'hair', l: 'COLOR', n: 16, name: (v) => String(HAIR.indexOf(v) + 1) },
  { k: 'shirt', l: 'SHIRT', n: 16, name: (v) => String(v + 1) },
  { k: 'extra', l: 'EXTRA', n: EXTRAS.length, name: (v) => EXTRAS[v] },
];

export function openCustomize(onDone: () => void) {
  const m = document.getElementById('modal')!;
  let a = decodeAvatar(profile.avatar);
  m.innerHTML = `<div class="panel cust">
      <h2>CUSTOMIZE</h2>
      <div class="avbig" id="cav"></div>
      <div id="parts">${PARTS.map((p) => `<div class="part"><button class="btn sm" data-p="${p.k}" data-d="-1">&lt;</button>
        <span>${p.l} <b id="pv-${p.k}"></b></span><button class="btn sm" data-p="${p.k}" data-d="1">&gt;</button></div>`).join('')}</div>
      <button class="btn sm" id="rnd">RANDOM</button>
      <h3>CARD BACK</h3><div class="grid" id="backs"></div>
      <h3>CARD FACE</h3><div class="grid faces" id="faces"></div>
      <h3>CARPET <b id="cname"></b></h3><div class="grid carpets" id="carpets"></div>
      <h3>TABLE FELT <b id="fname"></b></h3><div class="grid felts" id="felts"></div>
      <button class="btn gold" id="cdone">DONE</button>
    </div>`;
  const $ = (id: string) => m.querySelector<HTMLElement>('#' + id)!;
  let blink = false;
  const paint = () => {
    profile.avatar = encodeAvatar(a);
    const box = $('cav');
    box.innerHTML = '';
    box.append(pix(avatar(profile.avatar, blink), 'av'));
    for (const p of PARTS) $('pv-' + p.k).textContent = p.name(a[p.k]);
    m.querySelectorAll<HTMLElement>('#backs canvas').forEach((c, i) => c.classList.toggle('sel', i === profile.back));
    m.querySelectorAll<HTMLElement>('#faces canvas').forEach((c, i) => c.classList.toggle('sel', i === settings.cardFace));
    m.querySelectorAll<HTMLElement>('#carpets canvas').forEach((c, i) => c.classList.toggle('sel', i === settings.carpet));
    m.querySelectorAll<HTMLElement>('#felts button').forEach((c, i) => c.classList.toggle('sel', i === settings.felt));
    $('cname').textContent = CARPETS[settings.carpet]?.name ?? '';
    $('fname').textContent = FELTS[settings.felt]?.name ?? '';
  };
  BACKS.forEach((_, i) => {
    const c = backCanvas(i);
    c.onclick = () => { profile.back = i; sfx('tap'); paint(); };
    $('backs').append(c);
  });
  FACES.forEach((_, i) => {
    const c = pix(cardFace(48 + 3, settings.fourColor, false, i), 'cb');
    c.onclick = () => { settings.cardFace = i; saveSettings(); sfx('tap'); paint(); };
    $('faces').append(c);
  });
  const table = () => { saveSettings(); dispatchEvent(new Event('pp-table')); sfx('tap'); paint(); };
  CARPETS.forEach((_, i) => {
    const t = carpetTile(i), c = document.createElement('canvas');
    c.width = c.height = 32;
    c.className = 'cp';
    const x = c.getContext('2d')!;
    x.fillStyle = x.createPattern(t, 'repeat')!;
    x.fillRect(0, 0, 32, 32);
    c.onclick = () => { settings.carpet = i; table(); };
    $('carpets').append(c);
  });
  FELTS.forEach((f, i) => {
    const b = document.createElement('button');
    b.className = 'felt';
    b.style.background = `radial-gradient(${PAL[f.c[1]]}, ${PAL[f.c[0]]} 60%, ${PAL[f.c[2]]})`;
    b.onclick = () => { settings.felt = i; table(); };
    $('felts').append(b);
  });
  $('parts').onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const p = PARTS.find((x) => x.k === b.dataset.p)!, d = Number(b.dataset.d);
    if (p.k === 'hair') a = { ...a, hair: HAIR[(HAIR.indexOf(a.hair) + d + 16) % 16] };
    else a = { ...a, [p.k]: (a[p.k] + d + p.n) % p.n };
    sfx('tap');
    paint();
  };
  $('rnd').onclick = () => {
    const r = (n: number) => Math.floor(Math.random() * n);
    a = { style: r(STYLES.length), skin: r(SKINS.length), hair: r(16), shirt: r(16), extra: r(3) ? 0 : r(EXTRAS.length) };
    profile.back = r(BACKS.length);
    sfx('chip');
    paint();
  };
  const iv = setInterval(() => { blink = !blink && Math.random() < 0.3; paint(); }, 400);
  const close = () => { clearInterval(iv); saveProfile(); m.classList.remove('open'); m.onclick = null; onDone(); };
  $('cdone').onclick = () => { sfx('click'); close(); };
  m.onclick = (e) => { if (e.target === m) close(); };
  m.onchange = null;
  paint();
  m.classList.add('open');
}
