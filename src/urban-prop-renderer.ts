/** Fine, shared presentation for destructible voxel props. Any damage reveals the real rubble. */
import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { State, VOXEL, type City } from './world.ts';
import type { UrbanPropKind } from './urban-prop-types.ts';

type Vec = readonly [number, number, number];
type Kind = UrbanPropKind | 'shelf' | 'counter' | 'cooler' | 'sofa' | 'table' | 'bed' | 'cabinet';
type Role = 'wood' | 'metal' | 'paint' | 'soft' | 'glass' | 'display' | 'leaf';
interface Presentation { id: string; kind: Kind; object: number; voxels: number[]; center: Vec; size: Vec; base: number }
interface Part { at: Vec; scale: Vec; color: number; rotation: Vec; owner: number }
interface Batch { geometry: THREE.BufferGeometry; material: THREE.MeshStandardNodeMaterial; parts: Part[]; mesh?: THREE.InstancedMesh }
interface Watch { voxels: number[]; parts: { batch: Batch; index: number; matrix: THREE.Matrix4 }[]; intact: boolean }
export interface UrbanPropDiagnostics {
  props: number; furniture: number; intact: number; damaged: number; drawCalls: number;
  instances: number; triangles: number; geometries: number; materials: number; textures: number;
}
const C = { cream: 0xe7d9b9, coral: 0xc47d62, sage: 0x739582, wood: 0xb28757,
  darkWood: 0x76573d, iron: 0x52665e, brass: 0xb39b68, glass: 0x668f92, dark: 0x293831, leaf: 0x78935b };

/** Bounds come from original grid cells, even if readback has moved loose voxel positions. */
function presentations(city: City): { entries: Presentation[]; props: number; furniture: number } {
  const entries: Presentation[] = [];
  const propCount = city.urbanProps?.length ?? 0;
  const add = (id: string, kind: Kind, object: number) => {
    const b = city.buildings[object]; if (!b) return;
    const voxels: number[] = [];
    let x1 = Infinity, y1 = Infinity, z1 = Infinity, x2 = -Infinity, y2 = -Infinity, z2 = -Infinity;
    for (let cell = 0; cell < b.cells.length; cell++) {
      const voxel = b.cells[cell]; if (voxel < 0) continue; voxels.push(voxel);
      const x = b.x0 + cell % b.w, y = b.y0 + Math.floor(cell / b.w) % b.d, z = Math.floor(cell / (b.w * b.d));
      x1 = Math.min(x1, x); y1 = Math.min(y1, y); z1 = Math.min(z1, z);
      x2 = Math.max(x2, x + 1); y2 = Math.max(y2, y + 1); z2 = Math.max(z2, z + 1);
    }
    if (!voxels.length) return;
    entries.push({ id, kind, object, voxels, center: [(x1 + x2) * VOXEL / 2, (y1 + y2) * VOXEL / 2, (z1 + z2) * VOXEL / 2],
      size: [(x2 - x1) * VOXEL, (y2 - y1) * VOXEL, (z2 - z1) * VOXEL], base: z1 * VOXEL });
  };
  for (const prop of city.urbanProps ?? []) add(prop.id, prop.kind, prop.object);
  let furniture = 0;
  for (const building of city.district ?? []) for (const prop of building.furniture) {
    const suffix = prop.id.split('-').slice(1).join('-');
    const kind: Kind = suffix.startsWith('shelf') || suffix.startsWith('rack') ? 'shelf'
      : suffix.startsWith('crate') ? 'crate' : suffix === 'counter' ? 'counter' : suffix === 'cooler' ? 'cooler'
        : suffix === 'sofa' ? 'sofa' : suffix === 'table' ? 'table' : suffix === 'bed' ? 'bed' : 'cabinet';
    add(prop.id, kind, prop.object); furniture++;
  }
  return { entries, props: propCount, furniture };
}

