import type { Wild } from './eval.js';

export type Variant = 'floor' | 'holdem' | 'omaha' | 'draw' | 'short';
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
  goal: number; // Floor Deal: first to reach this wins (0 = no target)
  listed: boolean; // shown in the public OPEN TABLES list
}

export interface Level { sb: number; bb: number; ante: number }
export interface Street { kind: 'bet' | 'draw'; deal: number; big: boolean }
export interface VariantDef { name: string; hole: number; minRank: number; omaha: boolean; board: boolean; streets: Street[] }

export const BOMB_BB = 3;

const B = (deal: number, big = false): Street => ({ kind: 'bet', deal, big });
const BOARD_STREETS = [B(0), B(3), B(1, true), B(1, true)];

export const VARIANTS: Record<Variant, VariantDef> = {
  floor: { name: 'Floor Deal', hole: 4, minRank: 11, omaha: false, board: false, streets: [] },
  holdem: { name: "Texas Hold'em", hole: 2, minRank: 2, omaha: false, board: true, streets: BOARD_STREETS },
  omaha: { name: 'Omaha', hole: 4, minRank: 2, omaha: true, board: true, streets: BOARD_STREETS },
  short: { name: 'Short Deck', hole: 2, minRank: 6, omaha: false, board: true, streets: BOARD_STREETS },
  draw: { name: '5-Card Draw', hole: 5, minRank: 2, omaha: false, board: false, streets: [B(0), { kind: 'draw', deal: 0, big: false }, B(0, true)] },
};

export const DEFAULT_RULES: Rules = {
  variant: 'floor', betting: 'nl', stack: 50000, sb: 5, bb: 10, ante: 0, straddle: false,
  blindMode: 'static', blindEvery: 10, rebuys: false, maxRebuys: 3, runItTwice: false,
  bombEvery: 0, wild: 'none', timer: 30, goal: 1000000, listed: true,
};

const POKER: Rules = { ...DEFAULT_RULES, variant: 'holdem', stack: 1000, rebuys: true, goal: 0 };
export const PRESETS: Record<string, Rules> = {
  'Floor Deal': { ...DEFAULT_RULES },
  Casual: { ...POKER },
  Turbo: { ...POKER, stack: 500, sb: 10, bb: 20, blindMode: 'hands', blindEvery: 5, rebuys: false, timer: 15 },
  Chaos: {
    ...POKER, ante: 5, straddle: true, runItTwice: true, bombEvery: 4, wild: 'jokers',
    blindMode: 'minutes', blindEvery: 5, timer: 15,
  },
};

export const OPTIONS = {
  variant: ['floor', 'holdem', 'omaha', 'draw', 'short'] as Variant[],
  betting: ['nl', 'pl', 'fl'] as Betting[],
  blindMode: ['static', 'hands', 'minutes'] as BlindMode[],
  wild: ['none', 'jokers', 'deuces'] as Wild[],
  timer: [0, 15, 30, 60],
};

const int = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const bool = (v: unknown, d: boolean) => (v === undefined ? d : !!v);
const pick = <T>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);

/** Sanitize untrusted host input into a valid Rules object. */
export function sanitizeRules(raw: Partial<Record<keyof Rules, unknown>>): Rules {
  const d = DEFAULT_RULES;
  const bb = int(raw.bb, 2, 100000, d.bb);
  return {
    variant: pick(raw.variant, OPTIONS.variant, d.variant),
    betting: pick(raw.betting, OPTIONS.betting, d.betting),
    stack: int(raw.stack, 10, 100_000_000, d.stack),
    sb: int(raw.sb, 1, bb, Math.floor(bb / 2)),
    bb,
    ante: int(raw.ante, 0, bb, d.ante),
    straddle: bool(raw.straddle, d.straddle),
    blindMode: pick(raw.blindMode, OPTIONS.blindMode, d.blindMode),
    blindEvery: int(raw.blindEvery, 1, 120, d.blindEvery),
    rebuys: bool(raw.rebuys, d.rebuys),
    maxRebuys: int(raw.maxRebuys, 0, 99, d.maxRebuys),
    runItTwice: bool(raw.runItTwice, d.runItTwice),
    bombEvery: int(raw.bombEvery, 0, 50, d.bombEvery),
    wild: pick(raw.wild, OPTIONS.wild, d.wild),
    timer: pick(int(raw.timer, 0, 60, d.timer), OPTIONS.timer, d.timer),
    goal: int(raw.goal, 0, 1_000_000_000, d.goal),
    listed: bool(raw.listed, d.listed),
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
