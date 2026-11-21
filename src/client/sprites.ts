// All pixel art, generated in code from palette-indexed rows.
import { PAL, RGB, mkCanvas, FELT, FELT_HI, FELT_LO } from './palette';
import { textSprite } from './font';
import { rankOf, suitOf, isJoker } from '../shared/cards.js';

export function fromRows(rows: string[], map: Record<string, number>): HTMLCanvasElement {
  const c = mkCanvas(rows[0].length, rows.length);
  const x = c.getContext('2d')!;
  rows.forEach((r, y) => [...r].forEach((ch, i) => {
    const k = map[ch];
    if (k === undefined) return;
    x.fillStyle = PAL[k];
    x.fillRect(i, y, 1, 1);
  }));
  return c;
}

const SUIT7 = [
  ['...#...', '..###..', '.#####.', '#######', '##.#.##', '...#...', '..###..'],
  ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
  ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'],
  ['..###..', '..###..', '##.#.##', '#######', '##.#.##', '...#...', '..###..'],
];
const SUIT5 = [
  ['..#..', '.###.', '#####', '..#..', '.###.'],
  ['##.##', '#####', '#####', '.###.', '..#..'],
  ['..#..', '.###.', '#####', '.###.', '..#..'],
  ['..#..', '.###.', '#.#.#', '#####', '..#..'],
];
const STAR = ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '##...##'];
const RANKS = ['', '', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const suitColor = (s: number, four: boolean) => (four ? [0, 8, 12, 3] : [0, 8, 8, 0])[s];

function cardBody(w: number, h: number) {
  const c = mkCanvas(w, h);
  const x = c.getContext('2d')!;
  x.fillStyle = PAL[7];
  x.fillRect(1, 0, w - 2, h);
  x.fillRect(0, 1, w, h - 2);
  x.fillStyle = PAL[6];
  x.fillRect(1, h - 1, w - 2, 1);
  x.fillRect(w - 1, 1, 1, h - 2);
  return { c, x };
}

const faces = new Map<string, HTMLCanvasElement>();
export function cardFace(card: number, four: boolean): HTMLCanvasElement {
  const key = card + (four ? 'f' : 'n');
  const hit = faces.get(key);
  if (hit) return hit;
  const { c, x } = cardBody(15, 21);
  if (isJoker(card)) {
    x.drawImage(textSprite('JK', 2), 2, 2);
    x.drawImage(fromRows(STAR, { '#': 14 }), 4, 11);
  } else {
    const s = suitOf(card), col = suitColor(s, four);
    x.drawImage(textSprite(RANKS[rankOf(card)], col), 2, 2);
    x.drawImage(fromRows(SUIT5[s], { '#': col }), 2, 8);
    x.drawImage(fromRows(SUIT7[s], { '#': col }), 7, 13);
  }
  faces.set(key, c);
  return c;
}

function back(w: number, h: number) {
  const { c, x } = cardBody(w, h);
  for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) {
    const edge = xx === 1 || yy === 1 || xx === w - 2 || yy === h - 2;
    x.fillStyle = PAL[edge ? 8 : (xx + yy) % 4 === 0 || (xx - yy + 400) % 4 === 0 ? 14 : 2];
    x.fillRect(xx, yy, 1, 1);
  }
  return c;
}
export const CARD_BACK = back(15, 21);
export const MINI_BACK = back(9, 13);

// Chips: denomination, face colour, edge colour.
export const DENOMS: [number, number, number][] = [[1000, 10, 9], [500, 13, 2], [100, 0, 5], [25, 11, 3], [5, 8, 2], [1, 7, 6]];
const CHIP_ROWS = ['.ccccc.', 'cwcwcwc', 'dcccccd', '.ddddd.'];
const CHIPS = DENOMS.map(([, c, d]) => fromRows(CHIP_ROWS, { c, w: c === 7 ? 12 : 7, d }));

export function drawChips(ctx: CanvasRenderingContext2D, x: number, y: number, amt: number, max = 10) {
  const list: number[] = [];
  let a = Math.max(0, Math.round(amt));
  for (let i = 0; i < DENOMS.length && list.length < max; i++) {
    while (a >= DENOMS[i][0] && list.length < max) { list.push(i); a -= DENOMS[i][0]; }
  }
  if (!list.length && amt > 0) list.push(DENOMS.length - 1);
  list.forEach((k, j) => ctx.drawImage(CHIPS[k], Math.round(x - 3), Math.round(y - 4 - j * 2)));
}

export const DEALER = (() => {
  const c = fromRows(['..777..', '.77777.', '7777777', '7777777', '7777777', '.67776.', '..666..'], { '7': 7, '6': 6 });
  c.getContext('2d')!.drawImage(textSprite('D', 0), 2, 1);
  return c;
})();

export const LAMP = fromRows([
  '......5......', '......5......', '....33333....', '...3333333...',
  '..333333333..', '.33333333333.', '3333333333333', '...aaaaaaa...',
], { '5': 5, '3': 3, a: 10 });

// --- Avatars: 8 procedurally composed characters, 16x16, with blink frames.
type Style = 'spiky' | 'flat' | 'cowboy' | 'beanie' | 'crown' | 'long' | 'robot' | 'cat';
const AV: { skin: number; hair: number; shirt: number; style: Style; glasses?: boolean; beard?: boolean }[] = [
  { skin: 15, hair: 4, shirt: 8, style: 'spiky' },
  { skin: 15, hair: 5, shirt: 12, style: 'flat', glasses: true },
  { skin: 9, hair: 4, shirt: 3, style: 'cowboy', beard: true },
  { skin: 4, hair: 11, shirt: 2, style: 'beanie' },
  { skin: 15, hair: 10, shirt: 13, style: 'crown' },
  { skin: 15, hair: 14, shirt: 1, style: 'long' },
  { skin: 6, hair: 5, shirt: 5, style: 'robot' },
  { skin: 9, hair: 9, shirt: 14, style: 'cat' },
];
export const AVATAR_COUNT = AV.length;

