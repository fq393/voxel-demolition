import * as THREE from 'three/webgpu';
import { type StaticBox } from './city-colliders.ts';

type Point = readonly [number, number, number];
type Placement = { position: Point; scale: Point; color: number; heading: number };
type Batch = { geometry: THREE.BufferGeometry; material: THREE.MeshStandardNodeMaterial; placements: Placement[]; shadow: boolean };

const CREAM = 0xf4e5c6;
const SAND = 0xd4b98e;
const CORAL = 0xcd856c;
const TEAL = 0x3b7977;
const BRONZE = 0x4d6157;
const LEAF = 0x567e50;
const CLOTH = [0xd7a181, 0x698f87, 0xe6cc93] as const;

/**
 * Authored coastal-city dress for the existing skyline and its open park lots.
 * All parts are static instances with shared geometry/materials and no textures.
 * Ground-level props stay in park interiors, clear of traffic and pedestrian paths.
 */
export class CityAmbience {
  readonly object = new THREE.Group();
  /** Optional ground-only collision proxies; roofs/storefronts use skyline bounds. */
  readonly colliders: StaticBox[] = [];
  readonly diagnostics: Readonly<{
    drawCalls: number; shadowDrawCalls: number; triangles: number; instances: number;
    geometries: number; materials: number; textures: number; palms: number;
    dressedBuildings: number; storefronts: number; cafeTables: number; groundColliders: number;
  }>;
  private readonly batches = new Map<string, Batch>();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private palms = 0;
  private storefronts = 0;
  private cafeTables = 0;

  constructor(boxes: readonly StaticBox[]) {
    this.object.name = 'warmCoastalCity';
    this.createKit();
    const near = boxes
      .filter((b) => Math.hypot((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2) < 88 && b.maxZ < 38)
      .sort((a, b) => Math.hypot(a.minX + a.maxX, a.minY + a.maxY) - Math.hypot(b.minX + b.maxX, b.minY + b.maxY))
      .slice(0, 18);
    near.forEach((b, i) => this.building(b, i, boxes));
    this.park();
    this.cafe();

    let instances = 0;
    let triangles = 0;
    let drawCalls = 0;
    let shadowDrawCalls = 0;
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    for (const [name, batch] of this.batches) {
      if (!batch.placements.length) continue;
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.placements.length);
      mesh.name = name;
      mesh.receiveShadow = true;
      mesh.castShadow = batch.shadow;
      batch.placements.forEach((p, i) => {
        transform.position.set(...p.position);
        transform.scale.set(...p.scale);
        transform.rotation.set(0, 0, p.heading);
        transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
        mesh.setColorAt(i, color.setHex(p.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.object.add(mesh);
      drawCalls++;
      if (batch.shadow) shadowDrawCalls++;
      instances += mesh.count;
      triangles += ((mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3) * mesh.count;
    }
    this.diagnostics = Object.freeze({ drawCalls, shadowDrawCalls, triangles, instances, geometries: this.geometries.size, materials: this.materials.size, textures: 0, palms: this.palms, dressedBuildings: near.length, storefronts: this.storefronts, cafeTables: this.cafeTables, groundColliders: this.colliders.length });
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.traverse((child) => { if (child instanceof THREE.InstancedMesh) child.dispose(); });
    this.object.clear();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.batches.clear();
    this.colliders.length = 0;
  }

  private createKit(): void {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 16);
    cylinder.rotateX(Math.PI / 2);
    const bush = new THREE.IcosahedronGeometry(1, 1);
    const canopy = this.parasol();
    for (const geometry of [box, cylinder, bush, canopy]) this.geometries.add(geometry);
    const solid = this.material('sunwashedStuccoAndOak', 0.87);
    const metal = this.material('bronzeAndPowdercoat', 0.49, 0.48);
    const glass = this.material('coolTealShopGlass', 0.2, 0.25);
    glass.emissive.setHex(0x152928);
    glass.emissiveIntensity = 0.12;
    const fabric = this.material('wovenAwningAndUmbrella', 0.96);
    fabric.vertexColors = true;
    fabric.side = THREE.DoubleSide;
    const trunk = this.material('fibrousPalmBark', 0.94);
    const leaf = this.material('palmFronds', 0.79);
    leaf.side = THREE.DoubleSide;
    leaf.vertexColors = true;
    const foliage = this.material('planterFoliage', 0.91);
    this.batches.set('cornicesPlantersAndCafeWood', { geometry: box, material: solid, placements: [], shadow: false });
    this.batches.set('shopFramesAndCafeMetal', { geometry: box, material: metal, placements: [], shadow: false });
    this.batches.set('shopfrontGlass', { geometry: box, material: glass, placements: [], shadow: false });
    this.batches.set('stripedCanvasAwnings', { geometry: box, material: fabric, placements: [], shadow: false });
    this.batches.set('palmTrunks', { geometry: this.palmTrunk(), material: trunk, placements: [], shadow: true });
    this.batches.set('featheredPalmCrowns', { geometry: this.palmFrond(), material: leaf, placements: [], shadow: true });
    this.batches.set('terracottaPotsAndCafeTables', { geometry: cylinder, material: solid, placements: [], shadow: false });
    this.batches.set('scallopedCafeParasols', { geometry: canopy, material: fabric, placements: [], shadow: true });
    this.batches.set('lowGardenFoliage', { geometry: bush, material: foliage, placements: [], shadow: false });
  }

  private material(name: string, roughness: number, metalness = 0): THREE.MeshStandardNodeMaterial {
    const material = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness, metalness });
    material.name = name;
    this.materials.add(material);
    return material;
  }

  private put(role: string, position: Point, scale: Point, color: number, heading = 0): void {
    this.batches.get(role)!.placements.push({ position, scale, color, heading });
  }

  private solid(position: Point, scale: Point, color = CREAM, heading = 0): void {
    this.put('cornicesPlantersAndCafeWood', position, scale, color, heading);
  }

  private metal(position: Point, scale: Point, color = BRONZE, heading = 0): void {
    this.put('shopFramesAndCafeMetal', position, scale, color, heading);
  }

  private groundBox(x: number, y: number, w: number, d: number, h: number): void {
    this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: y - d / 2, maxY: y + d / 2, minZ: 0, maxZ: h });
  }

