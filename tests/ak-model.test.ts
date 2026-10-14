import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three/webgpu';
import { buildAKModel } from '../src/ak-model.ts';
import { ViewModel } from '../src/viewmodel.ts';

function meshes(object: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = []; object.traverse(child => { if (child instanceof THREE.Mesh) result.push(child); }); return result;
}
function release(group: THREE.Group): void {
  const geometry = new Set(meshes(group).map(mesh => mesh.geometry)), materials = new Set(meshes(group).map(mesh => mesh.material));
  for (const g of geometry) g.dispose(); for (const m of materials) (m as THREE.Material).dispose();
}

test('AK has a metre-scale rifle silhouette, warm wooden furniture and a genuinely curved extruded magazine', () => {
  const rifle = buildAKModel(), parts = meshes(rifle), bounds = new THREE.Box3().setFromObject(rifle), size = bounds.getSize(new THREE.Vector3());
  assert.equal(rifle.name, 'AK47'); assert.ok(parts.length <= 25);
  assert.ok(size.z > 1 && size.z < 1.2); assert.ok(size.x < .15); assert.ok(size.y > .45 && size.y < .60);
  assert.ok(bounds.max.z > .27 && bounds.min.z < -.80, 'wood stock points back and barrel points forward along -Z');
  for (const name of ['rifle-stock', 'rifle-lower-handguard', 'rifle-grip', 'rifle-barrel', 'rifle-front-sight', 'rifle-receiver'])
    assert.ok(rifle.getObjectByName(name) instanceof THREE.Mesh, `${name} is real authored geometry`);
  const magazine = rifle.getObjectByName('rifle-magazine') as THREE.Mesh;
  assert.equal(magazine.geometry.type, 'ExtrudeGeometry');
  const top: number[] = [], bottom: number[] = [], position = magazine.geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) > -.05) top.push(position.getZ(i));
    if (position.getY(i) < -.28) bottom.push(position.getZ(i));
  }
  assert.ok(top.length > 0 && bottom.length > 0);
  assert.ok(Math.min(...bottom) < Math.min(...top) - .06, 'magazine bends forwards below the receiver');
  const triangles = parts.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
  assert.ok(triangles < 8_000, `${triangles} triangles`);
  const geometries = new Set(parts.map(mesh => mesh.geometry)), materials = new Set(parts.map(mesh => mesh.material));
  assert.ok(geometries.size <= 7); assert.ok(materials.size <= 5);
  assert.ok(geometries.size < parts.length / 2, 'repeated hardware uses shared kit geometry');
  assert.equal(rifle.getObjectByName('rifle-flash')!.visible, false);
  release(rifle);
});

test('the five existing tool slots remain in order and AK is appended at index five', () => {
  const hand = new ViewModel();
  assert.deepEqual(hand.object.children.map(child => child.name), ['hammer', 'laser', 'rocket', 'detonator', 'wrecking-ball', 'AK47']);
  for (let slot = 0; slot < 6; slot++) {
    hand.select(slot); assert.equal(hand.object.children.filter(child => child.visible).length, 1); assert.equal(hand.object.children[slot].visible, true);
  }
  for (const invalid of [-1, 6, .5, NaN]) hand.select(invalid);
  assert.equal(hand.object.children[5].visible, true);
  hand.select(3); hand.use(.5); hand.update(.03, 0, 0, false);
  const button = hand.object.children[3].getObjectByName('button') as THREE.Mesh;
  assert.equal((button.material as THREE.MeshStandardMaterial).emissive.getHex(), 0, 'existing pressed button becomes dark');
  hand.update(.6, 0, 0, false); assert.equal((button.material as THREE.MeshStandardMaterial).emissive.getHex(), 0xff0c08, 'existing button rearms');
  hand.dispose();
});

test('AK muzzle follows the camera world transform while the legacy no-argument laser muzzle stays intact', () => {
  const camera = new THREE.PerspectiveCamera(); camera.position.set(8, -3, 4); camera.rotation.set(.1, .4, -.2);
  const hand = new ViewModel(); camera.add(hand.object); hand.select(5); hand.update(.5, 0, 0, false);
  const socket = hand.object.children[5].getObjectByName('rifle-muzzle')!;
  socket.updateWorldMatrix(true, false);
  assert.ok(hand.muzzle(new THREE.Vector3(), 5).distanceTo(socket.getWorldPosition(new THREE.Vector3())) < 1e-8);
  const laser = hand.object.children[1].getObjectByName('muzzle')!; laser.updateWorldMatrix(true, false);
  assert.ok(hand.muzzle(new THREE.Vector3()).distanceTo(laser.getWorldPosition(new THREE.Vector3())) < 1e-8);
  hand.dispose();
});

