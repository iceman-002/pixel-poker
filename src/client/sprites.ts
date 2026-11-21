// All pixel art, generated in code from palette-indexed rows.
import { PAL, RGB, mkCanvas, FELT, FELT_HI, FELT_LO } from './palette';
import { textSprite } from './font';
import { rankOf, suitOf, isJoker } from '../shared/cards.js';
export { avatar } from './avatars';
export const AVATAR_COUNT = 8;

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
/** Card face styles: body, edge shade, and whether dark ink becomes light. */
export const FACES = [{ name: 'CLASSIC', body: 7, edge: 6, night: false }, { name: 'CREAM', body: 15, edge: 9, night: false }, { name: 'NIGHT', body: 1, edge: 0, night: true }];
export function suitColor(s: number, four: boolean, night = false) {
  const c = (four ? [0, 8, 12, 3] : [0, 8, 8, 0])[s];
  return night ? ({ 0: 7, 3: 11 } as Record<number, number>)[c] ?? c : c;
}

function cardBody(w: number, h: number, face = 0) {
  const c = mkCanvas(w, h);
  const x = c.getContext('2d')!;
  const st = FACES[face] ?? FACES[0];
  x.fillStyle = PAL[st.body];
  x.fillRect(1, 0, w - 2, h);
  x.fillRect(0, 1, w, h - 2);
  x.fillStyle = PAL[st.edge];
  x.fillRect(1, h - 1, w - 2, 1);
  x.fillRect(w - 1, 1, 1, h - 2);
  return { c, x };
}

const WILD_STAR = ['..#..', '.###.', '#####', '.###.', '.#.#.'];
const faces = new Map<string, HTMLCanvasElement>();
export function cardFace(card: number, four: boolean, deucesWild = false, face = 0): HTMLCanvasElement {
  const wild = deucesWild && !isJoker(card) && rankOf(card) === 2;
  const key = `${card}|${four}|${wild}|${face}`;
  const hit = faces.get(key);
  if (hit) return hit;
  const { c, x } = cardBody(15, 21, face);
  const night = FACES[face]?.night ?? false;
  if (isJoker(card)) {
    x.drawImage(textSprite('JK', night ? 14 : 2), 2, 2);
    x.drawImage(fromRows(STAR, { '#': 14 }), 4, 11);
  } else {
    const s = suitOf(card), col = suitColor(s, four, night);
    x.drawImage(textSprite(RANKS[rankOf(card)], col), 2, 2);
    x.drawImage(fromRows(SUIT5[s], { '#': col }), 2, 8);
    x.drawImage(fromRows(SUIT7[s], { '#': col }), 7, 13);
    if (wild) x.drawImage(fromRows(WILD_STAR, { '#': 13 }), 9, 2);
  }
  faces.set(key, c);
  return c;
}

/** 12 card-back designs: [base, accent, border, pattern]. */
export const BACKS: [number, number, number, number][] = [
  [2, 14, 8, 0], [1, 12, 12, 0], [3, 11, 11, 1], [0, 10, 9, 2], [13, 7, 2, 3], [4, 9, 9, 1],
  [8, 7, 2, 2], [1, 7, 12, 3], [5, 6, 0, 0], [2, 10, 14, 2], [16, 17, 3, 3], [0, 8, 8, 1],
];
const PATTERN = [
  (x: number, y: number) => (x + y) % 4 === 0 || (x - y + 400) % 4 === 0,
  (x: number, y: number) => (x + y) % 3 === 0,
  (x: number, y: number) => x % 3 === 1 && y % 3 === 1,
  (x: number, y: number) => ((x >> 1) + (y >> 1)) % 2 === 0,
];
const backs = new Map<string, HTMLCanvasElement>();
export function cardBack(design: number, mini = false): HTMLCanvasElement {
  const d = BACKS[((design % BACKS.length) + BACKS.length) % BACKS.length], key = `${design}|${mini}`;
  const hit = backs.get(key);
  if (hit) return hit;
  const w = mini ? 9 : 15, h = mini ? 13 : 21;
  const { c, x } = cardBody(w, h);
  for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) {
    const edge = xx === 1 || yy === 1 || xx === w - 2 || yy === h - 2;
    x.fillStyle = PAL[edge ? d[2] : PATTERN[d[3]](xx, yy) ? d[1] : d[0]];
    x.fillRect(xx, yy, 1, 1);
  }
  backs.set(key, c);
  return c;
}
export const CARD_BACK = cardBack(0);
export const MINI_BACK = cardBack(0, true);

// Chips: denomination, face colour, edge colour.
export const DENOMS: [number, number, number][] = [
  [100000, 15, 4], [25000, 14, 2], [5000, 12, 1], [1000, 10, 9], [500, 13, 2], [100, 0, 5], [25, 11, 3], [5, 8, 2], [1, 7, 6],
];
const CHIP_ROWS = ['.ccccc.', 'cwcwcwc', 'dcccccd', '.ddddd.'];
const CHIPS = DENOMS.map(([, c, d]) => fromRows(CHIP_ROWS, { c, w: c === 7 ? 12 : 7, d }));

function breakdown(amt: number, max: number): number[] {
  const list: number[] = [];
  let a = Math.max(0, Math.round(amt));
  for (let i = 0; i < DENOMS.length && list.length < max; i++) {
    while (a >= DENOMS[i][0] && list.length < max) { list.push(i); a -= DENOMS[i][0]; }
  }
  if (!list.length && amt > 0) list.push(DENOMS.length - 1);
  return list;
}

export function drawChips(ctx: CanvasRenderingContext2D, x: number, y: number, amt: number, max = 10) {
  breakdown(amt, max).forEach((k, j) => ctx.drawImage(CHIPS[k], Math.round(x - 3), Math.round(y - 4 - j * 2)));
}

/** Realistic chip towers: one column per denomination (largest first), up to `cols` columns. */
export function drawTowers(ctx: CanvasRenderingContext2D, x: number, y: number, amt: number, cols = 3, per = 9) {
  const counts = new Map<number, number>();
  for (const k of breakdown(amt, 60)) counts.set(k, (counts.get(k) ?? 0) + 1);
  [...counts].slice(0, cols).forEach(([k, n], ci) => {
    for (let j = 0; j < Math.min(n, per); j++) ctx.drawImage(CHIPS[k], Math.round(x + ci * 7), Math.round(y - 4 - j * 2));
  });
}
export const towersWidth = (amt: number, cols = 3) => Math.min(cols, new Set(breakdown(amt, 60)).size) * 7;

export const CROWN = fromRows(['a...a...a', 'aa.aaa.aa', 'aaaaaaaaa', 'a8aa9aa8a', 'aaaaaaaaa'], { a: 10, '8': 8, '9': 12 });
export const DEALER = (() => {
  const c = fromRows(['..777..', '.77777.', '7777777', '7777777', '7777777', '.67776.', '..666..'], { '7': 7, '6': 6 });
  c.getContext('2d')!.drawImage(textSprite('D', 0), 2, 1);
  return c;
})();

export const LAMP = fromRows([
  '......5......', '......5......', '....33333....', '...3333333...',
  '..333333333..', '.33333333333.', '3333333333333', '...aaaaaaa...',
], { '5': 5, '3': 3, a: 10 });

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
