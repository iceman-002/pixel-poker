import type { Action, Ev, Legal, viewFor } from './engine.js';
import type { Rules, Level } from './rules.js';

export const MAX_SEATS = 8;
export const AVATARS = 8;
export const MAX_NAME = 12;

/** Client -> server intents. */
export type C2S =
  | { t: 'create'; name: string; avatar: number; rules?: Partial<Rules> }
  | { t: 'join'; room: string; name: string; avatar: number; token?: string }
  | { t: 'rules'; rules: Partial<Rules> }
  | { t: 'sit'; seat: number }
  | { t: 'stand' }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'act'; action: Action }
  | { t: 'rebuy' }
  | { t: 'leave' }
  | { t: 'ping' };

export type HandView = ReturnType<typeof viewFor>;

export interface SeatView {
  id: string; name: string; avatar: number; stack: number;
  connected: boolean; ready: boolean; rebuys: number;
}

export interface MemberView { id: string; name: string; avatar: number; connected: boolean; seat: number }

export interface RoomView {
  code: string;
  host: string;
  phase: 'lobby' | 'playing';
  rules: Rules;
  seats: (SeatView | null)[];
  members: MemberView[];
  you: string;
  seat: number;
  hand: HandView | null;
  handNo: number;
  legal: Legal | null;
  level: Level;
  levelIdx: number;
  nextLevel: { in: number; unit: 'hands' | 'ms' } | null; // hands left at this level, or ms until blinds rise
  timeLeft: number; // ms remaining for the active player, 0 = no timer
  timerMs: number;
  canRebuy: boolean;
}

/** Server -> client. `ev` holds hand events since the previous state, for animation. */
export type S2C =
  | { t: 'joined'; room: string; token: string; id: string }
  | { t: 'state'; s: RoomView; ev: Ev[] }
  | { t: 'error'; msg: string }
  | { t: 'left' }
  | { t: 'pong' };
