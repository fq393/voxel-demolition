import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { BlastDetails } from '../src/blast-details.ts';

const meshes = (fx: BlastDetails): THREE.InstancedMesh[] => fx.object.children as THREE.InstancedMesh[];
const zAt = (mesh: THREE.InstancedMesh, index = 0): number => mesh.instanceMatrix.array[index * 16 + 14];

test('a fuel blast adds a short shock/flash, lit chips and a ground scorch; each layer expires', () => {
  const fx = new BlastDetails();
  try {
    fx.burst([0, 0, 0.7], 3, { fuel: true });
    assert.equal(fx.diagnostics.activeHalos, 1);
    assert.ok(fx.diagnostics.activeShards > 0);
    assert.equal(fx.diagnostics.activeScorches, 1);
    assert.equal(fx.diagnostics.drawCalls, 3);
    fx.update(0.6); assert.equal(fx.diagnostics.activeHalos, 0);
    fx.update(4); assert.equal(fx.diagnostics.activeShards, 0);
    assert.equal(fx.diagnostics.activeScorches, 1);
    fx.update(50); assert.equal(fx.diagnostics.drawCalls, 0);
  } finally { fx.dispose(); }
});

test('falling chips have gravity and finite poses; roof explosions do not char ground below them', () => {
  const fx = new BlastDetails();
  try {
    fx.burst([2, 3, 10], 2);
    assert.equal(fx.diagnostics.activeScorches, 0);
    const chips = meshes(fx)[1], initial = zAt(chips);
    fx.update(0.1); const first = zAt(chips);
    fx.update(0.1); const second = zAt(chips);
    assert.ok(first > initial, 'the blast first throws chips up');
    assert.ok(second - first < first - initial - 0.08, 'gravity reduces upward speed each frame');
    for (let i = 0; i < 40; i++) fx.update(0.05);
    assert.ok(Array.from(chips.instanceMatrix.array).every(Number.isFinite));
  } finally { fx.dispose(); }
});

test('one hundred dense blasts reuse the same bounded geometry, materials and instance buffers', () => {
  const fx = new BlastDetails();
  try {
    const originals = meshes(fx).map(mesh => [mesh.geometry, mesh.material, mesh.instanceMatrix.array, mesh.instanceColor?.array]);
    for (let i = 0; i < 100; i++) { fx.burst([i % 5, 2, 0.6], 4, { fuel: true }); fx.update(0.001); }
    const d = fx.diagnostics;
    assert.ok(d.activeHalos <= d.haloCapacity); assert.ok(d.activeShards <= d.shardCapacity); assert.ok(d.activeScorches <= d.scorchCapacity);
    assert.equal(d.geometries, 3); assert.equal(d.materials, 3); assert.equal(fx.object.children.length, 3);
    assert.ok(d.triangles <= 2400);
    meshes(fx).forEach((mesh, i) => {
      assert.equal(mesh.geometry, originals[i][0]); assert.equal(mesh.material, originals[i][1]);
      assert.equal(mesh.instanceMatrix.array, originals[i][2]); assert.equal(mesh.instanceColor?.array, originals[i][3]);
      assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite));
    });
    assert.equal(fx.object.children.filter(child => child instanceof THREE.Light).length, 0);
  } finally { fx.dispose(); }
});

test('zero, paused or invalid updates preserve visible poses and cannot create invalid particles', () => {
  const fx = new BlastDetails();
  try {
    fx.burst([0, 0, 1], 2);
    const before = fx.diagnostics;
    const matrices = meshes(fx).map(mesh => Array.from(mesh.instanceMatrix.array));
    for (const dt of [0, -1, NaN, Infinity]) fx.update(dt, new THREE.PerspectiveCamera());
    for (const [at, radius] of [[[NaN, 0, 0], 2], [[0, Infinity, 0], 2], [[0, 0, 0], NaN], [[0, 0, 0], -1]] as const) fx.burst(at, radius);
    assert.deepEqual(fx.diagnostics, before);
    meshes(fx).forEach((mesh, i) => assert.deepEqual(Array.from(mesh.instanceMatrix.array), matrices[i]));
  } finally { fx.dispose(); }
});

test('clear leaves pooled resources reusable; disposal is idempotent and each resource is released once', () => {
  const fx = new BlastDetails();
  fx.burst([0, 0, 0.7], 3); fx.clear();
  assert.equal(fx.diagnostics.bursts, 0); assert.equal(fx.diagnostics.drawCalls, 0);
  fx.burst([0, 0, 0.7], 3, { fuel: true }); assert.equal(fx.diagnostics.activeHalos, 1);
  let released = 0;
  meshes(fx).forEach(mesh => {
    mesh.addEventListener('dispose', () => released++);
    mesh.geometry.addEventListener('dispose', () => released++);
    (mesh.material as THREE.Material).addEventListener('dispose', () => released++);
  });
  fx.dispose(); fx.dispose(); fx.burst([0, 0, 0], 3); fx.update(1);
  assert.equal(released, 9); assert.equal(fx.diagnostics.disposed, true); assert.equal(fx.diagnostics.geometries, 0);
  assert.equal(fx.object.children.length, 0);
});
