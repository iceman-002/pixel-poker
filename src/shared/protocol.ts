import type { Action, Ev, Legal, viewFor } from './engine.js';
import type { FAction, FEv, FLegal, floorView } from './floor.js';
import type { Rules, Level } from './rules.js';

export const MAX_SEATS = 8;
export const AVATARS = 8; // preset characters; custom avatars are encoded >= AVATAR_CUSTOM
export const AVATAR_CUSTOM = 1 << 18;
export const AVATAR_MAX = 1 << 19;
export const CARD_BACKS = 12;
export const MAX_NAME = 12;

/** Client -> server intents. */
export type C2S =
  | { t: 'create'; name: string; avatar: number; back?: number; rules?: Partial<Rules> }
  | { t: 'join'; room: string; name: string; avatar: number; back?: number; token?: string }
  | { t: 'profile'; name: string; avatar: number; back: number }
  | { t: 'rules'; rules: Partial<Rules> }
  | { t: 'sit'; seat: number }
  | { t: 'stand' }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'act'; action: Action | FAction }
  | { t: 'rebuy' }
  | { t: 'leave' }
  | { t: 'ping' };

export type HandView = ReturnType<typeof viewFor>;
export type FloorView = ReturnType<typeof floorView>;

export interface SeatView {
  id: string; name: string; avatar: number; back: number; stack: number;
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
  floor: FloorView | null;
  flegal: FLegal | null;
  winner: string; // name of the last game's winner (shown in the lobby)
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
  | { t: 'state'; s: RoomView; ev: (Ev | FEv)[] }
  | { t: 'error'; msg: string }
  | { t: 'left' }
  | { t: 'pong' };
