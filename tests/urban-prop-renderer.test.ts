import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three/webgpu';
import { UrbanPropRenderer } from '../src/urban-prop-renderer.ts';
import { buildUrbanProps } from '../src/urban-props.ts';
import { buildDistrict } from '../src/district-buildings.ts';
import { worldBuilder, State } from '../src/world.ts';

function scene() {
  const w = worldBuilder(7), district = buildDistrict(w), urbanProps = buildUrbanProps(w);
  const city = w.finish({ pitch: 46, street: 16, blocks: 1 }); city.district = district; city.urbanProps = urbanProps;
  return city;
}
function visibleInstances(renderer: UrbanPropRenderer): number {
  const matrix = new THREE.Matrix4(); let count = 0;
  for (const mesh of renderer.object.children as THREE.InstancedMesh[]) for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix); if (Math.abs(matrix.determinant()) > 1e-10) count++;
  }
  return count;
}

test('authored model kit adds bounded geometry, no textures, real curve silhouettes and all 13 furniture models', () => {
  const city = scene(), masks: { voxels: readonly number[]; hidden: boolean }[] = [];
  const renderer = new UrbanPropRenderer(city, (voxels, hidden) => masks.push({ voxels, hidden }));
  const d = renderer.diagnostics;
  assert.equal(d.props, 54); assert.equal(d.furniture, 13); assert.equal(d.intact, 67); assert.equal(d.damaged, 0);
  assert.ok(d.triangles > 10_000 && d.triangles < 60_000); assert.ok(d.drawCalls <= 24); assert.equal(d.textures, 0);
  assert.equal(masks.length, 67); assert.ok(masks.every(m => m.hidden));
  assert.equal(visibleInstances(renderer), d.instances);
  const bounds = new THREE.Box3().setFromObject(renderer.object);
  assert.ok(bounds.min.z >= -.03); assert.ok(bounds.max.z <= 5.01); assert.ok(bounds.min.x > -20 && bounds.max.x < 60);
  const types = new Set(renderer.object.children.map(child => (child as THREE.InstancedMesh).geometry.type));
  assert.ok(types.has('LatheGeometry')); assert.ok(types.has('TorusGeometry')); assert.ok(types.has('IcosahedronGeometry'));
  renderer.dispose();
});

test('first voxel damage immediately releases only its proxy mask and removes every attached decorative part', () => {
  const city = scene(), masks: { voxels: readonly number[]; hidden: boolean }[] = [];
  const renderer = new UrbanPropRenderer(city, (voxels, hidden) => masks.push({ voxels, hidden }));
  const before = visibleInstances(renderer), prop = city.urbanProps![0];
  const ids = [...city.buildings[prop.object].cells].filter(v => v >= 0); masks.length = 0;
  city.state[ids[1]] = State.Loose; renderer.update(city);
  assert.equal(masks.length, 1); assert.equal(masks[0].hidden, false); assert.deepEqual(masks[0].voxels, ids);
  assert.ok(visibleInstances(renderer) < before - 5, 'caps, rings, badge and barrel shell vanish together');
  assert.equal(renderer.diagnostics.damaged, 1); assert.equal(renderer.diagnostics.intact, 66);
  renderer.update(city); assert.equal(masks.length, 1, 'broken presentation is released once');
  city.state[ids[1]] = State.Fixed; renderer.update(city);
  assert.equal(renderer.diagnostics.damaged, 1, 'temporary solver state changes do not resurrect decoration');
  renderer.reset(city); assert.equal(renderer.diagnostics.intact, 67); assert.equal(visibleInstances(renderer), before);
  renderer.dispose();
});

test('saved missing furniture starts as the original damaged geometry without an intact model floating in place', () => {
  const city = scene(), sofa = city.district![1].furniture.find(p => p.id === 'home-sofa')!;
  const ids = [...city.buildings[sofa.object].cells].filter(v => v >= 0); city.state[ids[0]] = State.Gone;
  city.position[3 * ids[0] + 2] = -100;
  const masks: { voxels: readonly number[]; hidden: boolean }[] = [];
  const renderer = new UrbanPropRenderer(city, (voxels, hidden) => masks.push({ voxels, hidden }));
  assert.equal(renderer.diagnostics.damaged, 1); assert.equal(renderer.diagnostics.intact, 66);
  assert.ok(masks.some(m => m.voxels.includes(ids[0]) && !m.hidden));
  assert.ok(visibleInstances(renderer) < renderer.diagnostics.instances);
  assert.ok(new THREE.Box3().setFromObject(renderer.object).min.z >= -.03, 'grid bounds ignore relocated debris coordinates');
  renderer.dispose();
});

test('ten rebuilds reuse shared kit resources and dispose old instance buffers; final disposal is idempotent', () => {
  const city = scene(), renderer = new UrbanPropRenderer(city, () => {}), d = renderer.diagnostics;
  const geometries = new Set(renderer.object.children.map(c => (c as THREE.InstancedMesh).geometry));
  const materials = new Set(renderer.object.children.map(c => (c as THREE.InstancedMesh).material));
  let released = 0;
  for (let n = 0; n < 10; n++) {
    const previous = [...renderer.object.children] as THREE.InstancedMesh[];
    for (const mesh of previous) mesh.addEventListener('dispose', () => released++);
    renderer.reset(city);
    assert.deepEqual(renderer.diagnostics, d);
    assert.ok(previous.every(mesh => !mesh.parent));
    for (const mesh of renderer.object.children as THREE.InstancedMesh[]) {
      assert.ok(geometries.has(mesh.geometry)); assert.ok(materials.has(mesh.material));
    }
  }
  assert.equal(released, d.drawCalls * 10);
  let geometryDisposals = 0, materialDisposals = 0;
  for (const geometry of geometries) geometry.addEventListener('dispose', () => geometryDisposals++);
  for (const material of materials) (material as THREE.Material).addEventListener('dispose', () => materialDisposals++);
  renderer.dispose(); renderer.dispose();
  assert.equal(geometryDisposals, geometries.size); assert.equal(materialDisposals, materials.size);
  assert.equal(renderer.object.children.length, 0); assert.equal(renderer.diagnostics.instances, 0);
});
