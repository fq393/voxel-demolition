/** The first city-driving slice shares the existing car and voxel collision solver. */
export const CITY_CAR_SPAWNS: readonly (readonly [number, number, number])[] = [
  [-24.5, -9, Math.PI / 2], [-24.5, 5, Math.PI / 2], [-24.5, -23, Math.PI / 2],
  [23, -5, -Math.PI / 2], [2, 23, 0],
];

/** Sideways motion during a powerslide matters as much as forward speed. */
export const safeExitSpeed = (vx: number, vy: number): boolean => Math.hypot(vx, vy) <= 4;

/** Player AABB against the car's oriented body. Visual trim isn't a collider. */
export function playerOverlapsCar(x: number, y: number, z: number, height: number, cx: number, cy: number, heading: number, size: readonly number[] = [4.6, 2, 1.15]): boolean {
  if (z >= 0.12 + size[2] || z + height <= 0.12) return false;
  const dx = x - cx, dy = y - cy;
  const c = Math.cos(heading), s = Math.sin(heading);
  const length = size[0] / 2, width = size[1] / 2, player = 0.3;
  // All four separating axes: both car axes and both player axes.
  return Math.abs(dx * c + dy * s) < length + player * (Math.abs(c) + Math.abs(s))
    && Math.abs(-dx * s + dy * c) < width + player * (Math.abs(c) + Math.abs(s))
    && Math.abs(dx) < player + length * Math.abs(c) + width * Math.abs(s)
    && Math.abs(dy) < player + length * Math.abs(s) + width * Math.abs(c);
}

/** Try both doors, then behind/in front; slightly raised footing permits settled rubble. */
export function findVehicleExit(cx: number, cy: number, heading: number, blocked: (x: number, y: number, z: number) => boolean, size: readonly number[] = [4.6, 2, 1.15]): [number, number, number] | null {
  const c = Math.cos(heading), s = Math.sin(heading);
  const side = size[1] / 2 + 1.1, end = size[0] / 2 + 0.9;
  const offsets = [[0, side], [0, -side], [-end, 0], [end, 0], [-end + 0.6, side], [-end + 0.6, -side]];
  for (const z of [0, 0.25, 0.5, 0.75, 1, 1.5, 2]) {
    for (const [forward, side] of offsets) {
      const x = cx + c * forward - s * side;
      const y = cy + s * forward + c * side;
      if (!blocked(x, y, z)) return [x, y, z];
    }
  }
  return null;
}
