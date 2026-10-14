/** The first city-driving slice shares the existing car and voxel collision solver. */
export const CITY_CAR_SPAWNS: readonly (readonly [number, number, number])[] = [
  [-25, -9, Math.PI / 2], [-25, 5, Math.PI / 2], [-25, -23, Math.PI / 2],
  [23, -5, -Math.PI / 2], [2, 23, 0],
];

/** Sideways motion during a powerslide matters as much as forward speed. */
export const safeExitSpeed = (vx: number, vy: number): boolean => Math.hypot(vx, vy) <= 4;

/** Player AABB against the car's oriented body. Visual trim isn't a collider. */
export function playerOverlapsCar(x: number, y: number, z: number, height: number, cx: number, cy: number, heading: number): boolean {
  if (z >= 1.35 || z + height <= 0.12) return false;
  const dx = x - cx, dy = y - cy;
  const c = Math.cos(heading), s = Math.sin(heading);
  const length = 2.3, width = 1, player = 0.3;
  // All four separating axes: both car axes and both player axes.
  return Math.abs(dx * c + dy * s) < length + player * (Math.abs(c) + Math.abs(s))
    && Math.abs(-dx * s + dy * c) < width + player * (Math.abs(c) + Math.abs(s))
    && Math.abs(dx) < player + length * Math.abs(c) + width * Math.abs(s)
    && Math.abs(dy) < player + length * Math.abs(s) + width * Math.abs(c);
}

/** Try both doors, then behind/in front; slightly raised footing permits settled rubble. */
export function findVehicleExit(cx: number, cy: number, heading: number, blocked: (x: number, y: number, z: number) => boolean): [number, number, number] | null {
  const c = Math.cos(heading), s = Math.sin(heading);
  const offsets = [[0, 2.1], [0, -2.1], [-3.2, 0], [3.2, 0], [-2.6, 2.1], [-2.6, -2.1]];
  for (const z of [0, 0.25, 0.5, 0.75, 1, 1.5, 2]) {
    for (const [forward, side] of offsets) {
      const x = cx + c * forward - s * side;
      const y = cy + s * forward + c * side;
      if (!blocked(x, y, z)) return [x, y, z];
    }
  }
  return null;
}