export class UrbanPropRenderer {
  readonly object = new THREE.Group();
  private readonly geometry = new Map<string, THREE.BufferGeometry>();
  private readonly material = new Map<Role, THREE.MeshStandardNodeMaterial>();
  private readonly batches = new Map<string, Batch>();
  private watch: Watch[] = [];
  private disposed = false;
  private counts: UrbanPropDiagnostics = { props: 0, furniture: 0, intact: 0, damaged: 0, drawCalls: 0,
    instances: 0, triangles: 0, geometries: 0, materials: 0, textures: 0 };
  private readonly onMask: (voxels: readonly number[], hidden: boolean) => void;
  get diagnostics(): Readonly<UrbanPropDiagnostics> { return Object.freeze({ ...this.counts }); }

  constructor(city: City, onMask: (voxels: readonly number[], hidden: boolean) => void) {
    this.onMask = onMask; this.object.name = 'destructible-street-prop-detail';
    this.createKit(); this.reset(city);
  }
  reset(city: City): void {
    if (this.disposed) return;
    this.clearInstances();
    const { entries, props, furniture } = presentations(city);
    this.watch = entries.map(p => ({ voxels: p.voxels, parts: [], intact: p.voxels.every(v => city.state[v] === State.Fixed) }));
    entries.forEach((p, index) => this.model(p, index));
    const transform = new THREE.Object3D(), color = new THREE.Color();
    let triangles = 0, instances = 0;
    for (const [name, batch] of this.batches) {
      if (!batch.parts.length) continue;
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.parts.length);
      mesh.name = name; mesh.receiveShadow = true; mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      batch.parts.forEach((p, index) => {
        transform.position.set(...p.at); transform.scale.set(...p.scale); transform.rotation.set(...p.rotation); transform.updateMatrix();
        const matrix = transform.matrix.clone(); mesh.setMatrixAt(index, matrix); mesh.setColorAt(index, color.setHex(p.color));
        this.watch[p.owner].parts.push({ batch, index, matrix });
      });
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Keep full original bounds after damage: zero-scaled parts must not cause over-culling of their neighbours.
      mesh.computeBoundingBox(); mesh.computeBoundingSphere(); batch.mesh = mesh; this.object.add(mesh);
      instances += mesh.count; triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * mesh.count;
    }
    this.counts = { props, furniture, intact: 0, damaged: 0, drawCalls: this.object.children.length, instances, triangles,
      geometries: this.geometry.size, materials: this.material.size, textures: 0 };
    for (const watch of this.watch) this.setPresentation(watch, watch.intact);
  }
  /** First changed voxel tears down every intact detail part of that one object. */
  update(city: City): void {
    if (this.disposed) return;
    for (const watch of this.watch)
      if (watch.intact && watch.voxels.some(v => city.state[v] !== State.Fixed)) this.setPresentation(watch, false);
  }
  dispose(): void {
    if (this.disposed) return;
    this.clearInstances();
    for (const g of this.geometry.values()) g.dispose(); for (const m of this.material.values()) m.dispose();
    this.geometry.clear(); this.material.clear(); this.object.removeFromParent(); this.disposed = true;
    this.counts = { props: 0, furniture: 0, intact: 0, damaged: 0, drawCalls: 0, instances: 0, triangles: 0,
      geometries: 0, materials: 0, textures: 0 };
  }
  private clearInstances(): void {
    for (const watch of this.watch) if (watch.intact) this.onMask(watch.voxels, false);
    for (const batch of this.batches.values()) batch.mesh?.dispose();
    this.object.clear(); this.batches.clear(); this.watch = [];
  }
  private setPresentation(watch: Watch, intact: boolean): void {
    const wasIntact = watch.intact;
    watch.intact = intact;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const part of watch.parts) {
      part.batch.mesh!.setMatrixAt(part.index, intact ? part.matrix : hidden);
      part.batch.mesh!.instanceMatrix.needsUpdate = true;
    }
    this.onMask(watch.voxels, intact);
    // During reset counters start at zero; subsequent damage moves exactly one object.
    if (this.counts.intact + this.counts.damaged < this.watch.length) {
      if (intact) this.counts.intact++; else this.counts.damaged++;
    } else if (wasIntact && !intact) { this.counts.intact--; this.counts.damaged++; }
  }
  private createKit(): void {
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 16); cylinder.rotateX(Math.PI / 2);
    const cone = new THREE.CylinderGeometry(.08, 1, 1, 16); cone.rotateX(Math.PI / 2);
    const lathe = (points: readonly [number, number][]) => {
      const g = new THREE.LatheGeometry(points.map(([r, z]) => new THREE.Vector2(r, z)), 20); g.rotateX(Math.PI / 2); return g;
    };
    this.geometry.set('box', new THREE.BoxGeometry(1, 1, 1));
    this.geometry.set('bevel', new RoundedBoxGeometry(1, 1, 1, 1, .04));
    this.geometry.set('cylinder', cylinder); this.geometry.set('cone', cone);
    this.geometry.set('barrel', lathe([[0, -.5], [.91, -.5], [1, -.44], [1, -.35], [.98, .35], [1, .44], [.91, .5], [0, .5]]));
    this.geometry.set('bottle', lathe([[0, -.5], [.85, -.5], [1, -.43], [1, .21], [.92, .31], [.62, .42], [.28, .46], [.28, .5], [0, .5]]));
    this.geometry.set('ring', new THREE.TorusGeometry(1, .055, 4, 20));
    this.geometry.set('bush', new THREE.IcosahedronGeometry(1, 1));
    for (const [role, roughness, metalness] of [
      ['wood', .89, 0], ['metal', .46, .58], ['paint', .71, .18], ['soft', .94, 0],
      ['glass', .23, .24], ['display', .32, .1], ['leaf', .95, 0],
    ] as const) {
      const m = new THREE.MeshStandardNodeMaterial({ roughness, metalness }); m.name = `urban-${role}`;
      if (role === 'display') { m.emissive.setHex(0x6c9075); m.emissiveIntensity = .18; }
      this.material.set(role, m);
    }
  }
  private put(owner: number, geometry: string, role: Role, at: Vec, scale: Vec, color: number, rotation: Vec = [0, 0, 0]): void {
    const key = `${geometry}-${role}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { geometry: this.geometry.get(geometry)!, material: this.material.get(role)!, parts: [] }; this.batches.set(key, batch);
    }
    batch.parts.push({ at, scale, color, rotation, owner });
  }
  private model(p: Presentation, owner: number): void {
    const [x, y] = p.center, [w, d, h] = p.size, b = p.base;
    const part = (geometry: string, role: Role, dx: number, dy: number, z: number, sx: number, sy: number, sz: number, color: number, rotation: Vec = [0, 0, 0]) =>
      this.put(owner, geometry, role, [x + dx, y + dy, b + z], [sx, sy, sz], color, rotation);
    const box = (role: Role, dx: number, dy: number, z: number, sx: number, sy: number, sz: number, color: number, bevel = false, rotation: Vec = [0, 0, 0]) =>
      part(bevel ? 'bevel' : 'box', role, dx, dy, z, sx, sy, sz, color, rotation);
    const legs = (height: number, role: Role = 'wood') => {
      for (const dx of [-w / 2 + .09, w / 2 - .09]) for (const dy of [-d / 2 + .09, d / 2 - .09])
        box(role, dx, dy, height / 2, .13, .13, height, role === 'metal' ? C.iron : C.darkWood);
    };
    if (p.kind === 'fuelBarrel' || p.kind === 'gasCylinder') {
      const barrel = p.kind === 'fuelBarrel', radius = w * .46, bodyHeight = barrel ? h : h - .22;
      part(barrel ? 'barrel' : 'bottle', 'paint', 0, 0, bodyHeight / 2, radius, radius, bodyHeight, barrel ? C.coral : C.sage);
      for (const z of barrel ? [.12, h * .32, h * .72, h - .08] : [.10, bodyHeight - .06])
        part('ring', 'metal', 0, 0, z, radius * .99, radius * .99, radius * .7, C.iron);
      if (barrel) {
        part('cylinder', 'metal', radius * .32, radius * .25, h + .015, .055, .055, .035, C.brass);
        part('cylinder', 'metal', -radius * .38, -.12, h + .01, .028, .028, .025, C.iron);
      } else {
        box('metal', 0, 0, h - .14, .13, .12, .16, C.brass, true);
        part('ring', 'metal', 0, 0, h - .035, .10, .10, .05, C.iron);
        box('metal', .065, 0, h - .13, .16, .065, .065, C.brass);
      }
      // A pale hazard badge with a physical crossed mark, readable without relying on colour.
      box('paint', 0, -radius - .012, bodyHeight * .55, .29, .025, .27, C.cream);
      for (const tilt of [-.7, .7]) box('metal', 0, -radius - .031, bodyHeight * .55, .035, .018, .24, C.dark, false, [0, tilt, 0]);
      return;
    }
    if (p.kind === 'crate') {
      box('wood', 0, 0, .045, w - .025, d - .025, .09, C.darkWood);
      const rows = Math.max(3, Math.round(h / .22)), step = (h - .04) / rows;
      for (let n = 0; n < rows; n++) {
        const z = (n + .5) * step;
        for (const dy of [-d / 2 + .025, d / 2 - .025]) box('wood', 0, dy, z, w - .04, .055, step - .018, n % 2 ? C.wood : 0x9e774f);
        for (const dx of [-w / 2 + .025, w / 2 - .025]) box('wood', dx, 0, z, .055, d - .04, step - .018, n % 2 ? C.wood : 0xb58e63);
      }
      for (const dx of [-w / 2 + .075, w / 2 - .075]) for (const dy of [-d / 2 + .058, d / 2 - .058])
        box('wood', dx, dy, h / 2, .095, .075, h, C.darkWood);
      for (let n = 0; n < 5; n++) box('wood', (n - 2) * w / 5, 0, h - .035, w / 5 - .012, d - .04, .07, C.wood);
      const angle = Math.atan2(h * .75, w * .7);
      box('wood', 0, -d / 2 - .014, h / 2, Math.hypot(w * .7, h * .75), .05, .09, C.darkWood, false, [0, -angle, 0]);
      for (const dx of [-w * .3, w * .3]) for (const z of [.12, h - .12])
        part('cylinder', 'metal', dx, -d / 2 - .043, z, .016, .016, .012, C.iron, [Math.PI / 2, 0, 0]);
      return;
    }
    if (p.kind === 'pallet') {
      for (const dx of [-w * .4, 0, w * .4]) box('wood', dx, 0, h * .32, .16, d, h * .62, C.darkWood);
      for (let n = 0; n < 5; n++) {
        const dy = (n - 2) * d / 5;
        box('wood', 0, dy, h - .065, w, d / 5 - .035, .13, n % 2 ? C.wood : 0xc19b70);
      }
      return;
    }
    if (p.kind === 'barricade') {
      for (const dx of [-w * .42, w * .42]) {
        box('metal', dx, 0, .06, .18, d, .12, C.iron, true);
        box('metal', dx, 0, h / 2, .09, .10, h, C.iron);
      }
      for (const z of [h * .60, h * .86]) {
        box('paint', 0, 0, z, w, .13, .19, C.cream, true);
        for (let n = 0; n < 7; n++) box('paint', (n - 3) * w / 7, -.076, z, .11, .018, .20, C.coral, false, [0, -.42, 0]);
      }
      return;
    }
    if (p.kind === 'cone') {
      box('soft', 0, 0, .065, w, d, .13, C.dark, true);
      part('cone', 'paint', 0, 0, h * .54, w * .40, d * .40, h * .86, C.coral);
      for (const [z, radius] of [[.40, .27], [.64, .17]]) part('ring', 'paint', 0, 0, z * h, radius * w, radius * d, .23, C.cream);
      return;
    }
    if (p.kind === 'dumpster') {
      box('paint', 0, 0, h * .44, w * .94, d * .94, h * .80, C.sage, true);
      box('metal', 0, 0, h * .88, w, d, .14, C.iron, true);
      for (const dx of [-w * .31, w * .31]) {
        box('metal', dx, d * .48, h * .88, .22, .12, .10, C.brass, true);
        box('metal', dx, -d * .47, h * .55, .3, .08, .08, C.iron, true);
      }
      for (const dx of [-w * .4, w * .4]) for (const dy of [-d * .35, d * .35])
        part('cylinder', 'soft', dx, dy, .085, .085, .085, .09, C.dark, [Math.PI / 2, 0, 0]);
      for (const dx of [-w * .28, 0, w * .28]) box('paint', dx, -d * .475, h * .40, .05, .035, h * .48, 0x92a593);
      box('paint', 0, -d * .49, h * .65, .40, .028, .21, C.cream);
      return;
    }
    if (p.kind === 'vending' || p.kind === 'cooler') {
      const vending = p.kind === 'vending';
      box('paint', 0, 0, h / 2, w, d, h, C.cream, true);
      const glassW = vending ? w * .59 : w * .80, glassX = vending ? -w * .11 : 0;
      box('glass', glassX, -d / 2 - .018, h * .57, glassW, .035, h * .65, C.glass);
      for (const dx of [glassX - glassW / 2, glassX + glassW / 2]) box('metal', dx, -d / 2 - .042, h * .57, .045, .055, h * .67, C.iron);
      for (const z of [h * .25, h * .90]) box('metal', glassX, -d / 2 - .042, z, glassW, .055, .045, C.iron);
      for (let row = 0; row < 3; row++) {
        const z = h * (.35 + row * .17);
        box('metal', glassX, -d / 2 - .045, z - .065, glassW - .07, .045, .025, C.cream);
        for (let n = 0; n < 4; n++) part('cylinder', 'paint', glassX + (n - 1.5) * glassW / 4, -d / 2 - .055, z, .045, .035, h * .11, [C.coral, C.sage, C.cream, 0xc5a36a][n]);
      }
      if (vending) {
        box('display', w * .33, -d / 2 - .025, h * .73, w * .17, .045, .16, 0x85b09b);
        for (let n = 0; n < 4; n++) box('metal', w * .33, -d / 2 - .034, h * .62 - n * .075, .06, .045, .038, C.iron, true);
        box('metal', 0, -d / 2 - .025, h * .13, w * .52, .06, .17, C.dark, true);
        for (let n = 0; n < 5; n++) box('metal', -w * .18 + n * .08, -d / 2 - .025, .07, .025, .025, .07, C.iron);
      } else box('metal', w * .33, -d / 2 - .07, h * .54, .055, .08, .44, C.brass, true);
      return;
    }
    if (p.kind === 'planter') {
      const potHeight = h * .69;
      box('paint', 0, 0, potHeight / 2, w, d, potHeight, C.coral, true);
      box('paint', 0, 0, potHeight, w * 1.015, d * 1.015, .10, C.cream, true);
      box('wood', 0, 0, potHeight + .05, w * .83, d * .78, .06, C.darkWood);
      for (let n = 0; n < 3; n++) {
        const dx = (n - 1) * w * .29;
        part('bush', 'leaf', dx, 0, h * .83, w * .23, d * .41, h * .23, n % 2 ? 0x8eaa6e : C.leaf);
        part('bush', 'soft', dx + .05, -d * .18, h * .94, .06, .06, .05, n % 2 ? C.cream : 0xd19b7b);
      }
      return;
    }
    if (p.kind === 'shelf' || p.kind === 'cabinet') {
      const cabinet = p.kind === 'cabinet';
      if (cabinet) box('wood', 0, d / 2 - .04, h / 2, w, .08, h, C.darkWood);
      for (const dx of [-w / 2 + .055, w / 2 - .055]) for (const dy of [-d / 2 + .055, d / 2 - .055])
        box(cabinet ? 'wood' : 'metal', dx, dy, h / 2, .11, .11, h, cabinet ? C.darkWood : C.iron);
      const levels = 3;
      for (let n = 0; n < levels; n++) {
        const z = .07 + n * (h - .19) / levels;
        box('wood', 0, 0, z, w, d, .10, C.wood);
        const packs = Math.max(3, Math.min(7, Math.floor(w / .34)));
        for (let k = 0; k < packs; k++) {
          const pw = (w - .22) / packs, height = cabinet ? .18 + k % 3 * .08 : .28 + k % 3 * .025;
          box(cabinet ? 'soft' : 'paint', -w / 2 + .11 + pw * (k + .5), -.08, z + .06 + height / 2,
            pw * .72, Math.min(d * .65, .36), height, [0xccad72, C.sage, C.coral, C.cream][(k + n) % 4], true);
        }
      }
      return;
    }
    if (p.kind === 'counter') {
      box('wood', 0, 0, h * .34, w * .97, d * .97, h * .66, C.darkWood, true);
      box('paint', 0, 0, h * .70, w, d, .12, C.cream, true);
      for (const dx of [-w * .32, 0, w * .32]) box('wood', dx, -d / 2 - .012, h * .32, w * .27, .035, h * .52, C.wood);
      box('wood', -w * .24, 0, h * .86, w * .34, d * .52, h * .23, 0xc29a6b, true);
      for (const dx of [-w * .27, -w * .21]) box('paint', dx, 0, h * .86, .045, d * .54, h * .24, C.cream);
      box('metal', w * .30, -.06, h * .84, .27, .21, .20, C.iron, true);
      box('display', w * .30, -.175, h * .87, .18, .025, .08, 0x85b09b);
      return;
    }
    if (p.kind === 'sofa') {
      legs(.43); box('wood', 0, 0, .49, w, d, .17, C.darkWood, true);
      box('soft', 0, d * .37, h * .72, w, d * .22, h * .55, C.coral, true);
      for (const dx of [-w * .45, w * .45]) box('soft', dx, 0, h * .59, w * .10, d * .9, h * .28, 0xb17d66, true);
      for (let n = 0; n < 3; n++) {
        const dx = (n - 1) * w * .27;
        box('soft', dx, -d * .05, h * .55, w * .26, d * .69, .22, 0xce9b7f, true);
        box('soft', dx, d * .27, h * .77, w * .25, .22, h * .38, 0xba8870, true, [-.12, 0, 0]);
      }
      return;
    }
    if (p.kind === 'table') {
      legs(h - .12); box('wood', 0, 0, h - .065, w, d, .13, C.wood, true);
      for (let n = 0; n < 4; n++) box('wood', (n - 1.5) * w / 4, 0, h + .001, .012, d * .96, .007, C.darkWood);
      return;
    }
    // Upstairs bed: framed headboard, separated mattress, quilt fold and two pillows.
    legs(.39); box('wood', 0, 0, .46, w, d, .17, C.darkWood, true);
    box('soft', 0, -.03, h * .55, w * .94, d * .92, .25, C.cream, true);
    box('soft', 0, -d * .16, h * .66, w * .96, d * .60, .12, C.sage, true);
    box('soft', 0, d * .12, h * .68, w * .96, .18, .15, 0x8da28a, true);
    box('wood', 0, d / 2 - .045, h * .74, w, .09, h * .5, C.darkWood, true);
    for (const dx of [-w * .22, w * .22]) box('soft', dx, d * .30, h * .75, w * .37, d * .22, .18, C.cream, true);
  }
}