  private building(b: StaticBox, index: number, all: readonly StaticBox[]): void {
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const w = b.maxX - b.minX;
    const d = b.maxY - b.minY;
    const h = b.maxZ;
    // Three stepped cornice bands and a low parapet read as a deliberate Deco roofline.
    for (const [z, thickness, lip] of [[h - 0.72, 0.14, 0.16], [h - 0.31, 0.2, 0.25], [h + 0.08, 0.18, 0.32]]) {
      this.solid([cx, b.minY - lip / 2, z], [w + lip * 2, lip, thickness]);
      this.solid([cx, b.maxY + lip / 2, z], [w + lip * 2, lip, thickness]);
      this.solid([b.minX - lip / 2, cy, z], [lip, d, thickness]);
      this.solid([b.maxX + lip / 2, cy, z], [lip, d, thickness]);
    }
    const roofTone = index % 3 === 0 ? 0xe0ac94 : 0xe8d7b8;
    this.solid([cx + w * 0.12, cy + d * 0.08, h + 0.67], [w * 0.45, d * 0.38, 1.34], roofTone);
    this.solid([cx + w * 0.12, cy + d * 0.08, h + 1.38], [w * 0.47, d * 0.4, 0.1]);
    for (const offset of [-1, 1]) {
      this.metal([cx - w * 0.24, cy + offset * d * 0.2, h + 0.28], [0.95, 0.8, 0.56], 0x839087);
      for (let slit = -2; slit <= 2; slit++) this.metal([cx - w * 0.24 + slit * 0.15, cy + offset * d * 0.2, h + 0.57], [0.045, 0.65, 0.02], 0x3c4a45);
    }
    const faces: [number, number, number][] = Math.abs(cx) > Math.abs(cy)
      ? [[-Math.sign(cx), 0, d], [0, -Math.sign(cy || 1), w]]
      : [[0, -Math.sign(cy), w], [-Math.sign(cx || 1), 0, d]];
    faces.forEach(([nx, ny, length], side) => {
      const fx = nx ? (nx < 0 ? b.minX : b.maxX) : cx;
      const fy = ny ? (ny < 0 ? b.minY : b.maxY) : cy;
      // Dress the public street-facing side; skip faces pressed against a neighbour.
      const outX = fx + nx * 1.4;
      const outY = fy + ny * 1.4;
      if (all.some((other) => other !== b && outX > other.minX && outX < other.maxX && outY > other.minY && outY < other.maxY)) return;
      this.shop(fx, fy, nx, ny, Math.min(5.8, length - 0.8), index + side);
    });
  }

