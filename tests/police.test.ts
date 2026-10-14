import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { CityPolice } from '../src/police.ts';
import { buildCity, State } from '../src/world.ts';
import { GARAGE, type PoliceFrame } from '../src/police-types.ts';
import { skyline } from '../src/skyline.ts';
import { collectSkylineColliders, overlapsPlayer, overlapsVehicle } from '../src/city-colliders.ts';
import { trafficOverlapsWorld } from '../src/city-life.ts';
import { StreetSimulation, sampleRoute } from '../src/city-life-state.ts';

const QUIET: PoliceFrame = { player: { x: -120, y: -120, z: 0, driving: false, flying: false },
  car: null, traffic: [], pedestrians: [], wanted: { stars: 0, phase: 'quiet', target: null }, safe: false };
const frameAt = (x: number, y: number, z = 0): PoliceFrame => ({ ...QUIET,
  player: { x, y, z, driving: false, flying: false }, wanted: { stars: 1, phase: 'chase', target: [x, y, z] } });
const meshes = (police: CityPolice): THREE.InstancedMesh[] => police.object.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);

function backdropFor(city: ReturnType<typeof buildCity>) {
  const backdrop = skyline(city), boxes = collectSkylineColliders(backdrop);
  return { boxes, dispose() { backdrop.geometry.dispose(); (backdrop.material as THREE.Material).dispose(); } };
}

test('garage keeps every existing world voxel and road/sidewalk route unchanged and clear', () => {
  const city = buildCity(), positions = city.position.slice(), { boxes, dispose } = backdropFor(city);
  const police = new CityPolice(city, boxes), streets = new StreetSimulation({ carBlocked: () => false, pedestrianBlocked: () => false });
  for (let v = 0; v < city.count; v++) {
    if (city.state[v] !== State.Fixed) continue;
    const x = city.position[v * 3], y = city.position[v * 3 + 1], z = city.position[v * 3 + 2];
    assert.equal(overlapsPlayer(police.colliders, x, y, z, 0.25), false, `garage overlaps voxel ${v}`);
  }
  for (const route of streets.state.routes) for (let d = 0; d < route.length; d += 0.5) {
    const p = sampleRoute(route, d);
    assert.equal(overlapsVehicle(police.colliders, p.x, p.y, p.heading, 2.15, 0.92), false);
  }
  for (const route of streets.state.walkRoutes) for (let d = 0; d < route.length; d += 0.5) {
    const p = sampleRoute(route, d);
    assert.equal(overlapsPlayer(police.colliders, p.x, p.y, 0, 1.8), false);
  }
  assert.deepEqual(city.position, positions);
  police.dispose(); dispose();
});

test('garage east doorway admits a vehicle while sides, back and roof block movement and sight', () => {
  const police = new CityPolice(buildCity(), []);
  assert.equal(police.blocksPlayer(-31, -10, 0, 1.8), false);
  assert.equal(police.blocksCar(-31, -10, 0), false);
  assert.equal(police.blocksCar(...GARAGE.center.slice(0, 2) as [number, number], 0), false);
  for (const [x, y] of [[-39.9, -10], [-35, -13.9], [-35, -6.1], [-31.1, -13]])
    assert.equal(police.blocksPlayer(x, y, 0, 1.8), true);
  assert.equal(police.blocksPlayer(-35, -10, 2, 1.8), true);
  assert.equal(police.rayHit([-30, -10, 1.5], [-1, 0, 0], 5), null, 'east doorway should be clear');
  assert.ok(Math.abs(police.rayHit([-35, -10, 1.5], [0, 1, 0], 10)! - 3.7) < 1e-12);
  assert.equal(police.rayHit([-35, -10, 1.5], [0, 0, 1], 10), 1.4500000000000002);
  police.dispose();
});

test('real-world pursuit never crosses a solid skyline, intact voxel, or garage collider', () => {
  const city = buildCity(), { boxes, dispose } = backdropFor(city), police = new CityPolice(city, boxes);
  const frame = frameAt(-27, -12), travel = [0, 0];
  for (let i = 0; i < 30 * 60; i++) {
    const before = police.units.map(u => [u.x, u.y]);
    police.update(1 / 60, frame);
    police.units.forEach((unit, id) => {
      travel[id] += Math.hypot(unit.x - before[id][0], unit.y - before[id][1]);
      assert.equal(trafficOverlapsWorld(city, unit.x, unit.y, unit.heading), false, `unit ${id} crossed intact voxels`);
      assert.equal(overlapsVehicle([...boxes, ...police.colliders], unit.x, unit.y, unit.heading, 2.15, 0.92), false, `unit ${id} crossed solid building`);
    });
  }
  assert.ok(travel.every(d => d > 10), `police are stranded: ${travel}`);
  police.dispose(); dispose();
});

