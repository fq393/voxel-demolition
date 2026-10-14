import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CityProgress, validateCityProgress } from '../src/city-progress.ts';
import { DISTRICT_REWARDS, type DistrictBuilding, type DistrictId, type DistrictPoint } from '../src/district-layout.ts';
import { INDOOR_FURNITURE_GOAL, indoorInstruction, indoorMission, indoorTarget, validateIndoorState,
  type IndoorMissionFrame } from '../src/indoor-mission-state.ts';

const buildings: DistrictBuilding[] = (['store', 'home', 'warehouse'] as const).map((id, index) => ({
  id, name: { store: '便利店', home: '双层住宅', warehouse: '仓库' }[id], object: index,
  bounds: { minX: index * 20, maxX: index * 20 + 10, minY: 0, maxY: 10, maxZ: id === 'home' ? 7 : 4 },
  entrance: [index * 20 + 5, -1, 0.1], target: [index * 20 + 5, 5, id === 'home' ? 3.25 : 0.25],
  furniture: [{ id: `${id}-furniture`, name: '旧家具', object: index + 3, initial: 100, at: [index * 20 + 5, 6, 0.25] }],
}));
const building = (id: DistrictId): DistrictBuilding => buildings.find(value => value.id === id)!;
const frame = (point: DistrictPoint, removedFurniture = 0): IndoorMissionFrame => ({ x: point[0], y: point[1], z: point[2], driving: false, flying: false, removedFurniture });
const finish = (progress: CityProgress, id: DistrictId): void => {
  assert.equal(progress.acceptIndoor(id), true);
  assert.equal(progress.advanceIndoor(frame(building(id).target, INDOOR_FURNITURE_GOAL), buildings), null);
  assert.equal(progress.activeIndoor?.stage, 1);
  assert.equal(progress.advanceIndoor(frame(building(id).entrance, INDOOR_FURNITURE_GOAL), buildings)?.reward, DISTRICT_REWARDS[id]);
};

