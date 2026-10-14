import { GARAGE } from './police-types.ts';

export const ESCAPE_REWARD = 240;
export const ESCAPE_PARCEL = [46.75, 49, 0.25] as const;
export const ESCAPE_BREACH = [40.25, 47.25, 0.25] as const;
export const ESCAPE_NAME = '仓库脱身';
export interface ActiveEscapeMission { stage: 0 | 1 | 2 }
export interface EscapeMissionState { active: ActiveEscapeMission | null; completed: boolean }
export interface EscapeFrame {
  player: { x: number; y: number; z: number; driving: boolean; flying: boolean; grounded: boolean };
  dt: number;
  wantedStars: number;
  breachOpen: boolean;
  safe: boolean;
}
export interface EscapeCompletion { reward: number; coins: number }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const emptyEscapeState = (): EscapeMissionState => ({ active: null, completed: false });
export function validateEscapeState(value: unknown): EscapeMissionState | null {
  if (value === undefined) return emptyEscapeState();
  if (!record(value) || Object.keys(value).some(key => key !== 'active' && key !== 'completed') || typeof value.completed !== 'boolean') return null;
  let active: ActiveEscapeMission | null = null;
  if (value.active !== null) {
    if (value.completed || !record(value.active) || Object.keys(value.active).some(key => key !== 'stage')
      || ![0, 1, 2].includes(value.active.stage as number)) return null;
    active = { stage: value.active.stage as 0 | 1 | 2 };
  }
  return { active, completed: value.completed };
}
export function escapeEarned(state: Readonly<EscapeMissionState>): number { return state.completed ? ESCAPE_REWARD : 0; }
export function escapeTarget(active: Readonly<ActiveEscapeMission> | null): readonly [number, number, number] | null {
  return active ? active.stage === 0 ? ESCAPE_PARCEL : active.stage === 1 ? ESCAPE_BREACH : GARAGE.center : null;
}
export function escapeInstruction(active: Readonly<ActiveEscapeMission> | null): string {
  return active?.stage === 0 ? '步行进仓库，到后侧取包裹'
    : active?.stage === 1 ? '拆开西墙绿圈处，步行穿过缺口'
    : active?.stage === 2 ? '开车摆脱追踪，回西侧车库交付' : '取件、拆墙脱身，再开车回家';
}

/** Volatile crossing samples never enter saves: reload/R must restart the active attempt. */
export class EscapeAttempt {
  private previous: readonly [number, number, number] | null = null;
  private inside = false;
  private readonly active: ActiveEscapeMission;
  constructor(active: ActiveEscapeMission) { this.active = active; }
  advance(frame: EscapeFrame): boolean {
    const p = frame.player;
    if (![p.x, p.y, p.z, frame.dt, frame.wantedStars].every(Number.isFinite) || frame.dt <= 0 || frame.dt > 0.25) return false;
    if (this.active.stage === 2) {
      const b = GARAGE.safe;
      return p.driving && !p.flying && p.grounded && p.z >= -0.2 && p.z < 1
        && frame.safe && frame.wantedStars === 0 && p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
    }
    if (p.driving || p.flying || p.z < -0.2 || p.z > (this.active.stage === 0 ? 0.75 : 1.8)) {
      this.previous = null; this.inside = false; return false;
    }
    if (this.active.stage === 0) {
      if (!p.grounded) return false;
      if (Math.hypot(p.x - ESCAPE_PARCEL[0], p.y - ESCAPE_PARCEL[1]) < 1.25 && Math.abs(p.z - ESCAPE_PARCEL[2]) < 0.45) {
        this.active.stage = 1; this.previous = [p.x, p.y, p.z]; this.inside = false;
      }
      return false;
    }
    const previous = this.previous, continuous = previous !== null
      && Math.hypot(p.x - previous[0], p.y - previous[1], p.z - previous[2]) <= Math.min(frame.dt, 0.25) * 12 + 0.3;
    this.previous = [p.x, p.y, p.z];
    if (!continuous) this.inside = false;
    if (p.grounded && p.x >= 40.5 && p.x <= 43 && p.y >= 46.5 && p.y <= 48) this.inside = true;
    // Keep the grounded entry sample across a short drop from the broken floor/rubble.
    if (continuous && this.inside && frame.breachOpen && p.x < 39.5 && p.x > 38.5 && p.y >= 46.5 && p.y <= 48) {
      this.active.stage = 2; this.previous = null; this.inside = false;
    }
    return false;
  }
}