  private shop(x: number, y: number, nx: number, ny: number, width: number, index: number): void {
    if (width < 2) return;
    this.storefronts++;
    const tx = -ny;
    const ty = nx;
    const heading = Math.atan2(ty, tx);
    const place = (role: string, along: number, out: number, z: number, w: number, d: number, h: number, color: number) => {
      this.put(role, [x + tx * along + nx * out, y + ty * along + ny * out, z], [w, d, h], color, heading);
    };
    const stone = 'cornicesPlantersAndCafeWood';
    const metal = 'shopFramesAndCafeMetal';
    const color = CLOTH[index % CLOTH.length];
    place('shopfrontGlass', 0, 0.025, 1.45, width, 0.06, 2.5, 0x598f95);
    for (const along of [-width / 2, -width / 6, width / 6, width / 2]) place(metal, along, 0.08, 1.4, 0.075, 0.12, 2.75, TEAL);
    place(stone, 0, 0.08, 0.16, width + 0.25, 0.18, 0.32, SAND);
    place(stone, 0, 0.08, 2.78, width + 0.3, 0.18, 0.16, CREAM);
    place(metal, width * 0.055, 0.12, 1.22, 0.04, 0.09, 0.37, 0xd2b78a);
    // Alternating canvas stripes continue down the valance, instead of a solid box lid.
    const stripeCount = Math.max(8, Math.round(width / 0.35));
    for (let stripe = 0; stripe < stripeCount; stripe++) {
      const along = (stripe + 0.5) * width / stripeCount - width / 2;
      const tint = stripe % 2 ? color : 0xf0e2c4;
      place('stripedCanvasAwnings', along, 0.65, 3.03, width / stripeCount, 1.32, 0.1, tint);
      place('stripedCanvasAwnings', along, 1.26, 2.92, width / stripeCount, 0.1, 0.28, tint);
    }
    place(stone, 0, 0.16, 3.49, width * 0.8, 0.17, 0.55, index % 3 === 0 ? CORAL : TEAL);
    this.word(index % 3 === 0 ? 'CAFE' : index % 3 === 1 ? 'HOTEL' : 'SHOP', x + nx * 0.26, y + ny * 0.26, tx, ty, heading, 3.48, 0.3);
    // Narrow end piers carry the warm facade down to the pavement.
    for (const side of [-1, 1]) place(stone, side * (width / 2 + 0.22), 0.08, 1.55, 0.18, 0.2, 3.1, CREAM);
  }

