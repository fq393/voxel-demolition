import * as THREE from 'three/webgpu';

const COUNT = 16, LIFE = 0.075;
/** Short travelling streaks, reusing every mesh, material and instance slot. */
export class RifleTraces {
  readonly object: THREE.InstancedMesh;
  private readonly slots = Array.from({ length: COUNT }, () => ({ from: new THREE.Vector3(), direction: new THREE.Vector3(), length: 0, age: LIFE, fresh: false }));
  private head = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly forward = new THREE.Vector3(0, 0, 1);
  private disposed = false;
  constructor() {
    this.object = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(3, 1.6, 0.4), depthWrite: false }), COUNT);
    this.object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.object.frustumCulled = false;
    this.clear();
  }
  fire(from: THREE.Vector3, to: THREE.Vector3): void {
    if (this.disposed || ![...from.toArray(), ...to.toArray()].every(Number.isFinite)) return;
    const slot = this.slots[this.head];
    this.head = (this.head + 1) % COUNT;
    slot.from.copy(from);
    slot.direction.copy(to).sub(from);
    slot.length = Math.min(100, slot.direction.length());
    slot.direction.normalize();
    slot.age = slot.length > 0.01 ? 0 : LIFE;
    slot.fresh = slot.length > 0.01;
  }
  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    let visible = 0;
    for (const slot of this.slots) {
      if (slot.fresh) slot.fresh = false;
      else slot.age = Math.min(LIFE, slot.age + dt);
      if (slot.age >= LIFE) continue;
      const length = Math.min(slot.length, 2.2), progress = slot.age / LIFE;
      this.position.copy(slot.from).addScaledVector(slot.direction, length / 2 + (slot.length - length) * progress);
      this.quaternion.setFromUnitVectors(this.forward, slot.direction);
      this.scale.set(0.014 * (1 - progress), 0.014 * (1 - progress), length);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.object.setMatrixAt(visible++, this.matrix);
    }
    this.object.count = visible;
    this.object.instanceMatrix.needsUpdate = true;
  }
  clear(): void { for (const slot of this.slots) { slot.age = LIFE; slot.fresh = false; } this.head = 0; this.object.count = 0; }
  dispose(): void {
    if (this.disposed) return;
    this.clear(); this.object.removeFromParent(); this.object.dispose(); this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose(); this.disposed = true;
  }
  get diagnostics(): { active: number; capacity: number } { return { active: this.object.count, capacity: COUNT }; }
}
