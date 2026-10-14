import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three/webgpu';
import { collectSkylineColliders, firstStaticHit, overlapsPlayer, overlapsVehicle, type StaticBox } from '../src/city-colliders.ts';

const box = (minX: number, maxX: number, minY: number, maxY: number, minZ = 0, maxZ = 10): StaticBox => ({ minX, maxX, minY, maxY, minZ, maxZ });

test('collects actual instance transforms in world coordinates while excluding paving', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 3);
  const transform = new THREE.Matrix4();
  mesh.setMatrixAt(0, transform.makeScale(30, 30, 0.12).setPosition(0, 0, 0.06));
  mesh.setMatrixAt(1, transform.makeScale(8, 6, 12).setPosition(20, 30, 6));
  mesh.setMatrixAt(2, transform.makeScale(-4, 2, 8).setPosition(-10, 5, 4));
  mesh.position.set(3, -2, 0);
  assert.deepEqual(collectSkylineColliders(mesh), [box(19, 27, 25, 31, 0, 12), box(-9, -5, 2, 4, 0, 8)]);
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
  mesh.dispose();
});

test('walking uses the whole player footprint and feet-to-head range, allowing contact', () => {
  const boxes = [box(5, 8, 2, 4, 0, 12)];
  assert.equal(overlapsPlayer(boxes, 4.71, 2.5, 0, 1.8), true);
  assert.equal(overlapsPlayer(boxes, 4.7, 2.5, 0, 1.8), false);
  assert.equal(overlapsPlayer(boxes, 6, 4.31, 0, 1.8), false);
  assert.equal(overlapsPlayer(boxes, 6, 3, 11.9, 1.8), true);
  assert.equal(overlapsPlayer(boxes, 6, 3, 12, 1.8), false);
  assert.equal(overlapsPlayer(boxes, 6, 3, -1.8, 1.8), false);
  assert.equal(overlapsPlayer(boxes, 6, 3, -1.79, 1.8), true);
  assert.equal(overlapsPlayer(boxes, 6, 3, 0, 0), false);
});

test('vehicle SAT catches rotated corners but rejects empty corners of its broad AABB', () => {
  const h = Math.PI / 4;
  assert.equal(overlapsVehicle([box(1.4, 1.6, 1.4, 1.6)], 0, 0, h), true);
  // This corner lies in the broad world AABB but outside the diagonal car body.
  assert.equal(overlapsVehicle([box(1.9, 2.1, -2.1, -1.9)], 0, 0, h), false);
  assert.equal(overlapsVehicle([box(2.25, 2.5, -0.1, 0.1)], 0, 0, 0), true);
  assert.equal(overlapsVehicle([box(2.3, 2.5, -0.1, 0.1)], 0, 0, 0), false);
  assert.equal(overlapsVehicle([box(-0.1, 0.1, 2.2, 2.4)], 0, 0, Math.PI / 2), true);
  assert.equal(overlapsVehicle([box(-0.1, 0.1, 1.1, 1.3)], 0, 0, 0), false);
  assert.equal(overlapsVehicle([box(9, 11, 20, 22)], 10, 20, 0, 0.5, 0.25), true);
});

test('cars collide only with boxes intersecting their ground-to-roof volume', () => {
  assert.equal(overlapsVehicle([box(-1, 1, -1, 1, 1.35, 5)], 0, 0, 0), false);
  assert.equal(overlapsVehicle([box(-1, 1, -1, 1, 1.34, 5)], 0, 0, 0), true);
  assert.equal(overlapsVehicle([box(-1, 1, -1, 1, -3, 0)], 0, 0, 0), false);
  assert.equal(overlapsVehicle([box(-1, 1, -1, 1, -3, 0.01)], 0, 0, 0), true);
});

test('rays return the nearest hit regardless of collider order and obey reach', () => {
  const boxes = [box(8, 10, -1, 1), box(3, 5, -1, 1), box(-5, -3, -1, 1)];
  assert.equal(firstStaticHit(boxes, [0, 0, 1], [1, 0, 0], 20), 3);
  assert.equal(firstStaticHit(boxes, [0, 0, 1], [1, 0, 0], 2.99), null);
  assert.equal(firstStaticHit(boxes, [0, 0, 1], [1, 0, 0], 3), 3);
  assert.equal(firstStaticHit(boxes, [0, 0, 1], [-1, 0, 0], 20), 3);
  assert.equal(firstStaticHit(boxes, [0, 0, 11], [1, 0, 0], 20), null);
  assert.equal(firstStaticHit(boxes, [4, 0, 14], [0, 0, -1], 20), 4);
});

test('parallel rays, starts inside/on a face and zero direction have stable slab semantics', () => {
  const boxes = [box(3, 5, -1, 1, 0, 10)];
  assert.equal(firstStaticHit(boxes, [4, 0, 1], [0, 1, 0], 20), 0);
  assert.equal(firstStaticHit(boxes, [3, 0, 1], [-1, 0, 0], 20), 0);
  assert.equal(firstStaticHit(boxes, [4, 0, 1], [0, 0, 0], 0), 0);
  assert.equal(firstStaticHit(boxes, [0, 0, 1], [0, 0, 0], 20), null);
  assert.equal(firstStaticHit(boxes, [2, 0, 1], [0, 1, 0], 20), null);
  assert.equal(firstStaticHit(boxes, [6, 0, 1], [1, 0, 0], 20), null);
  assert.equal(firstStaticHit(boxes, [0, 0, 1], [1, 0, 0], -1), null);
});