  /** Small authored sign glyphs built into the shared box batch; no font/texture fetch. */
  private word(word: string, x: number, y: number, tx: number, ty: number, heading: number, z: number, size: number): void {
    const glyphs: Record<string, number[][]> = {
      C: [[1, 1, 0, 1], [0, 1, 0, 0], [0, 0, 1, 0]],
      A: [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0], [0, 0.5, 1, 0.5]],
      F: [[0, 0, 0, 1], [0, 1, 1, 1], [0, 0.5, 0.8, 0.5]],
      E: [[0, 0, 0, 1], [0, 1, 1, 1], [0, 0.5, 0.8, 0.5], [0, 0, 1, 0]],
      H: [[0, 0, 0, 1], [1, 0, 1, 1], [0, 0.5, 1, 0.5]],
      O: [[0, 0, 0, 1], [1, 0, 1, 1], [0, 1, 1, 1], [0, 0, 1, 0]],
      T: [[0, 1, 1, 1], [0.5, 0, 0.5, 1]],
      L: [[0, 1, 0, 0], [0, 0, 1, 0]],
      S: [[1, 1, 0, 1], [0, 1, 0, 0.5], [0, 0.5, 1, 0.5], [1, 0.5, 1, 0], [1, 0, 0, 0]],
      P: [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0.5], [1, 0.5, 0, 0.5]],
    };
    const width = size * 0.63;
    const advance = width + size * 0.38;
    const start = -(word.length - 1) * advance / 2;
    for (let i = 0; i < word.length; i++) {
      for (const [ax, az, bx, bz] of glyphs[word[i]] ?? []) {
        const along = start + i * advance + ((ax + bx) / 2 - 0.5) * width;
        this.solid([x + tx * along, y + ty * along, z + ((az + bz) / 2 - 0.5) * size], [Math.max(0.037, Math.abs(ax - bx) * width), 0.035, Math.max(0.037, Math.abs(az - bz) * size)], CREAM, heading);
      }
    }
  }

  private park(): void {
    // Southwest park: two planted islands, with a generous central walking promenade.
    for (const x of [-52.5, -39.5]) {
      this.solid([x, -46, 0.035], [8.5, 25, 0.07], 0x8a9a70);
      for (const y of [-56.5, -35.5]) this.solid([x, y, 0.08], [8.7, 0.16, 0.16], SAND);
      for (const y of [-54, -46, -38]) this.palm(x, y, 5.4 + ((Math.abs(x + y) % 5) / 5), x + y);
    }
    for (const y of [-53, -39]) {
      this.bench(-46, y, y < -46 ? 0 : Math.PI);
      this.planter(-48.3, y, 1.05, 0.7);
      this.planter(-43.7, y, 1.05, 0.7);
    }
    // More distant open lots form a soft palm-lined background, always inside the lots.
    for (const [x, y, height] of [[-84, -39, 6.7], [-100, -53, 7.4], [-130, -40, 6.6], [-144, -51, 7.7], [38, -53, 6.8], [54, -40, 7.3]]) this.palm(x, y, height, x - y);
  }

  private cafe(): void {
    // South lot: paving is flat/walkable. Keep [0,-42] +/- 4 m empty for the delivery.
    this.solid([0, -46, 0.025], [25, 26, 0.05], 0xcbbfa7);
    for (const [x, y, height] of [[-10.5, -36, 6], [10.5, -36, 6.6], [-10.5, -55.5, 6.4], [10.5, -55.5, 5.8]]) this.palm(x, y, height, x * y);
    for (const [x, y] of [[-7.6, -49.2], [7.6, -49.2], [-3.9, -55], [3.9, -55]]) this.table(x, y, x < 0 ? 0 : Math.PI / 5);
    this.bench(-10.2, -43.5, Math.PI / 2);
    this.bench(10.2, -43.5, -Math.PI / 2);
    for (const x of [-6, 6]) this.planter(x, -36, 2.3, 0.65);
  }

  private planter(x: number, y: number, w: number, d: number): void {
    this.solid([x, y, 0.3], [w, d, 0.6], 0xd6a08b);
    this.solid([x, y, 0.57], [w + 0.1, d + 0.1, 0.08], CREAM);
    this.solid([x, y, 0.62], [w - 0.14, d - 0.14, 0.035], 0x554e36);
    for (const t of [-0.28, 0, 0.28]) this.put('lowGardenFoliage', [x + t * w, y, 0.9], [w * 0.27, d * 0.55, 0.48], t === 0 ? 0x728b58 : LEAF);
    this.groundBox(x, y, w + 0.1, d + 0.1, 1.25);
  }

  private bench(x: number, y: number, heading: number): void {
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    const place = (metal: boolean, lx: number, ly: number, z: number, scale: Point) => {
      const p: Point = [x + lx * cos - ly * sin, y + lx * sin + ly * cos, z];
      if (metal) this.metal(p, scale, BRONZE, heading);
      else this.solid(p, scale, 0xb68852, heading);
    };
    for (const ly of [-0.22, 0, 0.22]) place(false, 0, ly, 0.53, [2.1, 0.17, 0.07]);
    for (const z of [0.8, 1.0]) place(false, 0, 0.3, z, [2.1, 0.06, 0.16]);
    for (const lx of [-0.8, 0.8]) {
      for (const ly of [-0.22, 0.3]) place(true, lx, ly, 0.25, [0.07, 0.07, 0.5]);
      place(true, lx, 0.3, 0.8, [0.06, 0.06, 0.7]);
    }
    const ex = Math.abs(cos) * 1.07 + Math.abs(sin) * 0.36;
    const ey = Math.abs(sin) * 1.07 + Math.abs(cos) * 0.36;
    this.groundBox(x, y, 2 * ex, 2 * ey, 1.15);
  }

  private table(x: number, y: number, heading: number): void {
    this.cafeTables++;
    this.put('terracottaPotsAndCafeTables', [x, y, 0.74], [0.58, 0.58, 0.065], 0xddd0b0);
    this.put('terracottaPotsAndCafeTables', [x, y, 0.045], [0.24, 0.24, 0.07], TEAL);
    this.metal([x, y, 0.39], [0.08, 0.08, 0.68], TEAL);
    this.metal([x, y, 1.42], [0.035, 0.035, 2.75], BRONZE);
    this.put('scallopedCafeParasols', [x, y, 2.85], [1.4, 1.4, 1], CLOTH[this.cafeTables % CLOTH.length], heading);
    for (const side of [-1, 1]) {
      const cx = x + side * 1.05 * Math.cos(heading);
      const cy = y + side * 1.05 * Math.sin(heading);
      const angle = heading + Math.PI / 2;
      this.solid([cx, cy, 0.46], [0.44, 0.43, 0.07], 0xb68852, angle);
      this.solid([cx + side * 0.21 * Math.cos(heading), cy + side * 0.21 * Math.sin(heading), 0.76], [0.44, 0.055, 0.42], 0xb68852, angle);
      for (const dx of [-0.16, 0.16]) for (const dy of [-0.16, 0.16]) this.metal([cx + dx, cy + dy, 0.22], [0.028, 0.028, 0.44], TEAL);
      this.groundBox(cx, cy, 0.55, 0.55, 1);
    }
    this.groundBox(x, y, 1.3, 1.3, 0.8);
  }

  private palm(x: number, y: number, height: number, seed: number): void {
    this.palms++;
    const angle = ((seed * 0.173) % 1) * Math.PI * 2;
    const scale = height / 6;
    this.put('palmTrunks', [x, y, 0.48], [1, 1, scale], 0x9b815c, angle);
    const topX = x + 0.16 * Math.cos(angle);
    const topY = y + 0.16 * Math.sin(angle);
    for (let leaf = 0; leaf < 8; leaf++) this.put('featheredPalmCrowns', [topX, topY, height + 0.48], [0.88 + (leaf % 3) * 0.1, 0.92, 0.9 + (leaf % 2) * 0.14], leaf % 3 === 0 ? 0x738d55 : LEAF, angle + leaf * Math.PI / 4);
    this.put('lowGardenFoliage', [topX, topY, height + 0.42], [0.38, 0.38, 0.55], 0x526e42);
    // A round terracotta tree basin gives an authored contact silhouette.
    this.put('terracottaPotsAndCafeTables', [x, y, 0.22], [0.72, 0.72, 0.44], 0xc58d70);
    this.put('terracottaPotsAndCafeTables', [x, y, 0.46], [0.79, 0.79, 0.08], 0xe6caa7);
    this.put('terracottaPotsAndCafeTables', [x, y, 0.51], [0.62, 0.62, 0.03], 0x6d6546);
    this.groundBox(x, y, 1.58, 1.58, 0.62);
    this.groundBox(x, y, 0.55, 0.55, height - 1.5);
  }

  private palmTrunk(): THREE.BufferGeometry {
    const vertices: number[] = [];
    const indices: number[] = [];
    const rings = 13;
    const sides = 8;
    for (let ring = 0; ring < rings; ring++) {
      const t = ring / (rings - 1);
      const x = -0.25 * Math.sin(t * Math.PI) + 0.16 * t;
      const radius = (0.205 - 0.09 * t) * (ring % 2 ? 0.94 : 1);
      for (let side = 0; side < sides; side++) {
        const a = side / sides * Math.PI * 2;
        vertices.push(x + Math.cos(a) * radius, Math.sin(a) * radius, t * 6);
      }
    }
    for (let ring = 0; ring < rings - 1; ring++) for (let side = 0; side < sides; side++) {
      const a = ring * sides + side;
      const b = ring * sides + (side + 1) % sides;
      indices.push(a, b, a + sides, b, b + sides, a + sides);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.geometries.add(geometry);
    return geometry;
  }

  private parasol(): THREE.BufferGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const panels = 16;
    const vertex = (x: number, y: number, z: number, tint: number): number => {
      const i = positions.length / 3;
      positions.push(x, y, z);
      colors.push(tint, tint, tint);
      return i;
    };
    for (let panel = 0; panel < panels; panel++) {
      const a = panel / panels * Math.PI * 2;
      const b = (panel + 1) / panels * Math.PI * 2;
      const m = (a + b) / 2;
      const tint = panel % 2 ? 0.82 : 1;
      const peak = vertex(0, 0, 0.23, tint);
      const left = vertex(Math.cos(a), Math.sin(a), -0.1, tint);
      const mid = vertex(Math.cos(m), Math.sin(m), -0.13, tint);
      const right = vertex(Math.cos(b), Math.sin(b), -0.1, tint);
      indices.push(peak, left, mid, peak, mid, right);
      // A scalloped fabric edge hangs below each spoke instead of a flat cylinder rim.
      const lowLeft = vertex(Math.cos(a), Math.sin(a), -0.18, tint);
      const lowMid = vertex(Math.cos(m), Math.sin(m), -0.25, tint);
      const lowRight = vertex(Math.cos(b), Math.sin(b), -0.18, tint);
      indices.push(left, lowLeft, mid, mid, lowLeft, lowMid, mid, lowMid, right, right, lowMid, lowRight);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private palmFrond(): THREE.BufferGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const point = (u: number, v: number): Point => [u * 3.1, v, Math.sin(u * Math.PI * 0.8) * 0.85 - u * u * 1.5 - Math.abs(v) * 0.24];
    const vertex = (p: Point, tint: number): number => {
      const index = positions.length / 3;
      positions.push(...p);
      colors.push(tint, tint, tint);
      return index;
    };
    for (let rib = 0; rib < 13; rib++) {
      const u = rib / 13;
      const next = (rib + 1) / 13;
      const a = vertex(point(u, -0.018), 0.93);
      const b = vertex(point(u, 0.018), 0.93);
      const c = vertex(point(next, -0.014), 0.87);
      const d = vertex(point(next, 0.014), 0.87);
      indices.push(a, c, b, b, c, d);
      // Paired, separated leaflets: a feathered silhouette, rather than a flat cone.
      const span = Math.sin((u + 0.04) * Math.PI) * 0.46 + 0.03;
      for (const side of [-1, 1]) {
        const root = vertex(point(u + 0.018, side * 0.015), 0.9);
        const tip = vertex(point(Math.max(0, u - 0.052), side * span), side < 0 ? 0.87 : 1.04);
        const end = vertex(point(next - 0.005, side * 0.02), 0.92);
        indices.push(root, tip, end);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.geometries.add(geometry);
    return geometry;
  }
}