function genAvatar(i: number, blink: boolean): HTMLCanvasElement {
  const a = AV[i % AV.length];
  const g: number[][] = Array.from({ length: 16 }, () => Array(16).fill(-1));
  const set = (x: number, y: number, c: number) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c; };
  const rect = (x: number, y: number, w: number, h: number, c: number) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(xx, yy, c);
  };
  rect(3, 13, 10, 3, a.shirt); rect(4, 12, 8, 1, a.shirt); rect(6, 11, 4, 1, a.skin);
  rect(4, 3, 8, 8, a.skin);
  if (a.style !== 'robot') { set(4, 3, -1); set(11, 3, -1); set(4, 10, -1); set(11, 10, -1); set(3, 6, a.skin); set(12, 6, a.skin); }
  const robot = a.style === 'robot';
  const eye = robot ? 8 : 1;
  const ew = robot ? 2 : 1, ex = robot ? [5, 9] : [6, 9];
  for (const x of ex) blink ? rect(x, 7, ew, 1, eye) : rect(x, 6, ew, 2, eye);
  if (robot) rect(6, 9, 4, 1, 5); else rect(7, 9, 2, 1, 2);
  const h = a.hair;
  switch (a.style) {
    case 'spiky': rect(4, 2, 8, 2, h); set(5, 1, h); set(7, 1, h); set(9, 1, h); set(4, 4, h); set(11, 4, h); break;
    case 'flat': rect(4, 2, 8, 2, h); set(4, 4, h); set(11, 4, h); break;
    case 'cowboy': rect(5, 0, 6, 3, h); rect(5, 2, 6, 1, 8); rect(1, 3, 14, 1, h); break;
    case 'beanie': rect(4, 1, 8, 3, h); rect(4, 4, 8, 1, 7); set(7, 0, 7); set(8, 0, 7); break;
    case 'crown': set(4, 1, 10); rect(7, 1, 2, 1, 10); set(11, 1, 10); rect(4, 2, 8, 2, 10); set(6, 3, 8); set(9, 3, 12); break;
    case 'long': rect(4, 2, 8, 2, h); rect(3, 3, 2, 9, h); rect(11, 3, 2, 9, h); break;
    case 'robot': set(8, 0, 8); set(8, 1, 5); set(8, 2, 5); rect(4, 3, 8, 1, 5); break;
    case 'cat': rect(4, 1, 2, 2, a.skin); rect(10, 1, 2, 2, a.skin); set(5, 2, 14); set(10, 2, 14); set(7, 8, 14); break;
  }
  if (a.glasses) { rect(5, 6, 2, 2, 0); rect(9, 6, 2, 2, 0); rect(7, 6, 2, 1, 0); set(5, 6, 6); set(9, 6, 6); }
  if (a.beard) { rect(4, 9, 8, 2, h); rect(5, 11, 6, 1, h); rect(7, 9, 2, 1, 2); }
  const c = mkCanvas(16, 16);
  const x = c.getContext('2d')!;
  for (let y = 0; y < 16; y++) for (let xx = 0; xx < 16; xx++) {
    let col = g[y][xx];
    if (col < 0) {
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (g[y + dy]?.[xx + dx] ?? -1) >= 0);
      if (!n) continue;
      col = 0;
    }
    x.fillStyle = PAL[col];
    x.fillRect(xx, y, 1, 1);
  }
  return c;
}
const AVATARS = AV.map((_, i) => [genAvatar(i, false), genAvatar(i, true)]);
export const avatar = (i: number, blink = false) => AVATARS[((i % AV.length) + AV.length) % AV.length][blink ? 1 : 0];

// --- Static table background: dithered backdrop, stadium table with rail, felt noise.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function buildTable(W: number, H: number): HTMLCanvasElement {
  const c = mkCanvas(W, H);
  const x = c.getContext('2d')!;
  const img = x.createImageData(W, H);
  const put = (px: number, py: number, k: number) => {
    const o = (py * W + px) * 4, [r, g, b] = RGB[k];
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
  };
  const cx = 97.5, top = 123.5, bot = 212.5;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const dy = py + 0.5 < top ? py + 0.5 - top : py + 0.5 > bot ? py + 0.5 - bot : 0;
    const d = Math.hypot(px + 0.5 - cx, dy);
    let k: number;
    if (d > 88) k = BAYER[(py % 4) * 4 + (px % 4)] / 16 < 0.25 + (py / H) * 0.35 ? 1 : 0;
    else if (d > 87) k = 0;
    else if (d > 82) k = (d > 85.5 && py < 180) || ((px * 7 + py * 3) % 23 === 0) ? 9 : 4;
    else if (d > 81) k = 2;
    else if (d > 78) k = FELT_LO;
    else if (d > 74 && d <= 75) k = (px + py) % 3 ? FELT_LO : FELT;
    else k = ((px * 73856093) ^ (py * 19349663)) % 11 === 0 ? FELT_HI : FELT;
    put(px, py, k);
  }
  x.putImageData(img, 0, 0);
  x.globalAlpha = 0.5;
  x.drawImage(textSprite('PIXEL POKER', FELT_HI), Math.round(cx - 21), 224);
  x.globalAlpha = 1;
  return c;
}