test('store requires a real grounded interior visit before returning to the entrance', () => {
  const progress = new CityProgress({ seed: 393 }), store = building('store');
  assert.deepEqual(indoorMission('store'), { id: 'store', name: '便利店取件', description: '进店到柜台取件，再走回门口交付。', reward: 110 });
  assert.equal(progress.acceptIndoor('unknown'), false); assert.equal(progress.acceptIndoor('store'), true);
  assert.deepEqual(indoorTarget(progress.activeIndoor, buildings), store.target); assert.match(indoorInstruction(progress.activeIndoor, buildings), /便利店/);
  for (const bad of [frame(store.entrance), { ...frame(store.target), driving: true }, { ...frame(store.target), flying: true },
    { ...frame(store.target), z: 4 }, { ...frame(store.target), x: NaN }, { ...frame(store.target), removedFurniture: -1 }]) {
    assert.equal(progress.advanceIndoor(bad, buildings), null); assert.equal(progress.activeIndoor?.stage, 0);
  }
  progress.advanceIndoor(frame(store.target), []); assert.equal(progress.activeIndoor?.stage, 0);
  progress.advanceIndoor(frame(store.target), buildings); assert.equal(progress.activeIndoor?.stage, 1);
  assert.deepEqual(indoorTarget(progress.activeIndoor, buildings), store.entrance); assert.match(indoorInstruction(progress.activeIndoor, buildings), /交付/);
  assert.equal(progress.advanceIndoor(frame(store.target), buildings), null); assert.equal(progress.coins, 0);
  const completion = progress.advanceIndoor(frame(store.entrance), buildings);
  assert.deepEqual(completion, { id: 'store', reward: 110, coins: 110 }); assert.equal(progress.activeIndoor, null);
  assert.deepEqual(progress.completedIndoor, ['store']); assert.equal(progress.completed, 0);
  assert.equal(progress.acceptIndoor('store'), false); assert.equal(progress.advanceIndoor(frame(store.entrance), buildings), null);
});
test('a point just outside the wall does not count as reaching a nearby interior target', () => {
  const progress = new CityProgress(), store = { ...building('store'), target: [0.8, 5, 0.25] as DistrictPoint };
  progress.acceptIndoor('store'); progress.advanceIndoor(frame([-0.1, 5, 0.25]), [store]);
  assert.equal(progress.activeIndoor?.stage, 0);
  progress.advanceIndoor(frame(store.target), [store]); assert.equal(progress.activeIndoor?.stage, 1);
});
test('the home parcel requires the upper floor and resumes carrying it across a reload', () => {
  const progress = new CityProgress(), home = building('home'); progress.acceptIndoor('home');
  progress.advanceIndoor(frame([home.target[0], home.target[1], 0.25]), buildings); assert.equal(progress.activeIndoor?.stage, 0);
  progress.advanceIndoor({ ...frame(home.target), flying: true }, buildings); assert.equal(progress.activeIndoor?.stage, 0);
  progress.advanceIndoor(frame(home.target), buildings);
  const restored = new CityProgress({ snapshot: progress.snapshot() });
  assert.equal(restored.activeIndoor?.id, 'home'); assert.equal(restored.activeIndoor?.stage, 1);
  assert.equal(restored.advanceIndoor({ ...frame(home.entrance), driving: true }, buildings), null);
  assert.equal(restored.advanceIndoor(frame(home.entrance), buildings)?.reward, 150);
  const after = new CityProgress({ snapshot: restored.snapshot() });
  assert.equal(after.coins, 150); assert.equal(after.acceptIndoor('home'), false); assert.deepEqual(after.completedIndoor, ['home']);
});
test('warehouse requires enough designated furniture damage, a room visit and a return outside', () => {
  const progress = new CityProgress(), warehouse = building('warehouse'); progress.acceptIndoor('warehouse');
  progress.advanceIndoor(frame(warehouse.target, INDOOR_FURNITURE_GOAL - 1), buildings); assert.equal(progress.activeIndoor?.stage, 0);
  progress.advanceIndoor(frame(warehouse.entrance, 400), buildings); assert.equal(progress.activeIndoor?.stage, 0);
  progress.advanceIndoor(frame(warehouse.target, INDOOR_FURNITURE_GOAL), buildings); assert.equal(progress.activeIndoor?.stage, 1);
  const restored = new CityProgress({ snapshot: progress.snapshot() });
  assert.equal(restored.advanceIndoor(frame(warehouse.entrance, INDOOR_FURNITURE_GOAL), buildings)?.reward, 165);
  assert.equal(restored.coins, 165); assert.equal(restored.advanceIndoor(frame(warehouse.entrance, 1000), buildings), null);
});
test('indoor and outdoor tasks are mutually exclusive; cancel and rebuild do not clear earned rewards', () => {
  const progress = new CityProgress(), outdoor = progress.offers[0];
  progress.acceptContract(outdoor.id); assert.equal(progress.acceptIndoor('store'), false);
  progress.cancelContract(); progress.acceptIndoor('home'); assert.equal(progress.acceptIndoor('store'), false);
  assert.equal(progress.acceptContract(outdoor.id), false); assert.equal(progress.rotateOffers(), false);
  progress.advanceIndoor(frame(building('home').target), buildings); progress.cancelIndoor();
  assert.equal(progress.coins, 0); assert.equal(progress.activeIndoor, null); assert.deepEqual(progress.completedIndoor, []);
  assert.equal(progress.acceptContract(outdoor.id), true); progress.cancelContract();
  for (const id of ['store', 'home', 'warehouse'] as const) finish(progress, id);
  const restored = new CityProgress({ snapshot: progress.snapshot() });
  assert.equal(restored.coins, 425); assert.equal(restored.earned, 425); assert.equal(restored.completed, 0);
  assert.equal(restored.purchase('pickup'), 'purchased'); assert.equal(restored.coins, 125);
  const bought = new CityProgress({ snapshot: restored.snapshot() }); assert.equal(bought.coins, 125);
  bought.cancelIndoor(); assert.deepEqual(bought.completedIndoor, ['store', 'home', 'warehouse']);
});
test('fixed indoor rewards coexist with outdoor earnings and reject forged totals, IDs and stages', () => {
  const progress = new CityProgress({ seed: 393 }); finish(progress, 'store');
  const tour = progress.offers[0]; progress.acceptContract(tour.id);
  for (const [x, y] of tour.stops) progress.advanceContract({ x, y, z: 0, driving: true, demolished: 0 });
  assert.equal(progress.earned, tour.reward + 110); assert.ok(validateCityProgress(progress.snapshot()));
  assert.equal(progress.snapshot().contractEarned, tour.reward);
  const valid = progress.snapshot();
  for (const change of [
    (value: typeof valid) => { value.earned++; value.coins++; },
    (value: typeof valid) => { value.indoor.completed.push('home'); },
    (value: typeof valid) => { value.indoor.completed.push('store'); },
    (value: typeof valid) => { value.indoor.completed = ['fake' as DistrictId]; },
    (value: typeof valid) => { value.indoor.active = { id: 'home', stage: 2 as 1 }; },
    (value: typeof valid) => { value.indoor.active = { id: 'store', stage: 0 }; },
    (value: typeof valid) => { value.indoor.active = { id: 'home', stage: 0 }; value.active = { contract: value.offers[0], progress: 0, stage: 0, cleanupLast: 0 }; },
  ]) { const bad = structuredClone(valid); change(bad); assert.equal(validateCityProgress(bad), null); }
  assert.equal(validateIndoorState({ active: null, completed: ['store'], reward: 9999 }), null);
  assert.equal(validateIndoorState({ active: { id: 'home', stage: 0, reward: 9999 }, completed: [] }), null);
  assert.equal(validateIndoorState({ active: null, completed: 'store' }), null);
});
