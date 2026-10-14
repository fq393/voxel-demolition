/** Stable district IDs and world-space routes. Z is up throughout the city. */
export type DistrictId = 'store' | 'home' | 'warehouse';
export type DistrictPoint = readonly [number, number, number];
export interface DistrictFurniture {
  id: string; name: string; object: number; initial: number; at: DistrictPoint;
}
export interface DistrictBuilding {
  id: DistrictId; name: string; object: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; maxZ: number };
  entrance: DistrictPoint;
  /** A reachable interior destination; the home destination is on the upper floor. */
  target: DistrictPoint;
  furniture: DistrictFurniture[];
  /** Ordered foot positions for the physical stair route, including approach and landing. */
  stairs?: DistrictPoint[];
}
export const DISTRICT_LOTS = [[1, 0], [0, 1], [1, 1]] as const;
export const DISTRICT_REWARDS = { store: 110, home: 150, warehouse: 165 } as const;
export function isDistrictLot(x: number, y: number): boolean {
  return DISTRICT_LOTS.some(([i, j]) => x === i && y === j);
}
