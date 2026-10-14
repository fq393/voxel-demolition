import * as THREE from 'three/webgpu';
import { attribute, float, length, mix, pow, sin, smoothstep, uv, vec3 } from 'three/tsl';

const RINGS = 12;
const SHARDS = 192;
const SCORCHES = 24;
const GRAVITY = 9.81;

interface Halo {
  at: THREE.Vector3;
  colour: THREE.Color;
  age: number;
  life: number;
  radius: number;
}
interface Shard {
  at: THREE.Vector3;
  velocity: THREE.Vector3;
  turn: THREE.Euler;
  spin: THREE.Vector3;
  size: THREE.Vector3;
  colour: THREE.Color;
  age: number;
  life: number;
  metal: number;
  heat: number;
}
interface Scorch {
  at: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  rotation: number;
  opacity: number;
}

export interface BlastOptions { fuel?: boolean; tint?: number }

/** Three draws, fixed CPU/GPU storage: brief shock/flash, tumbling chips, and fading ground char. */
export class BlastDetails {
  readonly object = new THREE.Group();
  private readonly haloMesh: THREE.InstancedMesh;
  private readonly shardMesh: THREE.InstancedMesh;
  private readonly scorchMesh: THREE.InstancedMesh;
  private readonly haloData: THREE.InstancedBufferAttribute;
  private readonly shardData: THREE.InstancedBufferAttribute;
  private readonly scorchData: THREE.InstancedBufferAttribute;
  private readonly halos: Halo[] = Array.from({ length: RINGS }, () => ({ at: new THREE.Vector3(), colour: new THREE.Color(), age: 1, life: 1, radius: 1 }));
  private readonly shards: Shard[] = Array.from({ length: SHARDS }, () => ({ at: new THREE.Vector3(), velocity: new THREE.Vector3(),
    turn: new THREE.Euler(), spin: new THREE.Vector3(), size: new THREE.Vector3(), colour: new THREE.Color(), age: 1, life: 1, metal: 0, heat: 0 }));
  private readonly scorches: Scorch[] = Array.from({ length: SCORCHES }, () => ({ at: new THREE.Vector3(), age: 1, life: 1, size: 1, rotation: 0, opacity: 0 }));
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly billboard = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private haloHead = 0;
  private shardHead = 0;
  private scorchHead = 0;
  private seed = 1;
  private bursts = 0;
  private disposed = false;

