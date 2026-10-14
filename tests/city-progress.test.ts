import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CityProgress, cityProgressKey, deserializeCityProgress, loadCityProgress, saveCityProgress, validateCityPose, validateCityProgress,
  type CityProgressPose, type CityProgressSnapshot, type ProgressStorage } from '../src/city-progress.ts';
import type { CleanupZone, ContractFrame, ContractPoint } from '../src/city-contracts.ts';

const zones: CleanupZone[] = [
  { id: 'west-corner', name: '西南街角', position: [-12, -13.6], remaining: 373 },
  { id: 'west-bench', name: '西侧人行道', position: [-13.6, 7.2], remaining: 220 },
];
const make = () => new CityProgress({ seed: 393, cleanupZones: zones });
const frame = (p: ContractPoint = [0, 0], driving = false, demolished = 0): ContractFrame => ({ x: p[0], y: p[1], z: 0, driving, demolished });
const storage = (): ProgressStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
};
const finishTour = (progress: CityProgress): number => {
  const offer = progress.offers.find(o => o.type === 'tour')!;
  assert.equal(progress.acceptContract(offer.id), true);
  let reward = 0;
  for (const stop of offer.stops) reward += progress.advanceContract(frame(stop, true))?.reward ?? 0;
  assert.equal(reward, offer.reward);
  return reward;
};

test('completion credits once, rotates the board and cannot be cashed again after reload', () => {
  const progress = make(), before = progress.offers.find(o => o.type === 'tour')!, db = storage();
  const reward = finishTour(progress);
  assert.equal(progress.coins, reward); assert.equal(progress.earned, reward); assert.equal(progress.completed, 1);
  assert.equal(progress.serial, 2); assert.equal(progress.active, null);
  assert.equal(progress.advanceContract(frame(before.stops.at(-1)!, true)), null);
  assert.equal(saveCityProgress(db, 'alice', progress).ok, true);
  const restored = loadCityProgress(db, 'alice', zones);
  assert.equal(restored.status, 'loaded'); assert.equal(restored.progress.coins, reward);
  assert.equal(restored.progress.acceptContract(before.id), false);
  assert.equal(restored.progress.advanceContract(frame(before.stops.at(-1)!, true)), null);
  assert.equal(restored.progress.completed, 1); assert.equal(restored.progress.coins, reward);
});

test('vehicle purchases charge once, reject insufficient funds, and selection requires ownership', () => {
  const progress = make();
  assert.deepEqual(progress.owned, ['sedan']); assert.equal(progress.selected, 'sedan');
  assert.equal(progress.purchase('pickup'), 'insufficient'); assert.equal(progress.coins, 0);
  assert.equal(progress.selectVehicle('pickup'), false); assert.equal(progress.purchase('unknown'), 'invalid');
  let earned = 0;
  for (let i = 0; i < 3; i++) earned += finishTour(progress);
  assert.equal(progress.purchase('pickup'), 'purchased'); assert.equal(progress.coins, earned - 300);
  assert.equal(progress.purchase('pickup'), 'owned'); assert.equal(progress.coins, earned - 300);
  assert.equal(progress.selectVehicle('pickup'), true); assert.equal(progress.selectVehicle('van'), false);
  const restored = new CityProgress({ cleanupZones: zones, snapshot: progress.snapshot() });
  assert.equal(restored.coins, earned - 300); assert.equal(restored.selected, 'pickup'); assert.deepEqual(restored.owned, ['sedan', 'pickup']);
  for (let i = 0; i < 6; i++) finishTour(restored);
  const balance = restored.coins;
  assert.equal(restored.purchase('van'), 'purchased'); assert.equal(restored.coins, balance - 650);
  assert.equal(restored.selectVehicle('van'), true); assert.equal(restored.selectVehicle('sedan'), true);
});

test('active tour checkpoints resume in order and cannot advance on foot or in the sky', () => {
  const progress = make(), tour = progress.offers[0];
  assert.equal(progress.acceptContract(tour.id), true);
  progress.advanceContract(frame(tour.stops[1], true));
  progress.advanceContract(frame(tour.stops[0]));
  progress.advanceContract({ ...frame(tour.stops[0], true), z: 8 });
  assert.equal(progress.active?.stage, 0);
  progress.advanceContract(frame(tour.stops[0], true));
  const restored = new CityProgress({ cleanupZones: zones, snapshot: progress.snapshot() });
  assert.equal(restored.active?.stage, 1); assert.deepEqual(restored.target, tour.stops[1]);
  assert.equal(restored.rotateOffers(), false); assert.equal(restored.acceptContract(restored.offers[1].id), false);
  for (const stop of tour.stops.slice(1)) restored.advanceContract(frame(stop, true));
  assert.equal(restored.completed, 1); assert.equal(restored.coins, tour.reward);
});

