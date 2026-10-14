import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CityJobState, TOUR_STOPS, PARCEL_PICKUP, PARCEL_DROP } from '../src/city-job-state.ts';
const frame = (p: readonly [number, number], driving = false, z = 0) => ({ x: p[0], y: p[1], z, driving, demolished: 0 });
test('tour requires driving and ordered checkpoints; repeated frames cannot skip ahead', () => {
  const job = new CityJobState(); job.start('tour', 0, 1000);
  job.update(frame(TOUR_STOPS[1], true)); assert.equal(job.progress, 0);
  job.update(frame(TOUR_STOPS[0])); assert.equal(job.progress, 0);
  job.update(frame(TOUR_STOPS[0], true, 10)); assert.equal(job.progress, 0);
  job.update(frame(TOUR_STOPS[0], true)); job.update(frame(TOUR_STOPS[0], true)); assert.equal(job.progress, 1);
  job.update(frame(TOUR_STOPS[1], true)); assert.equal(job.update(frame(TOUR_STOPS[2], true)), true);
  assert.equal(job.update(frame(TOUR_STOPS[2], true)), false); assert.equal(job.badges.size, 1);
});
test('parcel requires walking at both pickup and drop, allowing driving between them', () => {
  const job = new CityJobState(); job.start('delivery', 0, 1000);
  job.update(frame(PARCEL_DROP)); job.update(frame(PARCEL_PICKUP, true)); assert.equal(job.stage, 0);
  job.update({ ...frame(PARCEL_PICKUP), flying: true }); assert.equal(job.stage, 0);
  job.update(frame(PARCEL_PICKUP)); assert.deepEqual(job.target, PARCEL_DROP);
  job.update(frame(PARCEL_DROP, true)); assert.equal(job.stage, 1);
  assert.equal(job.update(frame(PARCEL_DROP)), true);
});
test('cleanup counts only fresh region damage and adapts to fewer remaining pieces', () => {
  const job = new CityJobState(); job.start('cleanup', 50, 30);
  job.update({ ...frame([0, 0]), demolished: 60 }); assert.equal(job.progress, 10);
  assert.equal(job.update({ ...frame([0, 0]), demolished: 80 }), true);
  assert.equal(job.start('cleanup', 80, 0), false);
});
test('rebuild restarts active task, cancellation preserves earned badges, replay cannot farm', () => {
  const job = new CityJobState(['delivery', 'forged']); assert.equal(job.badges.size, 1);
  job.start('delivery', 0, 1000); job.update(frame(PARCEL_PICKUP)); job.restart(1000); assert.equal(job.stage, 0);
  job.update(frame(PARCEL_PICKUP)); job.update(frame(PARCEL_DROP)); assert.equal(job.badges.size, 1);
  job.cancel(); assert.equal(job.target, null); assert.equal(job.badges.size, 1);
});
test('nonfinite fixture values never complete a task', () => {
  const job = new CityJobState(); job.start('cleanup', 0, 500);
  assert.equal(job.update({ x: 0, y: 0, z: 0, driving: false, demolished: Infinity }), false);
});
