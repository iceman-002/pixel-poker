import type { Wild } from './eval.js';

export type Variant = 'holdem' | 'omaha' | 'draw' | 'short';
export type Betting = 'nl' | 'pl' | 'fl';
export type BlindMode = 'static' | 'hands' | 'minutes';

export interface Rules {
  variant: Variant;
  betting: Betting;
  stack: number;
  sb: number;
  bb: number;
  ante: number;
  straddle: boolean;
  blindMode: BlindMode;
  blindEvery: number;
  rebuys: boolean;
  maxRebuys: number;
  runItTwice: boolean;
  bombEvery: number; // 0 = off
  wild: Wild;
  timer: number; // 0 = off, else seconds
}

export interface Level { sb: number; bb: number; ante: number }
export interface Street { kind: 'bet' | 'draw'; deal: number; big: boolean }
export interface VariantDef { name: string; hole: number; minRank: number; omaha: boolean; board: boolean; streets: Street[] }

export const BOMB_BB = 3;

const B = (deal: number, big = false): Street => ({ kind: 'bet', deal, big });
const BOARD_STREETS = [B(0), B(3), B(1, true), B(1, true)];

export const VARIANTS: Record<Variant, VariantDef> = {
  holdem: { name: "Texas Hold'em", hole: 2, minRank: 2, omaha: false, board: true, streets: BOARD_STREETS },
  omaha: { name: 'Omaha', hole: 4, minRank: 2, omaha: true, board: true, streets: BOARD_STREETS },
  short: { name: 'Short Deck', hole: 2, minRank: 6, omaha: false, board: true, streets: BOARD_STREETS },
  draw: { name: '5-Card Draw', hole: 5, minRank: 2, omaha: false, board: false, streets: [B(0), { kind: 'draw', deal: 0, big: false }, B(0, true)] },
};

export const DEFAULT_RULES: Rules = {
  variant: 'holdem', betting: 'nl', stack: 1000, sb: 5, bb: 10, ante: 0, straddle: false,
  blindMode: 'static', blindEvery: 10, rebuys: true, maxRebuys: 3, runItTwice: false,
  bombEvery: 0, wild: 'none', timer: 30,
};

export const PRESETS: Record<string, Rules> = {
  Casual: { ...DEFAULT_RULES },
  Turbo: { ...DEFAULT_RULES, stack: 500, sb: 10, bb: 20, blindMode: 'hands', blindEvery: 5, rebuys: false, timer: 15 },
  Chaos: {
    ...DEFAULT_RULES, ante: 5, straddle: true, runItTwice: true, bombEvery: 4, wild: 'jokers',
    blindMode: 'minutes', blindEvery: 5, timer: 15,
  },
};

export const OPTIONS = {
  variant: ['holdem', 'omaha', 'draw', 'short'] as Variant[],
  betting: ['nl', 'pl', 'fl'] as Betting[],
  blindMode: ['static', 'hands', 'minutes'] as BlindMode[],
  wild: ['none', 'jokers', 'deuces'] as Wild[],
  timer: [0, 15, 30, 60],
};

const int = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const pick = <T>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);

/** Sanitize untrusted host input into a valid Rules object. */
export function sanitizeRules(raw: Partial<Record<keyof Rules, unknown>>): Rules {
  const d = DEFAULT_RULES;
  const bb = int(raw.bb, 2, 100000, d.bb);
  return {
    variant: pick(raw.variant, OPTIONS.variant, d.variant),
    betting: pick(raw.betting, OPTIONS.betting, d.betting),
    stack: int(raw.stack, bb * 10, 10_000_000, Math.max(d.stack, bb * 10)),
    sb: int(raw.sb, 1, bb, Math.floor(bb / 2)),
    bb,
    ante: int(raw.ante, 0, bb, 0),
    straddle: !!raw.straddle,
    blindMode: pick(raw.blindMode, OPTIONS.blindMode, d.blindMode),
    blindEvery: int(raw.blindEvery, 1, 120, d.blindEvery),
    rebuys: !!raw.rebuys,
    maxRebuys: int(raw.maxRebuys, 0, 99, d.maxRebuys),
    runItTwice: !!raw.runItTwice,
    bombEvery: int(raw.bombEvery, 0, 50, 0),
    wild: pick(raw.wild, OPTIONS.wild, d.wild),
    timer: pick(int(raw.timer, 0, 60, d.timer), OPTIONS.timer, d.timer),
  };
}

/** Blind level i (0-based) for rising schedules: x1.5 per level, rounded to the small blind unit. */
export function levelAt(r: Rules, i: number): Level {
  if (r.blindMode === 'static' || i <= 0) return { sb: r.sb, bb: r.bb, ante: r.ante };
  const f = Math.pow(1.5, i);
  const unit = Math.max(1, r.sb);
  const round = (x: number) => Math.max(unit, Math.round(x / unit) * unit);
  return { sb: round(r.sb * f), bb: round(r.bb * f), ante: r.ante ? round(r.ante * f) : 0 };
}
