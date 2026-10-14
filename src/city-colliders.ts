import * as THREE from 'three/webgpu';

/** CPU-only world-space bounds for the solid, static skyline. */
export interface StaticBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

type Point3 = readonly [number, number, number];

/** Read the skyline's unit-box transforms once; paving plinths remain walkable. */
export function collectSkylineColliders(mesh: THREE.InstancedMesh): StaticBox[] {
  const boxes: StaticBox[] = [];
  const local = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  mesh.updateWorldMatrix(true, false);
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, local);
    world.multiplyMatrices(mesh.matrixWorld, local);
    const m = world.elements;
    // The source is BoxGeometry(1,1,1). Summed absolute basis components also
    // preserve correct world bounds when its containing mesh is translated.
    const hx = (Math.abs(m[0]) + Math.abs(m[4]) + Math.abs(m[8])) / 2;
    const hy = (Math.abs(m[1]) + Math.abs(m[5]) + Math.abs(m[9])) / 2;
    const hz = (Math.abs(m[2]) + Math.abs(m[6]) + Math.abs(m[10])) / 2;
    if (2 * hz <= 0.2 || !Number.isFinite(hx + hy + hz + m[12] + m[13] + m[14])) continue;
    boxes.push({ minX: m[12] - hx, maxX: m[12] + hx, minY: m[13] - hy, maxY: m[13] + hy, minZ: m[14] - hz, maxZ: m[14] + hz });
  }
  return boxes;
}

/** A 0.6 m wide player's box, with z at the feet. Surface contact is allowed. */
export function overlapsPlayer(boxes: readonly StaticBox[], x: number, y: number, z: number, height: number): boolean {
  if (height <= 0) return false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (x + 0.3 > b.minX && x - 0.3 < b.maxX && y + 0.3 > b.minY && y - 0.3 < b.maxY && z + height > b.minZ && z < b.maxZ) return true;
  }
  return false;
}

/** Full four-axis SAT: the car's oriented ground footprint against each AABB. */
export function overlapsVehicle(boxes: readonly StaticBox[], cx: number, cy: number, heading: number, halfLength = 2.3, halfWidth = 1, height = 1.35): boolean {
  if (halfLength <= 0 || halfWidth <= 0) return false;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const ac = Math.abs(cos);
  const as = Math.abs(sin);
  const extentX = halfLength * ac + halfWidth * as;
  const extentY = halfLength * as + halfWidth * ac;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.minZ >= height || b.maxZ <= 0) continue;
    const hx = (b.maxX - b.minX) / 2;
    const hy = (b.maxY - b.minY) / 2;
    const dx = (b.minX + b.maxX) / 2 - cx;
    const dy = (b.minY + b.maxY) / 2 - cy;
    if (Math.abs(dx) >= extentX + hx || Math.abs(dy) >= extentY + hy) continue;
    if (Math.abs(dx * cos + dy * sin) >= halfLength + hx * ac + hy * as) continue;
    if (Math.abs(-dx * sin + dy * cos) >= halfWidth + hx * as + hy * ac) continue;
    return true;
  }
  return false;
}

/**
 * Nearest forward ray parameter t in [0,reach], or null. Unit direction makes
 * t a distance in metres. An origin inside/on a solid box returns zero.
 */
export function firstStaticHit(boxes: readonly StaticBox[], from: Point3, direction: Point3, reach: number): number | null {
  if (reach < 0 || Number.isNaN(reach)) return null;
  const [x, y, z] = from;
  const [dx, dy, dz] = direction;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return null;
  let nearest = reach;
  let hit = false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    let near = 0;
    let far = nearest;
    if (dx === 0) {
      if (x < b.minX || x > b.maxX) continue;
    } else {
      const a = (b.minX - x) / dx;
      const c = (b.maxX - x) / dx;
      near = Math.max(near, Math.min(a, c));
      far = Math.min(far, Math.max(a, c));
      if (near > far) continue;
    }
    if (dy === 0) {
      if (y < b.minY || y > b.maxY) continue;
    } else {
      const a = (b.minY - y) / dy;
      const c = (b.maxY - y) / dy;
      near = Math.max(near, Math.min(a, c));
      far = Math.min(far, Math.max(a, c));
      if (near > far) continue;
    }
    if (dz === 0) {
      if (z < b.minZ || z > b.maxZ) continue;
    } else {
      const a = (b.minZ - z) / dz;
      const c = (b.maxZ - z) / dz;
      near = Math.max(near, Math.min(a, c));
      far = Math.min(far, Math.max(a, c));
      if (near > far) continue;
    }
    nearest = near;
    hit = true;
    if (nearest === 0) return 0;
  }
  return hit ? nearest : null;
}