test('delivery resumes with a carried parcel; cancel keeps the wallet and gives no partial reward', () => {
  const progress = make(), parcel = progress.offers[1];
  progress.acceptContract(parcel.id);
  progress.advanceContract(frame(parcel.stops[0], true));
  progress.advanceContract({ ...frame(parcel.stops[0]), flying: true });
  assert.equal(progress.active?.stage, 0);
  progress.advanceContract(frame(parcel.stops[0]));
  const restored = new CityProgress({ cleanupZones: zones, snapshot: progress.snapshot() });
  assert.equal(restored.active?.stage, 1); assert.deepEqual(restored.target, parcel.stops[1]);
  restored.advanceContract(frame(parcel.stops[1], true)); assert.equal(restored.coins, 0);
  const complete = restored.advanceContract(frame(parcel.stops[1]));
  assert.equal(complete?.reward, parcel.reward); assert.equal(restored.completed, 1);
  const next = restored.offers[1]; restored.acceptContract(next.id); restored.advanceContract(frame(next.stops[0]));
  const balance = restored.coins; restored.cancelContract();
  assert.equal(restored.target, null); assert.equal(restored.coins, balance); assert.equal(restored.completed, 1);
  assert.equal(restored.advanceContract(frame(next.stops[1])), null);
  assert.equal(restored.acceptContract(next.id), true); assert.equal(restored.active?.stage, 0);
});

test('cleanup tracks only fresh regional damage and rebases a rebuilt world without erasing saved work', () => {
  const progress = make(), cleanup = progress.offers[2];
  assert.equal(cleanup.type, 'cleanup'); assert.equal(progress.acceptContract(cleanup.id, 35), true);
  progress.advanceContract(frame([0, 0], false, 55)); assert.equal(progress.active?.progress, 20);
  progress.advanceContract(frame([0, 0], false, 55)); assert.equal(progress.active?.progress, 20);
  const restored = new CityProgress({ cleanupZones: zones, snapshot: progress.snapshot() });
  restored.rebaseCleanup(0); assert.equal(restored.active?.progress, 20);
  const result = restored.advanceContract(frame([0, 0], false, cleanup.cleanupTarget - 20));
  assert.equal(result?.reward, cleanup.reward); assert.equal(restored.completed, 1);
  assert.equal(restored.advanceContract(frame([0, 0], false, 900)), null);
  const depleted = make(); depleted.setCleanupZones(zones.map(zone => ({ ...zone, remaining: 0 })));
  assert.equal(depleted.acceptContract(depleted.offers[2].id), false);
  depleted.rotateOffers(); assert.equal(depleted.offers.some(o => o.type === 'cleanup'), false);
});

test('an odd remaining voxel count still grants integer coins and reloads after completion', () => {
  const oddZones = [{ ...zones[0], remaining: 63 }];
  const progress = new CityProgress({ seed: 393, cleanupZones: oddZones });
  const cleanup = progress.offers[2];
  assert.equal(cleanup.cleanupTarget, 60); assert.equal(Number.isInteger(cleanup.reward), true);
  assert.equal(progress.acceptContract(cleanup.id), true);
  progress.advanceContract(frame([0, 0], false, cleanup.cleanupTarget));
  const db = storage(); saveCityProgress(db, 'odd-remaining', progress);
  const restored = loadCityProgress(db, 'odd-remaining', oddZones);
  assert.equal(restored.status, 'loaded'); assert.equal(restored.progress.coins, cleanup.reward);
});

test('bad/unknown save versions, cars, balance math, offers and completed active tasks are rejected', () => {
  const original = make().snapshot();
  const bad = (change: (value: CityProgressSnapshot) => void): void => {
    const value = structuredClone(original); change(value); assert.equal(validateCityProgress(value, zones), null);
  };
  bad(v => { v.version = 99 as 1; }); bad(v => { v.coins = -1; }); bad(v => { v.coins = Infinity; });
  bad(v => { v.coins = 1; }); bad(v => { v.earned = 180; }); bad(v => { v.serial = 0; }); bad(v => { v.seed = -1; });
  bad(v => { v.owned.push('police' as 'sedan'); }); bad(v => { v.owned.push('sedan'); }); bad(v => { v.selected = 'van'; });
  bad(v => { v.offers[0].reward = 999; }); bad(v => { v.offers[0].stops = [[180, 180], [-180, -180], [0, 0]]; });
  bad(v => { v.offers[1].stops = [v.offers[1].stops[0], v.offers[1].stops[0]]; });
  bad(v => { v.offers[2].cleanupZoneId = 'missing-zone'; });
  bad(v => { v.active = { contract: v.offers[1], stage: 2, progress: 2, cleanupLast: 0 }; });
  assert.equal(deserializeCityProgress('{broken json', zones), null);
  assert.equal(deserializeCityProgress('null', zones), null);
  const db = storage(); db.values.set(cityProgressKey('alice'), 'broken');
  const loaded = loadCityProgress(db, 'alice', zones); assert.equal(loaded.status, 'invalid'); assert.equal(loaded.progress.coins, 0);
});

