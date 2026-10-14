import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUrbanProps } from '../src/urban-props.ts';
import { buildDistrict } from '../src/district-buildings.ts';
import { worldBuilder, buildCity, State, Mat, type City } from '../src/world.ts';
import { Structure } from '../src/structure.ts';
import { Player, type Input } from '../src/player.ts';
import { roundedLoop, sampleRoute, vehicleFootprintsOverlap } from '../src/city-life-state.ts';
import { CONTRACT_DELIVERY_STOPS } from '../src/city-contracts.ts';
import type { DistrictPoint } from '../src/district-layout.ts';
import { damageLayout } from '../src/district-save.ts';

function scene() {
  const w = worldBuilder(7), district = buildDistrict(w), urbanProps = buildUrbanProps(w);
  const city = w.finish({ pitch: 46, street: 16, blocks: 1 }); city.district = district; city.urbanProps = urbanProps;
  return city;
}
const city = scene(), props = city.urbanProps!;
const idle: Input = { forward: 0, right: 0, rise: 0, sprint: false, slow: false, crouch: false, jump: false };
function walkTo(player: Player, target: DistrictPoint): void {
  for (let frame = 0; frame < 950; frame++) {
    const dx = target[0] - player.position.x, dy = target[1] - player.position.y;
    if (Math.hypot(dx, dy) < .06) {
      for (let stop = 0; stop < 16; stop++) player.update(1 / 60, idle);
      assert.ok(Math.abs(player.position.z - target[2]) < .12, `feet ${player.position.toArray()} → ${target}`); return;
    }
    player.yaw = Math.atan2(dy, dx); player.update(1 / 60, { ...idle, forward: Math.min(.25, Math.hypot(dx, dy)) });
  }
  assert.fail(`grounded route blocked: ${player.position.toArray()} → ${target}`);
}
function cellKey(scene: City, v: number): string {
  return [0, 1, 2].map(axis => Math.round(scene.position[v * 3 + axis] * 4)).join(',');
}

test('54 distinct destructible props cover nine silhouettes, stay hollow and within the append budget', () => {
  assert.equal(props.length, 54); assert.equal(new Set(props.map(p => p.id)).size, props.length);
  assert.equal(new Set(props.map(p => p.object)).size, props.length);
  assert.equal(new Set(props.map(p => p.kind)).size, 9);
  const count = props.reduce((n, p) => n + p.initial, 0); assert.ok(count > 2_000 && count < 6_000, `${count} voxels`);
  const structure = new Structure(city);
  for (const prop of props) {
    const object = city.buildings[prop.object];
    assert.equal(object.cells.reduce((n, v) => n + Number(v >= 0), 0), prop.initial);
    assert.deepEqual(structure.unsupported(prop.object), [], `${prop.id} is joined to the ground`);
    assert.ok(object.cells.includes(-1), `${prop.id} uses shaped or hollow geometry`);
    assert.ok([...object.cells].some(v => v >= 0 && city.anchor![v] === 1), `${prop.id} has ground support`);
  }
  assert.ok(props.filter(p => p.kind === 'fuelBarrel').every(p => {
    const b = city.buildings[p.object]; return b.cells[1 + b.w * (1 + b.d * 2)] === -1;
  }), 'fuel barrels have an empty cylinder core, not a solid cuboid');
});

test('the complete v0.5 world remains the exact saved-layout prefix and challenge geometry is unchanged', () => {
  const full = buildCity(), legacyCount = 118_615, legacyObjects = 49;
  assert.equal(full.urbanProps![0].object, legacyObjects);
  assert.equal(full.count, legacyCount + props.reduce((n, p) => n + p.initial, 0));
  assert.ok(full.urbanProps!.every(p => [...full.buildings[p.object].cells].every(v => v < 0 || v >= legacyCount)));
  const prefix: City = { ...full, count: legacyCount, buildings: full.buildings.slice(0, legacyObjects),
    position: full.position.subarray(0, legacyCount * 3), material: full.material.subarray(0, legacyCount),
    building: full.building.subarray(0, legacyCount), cell: full.cell.subarray(0, legacyCount) };
  assert.equal(damageLayout(prefix), 'd1-2jiv-d83df7be-6f4e9878', 'v0.5 saved damage fingerprint');
  const challenge = buildCity(7, false);
  assert.equal(challenge.count, 94_196); assert.deepEqual(challenge.urbanProps, []);
});

