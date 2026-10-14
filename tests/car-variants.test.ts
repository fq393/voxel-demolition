import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { CAR_MASS, CAR_SIZE, Car, sweep } from '../src/car.ts';
import { VEHICLES, vehicleSpec, type VehicleId } from '../src/vehicle-spec.ts';
import { type City, State } from '../src/world.ts';

const throttle = { throttle: 1, steer: 0, handbrake: false, boost: false };
function drive(car: Car, seconds: number, steer = 0): void {
  for (let frame = 0; frame < seconds * 120; frame++) car.step(1 / 120, { ...throttle, steer });
}
function visibleBounds(car: Car): THREE.Box3 {
  car.draw(1);
  car.object.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  car.object.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) if (!parent.visible) return;
    object.geometry.computeBoundingBox();
    bounds.union(object.geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld));
  });
  return bounds;
}

test('city models fit their declared colliders and have distinct heights and an open pickup bed', () => {
  const heights: number[] = [];
  const bedHeights: number[] = [];
  for (const spec of VEHICLES) {
    const car = new Car(spec.id);
    try {
      const bounds = visibleBounds(car);
      assert.deepEqual(car.size, spec.size);
      assert.equal(car.mass, spec.mass);
      assert.ok(bounds.min.x >= -spec.size[0] / 2 - 1e-6 && bounds.max.x <= spec.size[0] / 2 + 1e-6);
      assert.ok(bounds.min.y >= -spec.size[1] / 2 - 1e-6 && bounds.max.y <= spec.size[1] / 2 + 1e-6);
      assert.ok(bounds.min.z >= -1e-6 && bounds.max.z <= spec.size[2] + 1e-6);
      heights.push(bounds.max.z);
      const body = car.object.getObjectByName('damageable-body') as THREE.Mesh;
      const ray = new THREE.Raycaster(new THREE.Vector3(-1.45, 0, 3), new THREE.Vector3(0, 0, -1));
      bedHeights.push(ray.intersectObject(body)[0].point.z);
      car.wantGuns = car.wantRockets = true;
      for (let frame = 0; frame < 120; frame++) car.step(1 / 60, { throttle: 0, steer: 0, handbrake: false, boost: false });
      const armed = visibleBounds(car);
      assert.ok(armed.min.x >= -spec.size[0] / 2 - 1e-6 && armed.max.x <= spec.size[0] / 2 + 1e-6);
      assert.ok(armed.min.y >= -spec.size[1] / 2 - 1e-6 && armed.max.y <= spec.size[1] / 2 + 1e-6);
      assert.ok(armed.max.z <= spec.size[2] + 1e-6, 'deployed weapons also stay inside the city car dimensions');
    } finally { car.dispose(); }
  }
  assert.ok(heights[0] < heights[1] && heights[1] < heights[2]);
  assert.ok(bedHeights[1] < 0.9, 'the pickup has an open load bed rather than a solid upper box');
  assert.ok(bedHeights[2] > 2, 'the van has a tall enclosed cargo roof');
});

test('city driving is slower than the track car and vehicle acceleration, speed and steering differ', () => {
  const cars = [new Car(), ...VEHICLES.map((spec) => new Car(spec.id))];
  try {
    assert.equal(cars[0].vehicleId, null);
    assert.deepEqual(cars[0].size, CAR_SIZE);
    assert.equal(cars[0].mass, CAR_MASS);
    for (const car of cars) drive(car, 3);
    const speeds = cars.map((car) => car.speed);
    assert.ok(speeds[0] > speeds[1] + 5);
    assert.ok(speeds[1] > speeds[2] + 3 && speeds[2] > speeds[3] + 3);
    for (const car of cars) drive(car, 60);
    for (let index = 1; index < cars.length; index++) {
      const car = cars[index];
      assert.ok(car.speed < vehicleSpec(car.vehicleId).maxSpeed && car.speed > vehicleSpec(car.vehicleId).maxSpeed * 0.8);
      car.place(0, 0, 0);
      car.velocity.set(8, 0);
      drive(car, 0.5, 1);
    }
    assert.ok(cars[1].heading > cars[2].heading && cars[2].heading > cars[3].heading);
  } finally { for (const car of cars) car.dispose(); }
});

