import * as THREE from 'three/webgpu';
import { type City, State, VOXEL } from './world.ts';
import { Player } from './player.ts';
import { overlapsPlayer, overlapsVehicle, type StaticBox } from './city-colliders.ts';
import { playerOverlapsCar } from './city-driving.ts';
import { StreetSimulation, pointNearVehicle, vehicleFootprintsOverlap, type LifeFrame, type CityLifeState, type RoadBody } from './city-life-state.ts';

/** The moving traffic's fixed-voxel probe; stops early and allocates no hit list. */
export function trafficOverlapsWorld(city: City, x: number, y: number, heading: number): boolean {
  const c = Math.cos(heading), s = Math.sin(heading), hx = 2.15 + VOXEL / 2, hy = 0.92 + VOXEL / 2;
  const ex = Math.abs(c) * hx + Math.abs(s) * hy, ey = Math.abs(s) * hx + Math.abs(c) * hy;
  for (const b of city.buildings) {
    const bx = b.x0 * VOXEL, by = b.y0 * VOXEL;
    if (x + ex < bx || x - ex > bx + b.w * VOXEL || y + ey < by || y - ey > by + b.d * VOXEL) continue;
    const x0 = Math.max(0, Math.floor((x - ex) / VOXEL) - b.x0), x1 = Math.min(b.w - 1, Math.floor((x + ex) / VOXEL) - b.x0);
    const y0 = Math.max(0, Math.floor((y - ey) / VOXEL) - b.y0), y1 = Math.min(b.d - 1, Math.floor((y + ey) / VOXEL) - b.y0);
    for (let z = 0; z <= Math.min(5, b.h - 1); z++) for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const v = b.cells[i + b.w * (j + b.d * z)];
      if (v < 0 || city.state[v] !== State.Fixed) continue;
      const dx = (b.x0 + i + 0.5) * VOXEL - x, dy = (b.y0 + j + 0.5) * VOXEL - y;
      if (Math.abs(dx * c + dy * s) < hx && Math.abs(-dx * s + dy * c) < hy) return true;
    }
  }
  return false;
}

const CAR_PAINT = [0xd28554, 0x638b86, 0xe1cc9a, 0x9c726d, 0x698ab0, 0xd4bc85, 0x79976e, 0xb4773e];
const SHIRTS = [0xcba16a, 0x718f83, 0xc87965, 0x78a0aa, 0xd6c69e, 0x9a82ad, 0xc1b366];
const SKIN = [0xd8a077, 0x9d694c, 0xe6ba91, 0xbd8660];
const TROUSERS = [0x435263, 0x7d705e, 0x4d645e, 0x786054];
const HAIR = [0x302b24, 0x695044, 0x302d29, 0x7f6451];
const BLACK = 0x252d30;

function profileGeometry(points: readonly (readonly [number, number])[], width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.035, bevelSegments: 1, steps: 1 });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** Seven shared render batches, irrespective of the number of people and cars. */
export class CityLife {
  readonly object = new THREE.Group();
  readonly diagnostics = {
    cars: 8, pedestrians: 14, movingCars: 0, walkingPedestrians: 0, frightenedPedestrians: 0,
    signalPhase: 'horizontal' as CityLifeState['signalPhase'],
    signalStops: 0, followStops: 0, pedestrianYields: 0, playerYields: 0, worldStops: 0,
    renderBatches: 7, resources: 10,
  };
  extraCarBlocked: ((x:number,y:number,heading:number)=>boolean) | null = null;
  extraPedestrianBlocked: ((x:number,y:number)=>boolean) | null = null;
  private city: City;
  private staticBoxes: readonly StaticBox[];
  private probe: Player;
  private simulation: StreetSimulation;
  private readonly box: THREE.InstancedMesh;
  private readonly bodies: THREE.InstancedMesh;
  private readonly glass: THREE.InstancedMesh;
  private readonly tyres: THREE.InstancedMesh;
  private readonly rims: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly signalLamps: THREE.InstancedMesh;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly lean = new THREE.Quaternion();
  private readonly matrix = new THREE.Matrix4();
  private readonly colour = new THREE.Color();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly collisionBody: RoadBody = { x: 0, y: 0, heading: 0, halfLength: 2.3, halfWidth: 1 };
  private boxIndex = 0;

