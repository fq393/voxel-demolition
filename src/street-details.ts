import * as THREE from 'three/webgpu';
import { State, VOXEL, type Building, type City } from './world.ts';

type Placement = { position: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] };
type Binding = { root: THREE.Group; voxels: number[] };

/** Fine surface dress for the existing destructible street furniture. Z remains up. */
export class StreetDetails {
  readonly object = new THREE.Group();
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private bindings: Binding[] = [];
  private nextCheck = 0;

  constructor(city: City) {
    this.object.name = 'warmStreetFurniture';
    this.reset(city);
  }

  /** Poll only these six tiny furniture objects, rather than the whole city. */
  update(states: Uint8Array): void {
    const now = performance.now();
    if (now < this.nextCheck) return;
    this.nextCheck = now + 100;
    for (const binding of this.bindings) {
      if (binding.root.visible && binding.voxels.some((v) => states[v] !== State.Fixed)) binding.root.visible = false;
    }
  }

  reset(city: City): void {
    // The shared geometry and material kit survives a level rebuild.
    this.object.traverse((child) => { if (child instanceof THREE.InstancedMesh) child.dispose(); });
    this.object.clear();
    this.bindings = [];
    this.nextCheck = 0;
    const furniture: { name: string; x0: number; y0: number; w: number; d: number; h: number; kind: 'bench' | 'bin' | 'hydrant' }[] = [
      { name: 'southBench', x0: -42, y0: -56, w: 8, d: 3, h: 4, kind: 'bench' },
      { name: 'westBench', x0: -56, y0: 30, w: 3, d: 8, h: 4, kind: 'bench' },
      { name: 'southBin', x0: -48, y0: -55, w: 2, d: 2, h: 5, kind: 'bin' },
      { name: 'westBin', x0: -55, y0: 24, w: 2, d: 2, h: 5, kind: 'bin' },
      { name: 'busStopBin', x0: 36, y0: -63, w: 2, d: 2, h: 5, kind: 'bin' },
      { name: 'cornerHydrant', x0: 57, y0: -66, w: 1, d: 1, h: 4, kind: 'hydrant' },
    ];
    for (const spec of furniture) {
      const b = city.buildings.find((candidate) => candidate.x0 === spec.x0 && candidate.y0 === spec.y0 && candidate.w === spec.w && candidate.d === spec.d && candidate.h === spec.h);
      // Other scenes intentionally get no furniture: their object IDs and physics differ.
      if (!b) continue;
      const root = new THREE.Group();
      root.name = spec.name;
      root.position.set((b.x0 + b.w / 2) * VOXEL, (b.y0 + b.d / 2) * VOXEL, 0);
      if (spec.kind === 'bench') {
        if (b.w < b.d) root.rotation.z = -Math.PI / 2;
        this.bench(root);
      } else if (spec.kind === 'bin') this.bin(root);
      else this.hydrant(root);
      this.bind(root, b, city.state);
    }
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.traverse((child) => { if (child instanceof THREE.InstancedMesh) child.dispose(); });
    this.object.clear();
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.bindings = [];
  }

  get diagnostics() {
    let drawCalls = 0;
    let triangles = 0;
    let instances = 0;
    this.object.traverse((child) => {
      if (!(child instanceof THREE.InstancedMesh)) return;
      drawCalls++;
      instances += child.count;
      triangles += ((child.geometry.index?.count ?? child.geometry.attributes.position.count) / 3) * child.count;
    });
    return { objects: this.bindings.length, visibleObjects: this.bindings.filter((b) => b.root.visible).length, drawCalls, triangles, instances, geometries: this.geometries.size, materials: this.materials.size, watchedVoxels: this.bindings.reduce((sum, b) => sum + b.voxels.length, 0), checkIntervalMs: 100 };
  }

  private bind(root: THREE.Group, b: Building, states: Uint8Array): void {
    const voxels = Array.from(b.cells).filter((v) => v >= 0);
    root.visible = voxels.every((v) => states[v] === State.Fixed);
    this.bindings.push({ root, voxels });
    this.object.add(root);
  }

