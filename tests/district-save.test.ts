import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureDamage, clearDamage, damagedVoxels, damageLayout, districtDamageKey, loadDamage, MAX_DAMAGE_TEXT,
  MAX_DAMAGE_VOXELS, saveDamage, type DamageSnapshot } from '../src/district-save.ts';
import type { ProgressStorage } from '../src/city-progress.ts';
import { buildCity, Mat, State, worldBuilder, type City } from '../src/world.ts';

const storage = (): ProgressStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
};
function scene(x = 0, material: number = Mat.Brick): City {
  const builder = worldBuilder(39);
  builder.place(x, 0, 3, 3, 1, put => { for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) put(i, j, 0, material as typeof Mat.Brick); });
  builder.place(x + 4, 0, 2, 2, 1, put => { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) put(i, j, 0, Mat.Wood); });
  const city = builder.finish({ pitch: 46, street: 16, blocks: 8 });
  city.district = [{ id: 'warehouse', name: '仓库', object: 0, bounds: { minX: x, maxX: x + 10, minY: 0, maxY: 10, maxZ: 4 },
    entrance: [x + 5, -1, 0.1], target: [x + 5, 5, 0.25], furniture: [{ id: 'warehouse-rack', name: '货架', object: 1, initial: 4, at: [x + 1, 1, 0.25] }] }];
  return city;
}
test('sparse consecutive damage is compact and all nonfixed dynamics restore as removals', () => {
  const city = scene();
  city.state[1] = State.Loose; city.state[2] = State.Gone; city.state[3] = State.Rubble; city.state[4] = State.Carried; city.state[8] = State.Gone;
  const before = city.state.slice(), snapshot = captureDamage(city);
  assert.deepEqual(snapshot.ranges, [[1, 4], [8, 1]]); assert.equal(snapshot.count, 13);
  assert.deepEqual(damagedVoxels(snapshot), [1, 2, 3, 4, 8]); assert.deepEqual(city.state, before);
  const db = storage(); assert.equal(saveDamage(db, 'alice', snapshot).ok, true);
  const fresh = scene(), loaded = loadDamage(db, 'alice', fresh);
  assert.equal(loaded.status, 'loaded'); assert.deepEqual(loaded.snapshot, snapshot);
  assert.ok(fresh.state.every(state => state === State.Fixed), 'loading must not update GPU/structure behind the caller');
});
test('removed furniture stays removed after reload without replaying loose bodies', () => {
  const city = scene(), furniture = city.district![0].furniture[0];
  const indices = [...city.building].flatMap((object, index) => object === furniture.object ? [index] : []);
  for (const index of indices) city.state[index] = State.Loose;
  const db = storage(); saveDamage(db, 'worker', captureDamage(city));
  const restored = scene(), loaded = loadDamage(db, 'worker', restored);
  for (const index of damagedVoxels(loaded.snapshot)) restored.state[index] = State.Gone;
  assert.equal(indices.filter(index => restored.state[index] !== State.Fixed).length, furniture.initial);
  assert.equal(restored.state.some(state => state === State.Loose || state === State.Rubble), false);
  assert.deepEqual(captureDamage(restored).ranges, captureDamage(city).ranges);
});
test('geometry, materials, object metadata and district destinations identify distinct layouts', () => {
  const original = scene(), db = storage(); original.state[0] = State.Gone; saveDamage(db, 'alice', captureDamage(original));
  const alteredMetadata = scene(); alteredMetadata.buildings[0].h++;
  const alteredDestination = scene(); alteredDestination.district![0].target = [5, 5, 3.25];
  const alteredObject = scene(); alteredObject.building[0] = 1;
  for (const other of [scene(1), scene(0, Mat.Plaster), alteredMetadata, alteredDestination, alteredObject]) {
    assert.notEqual(damageLayout(other), damageLayout(original));
    const loaded = loadDamage(db, 'alice', other); assert.equal(loaded.status, 'mismatched'); assert.deepEqual(damagedVoxels(loaded.snapshot), []);
  }
});
test('corrupt, huge, duplicate, unsorted, adjacent and out-of-range runs are rejected', () => {
  const city = scene(), snapshot = captureDamage(city), db = storage();
  const invalid = (change: (value: DamageSnapshot) => void): void => {
    const altered = structuredClone(snapshot); change(altered);
    db.values.set(districtDamageKey('alice'), JSON.stringify(altered));
    assert.equal(loadDamage(db, 'alice', city).status, 'invalid'); assert.deepEqual(damagedVoxels(altered), []);
    assert.equal(saveDamage(db, 'alice', altered).ok, false);
  };
  invalid(v => { v.version = 99 as 1; }); invalid(v => { v.count = MAX_DAMAGE_VOXELS + 1; }); invalid(v => { v.layout = 'broken'; });
  invalid(v => { v.ranges = [[-1, 1]]; }); invalid(v => { v.ranges = [[13, 1]]; }); invalid(v => { v.ranges = [[12, 2]]; });
  invalid(v => { v.ranges = [[0, 0]]; }); invalid(v => { v.ranges = [[0, 1.5]]; }); invalid(v => { v.ranges = [[1, 1], [1, 1]]; });
  invalid(v => { v.ranges = [[8, 1], [1, 1]]; }); invalid(v => { v.ranges = [[1, 1], [2, 1]]; });
  for (const raw of ['{broken', 'null', JSON.stringify({ ...snapshot, secrets: 'unexpected' }), ' '.repeat(MAX_DAMAGE_TEXT + 1)]) {
    db.values.set(districtDamageKey('alice'), raw);
    assert.equal(loadDamage(db, 'alice', city).status, 'invalid');
    assert.deepEqual(damagedVoxels(loadDamage(db, 'alice', city).snapshot), []);
  }
  db.values.set(districtDamageKey('alice'), JSON.stringify({ ...snapshot, count: 14 }));
  assert.equal(loadDamage(db, 'alice', city).status, 'mismatched');
});
test('nickname saves are isolated and rebuilding clears only that identity damage', () => {
  const db = storage(), city = scene(); city.state[0] = State.Gone;
  saveDamage(db, 'alice', captureDamage(city)); saveDamage(db, 'bob', captureDamage(city));
  db.values.set('city.progress.v1.alice', 'wallet-and-vehicles');
  assert.equal(loadDamage(db, 'charlie', city).status, 'fresh');
  assert.equal(clearDamage(db, 'alice', city).ok, true); assert.deepEqual(loadDamage(db, 'alice', city).snapshot.ranges, []);
  assert.deepEqual(damagedVoxels(loadDamage(db, 'bob', city).snapshot), [0]);
  assert.equal(db.values.get('city.progress.v1.alice'), 'wallet-and-vehicles'); assert.equal(city.state[0], State.Gone);
});
test('storage failure is explicit and leaves current damage untouched', () => {
  const city = scene(); city.state[0] = State.Gone;
  const blocked: ProgressStorage = { getItem: () => { throw Error('disabled'); }, setItem: () => { throw Error('quota'); } };
  assert.equal(loadDamage(blocked, 'alice', city).status, 'unavailable');
  const failed = saveDamage(blocked, 'alice', captureDamage(city)); assert.equal(failed.ok, false); assert.ok(failed.error);
  assert.equal(clearDamage(blocked, 'alice', city).ok, false); assert.equal(city.state[0], State.Gone);
});

