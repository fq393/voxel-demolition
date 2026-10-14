import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDistrict } from '../src/district-buildings.ts';
import { worldBuilder, buildCity, Mat, State, type City } from '../src/world.ts';
import { Player, type Input } from '../src/player.ts';
import { Structure } from '../src/structure.ts';
import type { DistrictPoint } from '../src/district-layout.ts';

const w = worldBuilder(29);
const district = buildDistrict(w);
const city = w.finish({ pitch: 46, street: 16, blocks: 10 });
const idle: Input = { forward: 0, right: 0, rise: 0, sprint: false, slow: false, crouch: false, jump: false };

/** Real grounded control: no flight, jumping, position edits or collision bypass along the route. */
function walkTo(player: Player, target: DistrictPoint): void {
  for (let frame = 0; frame < 900; frame++) {
    const dx = target[0] - player.position.x, dy = target[1] - player.position.y;
    if (Math.hypot(dx, dy) < 0.06) {
      for (let stop = 0; stop < 16; stop++) player.update(1 / 60, idle);
      assert.ok(Math.abs(player.position.z - target[2]) < 0.12, `expected feet z=${target[2]}, got ${player.position.toArray()}`);
      return;
    }
    player.yaw = Math.atan2(dy, dx);
    player.update(1 / 60, { ...idle, forward: Math.min(0.25, Math.hypot(dx, dy)) });
  }
  assert.fail(`grounded route blocked: ${player.position.toArray()} → ${target}`);
}

function walker(scene: City, at: DistrictPoint): Player {
  const player = new Player(scene);
  player.flying = false;
  player.position.set(...at);
  for (let frame = 0; frame < 30; frame++) player.update(1 / 60, idle);
  return player;
}

test('three distinct hollow buildings and their furniture stay within the additional voxel budget', () => {
  assert.deepEqual(district.map(b => b.id), ['store', 'home', 'warehouse']);
  assert.ok(city.count > 12_000 && city.count <= 25_000, `district has ${city.count} voxels`);
  const structure = new Structure(city);
  for (const b of district) {
    assert.ok(b.furniture.length >= 3, `${b.id} has authored furniture`);
    assert.ok(city.buildings[b.object].cells.includes(-1), 'architecture is hollow');
    assert.deepEqual(structure.unsupported(b.object), [], `${b.id} has no unsupported architecture`);
    for (const furniture of b.furniture) {
      assert.notEqual(furniture.object, b.object, 'furniture breaks independently of the building');
      assert.ok(furniture.initial > 20, `${furniture.id} is a real voxel object`);
      assert.equal(city.buildings[furniture.object].cells.reduce((n, v) => n + Number(v >= 0), 0), furniture.initial);
      assert.deepEqual(structure.unsupported(furniture.object), [], `${furniture.id} has supported voxels`);
    }
  }
  assert.ok(city.material.includes(Mat.Wood), 'warm wood furniture is present');
  assert.ok(city.material.includes(Mat.Glass), 'authored windows are present');
});

test('all three south doors admit the normal grounded player and lead to interior space', () => {
  for (const b of district) {
    const player = walker(city, [b.entrance[0], b.bounds.minY - 1, 0]);
    walkTo(player, b.entrance);
    assert.ok(player.position.y > b.bounds.minY + 0.3, `${b.id} is entered through its door`);
    if (b.id !== 'home') walkTo(player, b.target);
    assert.equal(player.flying, false);
  }
});

test('the house stairs ascend and descend continuously with the real grounded Player', () => {
  const home = district.find(b => b.id === 'home')!;
  assert.ok(home.stairs && home.stairs.length >= 14, 'approach, physical steps, and upper landing are authored');
  const player = walker(city, [home.entrance[0], home.bounds.minY - 1, 0]);
  walkTo(player, home.entrance);
  for (const at of home.stairs!) walkTo(player, at);
  walkTo(player, home.target);
  assert.ok(player.position.z > 3, 'upper room is reachable without flying or jumping');
  for (const at of [...home.stairs!].reverse()) walkTo(player, at);
  walkTo(player, home.entrance);
  walkTo(player, [home.entrance[0], home.bounds.minY - 1, 0]);
  assert.ok(player.position.z < 0.1, 'the same stairs lead safely back to the street');
});

test('removing furniture voxels changes interior collision without removing the building', () => {
  const sofa = district.find(b => b.id === 'home')!.furniture.find(f => f.id === 'home-sofa')!;
  const probe = new Player(city);
  assert.equal(probe.blocked(sofa.at[0], sofa.at[1], 0.25, 1.8), true);
  const changed: number[] = [];
  for (const v of city.buildings[sofa.object].cells) if (v >= 0) { city.state[v] = State.Gone; changed.push(v); }
  assert.equal(probe.blocked(sofa.at[0], sofa.at[1], 0.25, 1.8), false);
  assert.ok(city.buildings[district.find(b => b.id === 'home')!.object].cells.every(v => v < 0 || city.state[v] === State.Fixed));
  for (const v of changed) city.state[v] = State.Fixed;
});

test('the complete city preserves original anchors and admits the same interior routes', () => {
  const original = buildCity(7, false), full = buildCity();
  assert.ok(full.anchor, 'upper-floor props use explicit anchors');
  const streetPropVoxels = (full.urbanProps ?? []).reduce((sum, prop) => sum + prop.initial, 0);
  assert.equal(full.count - original.count - streetPropVoxels, city.count, 'the district adds the same bounded geometry before appended street props');
  for (let v = 0; v < original.count; v++) {
    const object = original.buildings[original.building[v]];
    assert.equal(full.anchor![v], Number(original.cell[v] < object.w * object.d), `original support ${v} is preserved`);
    assert.equal(full.position[3 * v], original.position[3 * v]);
    assert.equal(full.position[3 * v + 1], original.position[3 * v + 1]);
    assert.equal(full.position[3 * v + 2], original.position[3 * v + 2]);
  }
  for (const building of full.district!) {
    const player = walker(full, [building.entrance[0], building.bounds.minY - 1, 0]);
    walkTo(player, building.entrance);
    if (building.stairs) for (const at of building.stairs) walkTo(player, at);
    walkTo(player, building.target);
    if (building.stairs) for (const at of [...building.stairs].reverse()) walkTo(player, at);
    walkTo(player, building.entrance);
  }
});