  constructor(city: City, staticBoxes: readonly StaticBox[]) {
    this.city = city; this.staticBoxes = staticBoxes; this.probe = this.createProbe();
    this.simulation = this.createSimulation();
    this.object.name = 'city-life';
    const common = new THREE.MeshStandardNodeMaterial({ roughness: 0.67, metalness: 0.12 });
    const paint = new THREE.MeshStandardNodeMaterial({ roughness: 0.34, metalness: 0.42 });
    const glazing = new THREE.MeshStandardNodeMaterial({ color: 0x273c44, roughness: 0.18, metalness: 0.48 });
    const lamps = new THREE.MeshStandardNodeMaterial({ roughness: 0.45, emissive: 0xffffff, emissiveIntensity: 0.5 });
    this.materials.push(common, paint, glazing, lamps);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const body = profileGeometry([[-2.02, 0.32], [-2.04, 0.68], [-0.85, 0.82], [0.85, 0.76], [2.02, 0.53], [2.08, 0.32]], 1.68);
    const cabin = profileGeometry([[-1.03, 0.76], [-0.64, 1.17], [0.43, 1.17], [1.02, 0.74]], 1.37);
    const tyre = new THREE.CylinderGeometry(0.29, 0.29, 0.22, 12);
    const rim = new THREE.CylinderGeometry(0.165, 0.165, 0.226, 10);
    const head = new THREE.SphereGeometry(1, 10, 8);
    this.geometries.push(box, body, cabin, tyre, rim, head);
    this.box = this.batch('street-people-and-trim', box, common, 420);
    this.bodies = this.batch('traffic-paint', body, paint, 8);
    this.glass = this.batch('traffic-glass', cabin, glazing, 8);
    this.tyres = this.batch('traffic-tyres', tyre, common, 32);
    this.rims = this.batch('traffic-rims', rim, paint, 32);
    this.heads = this.batch('pedestrian-heads', head, common, 14);
    this.signalLamps = this.batch('junction-lights', box, lamps, 8);
    // The shell, roof, hair and limbs supply the silhouettes. Avoid separate
    // shadow draws for enclosed glass and tiny rims/heads in every cascade.
    for (const mesh of [this.glass, this.tyres, this.rims, this.heads, this.signalLamps]) mesh.castShadow = false;
    this.render();
  }

  get state(): CityLifeState { return this.simulation.state; }

  update(dt: number, frame: LifeFrame): void {
    this.simulation.update(dt, frame);
    this.render();
  }

  reset(city: City, staticBoxes: readonly StaticBox[]): void {
    this.city = city; this.staticBoxes = staticBoxes;
    this.probe = this.createProbe(); this.simulation = this.createSimulation();
    this.render();
  }

  blocksPlayer(x: number, y: number, z: number, height: number): boolean {
    if (z >= 1.75 || z + height <= 0) return false;
    for (const car of this.state.cars) if (playerOverlapsCar(x, y, z, height, car.x, car.y, car.heading)) return true;
    for (const p of this.state.pedestrians) if (Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5) return true;
    return false;
  }

  blocksCar(x: number, y: number, heading: number, size: readonly number[] = [4.6, 2, 1.15]): boolean {
    const body = this.collisionBody; body.x = x; body.y = y; body.heading = heading; body.halfLength = size[0] / 2; body.halfWidth = size[1] / 2;
    for (const car of this.state.cars) if (vehicleFootprintsOverlap(body, car)) return true;
    for (const p of this.state.pedestrians) if (pointNearVehicle(p.x, p.y, body, 0.32)) return true;
    return false;
  }

  /** Includes people and traffic in camera/weapon occlusion without awarding voxel points. */
  rayHit(origin: ArrayLike<number>, direction: ArrayLike<number>, reach: number): number | null {
    let nearest = reach, hit = false;
    for (const car of this.state.cars) {
      const value = this.rayBody(origin, direction, car.x, car.y, car.heading, 2.15, 0.92, 0.12, 1.34, nearest);
      if (value !== null) { nearest = value; hit = true; }
    }
    for (const p of this.state.pedestrians) {
      const value = this.rayBody(origin, direction, p.x, p.y, p.heading, 0.23, 0.27, 0, 1.78, nearest);
      if (value !== null) { nearest = value; hit = true; }
    }
    return hit ? nearest : null;
  }

  scare(x: number, y: number, radius: number): void { this.simulation.scare(x, y, radius); }

  dispose(): void {
    for (const child of this.object.children) if (child instanceof THREE.InstancedMesh) child.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.object.clear();
    this.object.removeFromParent();
  }

