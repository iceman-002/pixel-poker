// PICO-8 palette (0-15) + dark green felt (16-18).
export const PAL = [
  '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
  '#0b4d2c', '#0f6136', '#07361f',
];
export const FELT = 16, FELT_HI = 17, FELT_LO = 18;
export const RGB = PAL.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

export function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