test('ten marked explosives include a reachable four-container chain with metre-scale gaps', () => {
  const explosives = props.filter(p => p.explosive); assert.equal(explosives.length, 10);
  const chain = explosives.filter(p => p.id.startsWith('urban-repair-'));
  assert.equal(chain.length, 4);
  for (let i = 1; i < chain.length; i++) {
    const previous = chain[i - 1], current = chain[i];
    const gap = Math.hypot(previous.center[0] - current.center[0], previous.center[1] - current.center[1]);
    assert.ok(gap >= 2 && gap <= previous.explosive!.radius, `chain gap ${gap}`);
  }
  const player = new Player(city); player.flying = false; player.position.set(-27, -12, 0);
  walkTo(player, [-20, -12, 0]); walkTo(player, [-20, -9, 0]);
  assert.ok(Math.hypot(player.position.x - chain[0].center[0], player.position.y - chain[0].center[1]) < 2.2);
});

test('props do not overlap district or old street voxel objects, and do not occupy traffic or pavement routes', () => {
  const baseline = buildCity(7, false), oldCells = new Set(Array.from({ length: baseline.count }, (_, v) => cellKey(baseline, v)));
  const claimed = new Map<string, number>();
  for (let v = 0; v < city.count; v++) {
    const key = cellKey(city, v);
    assert.ok(!claimed.has(key), `objects ${claimed.get(key)} and ${city.building[v]} overlap at ${key}`);
    claimed.set(key, city.building[v]);
  }
  for (const prop of props) for (const v of city.buildings[prop.object].cells) if (v >= 0)
    assert.ok(!oldCells.has(cellKey(city, v)), `${prop.id} overlaps old street geometry`);
  for (const route of [roundedLoop(22, 4), roundedLoop(27, 5, true)]) {
    for (let at = 0; at < route.length; at += .45) {
      const car = { ...sampleRoute(route, at), halfLength: 2.15, halfWidth: .92 };
      for (const prop of props) assert.equal(vehicleFootprintsOverlap(car, {
        x: prop.center[0], y: prop.center[1], heading: 0, halfLength: prop.size[0] / 2, halfWidth: prop.size[1] / 2,
      }, .2), false, `${prop.id} blocks automatic traffic at ${car.x},${car.y}`);
    }
  }
  const walker = new Player(city);
  for (const route of [roundedLoop(14.9, 1.1), roundedLoop(29.8, 1.1, true)])
    for (let at = 0; at < route.length; at += .4) {
      const p = sampleRoute(route, at); assert.equal(walker.blocked(p.x, p.y, 0, 1.8), false, 'pavement stays clear');
    }
  for (const [x, y] of CONTRACT_DELIVERY_STOPS) assert.equal(walker.blocked(x, y, 0, 1.8), false, 'parcel target stays clear');
});

test('street doors, indoor targets and both stair directions stay reachable with the grounded controller', () => {
  for (const building of city.district!) {
    const player = new Player(city); player.flying = false; player.position.set(building.entrance[0], building.bounds.minY - 3, 0);
    walkTo(player, [building.entrance[0], building.bounds.minY - 1, 0]); walkTo(player, building.entrance);
    if (building.stairs) for (const at of building.stairs) walkTo(player, at);
    walkTo(player, building.target);
    if (building.stairs) for (const at of [...building.stairs].reverse()) walkTo(player, at);
    walkTo(player, building.entrance); walkTo(player, [building.entrance[0], building.bounds.minY - 3, 0]);
  }
});

test('removing a new object reveals a physical hole without altering the neighbouring building', () => {
  const prop = props.find(p => p.kind === 'dumpster')!, player = new Player(city);
  assert.equal(player.blocked(prop.center[0], prop.center[1], 0, 1.8), true);
  const voxels = [...city.buildings[prop.object].cells].filter(v => v >= 0);
  for (const v of voxels) city.state[v] = State.Gone;
  assert.equal(player.blocked(prop.center[0], prop.center[1], 0, 1.8), false);
  assert.ok(city.material[voxels[0]] === Mat.Steel);
  assert.ok(city.district!.every(building => city.buildings[building.object].cells.every(v => v < 0 || city.state[v] === State.Fixed)));
  for (const v of voxels) city.state[v] = State.Fixed;
});