  private material(role: string, color: number, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
    let material = this.materials.get(role);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      material.name = role;
      this.materials.set(role, material);
    }
    return material;
  }

  private geometry(role: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geometry = this.geometries.get(role);
    if (!geometry) { geometry = create(); geometry.name = role; this.geometries.set(role, geometry); }
    return geometry;
  }

  /** Beveled rectangular solid. The requested dimensions include its bevel. */
  private bevel(role: string, x: number, y: number, z: number, bevel = 0.004): THREE.BufferGeometry {
    return this.geometry(role, () => {
      const b = Math.min(bevel, x / 4, y / 4, z / 4);
      const shape = new THREE.Shape();
      shape.moveTo(-x / 2 + b, -y / 2 + b);
      shape.lineTo(x / 2 - b, -y / 2 + b);
      shape.lineTo(x / 2 - b, y / 2 - b);
      shape.lineTo(-x / 2 + b, y / 2 - b);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: z - 2 * b, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: b, bevelThickness: b, curveSegments: 2 });
      geometry.translate(0, 0, -z / 2 + b);
      return geometry;
    });
  }

  private batch(root: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, placements: Placement[]): void {
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    mesh.name = name;
    mesh.receiveShadow = true;
    // Tiny dress meshes do not enlarge the physics/shadow budget.
    mesh.castShadow = false;
    const transform = new THREE.Object3D();
    placements.forEach((placement, i) => {
      transform.position.set(...placement.position);
      transform.rotation.set(...(placement.rotation ?? [0, 0, 0]));
      transform.scale.set(...(placement.scale ?? [1, 1, 1]));
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    root.add(mesh);
  }

  private bench(root: THREE.Group): void {
    const oak = this.material('oiledHoneyOak', 0xa57443, 0.57);
    const darkOak = this.material('oakEndgrain', 0x795231, 0.69);
    const iron = this.material('warmGraphiteIron', 0x34352f, 0.46, 0.65);
    const bolt = this.material('agedBrassFasteners', 0x998363, 0.39, 0.78);
    this.batch(root, 'beveledSeatSlats', this.bevel('seatSlat', 1.96, 0.229, 0.018), oak, [-0.25, 0].map((y) => ({ position: [0, y, 0.505] })));
    this.batch(root, 'roundedBackSlats', this.bevel('backSlat', 1.96, 0.018, 0.227), oak, [0.625, 0.875].map((z) => ({ position: [0, 0.116, z] })));
    const arms = this.geometry('curvedBenchArm', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.245, 0.49), new THREE.Vector3(0, -0.23, 0.67), new THREE.Vector3(0, -0.15, 0.7), new THREE.Vector3(0, 0.12, 0.7), new THREE.Vector3(0, 0.245, 0.64),
    ]), 14, 0.017, 6, false));
    this.batch(root, 'curvedIronArmrests', arms, iron, [-0.875, 0.875].map((x) => ({ position: [x, 0, 0] })));
    const heads = this.geometry('boltHead', () => new THREE.CylinderGeometry(0.014, 0.014, 0.004, 6));
    const bolts: Placement[] = [];
    for (const x of [-0.86, 0.86]) {
      for (const y of [-0.25, 0]) bolts.push({ position: [x, y, 0.517], rotation: [Math.PI / 2, 0, 0] });
      for (const z of [0.625, 0.875]) bolts.push({ position: [x, 0.104, z] });
    }
    this.batch(root, 'exposedSlatBolts', heads, bolt, bolts);
    const grain = this.bevel('woodGrain', 1.63, 0.0012, 0.0012, 0.0002);
    const streaks: Placement[] = [];
    for (const y of [-0.319, -0.262, -0.18, -0.072, -0.018, 0.071]) streaks.push({ position: [y > -0.1 ? -0.04 : 0.05, y, 0.515] });
    this.batch(root, 'fineOakGrain', grain, darkOak, streaks);
  }

  private bin(root: THREE.Group): void {
    const green = this.material('olivePowdercoat', 0x687855, 0.65, 0.28);
    const iron = this.material('warmGraphiteIron', 0x34352f, 0.46, 0.65);
    const badge = this.material('warmEnamelMarkings', 0xd6c6a3, 0.74);
    const ribs: Placement[] = [];
    for (const along of [-0.19, -0.115, -0.035, 0.045, 0.12, 0.195]) {
      for (const side of [-1, 1]) {
        ribs.push({ position: [along, side * 0.25, 0.55] });
        ribs.push({ position: [side * 0.25, along, 0.55], rotation: [0, 0, Math.PI / 2] });
      }
    }
    // The tiny lettering shares the rib batch instead of spending another draw call.
    ribs.push({ position: [0, -0.264, 0.853], scale: [4.93, 0.143, 0.0051] }, { position: [-0.012, -0.264, 0.828], scale: [3.25, 0.143, 0.0051] });
    this.batch(root, 'pressedVerticalRibsAndMarkings', this.bevel('binRib', 0.015, 0.014, 0.79), green, ribs);
    this.batch(root, 'beveledBinLid', this.bevel('binLid', 0.493, 0.493, 0.026, 0.006), iron, [{ position: [0, 0, 1.249] }]);
    const trim = this.geometry('squareBinTrim', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.221, -0.25, 0), new THREE.Vector3(0.221, -0.25, 0), new THREE.Vector3(0.25, -0.221, 0), new THREE.Vector3(0.25, 0.221, 0), new THREE.Vector3(0.221, 0.25, 0), new THREE.Vector3(-0.221, 0.25, 0), new THREE.Vector3(-0.25, 0.221, 0), new THREE.Vector3(-0.25, -0.221, 0),
    ], true, 'centripetal'), 32, 0.008, 5, true));
    this.batch(root, 'rolledSteelSeams', trim, iron, [{ position: [0, 0, 0.16] }, { position: [0, 0, 0.985] }]);
    const handle = this.geometry('foldedBinHandle', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.069, 0, 0), new THREE.Vector3(-0.066, 0, 0.035), new THREE.Vector3(0, 0, 0.05), new THREE.Vector3(0.066, 0, 0.035), new THREE.Vector3(0.069, 0, 0),
    ]), 12, 0.009, 6, false));
    this.batch(root, 'liftingHandle', handle, iron, [{ position: [0, 0, 1.263] }]);
    this.batch(root, 'enamelIdentificationPlate', this.bevel('binPlate', 0.132, 0.009, 0.083, 0.002), badge, [{ position: [0, -0.258, 0.84] }]);
  }

  private hydrant(root: THREE.Group): void {
    const red = this.material('hydrantWarmVermilion', 0xb95238, 0.49, 0.47);
    const brass = this.material('agedBrassFasteners', 0x998363, 0.39, 0.78);
    const cap = this.material('warmEnamelMarkings', 0xd6c6a3, 0.74);
    const crown = this.geometry('turnedHydrantCrown', () => {
      const geometry = new THREE.LatheGeometry([new THREE.Vector2(0.115, 0), new THREE.Vector2(0.113, 0.014), new THREE.Vector2(0.094, 0.032), new THREE.Vector2(0.056, 0.045), new THREE.Vector2(0, 0.047)], 16);
      geometry.rotateX(Math.PI / 2); // Lathe's y axis becomes the city's z axis.
      return geometry;
    });
    this.batch(root, 'castHydrantCrown', crown, cap, [{ position: [0, 0, 1.002] }]);
    const valve = this.geometry('hexagonalHydrantValve', () => new THREE.CylinderGeometry(0.063, 0.072, 0.022, 6));
    this.batch(root, 'sideValveCaps', valve, brass, [{ position: [0, -0.135, 0.575] }, { position: [0.135, 0, 0.575], rotation: [0, 0, Math.PI / 2] }]);
    this.batch(root, 'topValveNut', valve, brass, [{ position: [0, 0, 1.058], rotation: [Math.PI / 2, 0, 0], scale: [0.65, 0.65, 0.65] }]);
    const collar = this.geometry('hydrantCollar', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.11, -0.127, 0), new THREE.Vector3(0.11, -0.127, 0), new THREE.Vector3(0.127, -0.11, 0), new THREE.Vector3(0.127, 0.11, 0), new THREE.Vector3(0.11, 0.127, 0), new THREE.Vector3(-0.11, 0.127, 0), new THREE.Vector3(-0.127, 0.11, 0), new THREE.Vector3(-0.127, -0.11, 0),
    ], true, 'centripetal'), 24, 0.007, 5, true));
    this.batch(root, 'castCollarSeams', collar, red, [{ position: [0, 0, 0.15] }, { position: [0, 0, 0.703] }]);
  }
}