  private createProbe(): Player {
    const probe = new Player(this.city);
    probe.extraBlocked = (x, y, z, height) => overlapsPlayer(this.staticBoxes, x, y, z, height);
    return probe;
  }

  private createSimulation(): StreetSimulation {
    return new StreetSimulation({
      carBlocked: (x, y, heading) => overlapsVehicle(this.staticBoxes, x, y, heading, 2.15, 0.92) || trafficOverlapsWorld(this.city, x, y, heading) || !!this.extraCarBlocked?.(x,y,heading),
      pedestrianBlocked: (x, y) => this.probe.blocked(x, y, 0, 1.8) || !!this.extraPedestrianBlocked?.(x,y),
    });
  }

  private batch(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.object.add(mesh);
    return mesh;
  }

  private place(mesh: THREE.InstancedMesh, index: number, x: number, y: number, heading: number,
    lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color?: number, tilt = 0): void {
    const c = Math.cos(heading), s = Math.sin(heading);
    this.position.set(x + c * lx - s * ly, y + s * lx + c * ly, lz);
    this.scale.set(sx, sy, sz);
    this.rotation.setFromAxisAngle(this.zAxis, heading);
    if (tilt) this.rotation.multiply(this.lean.setFromAxisAngle(this.yAxis, tilt));
    this.matrix.compose(this.position, this.rotation, this.scale);
    mesh.setMatrixAt(index, this.matrix);
    if (color !== undefined) mesh.setColorAt(index, this.colour.setHex(color));
  }

  private trim(x: number, y: number, h: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: number, tilt = 0): void {
    this.place(this.box, this.boxIndex++, x, y, h, lx, ly, lz, sx, sy, sz, color, tilt);
  }

