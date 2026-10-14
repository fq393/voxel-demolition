import * as THREE from 'three/webgpu';
import { instanceColor } from 'three/tsl';
import { type City, raycast, voxelAt } from './world.ts';
import { Player } from './player.ts';
import { firstStaticHit, overlapsPlayer, overlapsVehicle, type StaticBox } from './city-colliders.ts';
import { trafficOverlapsWorld } from './city-life.ts';
import { playerOverlapsCar } from './city-driving.ts';
import { pointNearVehicle, vehicleFootprintsOverlap, type RoadBody } from './city-life-state.ts';
import { PoliceSimulation } from './police-state.ts';
import { GARAGE, type PoliceFrame, type PoliceStep } from './police-types.ts';

const NAVY = 0x253a50, IVORY = 0xf0e4c9, RUBBER = 0x242b2d, GOLD = 0xd5b46b;

/** Garage solids are independent of destructible voxel indices and damage saves. */
function garageColliders(): StaticBox[] {
  const b = GARAGE.bounds;
  return [
    { minX: b.minX, maxX: b.minX + 0.3, minY: b.minY, maxY: b.maxY, minZ: 0, maxZ: 3.1 },
    { minX: b.minX + 0.3, maxX: b.maxX, minY: b.minY, maxY: b.minY + 0.3, minZ: 0, maxZ: 3.1 },
    { minX: b.minX + 0.3, maxX: b.maxX, minY: b.maxY - 0.3, maxY: b.maxY, minZ: 0, maxZ: 3.1 },
    { minX: b.maxX - 0.3, maxX: b.maxX, minY: b.minY + 0.3, maxY: -12, minZ: 0, maxZ: 3.1 },
    { minX: b.maxX - 0.3, maxX: b.maxX, minY: -8, maxY: b.maxY - 0.3, minZ: 0, maxZ: 3.1 },
    { minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY, minZ: 2.95, maxZ: b.maxZ },
  ];
}

function profile(points: readonly (readonly [number, number])[], width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => i ? shape.lineTo(x, z) : shape.moveTo(x, z));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.025, bevelSegments: 1, steps: 1 });
  geometry.translate(0, 0, -width / 2); geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** Two authored police sedans, uniformed officers and a garage in nine shared batches. */
export class CityPolice {
  readonly object = new THREE.Group();
  readonly colliders = garageColliders();
  private city: City;
  private staticBoxes: readonly StaticBox[];
  private probe: Player;
  private simulation: PoliceSimulation;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly box: THREE.InstancedMesh;
  private readonly bodies: THREE.InstancedMesh;
  private readonly glass: THREE.InstancedMesh;
  private readonly tyres: THREE.InstancedMesh;
  private readonly rims: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly badges: THREE.InstancedMesh;
  private readonly lamps: THREE.InstancedMesh;
  private readonly shelter: THREE.InstancedMesh;
  private boxIndex = 0;
  private badgeIndex = 0;
  private lampIndex = 0;
  private time = 0;
  private baseZ = 0;
  private disposed = false;
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly lean = new THREE.Quaternion();
  private readonly matrix = new THREE.Matrix4();
  private readonly colour = new THREE.Color();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly body: RoadBody = { x: 0, y: 0, heading: 0, halfLength: 2.15, halfWidth: 0.92 };

