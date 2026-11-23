// PICO-8 palette (0-15) + green felt (16-18) + other felts and carpet tones (19-41).
export const PAL = [
  '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
  '#0b4d2c', '#0f6136', '#07361f',
  // 19-30: felt sets (base, highlight, shadow): blue, red, purple, black
  '#16336b', '#1f4a8f', '#0e2149', '#6b1622', '#8a2232', '#470d16', '#47206b', '#5e2f8a', '#2e1347', '#1c1d22', '#2a2b33', '#101115',
  // 31-41: carpet tones
  '#4a0a14', '#2c050b', '#c99a2e', '#0d1a3d', '#081129', '#0f2a1d', '#07170f', '#2a0f3d', '#1a0827', '#0a0a0f', '#14141c',
];
export const FELT = 16, FELT_HI = 17, FELT_LO = 18;
export const RGB = PAL.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

export function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
