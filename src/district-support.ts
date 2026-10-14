import { State, VOXEL, voxelAt, type City } from './world.ts';

/** Independent props have local anchors; a demolished supporting floor must release them too. */
export function unsupportedInteriorFurniture(city: City): number[][] {
  const detached: number[][] = [];
  for (const building of city.district ?? []) for (const furniture of building.furniture) {
    const object = city.buildings[furniture.object];
    if (!object) continue;
    const layer = object.w * object.d;
    let base = Infinity;
    for (let cell = 0; cell < object.cells.length; cell++) if (object.cells[cell] >= 0) { base = Math.floor(cell / layer); break; }
    if (base === 0 || !Number.isFinite(base)) continue; // Ground itself supports the bottom layer.
    const fixed: number[] = [];
    let supported = false;
    for (let cell = 0; cell < object.cells.length; cell++) {
      const v = object.cells[cell];
      if (v < 0 || city.state[v] !== State.Fixed) continue;
      fixed.push(v);
      if (!supported && Math.floor(cell / layer) === base) {
        const below = voxelAt(city, city.position[3*v], city.position[3*v+1], city.position[3*v+2] - VOXEL);
        supported = below >= 0 && city.building[below] !== furniture.object;
      }
    }
    if (fixed.length && !supported) detached.push(fixed);
  }
  return detached;
}