  constructor(city: City, staticBoxes: readonly StaticBox[]) {
    this.city = city; this.staticBoxes = [...staticBoxes, ...this.colliders];
    this.probe = this.createProbe(); this.simulation = this.createSimulation();
    this.object.name = 'city-police-and-garage';
    const trim = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0.1 });
    const paint = new THREE.MeshStandardNodeMaterial({ roughness: 0.33, metalness: 0.4 });
    const window = new THREE.MeshStandardNodeMaterial({ color: 0x304952, roughness: 0.2, metalness: 0.45 });
    const signal = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.9 });
    signal.emissiveNode = instanceColor.mul(0.9);
    this.materials.push(trim, paint, window, signal);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const hull = profile([[-2.04, 0.31], [-2.03, 0.61], [-1.12, 0.78], [0.93, 0.77], [1.95, 0.59], [2.07, 0.31]], 1.7);
    const cabin = profile([[-1.12, 0.76], [-0.7, 1.19], [0.5, 1.19], [1.05, 0.75]], 1.39);
    const tyre = new THREE.CylinderGeometry(0.3, 0.3, 0.23, 12);
    const rim = new THREE.CylinderGeometry(0.18, 0.18, 0.235, 10);
    const head = new THREE.SphereGeometry(1, 10, 8);
    const badge = new THREE.CylinderGeometry(1, 1, 1, 6); badge.rotateZ(-Math.PI / 2);
    this.geometries.push(box, hull, cabin, tyre, rim, head, badge);
    this.box = this.batch('police-trim-and-uniforms', box, trim, 220);
    this.bodies = this.batch('police-sedan-shells', hull, paint, 2);
    this.glass = this.batch('police-sedan-glass', cabin, window, 2);
    this.tyres = this.batch('police-tyres', tyre, trim, 8);
    this.rims = this.batch('police-wheel-rims', rim, paint, 8);
    this.heads = this.batch('police-officer-heads', head, trim, 2);
    this.badges = this.batch('police-door-and-uniform-badges', badge, paint, 6);
    this.lamps = this.batch('police-lightbars-and-garage-marker', box, signal, 16);
    this.shelter = this.batch('garage-walls-and-roof', box, trim, 6);
    for (const mesh of [this.glass, this.tyres, this.rims, this.heads, this.badges, this.lamps]) mesh.castShadow = false;
    this.colliders.forEach((b, i) => this.place(this.shelter, i, 0, 0, 0,
      (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2,
      b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ, i === 5 ? 0xd4b292 : 0xdca68d));
    this.shelter.instanceMatrix.needsUpdate = true;
    this.render();
  }

  get units() { return this.simulation.units; }
  get diagnostics() {
    let triangles = 0;
    for (const mesh of this.object.children) if (mesh instanceof THREE.InstancedMesh)
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * mesh.count;
    return { ...this.simulation.diagnostics, renderBatches: 9, geometries: this.geometries.length,
      materials: this.materials.length, triangles, garageColliders: this.colliders.length,
      visibleOfficers: this.units.filter(unit => unit.officer.active).length };
  }

  update(dt: number, frame: PoliceFrame): PoliceStep {
    const result = this.simulation.update(dt, frame);
    if (Number.isFinite(dt) && dt > 0) this.time += Math.min(dt, 0.25);
    this.render(); return result;
  }

  reset(city: City, staticBoxes: readonly StaticBox[]): void {
    this.city = city; this.staticBoxes = [...staticBoxes, ...this.colliders];
    this.probe = this.createProbe(); this.simulation = this.createSimulation(); this.time = 0;
    this.render();
  }

  blocksPlayer(x: number, y: number, z: number, height: number): boolean {
    if (overlapsPlayer(this.colliders, x, y, z, height)) return true;
    for (const unit of this.units) {
      if (playerOverlapsCar(x, y, z, height, unit.x, unit.y, unit.heading, [4.3, 1.84, 1.36])) return true;
      const p = unit.officer;
      const floor = this.officerFloor(p.x, p.y);
      if (p.active && z < floor + 1.82 && z + height > floor && Math.abs(p.x - x) < 0.53 && Math.abs(p.y - y) < 0.53) return true;
    }
    return false;
  }

  blocksCar(x: number, y: number, heading: number, size: readonly number[] = [4.6, 2, 1.35]): boolean {
    if (overlapsVehicle(this.colliders, x, y, heading, size[0] / 2, size[1] / 2, size[2])) return true;
    Object.assign(this.body, { x, y, heading, halfLength: size[0] / 2, halfWidth: size[1] / 2 });
    for (const unit of this.units) {
      if (vehicleFootprintsOverlap(this.body, { ...unit, halfLength: 2.15, halfWidth: 0.92 })) return true;
      if (unit.officer.active && pointNearVehicle(unit.officer.x, unit.officer.y, this.body, 0.3)) return true;
    }
    return false;
  }

  rayHit(origin: ArrayLike<number>, direction: ArrayLike<number>, reach: number): number | null {
    let nearest = firstStaticHit(this.colliders, [origin[0], origin[1], origin[2]], [direction[0], direction[1], direction[2]], reach);
    for (const unit of this.units) {
      const value = this.rayBody(origin, direction, unit.x, unit.y, unit.heading, 2.15, 0.92, 0.12, 1.48, nearest ?? reach);
      if (value !== null) nearest = value;
      const p = unit.officer;
      if (p.active) {
        const floor = this.officerFloor(p.x, p.y);
        const hit = this.rayBody(origin, direction, p.x, p.y, p.heading, 0.23, 0.27, floor, floor + 1.82, nearest ?? reach);
        if (hit !== null) nearest = hit;
      }
    }
    return nearest;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const child of this.object.children) if (child instanceof THREE.InstancedMesh) child.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.object.clear(); this.object.removeFromParent();
  }

  private createProbe(): Player {
    const probe = new Player(this.city);
    probe.extraBlocked = (x, y, z, height) => overlapsPlayer(this.staticBoxes, x, y, z, height);
    return probe;
  }

  private createSimulation(): PoliceSimulation {
    return new PoliceSimulation({
      carBlocked: (x, y, heading) => overlapsVehicle(this.staticBoxes, x, y, heading, 2.15, 0.92)
        || trafficOverlapsWorld(this.city, x, y, heading),
      officerBlocked: (x, y) => this.probe.blocked(x, y, 0.25, 1.8),
      visible: (from, to) => {
        const origin: [number, number, number] = [from[0], from[1], from[2]];
        if (this.units.some(unit => unit.officer.active && Math.hypot(unit.officer.x - from[0], unit.officer.y - from[1]) < 0.01))
          origin[2] += this.officerFloor(from[0], from[1]);
        const dx = to[0] - origin[0], dy = to[1] - origin[1], dz = to[2] - origin[2], reach = Math.hypot(dx, dy, dz);
        if (!Number.isFinite(reach)) return false;
        if (reach < 0.01) return true;
        const direction: [number, number, number] = [dx / reach, dy / reach, dz / reach];
        const wall = firstStaticHit(this.staticBoxes, origin, direction, reach - 0.05);
        if (wall !== null) return false;
        return raycast(this.city, origin, direction, reach - 0.05) === null;
      },
    });
  }

  private officerFloor(x: number, y: number): number {
    return voxelAt(this.city, x, y, 0.125) >= 0 ? 0.25 : 0;
  }

  private batch(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Reserve colours before the first shader compile, including initially hidden officers.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.object.add(mesh); return mesh;
  }

  private place(mesh: THREE.InstancedMesh, index: number, x: number, y: number, heading: number,
    lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color?: number, tilt = 0): void {
    const c = Math.cos(heading), s = Math.sin(heading);
    this.position.set(x + c * lx - s * ly, y + s * lx + c * ly, lz + this.baseZ);
    this.scale.set(sx, sy, sz); this.rotation.setFromAxisAngle(this.zAxis, heading);
    if (tilt) this.rotation.multiply(this.lean.setFromAxisAngle(this.yAxis, tilt));
    this.matrix.compose(this.position, this.rotation, this.scale); mesh.setMatrixAt(index, this.matrix);
    if (color !== undefined) mesh.setColorAt(index, this.colour.setHex(color));
  }

  private trim(x: number, y: number, h: number, lx: number, ly: number, lz: number,
    sx: number, sy: number, sz: number, color: number, tilt = 0): void {
    this.place(this.box, this.boxIndex++, x, y, h, lx, ly, lz, sx, sy, sz, color, tilt);
  }

  private light(x: number, y: number, h: number, lx: number, ly: number, lz: number,
    sx: number, sy: number, sz: number, color: number): void {
    this.place(this.lamps, this.lampIndex++, x, y, h, lx, ly, lz, sx, sy, sz, color);
  }

  private render(): void {
    this.boxIndex = 0; this.badgeIndex = 0; this.lampIndex = 0;
    let headIndex = 0;
    for (const unit of this.units) {
      this.baseZ = 0;
      const { x, y, heading: h, id } = unit;
      this.place(this.bodies, id, x, y, h, 0, 0, 0, 1, 1, 1, IVORY);
      this.place(this.glass, id, x, y, h, 0, 0, 0, 1, 1, 1);
      this.trim(x, y, h, -0.12, 0, 1.22, 1.27, 1.39, 0.085, NAVY);
      this.trim(x, y, h, 1.29, 0, 0.77, 1.2, 1.65, 0.07, NAVY);
      this.trim(x, y, h, -1.51, 0, 0.73, 0.7, 1.67, 0.075, NAVY);
      this.trim(x, y, h, -0.1, 0, 1.31, 0.35, 1.31, 0.09, RUBBER);
      const flashing = unit.mode !== 'patrol', phase = Math.floor(this.time * 4) % 2;
      for (const side of [-1, 1]) {
        this.trim(x, y, h, 0.04, side * 0.717, 0.97, 0.065, 0.04, 0.42, IVORY);
        this.trim(x, y, h, 0.74, side * 0.91, 0.83, 0.2, 0.12, 0.1, NAVY);
        this.trim(x, y, h, -0.08, side * 0.866, 0.54, 1.55, 0.027, 0.23, NAVY);
        this.trim(x, y, h, 0.13, side * 0.889, 0.7, 0.27, 0.025, 0.04, 0xb9b5a4);
        this.place(this.badges, this.badgeIndex++, x, y, h + side * Math.PI / 2,
          0.881, side * -0.15, 0.57, 0.025, 0.12, 0.12, GOLD);
        this.trim(x, y, h, 2.027, side * 0.57, 0.53, 0.06, 0.31, 0.12, 0xffedc4);
        this.trim(x, y, h, -2.045, side * 0.58, 0.53, 0.035, 0.32, 0.12, 0xc16450);
        const on = flashing && phase === (side > 0 ? 1 : 0);
        this.light(x, y, h, -0.1, side * 0.41, 1.38, 0.25, 0.52, 0.14,
          on ? side < 0 ? 0xff7963 : 0x67baf4 : side < 0 ? 0x71403b : 0x36576e);
      }
      this.trim(x, y, h, 2.08, 0, 0.33, 0.055, 1.7, 0.1, RUBBER);
      this.trim(x, y, h, 2.1, 0, 0.46, 0.07, 0.7, 0.13, NAVY);
      this.trim(x, y, h, -2.075, 0, 0.34, 0.055, 1.69, 0.1, RUBBER);
      this.trim(x, y, h, 2.137, 0, 0.46, 0.026, 0.34, 0.1, IVORY);
      for (let i = 0; i < 5; i++) this.trim(x, y, h, 2.14, -0.22 + i * 0.11, 0.5, 0.025, 0.025, 0.09, 0xa9a89c);
      let wheel = id * 4;
      for (const axle of [-1.3, 1.29]) for (const side of [-1, 1]) {
        this.place(this.tyres, wheel, x, y, h, axle, side * 0.862, 0.3, 1, 1, 1, RUBBER, -unit.wheelPhase);
        this.place(this.rims, wheel++, x, y, h, axle, side * 0.864, 0.3, 1, 1, 1, 0xbdb9ac, -unit.wheelPhase);
      }
      const p = unit.officer;
      if (!p.active) continue;
      const skin = id ? 0xb58160 : 0xe0b58b, swing = p.moving ? Math.sin(p.phase) * 0.55 : 0;
      const px = p.x, py = p.y, ph = p.heading;
      this.baseZ = this.officerFloor(px, py);
      this.trim(px, py, ph, 0, 0, 1.13, 0.29, 0.4, 0.51, NAVY);
      this.trim(px, py, ph, 0.152, 0, 1.14, 0.021, 0.03, 0.46, 0xc6bda6);
      this.trim(px, py, ph, 0, 0, 0.85, 0.29, 0.37, 0.12, RUBBER);
      this.trim(px, py, ph, 0.155, 0, 0.85, 0.03, 0.1, 0.08, GOLD);
      this.trim(px, py, ph, -0.02, 0.25, 0.82, 0.14, 0.12, 0.24, RUBBER);
      this.trim(px, py, ph, -0.03, -0.24, 0.91, 0.09, 0.1, 0.21, RUBBER);
      this.trim(px, py, ph, 0, 0, 1.45, 0.12, 0.12, 0.1, skin);
      this.place(this.heads, headIndex++, px, py, ph, 0, 0, 1.59, 0.145, 0.14, 0.17, skin);
      this.trim(px, py, ph, 0, 0, 1.737, 0.28, 0.29, 0.12, NAVY);
      this.trim(px, py, ph, 0.14, 0, 1.7, 0.23, 0.31, 0.035, RUBBER);
      this.place(this.badges, this.badgeIndex++, px, py, ph, 0.156, -0.1, 1.27, 0.025, 0.045, 0.054, GOLD);
      for (const side of [-1, 1]) {
        const leg = swing * side;
        this.trim(px, py, ph, Math.sin(leg) * 0.15, side * 0.1, 0.44, 0.135, 0.145, 0.66, 0x344557, leg);
        this.trim(px, py, ph, 0.06 + Math.sin(leg) * 0.3, side * 0.1, 0.07 + Math.max(0, Math.sin(p.phase) * side) * (p.moving ? 0.05 : 0), 0.25, 0.16, 0.14, RUBBER);
        this.trim(px, py, ph, -Math.sin(leg) * 0.12, side * 0.26, 1.07, 0.12, 0.135, 0.5, NAVY, -leg);
        this.trim(px, py, ph, -Math.sin(leg) * 0.24, side * 0.26, 0.8, 0.105, 0.11, 0.13, skin, -leg);
        this.trim(px, py, ph, 0.137, side * 0.055, 1.615, 0.022, 0.022, 0.025, RUBBER);
        this.trim(px, py, ph, 0.07, side * 0.21, 1.3, 0.12, 0.07, 0.07, GOLD);
      }
    }
    this.baseZ = 0; this.renderGarage();
    this.box.count = this.boxIndex; this.badges.count = this.badgeIndex; this.lamps.count = this.lampIndex; this.heads.count = headIndex;
    for (const mesh of [this.box, this.bodies, this.glass, this.tyres, this.rims, this.heads, this.badges, this.lamps]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private renderGarage(): void {
    const [x, y] = GARAGE.center;
    this.trim(x, y, 0, 0, 0, 0.02, 8.35, 7.35, 0.04, 0x887f6b);
    // Green outlined parking bays, facing the open east entrance.
    for (const side of [-1, 1]) {
      this.light(x, y, 0, 0.3, side * 2.15, 0.051, 6.65, 0.07, 0.02, 0x7da58b);
      this.light(x, y, 0, side * 3.02 + 0.3, 0, 0.051, 0.07, 4.3, 0.02, 0x7da58b);
    }
    this.trim(x, y, 0, 4.21, 0, 2.78, 0.25, 4.52, 0.34, IVORY);
    for (const side of [-1, 1]) {
      this.trim(x, y, 0, 4.2, side * 2.09, 1.4, 0.28, 0.18, 2.8, IVORY);
      for (let i = 0; i < 5; i++) this.trim(x, y, 0, 4.36, side * 2.09, 0.2 + i * 0.3, 0.028, 0.17, 0.12, i % 2 ? RUBBER : GOLD);
    }
    this.trim(x, y, 0, 4.54, 0, 2.76, 0.025, 1.4, 0.23, 0x456857);
    // House icon, geometric so it stays readable without a texture or font download.
    this.light(x, y, 0, 4.56, 0, 2.79, 0.023, 0.13, 0.11, IVORY);
    this.light(x, y, 0, 4.56, -0.065, 2.84, 0.023, 0.025, 0.12, IVORY);
    this.light(x, y, 0, 4.56, 0.065, 2.84, 0.023, 0.025, 0.12, IVORY);
    // A shallow service bench and cabinet against the back wall, outside safe parking footprint.
    this.trim(x, y, 0, -3.88, 0, 0.52, 0.55, 2.6, 0.98, 0x775949);
    this.trim(x, y, 0, -3.83, 0, 1.04, 0.65, 2.72, 0.1, 0xc4b599);
    for (const side of [-1, 1]) {
      this.trim(x, y, 0, -3.53, side * 0.65, 0.67, 0.025, 0.82, 0.52, 0xbd8b6e);
      this.trim(x, y, 0, -3.51, side * 0.65, 0.75, 0.02, 0.3, 0.04, GOLD);
      this.trim(x, y, 0, -4.18, side * 0.46, 1.6, 0.035, 0.05, 0.65, RUBBER);
      this.trim(x, y, 0, -4.15, side * 0.46, 1.91, 0.04, 0.22, 0.05, 0xb9b5a4);
    }
    for (let i = 0; i < 3; i++) this.trim(x, y, 0, -3.84, -0.65 + i * 0.65, 1.16, 0.25, 0.27, 0.17, i === 1 ? 0x8ca397 : 0xc99a6e);
    this.trim(x, y, 0, -4.21, 0, 1.85, 0.04, 2.5, 1.35, 0x526154);
    this.trim(x, y, 0, 0, -3.82, 2.78, 8.3, 0.04, 0.3, IVORY);
    this.trim(x, y, 0, 0, 3.82, 2.78, 8.3, 0.04, 0.3, IVORY);
  }

  private rayBody(origin: ArrayLike<number>, direction: ArrayLike<number>, x: number, y: number, heading: number,
    halfLength: number, halfWidth: number, minZ: number, maxZ: number, reach: number): number | null {
    const c = Math.cos(heading), s = Math.sin(heading), dx = origin[0] - x, dy = origin[1] - y;
    return firstStaticHit([{ minX: -halfLength, maxX: halfLength, minY: -halfWidth, maxY: halfWidth, minZ, maxZ }],
      [dx * c + dy * s, -dx * s + dy * c, origin[2]],
      [direction[0] * c + direction[1] * s, -direction[0] * s + direction[1] * c, direction[2]], reach);
  }
}