test('police LOS respects actual voxel walls, holes, and independent garage walls', () => {
  const city = buildCity(), police = new CityPolice(city, []), unit = police.units[0];
  // Warehouse front wall is solid away from its open door. Isolate other unit's sight range.
  Object.assign(unit, { x: 43, y: 36, heading: Math.PI / 2, speed: 0 });
  Object.assign(police.units[1], { x: -100, y: -100 });
  const frame = frameAt(43, 44);
  assert.equal(police.update(1 / 60, frame).seen, false);
  for (let v = 0; v < city.count; v++) if (city.position[v * 3] > 42 && city.position[v * 3] < 44
    && city.position[v * 3 + 1] > 39 && city.position[v * 3 + 1] < 44 && city.position[v * 3 + 2] < 2) city.state[v] = State.Gone;
  assert.equal(police.update(1 / 60, frame).seen, true, 'removed voxels must expose the player');
  Object.assign(unit, { x: -35, y: -18, speed: 0 });
  assert.equal(police.update(1 / 60, frameAt(-35, -10)).seen, false, 'garage south wall must hide the player');
  Object.assign(unit, { x: -28, y: -10, speed: 0 });
  assert.equal(police.update(1 / 60, frameAt(-35, -10)).seen, true, 'east door should permit sight when caller marks garage unsafe');
  police.dispose();
});

test('unit collision and occlusion follow moving police/officers and clear above their bodies', () => {
  const police = new CityPolice(buildCity(), []), unit = police.units[0];
  const dx = Math.cos(unit.heading), dy = Math.sin(unit.heading);
  assert.equal(police.blocksPlayer(unit.x, unit.y, 0, 1.8), true);
  assert.equal(police.blocksPlayer(unit.x, unit.y, 2, 1.8), false);
  assert.equal(police.blocksCar(unit.x, unit.y, unit.heading), true);
  const hit = police.rayHit([unit.x - dx * 8, unit.y - dy * 8, 0.6], [dx, dy, 0], 8);
  assert.ok(hit !== null && Math.abs(hit - 5.85) < 0.001);
  assert.equal(police.rayHit([unit.x - dx * 8, unit.y - dy * 8, 2], [dx, dy, 0], 8), null);
  Object.assign(unit.officer, { active: true, x: -45, y: -10, heading: 0 });
  assert.equal(police.blocksPlayer(-45, -10, 0, 1.8), true);
  assert.equal(police.blocksPlayer(-45, -10, 2, 1.8), false);
  assert.equal(police.rayHit([-48, -10, 1.6], [1, 0, 0], 3), 2.77);
  police.dispose();
});

test('paused clock freezes lightbar/limbs and reset reuses every render resource; dispose runs once', () => {
  const city = buildCity(), police = new CityPolice(city, []), batch = meshes(police);
  Object.assign(police.units[0].officer, { active: true, moving: true, x: -45, y: -10, phase: 1 });
  police.update(0, QUIET);
  assert.equal(police.diagnostics.visibleOfficers, 1);
  const matrices = batch.map(m => m.instanceMatrix.array.slice()), colors = batch.map(m => m.instanceColor?.array.slice());
  police.update(0, QUIET);
  batch.forEach((m, i) => { assert.deepEqual(m.instanceMatrix.array, matrices[i]); assert.deepEqual(m.instanceColor?.array, colors[i]); });
  const geometry = new Set(batch.map(m => m.geometry)), materials = new Set(batch.map(m => m.material));
  for (let i = 0; i < 10; i++) police.reset(city, []);
  assert.deepEqual(meshes(police), batch); assert.deepEqual(new Set(batch.map(m => m.geometry)), geometry);
  assert.deepEqual(new Set(batch.map(m => m.material)), materials);
  assert.equal(police.diagnostics.renderBatches, 9); assert.equal(police.diagnostics.visibleOfficers, 0);
  assert.ok(police.diagnostics.triangles < 30000);
  let disposed = 0;
  for (const g of geometry) g.addEventListener('dispose', () => disposed++);
  for (const m of materials) if (m instanceof THREE.Material) m.addEventListener('dispose', () => disposed++);
  police.dispose(); police.dispose();
  assert.equal(disposed, geometry.size + materials.size); assert.equal(police.object.children.length, 0);
});

test('officers stand on intact indoor floors and fall back to street height after floor destruction', () => {
  const city = buildCity(), police = new CityPolice(city, []), officer = police.units[0].officer;
  Object.assign(officer, { active: true, moving: false, x: 46, y: 44, heading: 0 });
  police.update(0, QUIET);
  const heads = meshes(police).find(mesh => mesh.name === 'police-officer-heads')!, matrix = new THREE.Matrix4();
  heads.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[14] - 1.84) < 0.001, 'officer should stand .25 m above indoor slab');
  assert.equal(police.blocksPlayer(46, 44, 1.9, 0.1), true);
  for (let v = 0; v < city.count; v++) if (Math.abs(city.position[v * 3] - 46) < 0.6
    && Math.abs(city.position[v * 3 + 1] - 44) < 0.6 && city.position[v * 3 + 2] < 0.25) city.state[v] = State.Gone;
  police.update(0, QUIET); heads.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[14] - 1.59) < 0.001);
  assert.equal(police.blocksPlayer(46, 44, 1.9, 0.1), false);
  police.dispose();
});
