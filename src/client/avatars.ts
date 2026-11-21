// Procedural 16x16 avatars: 8 presets plus a builder encoded in one integer.
import { PAL, mkCanvas } from './palette';
import { AVATARS, AVATAR_CUSTOM } from '../shared/protocol.js';

export const STYLES = ['spiky', 'flat', 'cowboy', 'beanie', 'crown', 'long', 'robot', 'cat', 'bald', 'cap', 'mohawk', 'bob'] as const;
export type Style = (typeof STYLES)[number];
export const SKINS = [15, 9, 4, 2, 6, 14, 11, 12];
export const EXTRAS = ['NONE', 'SHADES', 'BEARD', 'MUSTACHE', 'MONOCLE', 'BLUSH'] as const;
export interface AvSpec { skin: number; style: number; hair: number; shirt: number; extra: number }

const PRESETS: AvSpec[] = [
  { skin: 0, style: 0, hair: 4, shirt: 8, extra: 0 },
  { skin: 0, style: 1, hair: 5, shirt: 12, extra: 1 },
  { skin: 1, style: 2, hair: 4, shirt: 3, extra: 2 },
  { skin: 2, style: 3, hair: 11, shirt: 2, extra: 0 },
  { skin: 0, style: 4, hair: 10, shirt: 13, extra: 0 },
  { skin: 0, style: 5, hair: 14, shirt: 1, extra: 5 },
  { skin: 4, style: 6, hair: 5, shirt: 5, extra: 0 },
  { skin: 1, style: 7, hair: 9, shirt: 14, extra: 0 },
];

export function decodeAvatar(code: number): AvSpec {
  if (code < AVATAR_CUSTOM) return PRESETS[((code % AVATARS) + AVATARS) % AVATARS];
  const v = code - AVATAR_CUSTOM;
  return { skin: v & 7, style: ((v >> 3) & 15) % STYLES.length, hair: (v >> 7) & 15, shirt: (v >> 11) & 15, extra: ((v >> 15) & 7) % EXTRAS.length };
}
export const encodeAvatar = (a: AvSpec) => AVATAR_CUSTOM + a.skin + (a.style << 3) + (a.hair << 7) + (a.shirt << 11) + (a.extra << 15);

function gen(a: AvSpec, blink: boolean): HTMLCanvasElement {
  const skin = SKINS[a.skin], h = a.hair, style: Style = STYLES[a.style];
  const g: number[][] = Array.from({ length: 16 }, () => Array(16).fill(-1));
  const set = (x: number, y: number, c: number) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c; };
  const rect = (x: number, y: number, w: number, hh: number, c: number) => {
    for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + w; xx++) set(xx, yy, c);
  };
  rect(3, 13, 10, 3, a.shirt); rect(4, 12, 8, 1, a.shirt); rect(6, 11, 4, 1, skin);
  rect(4, 3, 8, 8, skin);
  const robot = style === 'robot';
  if (!robot) { set(4, 3, -1); set(11, 3, -1); set(4, 10, -1); set(11, 10, -1); set(3, 6, skin); set(12, 6, skin); }
  const eye = robot ? 8 : 1, ew = robot ? 2 : 1, ex = robot ? [5, 9] : [6, 9];
  for (const x of ex) blink ? rect(x, 7, ew, 1, eye) : rect(x, 6, ew, 2, eye);
  if (robot) rect(6, 9, 4, 1, 5); else rect(7, 9, 2, 1, 2);
  switch (style) {
    case 'spiky': rect(4, 2, 8, 2, h); set(5, 1, h); set(7, 1, h); set(9, 1, h); set(4, 4, h); set(11, 4, h); break;
    case 'flat': rect(4, 2, 8, 2, h); set(4, 4, h); set(11, 4, h); break;
    case 'cowboy': rect(5, 0, 6, 3, h); rect(5, 2, 6, 1, 8); rect(1, 3, 14, 1, h); break;
    case 'beanie': rect(4, 1, 8, 3, h); rect(4, 4, 8, 1, 7); set(7, 0, 7); set(8, 0, 7); break;
    case 'crown': set(4, 1, 10); rect(7, 1, 2, 1, 10); set(11, 1, 10); rect(4, 2, 8, 2, 10); set(6, 3, 8); set(9, 3, 12); break;
    case 'long': rect(4, 2, 8, 2, h); rect(3, 3, 2, 9, h); rect(11, 3, 2, 9, h); break;
    case 'robot': set(8, 0, 8); set(8, 1, 5); set(8, 2, 5); rect(4, 3, 8, 1, 5); break;
    case 'cat': rect(4, 1, 2, 2, skin); rect(10, 1, 2, 2, skin); set(5, 2, 14); set(10, 2, 14); set(7, 8, 14); break;
    case 'bald': set(9, 4, 7); break;
    case 'cap': rect(4, 2, 8, 2, h); rect(8, 4, 6, 1, h); set(6, 2, 7); break;
    case 'mohawk': rect(7, 0, 2, 4, h); break;
    case 'bob': rect(3, 2, 10, 3, h); rect(3, 5, 2, 5, h); rect(11, 5, 2, 5, h); break;
  }
  switch (EXTRAS[a.extra]) {
    case 'SHADES': rect(5, 6, 2, 2, 0); rect(9, 6, 2, 2, 0); rect(7, 6, 2, 1, 0); set(5, 6, 6); set(9, 6, 6); break;
    case 'BEARD': rect(4, 9, 8, 2, h); rect(5, 11, 6, 1, h); rect(7, 9, 2, 1, 2); break;
    case 'MUSTACHE': rect(6, 8, 4, 1, h); break;
    case 'MONOCLE': rect(8, 5, 3, 1, 10); set(8, 6, 10); set(10, 6, 10); rect(8, 7, 3, 1, 10); set(10, 8, 10); break;
    case 'BLUSH': set(5, 8, 14); set(10, 8, 14); break;
  }
  const c = mkCanvas(16, 16);
  const x = c.getContext('2d')!;
  for (let y = 0; y < 16; y++) for (let xx = 0; xx < 16; xx++) {
    let col = g[y][xx];
    if (col < 0) {
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (g[y + dy]?.[xx + dx] ?? -1) >= 0)) continue;
      col = 0;
    }
    x.fillStyle = PAL[col];
    x.fillRect(xx, y, 1, 1);
  }
  return c;
}

const cache = new Map<string, HTMLCanvasElement>();
export function avatar(code: number, blink = false): HTMLCanvasElement {
  const k = code + (blink ? 'b' : '');
  let c = cache.get(k);
  if (!c) { c = gen(decodeAvatar(code), blink); cache.set(k, c); }
  return c;
}