  constructor() {
    // The same small quad renders a thin annulus or a central flash; per-instance data keeps it one draw.
    const haloGeometry = new THREE.PlaneGeometry(2, 2);
    this.haloData = new THREE.InstancedBufferAttribute(new Float32Array(RINGS * 2 * 2), 2).setUsage(THREE.DynamicDrawUsage);
    haloGeometry.setAttribute('blastHalo', this.haloData);
    const halo = attribute('blastHalo', 'vec2');
    const radial = length(uv().sub(0.5).mul(2));
    const annulus = smoothstep(0.80, 0.89, radial).mul(float(1).sub(smoothstep(0.95, 1, radial)));
    const core = pow(float(1).sub(radial).max(0), 2.2);
    const haloMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, depthWrite: false, fog: true });
    haloMaterial.opacityNode = mix(annulus, core, halo.y).mul(halo.x) as unknown as THREE.Node<'float'>;
    this.haloMesh = this.instances(haloGeometry, haloMaterial, RINGS * 2, true);

    const shardGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.shardData = new THREE.InstancedBufferAttribute(new Float32Array(SHARDS * 2), 2).setUsage(THREE.DynamicDrawUsage);
    shardGeometry.setAttribute('blastChip', this.shardData);
    const chip = attribute('blastChip', 'vec2');
    const shardMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.62 });
    shardMaterial.metalnessNode = chip.x as unknown as THREE.Node<'float'>;
    shardMaterial.emissiveNode = vec3(4, 1, 0.1).mul(chip.y) as unknown as THREE.Node<'color'>;
    this.shardMesh = this.instances(shardGeometry, shardMaterial, SHARDS, true);

    const scorchGeometry = new THREE.PlaneGeometry(2, 2);
    this.scorchData = new THREE.InstancedBufferAttribute(new Float32Array(SCORCHES * 2), 2).setUsage(THREE.DynamicDrawUsage);
    scorchGeometry.setAttribute('blastScorch', this.scorchData);
    const scorch = attribute('blastScorch', 'vec2');
    const wobble = sin(uv().x.mul(39).add(scorch.y)).mul(sin(uv().y.mul(31).add(scorch.y))).mul(0.07);
    const edge = float(1).sub(smoothstep(0.32, 0.98, radial.add(wobble)));
    const scorchMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    scorchMaterial.colorNode = vec3(0.022, 0.015, 0.010) as unknown as THREE.Node<'color'>;
    scorchMaterial.opacityNode = edge.mul(scorch.x) as unknown as THREE.Node<'float'>;
    this.scorchMesh = this.instances(scorchGeometry, scorchMaterial, SCORCHES, false);
    this.scorchMesh.renderOrder = 1;
    this.clear();
  }

  private instances(geometry: THREE.BufferGeometry, material: THREE.Material, count: number, colours: boolean): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (colours) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.count = 0;
    this.object.add(mesh);
    return mesh;
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  burst(at: ArrayLike<number>, radius: number, options: BlastOptions = {}): void {
    if (this.disposed || !Number.isFinite(radius) || radius <= 0
      || !Number.isFinite(at[0]) || !Number.isFinite(at[1]) || !Number.isFinite(at[2])) return;
    const r = Math.max(0.25, Math.min(radius, 12));
    const fuel = options.fuel === true;
    const halo = this.halos[this.haloHead];
    this.haloHead = (this.haloHead + 1) % RINGS;
    halo.at.set(at[0], at[1], at[2]);
    halo.radius = r;
    halo.age = 0;
    halo.life = fuel ? 0.48 : 0.36;
    if (fuel) halo.colour.setRGB(3.5, 1.0, 0.15);
    else halo.colour.setRGB(2.4, 1.8, 1.05);

    const count = Math.min(30, Math.round((fuel ? 18 : 10) + r * 3));
    const speed = Math.sqrt(r);
    for (let i = 0; i < count; i++) {
      const shard = this.shards[this.shardHead];
      this.shardHead = (this.shardHead + 1) % SHARDS;
      const angle = this.random() * Math.PI * 2;
      const spread = 1.5 + this.random() * 5;
      shard.at.set(at[0] + Math.cos(angle) * r * 0.07, at[1] + Math.sin(angle) * r * 0.07, at[2]);
      shard.velocity.set(Math.cos(angle) * spread * speed, Math.sin(angle) * spread * speed, (2 + this.random() * 4) * speed);
      shard.age = 0;
      shard.life = 1.8 + this.random() * 1.4;
      shard.metal = fuel || this.random() < 0.45 ? 0.8 : 0.05;
      shard.heat = fuel && this.random() < 0.28 ? 1 : 0;
      shard.turn.set(this.random() * 6, this.random() * 6, this.random() * 6);
      shard.spin.set((this.random() - 0.5) * 18, (this.random() - 0.5) * 18, (this.random() - 0.5) * 18);
      const length = 0.12 + this.random() * 0.23;
      shard.size.set(length * 0.45, shard.metal > 0.5 ? 0.025 : 0.06, length);
      if (options.tint !== undefined && Number.isFinite(options.tint)) shard.colour.setHex(options.tint);
      else if (shard.metal > 0.5) shard.colour.setRGB(0.26 + this.random() * 0.18, 0.21, 0.15);
      else shard.colour.setRGB(0.27, 0.11 + this.random() * 0.1, 0.035);
    }

    // No ground decal for upper floors or roof blasts: the layer has no terrain projection pass.
    if (at[2] >= -0.2 && at[2] <= 1.6) {
      const scorch = this.scorches[this.scorchHead];
      this.scorchHead = (this.scorchHead + 1) % SCORCHES;
      scorch.at.set(at[0], at[1], 0.018);
      scorch.age = 0;
      scorch.life = fuel ? 50 : 35;
      scorch.size = Math.max(0.35, Math.min(r * 0.6, 2.5));
      scorch.rotation = this.random() * Math.PI * 2;
      scorch.opacity = fuel ? 0.70 : 0.42;
    }
    this.bursts++;
    this.writeInstances();
  }

  update(dt: number, camera?: THREE.Camera): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    if (camera) camera.getWorldQuaternion(this.billboard);
    for (const halo of this.halos) if (halo.age < halo.life) halo.age += dt;
    for (const scorch of this.scorches) if (scorch.age < scorch.life) scorch.age += dt;
    for (const shard of this.shards) {
      if (shard.age >= shard.life) continue;
      shard.age += dt;
      if (shard.age >= shard.life) continue;
      shard.at.x += shard.velocity.x * dt;
      shard.at.y += shard.velocity.y * dt;
      shard.at.z += shard.velocity.z * dt - 0.5 * GRAVITY * dt * dt;
      shard.velocity.z -= GRAVITY * dt;
      const floor = shard.size.z * 0.5;
      if (shard.at.z < floor) {
        shard.at.z = floor;
        shard.velocity.z = Math.abs(shard.velocity.z) * 0.24;
        shard.velocity.x *= 0.65;
        shard.velocity.y *= 0.65;
        shard.spin.multiplyScalar(0.6);
      }
      shard.turn.x += shard.spin.x * dt;
      shard.turn.y += shard.spin.y * dt;
      shard.turn.z += shard.spin.z * dt;
    }
    this.writeInstances();
  }

  private writeInstances(): void {
    let haloCount = 0, shardCount = 0, scorchCount = 0;
    for (const halo of this.halos) {
      if (halo.age >= halo.life) continue;
      const f = halo.age / halo.life;
      const size = 0.12 + halo.radius * (1 - (1 - f) ** 3);
      this.matrix.compose(halo.at, this.billboard, this.scale.set(size, size, 1));
      this.haloMesh.setMatrixAt(haloCount, this.matrix);
      this.haloMesh.setColorAt(haloCount, halo.colour);
      this.haloData.setXY(haloCount++, (1 - f) ** 2 * 0.7, 0);
      const flash = Math.max(0, 1 - halo.age / 0.16);
      if (flash > 0) {
        const flashSize = halo.radius * (0.28 + 0.08 * flash);
        this.matrix.compose(halo.at, this.billboard, this.scale.set(flashSize, flashSize, 1));
        this.haloMesh.setMatrixAt(haloCount, this.matrix);
        this.haloMesh.setColorAt(haloCount, halo.colour);
        this.haloData.setXY(haloCount++, flash * flash, 1);
      }
    }
    for (const shard of this.shards) {
      if (shard.age >= shard.life) continue;
      const fade = Math.min(1, (shard.life - shard.age) / 0.6);
      this.scale.copy(shard.size).multiplyScalar(fade);
      this.matrix.compose(shard.at, this.quaternion.setFromEuler(shard.turn), this.scale);
      this.shardMesh.setMatrixAt(shardCount, this.matrix);
      this.shardMesh.setColorAt(shardCount, shard.colour);
      this.shardData.setXY(shardCount++, shard.metal, shard.heat * Math.max(0, 1 - shard.age / 0.8));
    }
    for (const scorch of this.scorches) {
      if (scorch.age >= scorch.life) continue;
      // City up is z, whereas Three's default up is y.
      this.quaternion.set(0, 0, Math.sin(scorch.rotation / 2), Math.cos(scorch.rotation / 2));
      this.matrix.compose(scorch.at, this.quaternion, this.scale.set(scorch.size, scorch.size, 1));
      this.scorchMesh.setMatrixAt(scorchCount, this.matrix);
      this.scorchData.setXY(scorchCount++, scorch.opacity * Math.min(1, (scorch.life - scorch.age) / 8), scorch.rotation);
    }
    this.haloMesh.count = haloCount;
    this.shardMesh.count = shardCount;
    this.scorchMesh.count = scorchCount;
    this.haloMesh.instanceMatrix.needsUpdate = this.shardMesh.instanceMatrix.needsUpdate = this.scorchMesh.instanceMatrix.needsUpdate = true;
    this.haloMesh.instanceColor!.needsUpdate = this.shardMesh.instanceColor!.needsUpdate = true;
    this.haloData.needsUpdate = this.shardData.needsUpdate = this.scorchData.needsUpdate = true;
  }

  clear(): void {
    for (const halo of this.halos) halo.age = halo.life;
    for (const shard of this.shards) shard.age = shard.life;
    for (const scorch of this.scorches) scorch.age = scorch.life;
    this.haloHead = this.shardHead = this.scorchHead = this.bursts = 0;
    this.seed = 1;
    this.haloMesh.count = this.shardMesh.count = this.scorchMesh.count = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    for (const mesh of [this.haloMesh, this.shardMesh, this.scorchMesh]) {
      mesh.dispose();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.object.clear();
  }

  get diagnostics(): Readonly<{ activeHalos: number; activeShards: number; activeScorches: number; haloCapacity: number;
    shardCapacity: number; scorchCapacity: number; drawCalls: number; geometries: number; materials: number; triangles: number; bursts: number; disposed: boolean }> {
    let activeHalos = 0;
    for (const halo of this.halos) if (halo.age < halo.life) activeHalos++;
    return { activeHalos, activeShards: this.shardMesh.count, activeScorches: this.scorchMesh.count,
      haloCapacity: RINGS, shardCapacity: SHARDS, scorchCapacity: SCORCHES,
      drawCalls: Number(this.haloMesh.count > 0) + Number(this.shardMesh.count > 0) + Number(this.scorchMesh.count > 0),
      geometries: this.disposed ? 0 : 3, materials: this.disposed ? 0 : 3,
      triangles: this.haloMesh.count * 2 + this.shardMesh.count * 12 + this.scorchMesh.count * 2,
      bursts: this.bursts, disposed: this.disposed };
  }
}