test('a tall van hits a low overhead voxel that the original and sedan can pass beneath', () => {
  const cells = new Int32Array(9).fill(-1); cells[8] = 0;
  const city: City = {
    count: 1, position: new Float32Array([0.125, 0.125, 2.125]), material: new Uint8Array(1), building: new Uint16Array(1), cell: new Int32Array([8]),
    color: new Uint32Array(1), state: new Uint8Array([State.Fixed]), exposed: new Uint8Array(1), pane: new Int32Array([-1]), panes: [],
    buildings: [{ x0: 0, y0: 0, w: 1, d: 1, h: 9, cells }], pitch: 30, street: 16, blocks: 1,
  };
  assert.deepEqual(sweep(city, 0, 0, 0), []);
  assert.deepEqual(sweep(city, 0, 0, 0, vehicleSpec('sedan').size), []);
  assert.deepEqual(sweep(city, 0, 0, 0, vehicleSpec('van').size), [0]);
});

test('garage swaps keep a compatible exhaust socket count for the shared afterfire pool', () => {
  for (const spec of VEHICLES) {
    const car = new Car(spec.id);
    try { assert.equal(car.exhausts().at.length, 2); }
    finally { car.dispose(); }
  }
});

test('city damage, weapons and repair retain the original APIs', () => {
  for (const id of ['sedan', 'pickup', 'van'] as VehicleId[]) {
    const car = new Car(id);
    try {
      car.place(2, -3, 0.3); car.draw(1);
      const body = car.object.getObjectByName('damageable-body') as THREE.Mesh;
      const intact = body.geometry.drawRange.count;
      car.object.updateMatrixWorld(true);
      const hit = body.localToWorld(new THREE.Vector3(-1.9, 0.75, id === 'sedan' ? 0.75 : 1.15));
      car.hurt(0.4, hit); car.draw(1); car.bits.update(1 / 60);
      assert.equal(car.health, 0.6);
      assert.notEqual(body.geometry.drawRange.count, intact);
      assert.ok(car.bits.object.count > 0);
      car.wantGuns = car.wantRockets = true;
      drive(car, 1); car.draw(1);
      const muzzles = car.muzzles();
      assert.equal(muzzles.guns.length, 2); assert.equal(muzzles.rockets.length, 2);
      assert.ok(muzzles.guns.concat(muzzles.rockets).every((point) => point.toArray().every(Number.isFinite)));
      car.repair(); car.draw(1);
      assert.equal(car.health, 1); assert.equal(car.bits.object.count, 0);
      assert.equal(body.geometry.drawRange.count, intact);
    } finally { car.dispose(); }
  }
});

test('garage replacement disposes each shared geometry and material once, including its separate bits pool', () => {
  const scene = new THREE.Scene();
  const car = new Car('van'); scene.add(car.object, car.bits.object);
  const resources = new Set<THREE.BufferGeometry | THREE.Material>();
  for (const root of [car.object, car.bits.object]) root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) resources.add(material);
  });
  const disposed = new Map<THREE.BufferGeometry | THREE.Material, number>();
  for (const resource of resources) resource.addEventListener('dispose', () => disposed.set(resource, (disposed.get(resource) ?? 0) + 1));
  let instanceDisposed = 0;
  car.bits.object.addEventListener('dispose', () => instanceDisposed++);
  car.dispose(); car.dispose();
  assert.equal(car.object.parent, null); assert.equal(car.bits.object.parent, null);
  assert.equal(disposed.size, resources.size);
  assert.ok([...disposed.values()].every((count) => count === 1));
  assert.equal(instanceDisposed, 1);
});
