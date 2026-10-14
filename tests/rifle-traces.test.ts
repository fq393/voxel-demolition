import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { RifleTraces } from '../src/rifle-traces.ts';
test('rapid automatic fire reuses a bounded tracer pool and pauses without drifting', () => {
  const t = new RifleTraces(), mesh = t.object, geometry = mesh.geometry, material = mesh.material, buffer = mesh.instanceMatrix;
  for (let i = 0; i < 100; i++) t.fire(new THREE.Vector3(0, 0, 1), new THREE.Vector3(10, 0, 1));
  t.update(.01); assert.equal(t.diagnostics.active, 16);
  const before = mesh.instanceMatrix.array.slice(); t.update(0); t.update(NaN); assert.deepEqual(mesh.instanceMatrix.array, before);
  assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material); assert.equal(mesh.instanceMatrix, buffer);
  t.update(.1); assert.equal(t.diagnostics.active, 0); t.clear(); t.dispose(); t.dispose();
});
test('new tracers survive their first rendered frame under load and still expire', () => {
  const t = new RifleTraces(); t.fire(new THREE.Vector3(0, 0, 1), new THREE.Vector3(10, 0, 1));
  t.update(.1); assert.equal(t.diagnostics.active, 1);
  t.update(.1); assert.equal(t.diagnostics.active, 0); t.dispose();
});
