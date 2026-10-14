import assert from 'node:assert/strict';
import test from 'node:test';
import { PoliceSimulation } from '../src/police-state.ts';
import type { PoliceFrame, PoliceProbes } from '../src/police-types.ts';
import { vehicleFootprintsOverlap } from '../src/city-life-state.ts';

const probes = (): PoliceProbes => ({ carBlocked: () => false, officerBlocked: () => false, visible: () => true });
function frame(): PoliceFrame {
  return { player: { x: 46, y: 0, z: 0, driving: false, flying: false }, car: null, traffic: [], pedestrians: [],
    wanted: { stars: 2, phase: 'chase', target: [46, 0, 0] }, safe: false };
}
const run = (sim: PoliceSimulation, f: PoliceFrame, seconds: number, dt = 1 / 60) => {
  let caught = false, seen = false;
  for (let i = 0; i < Math.round(seconds / dt); i++) { const step = sim.update(dt, f); caught ||= step.caught; seen ||= step.seen; }
  return { caught, seen };
};

test('fixed steps yield deterministic patrol; pause and invalid input preserve state', () => {
  const a = new PoliceSimulation(probes()), b = new PoliceSimulation(probes()), f = frame(); f.wanted = { stars: 0, phase: 'quiet', target: null };
  run(a, f, 8, 1 / 60); run(b, f, 8, 1 / 30);
  assert.deepEqual(a.units, b.units);
  const state = structuredClone(a.units), time = a.diagnostics.time;
  a.update(0, f); a.update(NaN, f); a.update(1, { ...f, player: { ...f.player, x: NaN } });
  assert.deepEqual(a.units, state); assert.equal(a.diagnostics.time, time);
});

test('road pursuit reaches a distant pedestrian then catches after sustained contact', () => {
  const sim = new PoliceSimulation(probes()), f = frame();
  const result = run(sim, f, 65);
  assert.equal(result.seen, true); assert.equal(result.caught, true);
  assert.ok(sim.units.some(u => u.officer.active && Math.hypot(u.officer.x - f.player.x, u.officer.y - f.player.y) < 1.5));
});

test('LOS, flying, upper floors and garage safety prevent capture', () => {
  for (const mode of ['los', 'flying', 'height', 'safe'] as const) {
    const p = probes(); if (mode === 'los') p.visible = () => false;
    const sim = new PoliceSimulation(p), f = frame();
    const u = sim.units[0]; Object.assign(u, { x: -29.1, y: 0, heading: 0 });
    Object.assign(u.officer, { active: true, x: -27.5, y: 0 });
    f.player.x = -26.5; f.player.y = 0; f.wanted.target = [-26.5, 0, 0];
    if (mode === 'flying') f.player.flying = true;
    if (mode === 'height') f.player.z = 3.25;
    if (mode === 'safe') f.safe = true;
    assert.equal(run(sim, f, 4).caught, false, mode);
  }
});

test('walking capture needs two uninterrupted seconds and resets after losing LOS', () => {
  let visible = true; const p = probes(); p.visible = () => visible;
  const sim = new PoliceSimulation(p), f = frame(), u = sim.units[0];
  Object.assign(u, { x: -29.1, y: 0 }); Object.assign(u.officer, { active: true, x: -27.5, y: 0 });
  f.player.x = -26.5; f.player.y = 0; f.wanted.target = [-26.5, 0, 0];
  assert.equal(run(sim, f, 1.9).caught, false);
  visible = false; sim.update(1 / 60, f); visible = true;
  assert.equal(run(sim, f, 1.9).caught, false);
  assert.equal(run(sim, f, 0.2).caught, true);
});

test('slow driving capture needs three seconds; moving vehicles escape capture', () => {
  for (const speed of [0, 3]) {
    const sim = new PoliceSimulation(probes()), f = frame(), u = sim.units[0];
    Object.assign(u, { x: -29.1, y: 0, heading: Math.PI / 2 });
    f.player = { x: -29.1, y: 4.8, z: 0, driving: true, flying: false };
    f.car = { x: -29.1, y: 4.8, heading: Math.PI / 2, speed };
    f.wanted.target = [-29.1, 4.8, 0];
    assert.equal(run(sim, f, 2.9).caught, false);
    assert.equal(run(sim, f, 0.2).caught, speed === 0);
  }
});

test('cars remain separate and check every substep against traffic and pedestrians', () => {
  const sim = new PoliceSimulation(probes()), f = frame();
  f.traffic = [{ x: -29.1, y: -50, heading: -Math.PI / 2 }];
  f.pedestrians = [{ x: 69, y: 29.1 }];
  for (let i = 0; i < 3000; i++) {
    const before = sim.units.map(u => [u.x, u.y] as const); sim.update(1 / 60, f);
    for (const u of sim.units) {
      assert.ok(Math.hypot(u.x - before[u.id][0], u.y - before[u.id][1]) <= 0.3);
      for (const t of f.traffic) assert.equal(vehicleFootprintsOverlap(u, t), false);
    }
    assert.equal(vehicleFootprintsOverlap(sim.units[0], sim.units[1]), false);
  }
});

test('blocked street is routed around without resetting or crossing static barriers', () => {
  const p = probes(); p.carBlocked = (x, y) => Math.abs(x + 29.1) < 3 && y > -55 && y < -38;
  const sim = new PoliceSimulation(p), f = frame(); f.player.x = -29.1; f.player.y = 50; f.wanted.target = [-29.1, 50, 0];
  let movedAcross = false;
  for (let i = 0; i < 4200; i++) {
    const before = sim.units[0]; const x = before.x, y = before.y;
    sim.update(1 / 60, f);
    assert.equal(p.carBlocked(before.x, before.y, before.heading), false);
    assert.ok(Math.hypot(before.x - x, before.y - y) < 0.3);
    movedAcross ||= before.y > 0;
  }
  assert.equal(movedAcross, true);
});

