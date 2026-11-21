// App icons drawn as 32x32 pixel art and encoded to PNG on demand (no image files in the repo).
import zlib from 'node:zlib';

const C: Record<string, [number, number, number]> = {
  g: [11, 77, 44], h: [15, 97, 54], k: [0, 0, 0], w: [255, 241, 232], s: [194, 195, 199],
  r: [255, 0, 77], d: [126, 37, 83], y: [255, 236, 39], o: [255, 163, 0],
};
const SPADE = ['...#...', '..###..', '.#####.', '#######', '#######', '##.#.##', '...#...', '..###..'];

function art(): string[][] {
  const g = Array.from({ length: 32 }, (_, y) => Array.from({ length: 32 }, (_, x): string => ((x * 7 + y * 13) % 11 === 0 ? 'h' : 'g')));
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (g[yy]?.[xx]) g[yy][xx] = c;
  };
  // Back card (tilted look via offset) and front card.
  rect(5, 6, 14, 20, 'k'); rect(6, 7, 12, 18, 'r'); rect(7, 8, 10, 16, 'd');
  for (let y = 8; y < 24; y++) for (let x = 7; x < 17; x++) if ((x + y) % 3 === 0) g[y][x] = 'r';
  rect(11, 4, 16, 22, 'k'); rect(12, 5, 14, 20, 'w'); rect(25, 6, 1, 19, 's'); rect(13, 24, 12, 1, 's');
  // "A" in the corner.
  rect(13, 7, 1, 4, 'k'); rect(15, 7, 1, 4, 'k'); rect(14, 6, 1, 1, 'k'); rect(14, 9, 1, 1, 'k');
  SPADE.forEach((row, yy) => [...row].forEach((ch, xx) => { if (ch === '#') rect(15 + xx, 12 + yy, 1, 1, 'k'); }));
  // Gold chip.
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const d = Math.hypot(x + 0.5 - 24, y + 0.5 - 25);
    if (d < 6.5) g[y][x] = d > 5.5 ? 'k' : d > 4.2 ? ((Math.atan2(y - 25, x - 24) * 4) / Math.PI + 8) % 2 < 1 ? 'w' : 'o' : 'y';
  }
  return g;
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b: Buffer) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const cache = new Map<number, Buffer>();
export function iconPng(size: number): Buffer {
  const hit = cache.get(size);
  if (hit) return hit;
  const g = art(), raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, gg, b] = C[g[Math.floor((y * 32) / size)][Math.floor((x * 32) / size)]];
      raw.set([r, gg, b], y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  cache.set(size, png);
  return png;
}

/** Serves /icon-<size>.png and /apple-touch-icon.png. Returns true if handled. */
export function serveIcon(url: string, res: import('node:http').ServerResponse): boolean {
  const m = /^\/(?:icon-(\d+)|apple-touch-icon(?:-precomposed)?)\.png$/.exec(url.split('?')[0]);
  if (!m) return false;
  const size = Math.min(1024, Math.max(16, Number(m[1] ?? 180)));
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }).end(iconPng(size));
  return true;
}