  private render(): void {
    this.boxIndex = 0;
    const { state } = this;
    let movingCars = 0, walkers = 0, frightened = 0;
    for (const car of state.cars) {
      const { x, y, heading: h, id } = car;
      const paint = CAR_PAINT[id], tall = id % 3 === 1 ? 1.13 : 1;
      this.place(this.bodies, id, x, y, h, 0, 0, 0, 1, 1, 1, paint);
      this.place(this.glass, id, x, y, h, 0, 0, 0, 1, 1, tall);
      this.trim(x, y, h, -0.1, 0, 1.18 * tall, 1.2, 1.37, 0.08, paint);
      for (const side of [-1, 1]) {
        this.trim(x, y, h, 0.07, side * 0.707, 0.99 * tall, 0.065, 0.045, 0.37 * tall, paint);
        this.trim(x, y, h, 0.74, side * 0.92, 0.81, 0.2, 0.12, 0.095, paint);
        this.trim(x, y, h, -0.15, side * 0.847, 0.62, 0.27, 0.025, 0.04, 0xb2b1a6);
        this.trim(x, y, h, 1.99, side * 0.56, 0.48, 0.065, 0.34, 0.105, 0xffedc4);
        this.trim(x, y, h, -2.035, side * 0.58, 0.57, 0.035, 0.32, 0.095, car.stopped === 'none' ? 0xb9493a : 0xf37151);
      }
      this.trim(x, y, h, 2.03, 0, 0.34, 0.055, 0.67, 0.13, BLACK);
      this.trim(x, y, h, -2.055, 0, 0.36, 0.055, 1.4, 0.09, BLACK);
      this.trim(x, y, h, 2.07, 0, 0.48, 0.025, 0.32, 0.1, 0xe1d9bc);
      let wheel = id * 4;
      for (const axle of [-1.28, 1.27]) for (const side of [-1, 1]) {
        this.place(this.tyres, wheel, x, y, h, axle, side * 0.855, 0.29, 1, 1, 1, BLACK, -car.wheelPhase);
        this.place(this.rims, wheel++, x, y, h, axle, side * 0.855, 0.29, 1, 1, 1, 0xb8b1a0, -car.wheelPhase);
      }
      if (car.speed > 0.3) movingCars++;
    }
    for (const p of state.pedestrians) {
      const { x, y, heading: h, id } = p, skin = SKIN[id % SKIN.length], shirt = SHIRTS[id % SHIRTS.length];
      const swing = p.moving ? Math.sin(p.phase) * (p.scared > 0 ? 0.65 : 0.42) : 0;
      this.trim(x, y, h, 0, 0, 1.12, 0.29, 0.39, 0.51, shirt);
      this.trim(x, y, h, 0, 0, 0.81, 0.24, 0.32, 0.16, TROUSERS[id % 4]);
      this.trim(x, y, h, 0, 0, 1.43, 0.12, 0.12, 0.11, skin);
      this.place(this.heads, id, x, y, h, 0, 0, 1.57, 0.145, 0.14, 0.175, skin);
      this.trim(x, y, h, -0.025, 0, 1.699, 0.255, 0.26, 0.09, HAIR[id % 4]);
      if (id % 4 === 0) this.trim(x, y, h, 0.11, 0, 1.738, 0.22, 0.31, 0.035, shirt);
      for (const side of [-1, 1]) {
        const leg = swing * side, lift = p.moving ? Math.max(0, Math.sin(p.phase) * side) * 0.07 : 0;
        this.trim(x, y, h, Math.sin(leg) * 0.12, side * 0.10, 0.45, 0.135, 0.14, 0.60, TROUSERS[id % 4], leg);
        this.trim(x, y, h, 0.05 + Math.sin(leg) * 0.28, side * 0.10, 0.065 + lift, 0.24, 0.15, 0.13, id % 3 ? 0x3e3b33 : 0xd7cbb4);
        this.trim(x, y, h, -Math.sin(leg) * 0.11, side * 0.26, 1.05, 0.11, 0.12, 0.49, shirt, -leg);
        this.trim(x, y, h, -Math.sin(leg) * 0.25, side * 0.26, 0.77, 0.10, 0.105, 0.115, skin, -leg);
        this.trim(x, y, h, 0.138, side * 0.052, 1.60, 0.022, 0.022, 0.027, BLACK);
      }
      if (id % 3 === 2) {
        this.trim(x, y, h, -0.04, 0.34, 0.94, 0.23, 0.15, 0.32, 0x88634a);
        this.trim(x, y, h, 0, 0.30, 1.17, 0.045, 0.035, 0.60, 0x88634a);
      }
      if (p.moving) walkers++;
      if (p.scared > 0) frightened++;
    }
    // A compact, two-sided mast at each bend gives the stop phases a visible cause.
    for (let i = 0; i < 4; i++) {
      const x = i < 2 ? 30.4 : -30.4, y = i === 0 || i === 3 ? -30.4 : 30.4;
      this.trim(x, y, 0, 0, 0, 1.65, 0.12, 0.12, 3.3, 0x56534b);
      this.trim(x, y, 0, 0, 0, 3.1, 0.35, 0.22, 0.60, BLACK);
      for (let axis = 0; axis < 2; axis++) {
        const green = state.signalPhase === (axis ? 'vertical' : 'horizontal');
        this.place(this.signalLamps, i * 2 + axis, x, y, 0, axis ? 0 : 0.185, axis ? 0.125 : 0, 3.16, 0.07, 0.07, 0.13, green ? 0x7cba88 : 0xe67b64);
      }
    }
    this.box.count = this.boxIndex;
    for (const mesh of [this.box, this.bodies, this.glass, this.tyres, this.rims, this.heads, this.signalLamps]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    Object.assign(this.diagnostics, { movingCars, walkingPedestrians: walkers, frightenedPedestrians: frightened,
      signalPhase: state.signalPhase, signalStops: state.stops.signal, followStops: state.stops.following,
      pedestrianYields: state.stops.pedestrian, playerYields: state.stops.player, worldStops: state.stops.world });
  }

  private rayBody(origin: ArrayLike<number>, direction: ArrayLike<number>, x: number, y: number, heading: number,
    halfLength: number, halfWidth: number, minZ: number, maxZ: number, reach: number): number | null {
    if (!(reach >= 0)) return null;
    const c = Math.cos(heading), s = Math.sin(heading), dx = origin[0] - x, dy = origin[1] - y;
    const ox = dx * c + dy * s, oy = -dx * s + dy * c;
    const vx = direction[0] * c + direction[1] * s, vy = -direction[0] * s + direction[1] * c;
    let near = 0, far = reach;
    if (vx === 0) { if (Math.abs(ox) > halfLength) return null; }
    else { const a = (-halfLength - ox) / vx, b = (halfLength - ox) / vx; near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b)); }
    if (vy === 0) { if (Math.abs(oy) > halfWidth) return null; }
    else { const a = (-halfWidth - oy) / vy, b = (halfWidth - oy) / vy; near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b)); }
    if (direction[2] === 0) { if (origin[2] < minZ || origin[2] > maxZ) return null; }
    else { const a = (minZ - origin[2]) / direction[2], b = (maxZ - origin[2]) / direction[2]; near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b)); }
    return near <= far ? near : null;
  }
}