test('fixed building corner probes admit a full patrol lap without clipping', () => {
  const p = probes();
  p.carBlocked = (x, y, heading) => {
    const body = { x, y, heading };
    // Exact rotated SAT against city block massing, more demanding than centre-only road tests.
    for (const bx of [-46, 0, 46]) for (const by of [-46, 0, 46]) {
      if (vehicleFootprintsOverlap(body, { x: bx, y: by, heading: 0, halfLength: 15, halfWidth: 15 })) return true;
    }
    return false;
  };
  const sim = new PoliceSimulation(p), f = frame(); f.wanted = { stars: 0, phase: 'quiet', target: null };
  const initial = sim.units.map(u => [u.x, u.y]); let travel = 0;
  for (let i = 0; i < 7200; i++) {
    const x = sim.units[0].x, y = sim.units[0].y; sim.update(1 / 60, f);
    for (const u of sim.units) assert.equal(p.carBlocked(u.x, u.y, u.heading), false);
    travel += Math.hypot(sim.units[0].x - x, sim.units[0].y - y);
  }
  assert.ok(travel > 350, `patrol covered only ${travel} metres from ${initial}`);
});

test('reset preserves two unit objects and rearms a clean patrol', () => {
  const sim = new PoliceSimulation(probes()), initial = structuredClone(sim.units);
  run(sim, frame(), 5); sim.reset(); assert.deepEqual(sim.units, initial); assert.equal(sim.diagnostics.time, 0);
});

test('officer navigation goes around a solid wall through its actual doorway', () => {
  const p = probes();
  p.officerBlocked = (x, y) => x > -0.3 && x < 0.3 && (y < 2 || y > 4);
  const sim = new PoliceSimulation(p), f = frame(), u = sim.units[0];
  Object.assign(u, { x: -7, y: 0, heading: 0 }); Object.assign(u.officer, { active: true, x: -4, y: 0 });
  f.player.x = 4; f.player.y = 0; f.wanted.target = [4, 0, 0];
  let doorway = false;
  for (let i = 0; i < 1600; i++) {
    const x = u.officer.x, y = u.officer.y; sim.update(1 / 60, f);
    assert.equal(p.officerBlocked(u.officer.x, u.officer.y), false);
    assert.ok(Math.hypot(u.officer.x - x, u.officer.y - y) < 0.05);
    doorway ||= Math.abs(u.officer.x) < 0.4 && u.officer.y >= 2 && u.officer.y <= 4;
  }
  assert.equal(doorway, true); assert.ok(u.officer.x > 2);
});

test('cars recover after traffic clears without snapping back to the lane', () => {
  const sim = new PoliceSimulation(probes()), f = frame(), u = sim.units[0];
  f.traffic = [{ x: -29.1, y: -58, heading: -Math.PI / 2 }];
  run(sim, f, 8); const before: Point = [u.x, u.y];
  assert.ok(sim.diagnostics.carStops > 0);
  f.traffic = [];
  for (let i = 0; i < 1800; i++) {
    const x = u.x, y = u.y; sim.update(1 / 60, f);
    assert.ok(Math.hypot(u.x - x, u.y - y) < 0.3);
  }
  assert.ok(Math.hypot(u.x - before[0], u.y - before[1]) > 20);
});

type Point = readonly [number, number];

test('nearby patrol physically closes its lane offset to capture a stationary centre-lane car', () => {
  const sim = new PoliceSimulation(probes()), f = frame(), u = sim.units[0];
  Object.assign(u, { x: -29.1, y: 0, heading: Math.PI / 2 });
  f.player = { x: -23, y: 0, z: 0, driving: true, flying: false };
  f.car = { x: -23, y: 0, heading: Math.PI / 2, speed: 0 }; f.wanted.target = [-23, 0, 0];
  let caught = false;
  for (let i = 0; i < 900; i++) {
    const x = u.x, y = u.y; const step = sim.update(1 / 60, f); caught ||= step.caught;
    assert.ok(Math.hypot(u.x - x, u.y - y) < 0.3);
    assert.equal(vehicleFootprintsOverlap(u, f.car), false);
  }
  assert.equal(caught, true); assert.ok(u.x > -29.1 + 0.8);
});

test('officers physically return and board before resuming vehicle pursuit', () => {
  const sim = new PoliceSimulation(probes()), f = frame(), u = sim.units[0];
  Object.assign(u, { x: -29.1, y: 0, heading: Math.PI / 2 });
  Object.assign(u.officer, { active: true, x: -25, y: 8 });
  f.player = { x: 23, y: 20, z: 0, driving: true, flying: false };
  f.car = { x: 23, y: 20, heading: Math.PI / 2, speed: 6 }; f.wanted.target = [23, 20, 0];
  const start = [u.x, u.y]; let boarded = false;
  for (let i = 0; i < 1800; i++) {
    const x = u.officer.x, y = u.officer.y; sim.update(1 / 60, f);
    if (u.officer.active) assert.ok(Math.hypot(u.officer.x - x, u.officer.y - y) < 0.05);
    else boarded = true;
  }
  assert.equal(boarded, true); assert.ok(Math.hypot(u.x - start[0], u.y - start[1]) > 15);
});