/** Released v0.5 geometry fingerprint, verified against its 0b9fc43 source. */
function legacyDistrict(city: City): City {
  const count = 118615;
  return { ...city, count, position: city.position.subarray(0, count * 3), material: city.material.subarray(0, count),
    building: city.building.subarray(0, count), cell: city.cell.subarray(0, count), buildings: city.buildings.slice(0, 49) };
}
test('released v0.5 holes migrate only into the identical complete object prefix', () => {
  const city = buildCity(7), old = legacyDistrict(city), db = storage();
  assert.equal(damageLayout(old), 'd1-2jiv-d83df7be-6f4e9878');
  old.state[118600] = State.Gone;
  const snapshot = captureDamage(old);
  saveDamage(db, 'legacy', snapshot);
  const current = buildCity(7), loaded = loadDamage(db, 'legacy', current);
  assert.equal(loaded.status, 'migrated');
  assert.equal(loaded.snapshot.count, current.count);
  assert.equal(loaded.snapshot.layout, damageLayout(current));
  assert.deepEqual(damagedVoxels(loaded.snapshot), [118600]);
  assert.equal(db.values.get(districtDamageKey('legacy')), JSON.stringify(snapshot), 'load is read only');
  saveDamage(db, 'legacy', loaded.snapshot);
  assert.equal(loadDamage(db, 'legacy', current).status, 'loaded');
  for (const alter of [
    (world: City) => { world.position[0] += 0.25; },
    (world: City) => { world.material[118600] = Mat.Glass; },
    (world: City) => { world.buildings[48].h++; },
    (world: City) => { world.district![0].target = [46, 3, 0.25]; },
  ]) {
    const changed = buildCity(7); alter(changed);
    saveDamage(db, 'legacy', snapshot);
    assert.equal(loadDamage(db, 'legacy', changed).status, 'mismatched');
  }
});
test('a truncated object cannot pass append-only damage migration', () => {
  const city = buildCity(7), count = 118614, db = storage();
  const partial: City = { ...legacyDistrict(city), count, position: city.position.subarray(0, count * 3),
    material: city.material.subarray(0, count), building: city.building.subarray(0, count), cell: city.cell.subarray(0, count) };
  partial.state[0] = State.Gone;
  saveDamage(db, 'partial', captureDamage(partial));
  assert.equal(loadDamage(db, 'partial', city).status, 'mismatched');
});
