import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MissionState } from '../src/mission-state.ts';

test('sandbox is unlimited; a challenge uses a copied fixed-voxel baseline', () => {
  const states = new Uint8Array([0, 0, 1, 2, 0]);
  const mission = new MissionState();
  mission.reset(states);
  mission.start();
  mission.update(100, true, states);
  assert.equal(mission.snapshot.phase, 'ready');
  assert.equal(mission.snapshot.remaining, 90);
  mission.setMode('challenge');
  mission.start();
  states[0] = 1;
  states[2] = 3;
  states[3] = 4;
  mission.update(1, true, states);
  assert.equal(mission.snapshot.count, 1);
  assert.equal(mission.snapshot.remaining, 89);
});

test('a loosened voxel counts once across all life states, including becoming fixed again', () => {
  const states = new Uint8Array(5);
  const mission = new MissionState();
  mission.reset(states);
  mission.setMode('challenge');
  mission.start();
  for (const value of [1, 2, 3, 4, 0, 1]) {
    states[0] = value;
    mission.update(0.25, true, states);
  }
  assert.equal(mission.snapshot.count, 1);
  states[1] = 2;
  mission.update(0.25, true, states);
  assert.equal(mission.snapshot.count, 2);
});

test('paused or inactive time and damage do not advance a challenge', () => {
  const states = new Uint8Array(3);
  const mission = new MissionState();
  mission.reset(states);
  mission.setMode('challenge');
  mission.start();
  states[0] = 1;
  mission.update(200, false, states);
  assert.equal(mission.snapshot.remaining, 90);
  assert.equal(mission.snapshot.count, 0);
  mission.update(2, true, states);
  assert.equal(mission.snapshot.remaining, 88);
  assert.equal(mission.snapshot.count, 1);
  mission.update(-4, true, states);
  assert.equal(mission.snapshot.remaining, 88);
});

test('reaching the target keeps a ranked round running until 90 seconds', () => {
  const states = new Uint8Array(2000);
  const mission = new MissionState();
  mission.reset(states);
  mission.setMode('challenge');
  mission.start();
  states.fill(1, 0, 1799);
  mission.update(10, true, states);
  assert.equal(mission.snapshot.phase, 'running');
  states[1799] = 2;
  mission.update(0.5, true, states);
  assert.equal(mission.snapshot.phase, 'running');
  assert.equal(mission.snapshot.count, 1800);
  assert.equal(mission.snapshot.progress, 1);
  mission.start();
  mission.update(100, true, states);
  assert.equal(mission.snapshot.phase, 'won');
  assert.equal(mission.snapshot.remaining, 0);
});

test('time expiry scans the final destruction before resolving win or loss', () => {
  const states = new Uint8Array(1800);
  const mission = new MissionState();
  mission.reset(states);
  mission.setMode('challenge');
  mission.start();
  mission.update(89.9, true, states, false);
  states.fill(4);
  mission.update(0.2, true, states, false);
  assert.equal(mission.snapshot.phase, 'won');
  assert.equal(mission.snapshot.remaining, 0);
  mission.reset(new Uint8Array(1800));
  mission.start();
  mission.update(100, true, new Uint8Array(1800), false);
  assert.equal(mission.snapshot.phase, 'lost');
  assert.equal(mission.snapshot.remaining, 0);
});

test('reset clears the score, result and timer but keeps the chosen mode', () => {
  const states = new Uint8Array(2000);
  const mission = new MissionState();
  mission.reset(states);
  mission.setMode('challenge');
  mission.start();
  states.fill(1);
  mission.update(1, true, states);
  const next = new Uint8Array([0, 0, 2]);
  mission.reset(next);
  assert.deepEqual(mission.snapshot, { mode: 'challenge', phase: 'ready', remaining: 90, duration: 90, count: 0, target: 1800, progress: 0 });
  mission.start();
  next[0] = 3;
  next[2] = 1;
  mission.update(1, true, next);
  assert.equal(mission.snapshot.count, 1);
  mission.setMode('sandbox');
  assert.equal(mission.snapshot.phase, 'ready');
  assert.equal(mission.snapshot.count, 0);
});
