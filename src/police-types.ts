import type { RoadBody } from './city-life-state.ts';

export type WantedPhase = 'quiet' | 'chase' | 'search';
export interface PoliceCommand {
  stars: number;
  phase: WantedPhase;
  target: readonly [number, number, number] | null;
}
export interface PoliceFrame {
  player: { x: number; y: number; z: number; driving: boolean; flying: boolean };
  car: (RoadBody & { speed: number }) | null;
  traffic: readonly RoadBody[];
  pedestrians: readonly { x: number; y: number }[];
  wanted: PoliceCommand;
  safe: boolean;
}
export interface OfficerState {
  x: number; y: number; heading: number; moving: boolean; phase: number; active: boolean;
}
export interface PoliceUnit {
  id: number; x: number; y: number; heading: number; speed: number; wheelPhase: number;
  mode: 'patrol' | 'chase' | 'search'; officer: OfficerState;
  carDestroyed: boolean; officerDestroyed: boolean;
}
export interface PoliceProbes {
  carBlocked(x: number, y: number, heading: number): boolean;
  officerBlocked(x: number, y: number): boolean;
  visible(from: readonly [number, number, number], to: readonly [number, number, number]): boolean;
}
export interface PoliceStep { seen: boolean; caught: boolean }
export const GARAGE = {
  bounds: { minX: -40, maxX: -31, minY: -14, maxY: -6, maxZ: 3.25 },
  safe: { minX: -38.5, maxX: -33, minY: -12.5, maxY: -7.5 },
  center: [-35.5, -10, 0] as const,
};
export function inGarage(x: number, y: number, z: number): boolean {
  const b = GARAGE.safe;
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && z >= -0.2 && z < 2
    && x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}