test('automatic-fire flash reuses one prebuilt mesh, lasts 50ms and is cleared by tool switching and reload', () => {
  const hand = new ViewModel(); hand.select(5); hand.update(.5, 0, 0, false);
  const rifle = hand.object.children[5], flash = rifle.getObjectByName('rifle-flash') as THREE.Mesh;
  const resources = meshes(rifle).map(mesh => [mesh.uuid, mesh.geometry.uuid, (mesh.material as THREE.Material).uuid]);
  const resting = rifle.position.z;
  hand.use(); assert.equal(flash.visible, true); hand.update(.02, 0, 0, false);
  assert.equal(flash.visible, true); assert.ok(rifle.position.z > resting, 'short recoil moves the rifle back');
  hand.update(.02, 0, 0, false);
  hand.update(.031, 0, 0, false); assert.equal(flash.visible, false);
  for (let i = 0; i < 100; i++) { hand.use(); hand.update(.09, 0, 0, false); }
  assert.deepEqual(meshes(rifle).map(mesh => [mesh.uuid, mesh.geometry.uuid, (mesh.material as THREE.Material).uuid]), resources);
  let lights = 0; rifle.traverse(child => { if (child instanceof THREE.Light) lights++; }); assert.equal(lights, 0);
  hand.use(); hand.select(0); assert.equal(flash.visible, false);
  hand.select(5); hand.use(); hand.reload(.5); assert.equal(flash.visible, false);
  hand.use(); assert.equal(flash.visible, false, 'reload cannot retrigger the cosmetic flash');
  hand.dispose();
});

test('a newly fired AK flash is presented once even after a slow frame, then expires normally', () => {
  const hand = new ViewModel(); hand.select(5);
  const flash = hand.object.children[5].getObjectByName('rifle-flash')!;
  hand.reload(.99); hand.reload(null); hand.use(); hand.update(.1, 0, 0, false);
  assert.equal(flash.visible, true, 'first shot after reload is visible despite prior frame latency');
  hand.update(.06, 0, 0, false); assert.equal(flash.visible, false); hand.dispose();
});
test('world reset clears a fresh flash and reload pose while keeping AK selected', () => {
  const hand = new ViewModel(); hand.select(5); hand.use(); hand.reset();
  assert.equal(hand.object.children[5].visible, true);
  assert.equal(hand.object.children[5].getObjectByName('rifle-flash')!.visible, false);
  hand.reload(.5); hand.update(.016, 0, 0, false); hand.reset(); hand.update(.016, 0, 0, false);
  assert.equal(hand.object.children[5].getObjectByName('rifle-magazine')!.visible, true);
  hand.dispose();
});

test('reload dips and rolls the rifle, temporarily removes the magazine and restores it on cancellation', () => {
  const hand = new ViewModel(); hand.select(5); hand.update(1, 0, 0, false);
  const rifle = hand.object.children[5], magazine = rifle.getObjectByName('rifle-magazine')!;
  const restY = rifle.position.y;
  hand.reload(.5); hand.update(.016, 0, 0, false);
  assert.ok(rifle.position.y < restY - .09); assert.ok(rifle.rotation.z > .2); assert.equal(magazine.visible, false);
  assert.equal(rifle.getObjectByName('rifle-magazine-rib-1')!.visible, false);
  hand.reload(.9); hand.update(.016, 0, 0, false); assert.equal(magazine.visible, true);
  hand.reload(null); hand.update(.016, 0, 0, false);
  assert.equal(magazine.visible, true); assert.ok(Math.abs(rifle.position.y - restY) < .001); assert.equal(rifle.rotation.z, 0);
  hand.dispose();
});

test('viewmodel disposal releases shared AK resources once and safely handles repeated disposal', () => {
  const hand = new ViewModel(), rifle = hand.object.children[5], parts = meshes(rifle);
  const geometries = new Set(parts.map(mesh => mesh.geometry)), materials = new Set(parts.map(mesh => mesh.material));
  let geometryDisposals = 0, materialDisposals = 0;
  for (const geometry of geometries) geometry.addEventListener('dispose', () => geometryDisposals++);
  for (const material of materials) (material as THREE.Material).addEventListener('dispose', () => materialDisposals++);
  hand.dispose(); hand.dispose(); hand.use(); hand.select(5); hand.update(.1, 0, 0, false);
  assert.equal(geometryDisposals, geometries.size); assert.equal(materialDisposals, materials.size); assert.equal(hand.object.children.length, 0);
});