test('poses retain health and heading, clamp altitude, and discard nonfinite/out-of-world coordinates', () => {
  const pose: CityProgressPose = { player: { x: -24, y: -10, z: 80, yaw: 20, driving: false }, car: { x: -24.5, y: -12, z: 50, yaw: -10, health: 0.4 } };
  const valid = validateCityPose(pose)!;
  assert.equal(valid.player.z, 60); assert.equal(valid.car.z, 1); assert.equal(valid.car.health, 0.4);
  assert.ok(Math.abs(valid.player.yaw) <= Math.PI); assert.ok(Math.abs(valid.car.yaw) <= Math.PI);
  const progress = make(); assert.equal(progress.capturePose(pose), true);
  const restore = new CityProgress({ cleanupZones: zones, snapshot: progress.snapshot() }); assert.deepEqual(restore.pose, valid);
  assert.equal(validateCityPose({ ...pose, player: { ...pose.player, x: 181 } }), null);
  assert.equal(validateCityPose({ ...pose, car: { ...pose.car, yaw: Infinity } }), null);
  assert.equal(validateCityPose({ ...pose, car: { ...pose.car, health: -1 } }), null);
  assert.equal(progress.capturePose({ ...pose, player: { ...pose.player, x: Infinity } }), false); assert.deepEqual(progress.pose, valid);
  const invalidPoseSave = progress.snapshot(); invalidPoseSave.pose!.car.x = 1000;
  assert.equal(validateCityProgress(invalidPoseSave, zones)?.pose, null);
  assert.equal(validateCityPose({ ...pose, player: { ...pose.player, z: 3.25 } })?.player.z, 3.25);
});

test('old v0.4 wallets gain empty indoor state without changing the version or key', () => {
  const progress = make(); finishTour(progress);
  const legacy: Record<string, unknown> = { ...progress.snapshot() }; delete legacy.indoor; delete legacy.contractEarned;
  const migrated = validateCityProgress(legacy, zones)!;
  assert.deepEqual(migrated.indoor, { active: null, completed: [] });
  assert.equal(migrated.coins, progress.coins); assert.equal(migrated.completed, 1);
  assert.equal(migrated.contractEarned, progress.earned);
  const db = storage(); db.values.set(cityProgressKey('legacy-player'), JSON.stringify(legacy));
  const loaded = loadCityProgress(db, 'legacy-player', zones);
  assert.equal(loaded.status, 'loaded'); assert.equal(loaded.progress.coins, progress.coins);
  assert.equal(cityProgressKey('legacy-player'), 'city.progress.v1.legacy-player');
});

test('storage failures are explicit, nickname identities stay separate, and legacy badges grant no money', () => {
  const db = storage(), progress = make(); finishTour(progress); saveCityProgress(db, 'alice', progress);
  assert.equal(loadCityProgress(db, 'bob', zones).status, 'fresh'); assert.equal(loadCityProgress(db, 'bob', zones).progress.coins, 0);
  db.values.set('city.jobs.charlie', JSON.stringify(['tour', 'cleanup', 'forged', 'cleanup']));
  const legacy = loadCityProgress(db, 'charlie', zones);
  assert.equal(legacy.status, 'migrated'); assert.deepEqual(legacy.progress.badges, ['tour', 'cleanup']);
  assert.equal(legacy.progress.coins, 0); assert.equal(legacy.progress.completed, 0);
  const blocked: ProgressStorage = { getItem: () => { throw Error('disabled'); }, setItem: () => { throw Error('quota'); } };
  assert.equal(loadCityProgress(blocked, 'alice', zones).status, 'unavailable');
  const failed = saveCityProgress(blocked, 'alice', progress); assert.equal(failed.ok, false); assert.ok(failed.error);
  assert.ok(progress.coins > 0);
});
