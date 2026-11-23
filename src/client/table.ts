// Table background: casino carpet around a stadium table with a wooden rail and coloured felt.
import { RGB, mkCanvas } from './palette';
import { textSprite } from './font';

const md = (n: number, p: number) => ((n % p) + p) % p;
const hash = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; };
/** Woven texture: a few darker pixels scattered over the base colour. */
const weave = (x: number, y: number, base: number, dark: number, p: number) => (hash(md(x, p), md(y, p)) % 7 === 0 ? dark : base);

export interface Carpet { name: string; p: number; f: (x: number, y: number) => number }
export const CARPETS: Carpet[] = [
  { name: 'CASINO RED', p: 16, f: (x, y) => {
    const lx = md(x, 16), ly = md(y, 16);
    if (lx === ly || lx === 15 - ly) return 33;
    const s = Math.min(Math.abs(lx - 8) + Math.min(ly, 16 - ly), Math.min(lx, 16 - lx) + Math.abs(ly - 8));
    return s <= 1 ? 12 : s === 2 ? 33 : weave(x, y, 31, 32, 16);
  } },
  { name: 'ROYAL BLUE', p: 16, f: (x, y) => {
    const lx = md(x, 16), ly = md(y, 16), r = Math.hypot(lx - 7.5, ly - 7.5);
    if (r > 5.4 && r < 6.5) return 33;
    if (r < 1.8) return 8;
    if (r < 2.9) return 10;
    if ((lx === 0 || ly === 0) && Math.min(lx, 16 - lx) + Math.min(ly, 16 - ly) < 3) return 12;
    return weave(x, y, 34, 35, 16);
  } },
  { name: 'VEGAS NIGHT', p: 24, f: (x, y) => {
    const cx = Math.floor(md(x, 24) / 6), cy = Math.floor(md(y, 24) / 6), h = hash(cx + 7, cy + 3);
    const lx = md(x, 6) - 1 - ((h >> 5) % 2), ly = md(y, 6) - 1 - ((h >> 7) % 2), col = [8, 12, 10, 11, 14][h % 5];
    if (h % 3 !== 0) {
      const shape = (h >> 3) % 3;
      if (shape === 0 && lx >= 0 && lx < 2 && ly >= 0 && ly < 2) return col;
      if (shape === 1 && ((lx === 1 && ly >= 0 && ly < 3) || (ly === 1 && lx >= 0 && lx < 3))) return col;
      if (shape === 2 && lx === ly && lx >= 0 && lx < 3) return col;
    }
    return weave(x, y, 40, 41, 24);
  } },
  { name: 'EMERALD', p: 12, f: (x, y) => {
    const lx = md(x, 12), ly = md(y, 12);
    if (lx === 0 || ly === 0) return (lx + ly) % 2 ? 33 : 9;
    const s = Math.abs(lx - 6) + Math.abs(ly - 6);
    return s === 0 ? 10 : s <= 1 ? 11 : s === 2 ? 3 : weave(x, y, 36, 37, 12);
  } },
  { name: 'VELVET', p: 16, f: (x, y) => {
    const lx = md(x, 16), ly = md(y, 16);
    for (const [cx, cy] of [[4, 4], [12, 12]]) {
      const dx = Math.abs(lx - cx), dy = Math.abs(ly - cy);
      if (dx === 0 && dy === 0) return 7;
      if ((dx === 0 && dy <= 2) || (dy === 0 && dx <= 2)) return 14;
    }
    return weave(x, y, 38, 39, 16);
  } },
];
/** Felt colour sets: base, highlight, shadow. */
export const FELTS: { name: string; c: [number, number, number] }[] = [
  { name: 'GREEN', c: [16, 17, 18] }, { name: 'BLUE', c: [19, 20, 21] }, { name: 'RED', c: [22, 23, 24] },
  { name: 'PURPLE', c: [25, 26, 27] }, { name: 'BLACK', c: [28, 29, 30] },
];
const carpetOf = (i: number) => CARPETS[md(i, CARPETS.length)];

/** One repeating carpet tile (used for the margins around the scene and the menu backgrounds). */
const tiles = new Map<number, HTMLCanvasElement>();
export function carpetTile(i: number): HTMLCanvasElement {
  const key = md(i, CARPETS.length);
  let c = tiles.get(key);
  if (c) return c;
  const cp = carpetOf(key);
  c = mkCanvas(cp.p, cp.p);
  const x = c.getContext('2d')!, img = x.createImageData(cp.p, cp.p);
  for (let y = 0; y < cp.p; y++) for (let xx = 0; xx < cp.p; xx++) {
    const o = (y * cp.p + xx) * 4, [r, g, b] = RGB[cp.f(xx, y)];
    img.data.set([r, g, b, 255], o);
  }
  x.putImageData(img, 0, 0);
  tiles.set(key, c);
  return c;
}

/** Point the menu screens' CSS background at the chosen carpet. */
export function applyCarpetCss(i: number) {
  const t = carpetTile(i), root = document.documentElement.style;
  root.setProperty('--carpet', `url(${t.toDataURL()})`);
  root.setProperty('--carpet-size', `calc(var(--u) * ${t.width})`);
}

export function buildTable(W: number, H: number, carpet = 0, felt = 0): HTMLCanvasElement {
  const c = mkCanvas(W, H);
  const x = c.getContext('2d')!;
  const img = x.createImageData(W, H);
  const cp = carpetOf(carpet), [F, FHI, FLO] = FELTS[md(felt, FELTS.length)].c;
  const cx = 97.5, top = 123.5, bot = 212.5;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const dy = py + 0.5 < top ? py + 0.5 - top : py + 0.5 > bot ? py + 0.5 - bot : 0;
    const d = Math.hypot(px + 0.5 - cx, dy);
    let k: number;
    if (d > 90) k = cp.f(px, py);
    else if (d > 88) k = 0; // shadow under the rail
    else if (d > 87) k = 0;
    else if (d > 82) k = (d > 85.5 && py < 180) || ((px * 7 + py * 3) % 23 === 0) ? 9 : 4;
    else if (d > 81) k = 2;
    else if (d > 78) k = FLO;
    else if (d > 74 && d <= 75) k = (px + py) % 3 ? FLO : F;
    else k = ((px * 73856093) ^ (py * 19349663)) % 11 === 0 ? FHI : F;
    const o = (py * W + px) * 4, [r, g, b] = RGB[k];
    img.data.set([r, g, b, 255], o);
  }
  x.putImageData(img, 0, 0);
  x.globalAlpha = 0.5;
  x.drawImage(textSprite('PIXEL POKER', FHI), Math.round(cx - 21), 224);
  x.globalAlpha = 1;
  return c;
}
