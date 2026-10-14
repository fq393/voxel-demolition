import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { StreetSimulation, sampleRoute, trafficSignal, pointNearVehicle, vehicleFootprintsOverlap, type LifeFrame, type Route, type TrafficCar } from '../src/city-life-state.ts';
import { CityLife, trafficOverlapsWorld } from '../src/city-life.ts';
import { buildCity } from '../src/world.ts';
import { Player } from '../src/player.ts';
import { skyline } from '../src/skyline.ts';
import { collectSkylineColliders, overlapsPlayer, overlapsVehicle } from '../src/city-colliders.ts';

const EMPTY_FRAME: LifeFrame = { car: null, player: { x: -120, y: -120, z: 0, driving: false } };
const CLEAR = { carBlocked: () => false, pedestrianBlocked: () => false };
const advance = (simulation: StreetSimulation, seconds: number, frame = EMPTY_FRAME, dt = 1 / 60): void => {
  for (let t = 0; t < seconds - 1e-8; t += dt) simulation.update(dt, frame);
};
function positionCar(car: TrafficCar, route: Route, distance: number): void {
  car.distance = distance; Object.assign(car, sampleRoute(route, distance));
}
function distanceAt(route: Route, x: number, y: number): number {
  let best = Infinity, distance = 0;
  for (let d = 0; d < route.length; d += 0.02) {
    const pose = sampleRoute(route, d), error = Math.hypot(pose.x - x, pose.y - y);
    if (error < best) { best = error; distance = d; }
  }
  return distance;
}

test('traffic routes avoid the real voxel props and solid skyline at every half metre', () => {
  const city = buildCity(), backdrop = skyline(city) as THREE.InstancedMesh;
  const boxes = collectSkylineColliders(backdrop), simulation = new StreetSimulation(CLEAR), probe = new Player(city);
  for (const route of simulation.state.routes) for (let d = 0; d < route.length; d += 0.5) {
    const p = sampleRoute(route, d);
    assert.equal(trafficOverlapsWorld(city, p.x, p.y, p.heading), false, `voxel traffic obstruction at ${p.x},${p.y}`);
    assert.equal(overlapsVehicle(boxes, p.x, p.y, p.heading, 2.15, 0.92), false, `skyline obstruction at ${p.x},${p.y}`);
  }
  for (const route of simulation.state.walkRoutes) for (let d = 0; d < route.length; d += 0.3) {
    const p = sampleRoute(route, d);
    assert.equal(probe.blocked(p.x, p.y, 0, 1.8), false, `blocked walking path at ${p.x},${p.y}`);
  }
  for (const car of simulation.state.cars) assert.equal(vehicleFootprintsOverlap(car, { x: -25, y: -9, heading: Math.PI / 2, halfLength: 2.3, halfWidth: 1 }), false);
  backdrop.geometry.dispose(); (backdrop.material as THREE.Material).dispose();
});

test('same seed and elapsed time produce the same street life at different frame rates', () => {
  const a = new StreetSimulation(CLEAR), b = new StreetSimulation(CLEAR);
  advance(a, 30, EMPTY_FRAME, 1 / 60); advance(b, 30, EMPTY_FRAME, 1 / 30);
  assert.deepEqual(a.state, b.state);
});

test('road phases include clearance time and stopped traffic resumes over repeated cycles', () => {
  assert.equal(trafficSignal(0), 'horizontal'); assert.equal(trafficSignal(9.5), 'all-stop');
  assert.equal(trafficSignal(12), 'vertical'); assert.equal(trafficSignal(21), 'all-stop');
  const sim = new StreetSimulation(CLEAR); sim.state.pedestrians = [];
  const travelled = sim.state.cars.map(() => 0);
  for (let t = 0; t < 90 * 60; t++) {
    sim.update(1 / 60, EMPTY_FRAME);
    sim.state.cars.forEach((c, i) => travelled[i] += c.speed / 60);
    for (let i = 0; i < sim.state.cars.length; i++) for (let j = i + 1; j < sim.state.cars.length; j++) {
      assert.equal(vehicleFootprintsOverlap(sim.state.cars[i], sim.state.cars[j]), false, 'traffic bodies overlapped');
    }
  }
  assert.ok(sim.state.stops.signal > 0);
  assert.ok(travelled.every(distance => distance > 80), `cars stranded: ${travelled}`);
});

test('a follower leaves room behind a queued car and moves again when the road clears', () => {
  const sim = new StreetSimulation(CLEAR); sim.state.pedestrians = []; sim.state.cars.splice(2);
  const [behind, ahead] = sim.state.cars, route = sim.state.routes[0];
  ahead.route = 0; positionCar(behind, route, 28); positionCar(ahead, route, 37);
  const obstacle = sampleRoute(route, 47);
  const frame: LifeFrame = { ...EMPTY_FRAME, car: { ...obstacle, speed: 0 } };
  advance(sim, 4, frame);
  assert.ok(sim.state.stops.following > 0);
  assert.equal(vehicleFootprintsOverlap(behind, ahead), false);
  assert.equal(vehicleFootprintsOverlap(ahead, { ...obstacle, halfLength: 2.3, halfWidth: 1 }), false);
  const old = behind.distance; advance(sim, 13);
  assert.ok(behind.distance > old + 5);
});

test('cars yield to a pedestrian in the crossing without hitting or awarding damage', () => {
  const sim = new StreetSimulation({ ...CLEAR, pedestrianBlocked: () => true });
  sim.state.cars.splice(1); sim.state.pedestrians.splice(0, 12); sim.state.pedestrians.splice(1);
  const car = sim.state.cars[0], route = sim.state.routes[0], p = sim.state.pedestrians[0];
  positionCar(car, route, distanceAt(route, 7, 22)); car.speed = 5;
  p.x = -5; p.y = 22; p.distance = 7.1; p.offsetX = 0; p.offsetY = 0;
  advance(sim, 5);
  assert.ok(sim.state.stops.pedestrian > 0);
  assert.equal(pointNearVehicle(p.x, p.y, car, 0.32), false);
  const previous = car.distance; sim.state.pedestrians = []; advance(sim, 3);
  assert.ok(car.distance > previous + 3);
  assert.equal('health' in p, false);
});

test('walkers wait for an approaching car before entering the north road, then cross', () => {
  const sim = new StreetSimulation(CLEAR); sim.state.cars.splice(1); sim.state.pedestrians.splice(0, 12); sim.state.pedestrians.splice(1);
  const p = sim.state.pedestrians[0], car = sim.state.cars[0];
  p.distance = 2.05; Object.assign(p, sampleRoute(sim.state.walkRoutes[2], p.distance));
  positionCar(car, sim.state.routes[0], distanceAt(sim.state.routes[0], -2, 22)); car.speed = 7;
  // The walker waits at the kerb, rather than stepping into a predicted arrival.
  sim.update(1 / 60, EMPTY_FRAME);
  assert.ok(p.y < 17.1);
  sim.state.cars = []; advance(sim, 4);
  assert.ok(p.y > 20);
});

test('an obstructed route waits without teleporting and resumes after the obstacle is removed', () => {
  let blocked = true;
  const sim = new StreetSimulation({ carBlocked: () => blocked, pedestrianBlocked: () => false });
  sim.state.pedestrians = []; const car = sim.state.cars[0], original = { x: car.x, y: car.y, distance: car.distance };
  advance(sim, 5);
  assert.equal(car.x, original.x); assert.equal(car.y, original.y); assert.equal(car.distance, original.distance);
  assert.ok(sim.state.stops.world > 0);
  blocked = false; advance(sim, 3);
  assert.ok(Math.hypot(car.x - original.x, car.y - original.y) > 3);
});

test('opposing sidewalk walkers pass one another and crossing activity stays alive', () => {
  const sim = new StreetSimulation(CLEAR), travel = sim.state.pedestrians.map(() => 0);
  for (let step = 0; step < 120 * 60; step++) {
    const positions = sim.state.pedestrians.map(p => ({ x: p.x, y: p.y }));
    sim.update(1 / 60, EMPTY_FRAME);
    sim.state.pedestrians.forEach((p, i) => travel[i] += Math.hypot(p.x - positions[i].x, p.y - positions[i].y));
  }
  assert.ok(travel.every(distance => distance > 45), `walkers stranded: ${travel}`);
  assert.ok(sim.state.stops.pedestrian > 0, 'crossing traffic never yielded');
});

test('a crossing walker and outer-sidewalk walker release a mutually blocked merge', () => {
  const sim = new StreetSimulation(CLEAR);
  const sidewalk = sim.state.pedestrians[11], crossing = sim.state.pedestrians[12];
  sim.state.cars = []; sim.state.pedestrians = [sidewalk, crossing];
  sidewalk.distance = distanceAt(sim.state.walkRoutes[1], -5.4413, 29.8);
  Object.assign(sidewalk, { x: -5.4413, y: 30.16, heading: 0, waiting: 37.7, moving: false });
  crossing.distance = 29.7599 - 14.9;
  Object.assign(crossing, { x: -5, y: 29.7599, heading: Math.PI / 2, waiting: 37.7, moving: false });
  advance(sim, 20);
  assert.ok(sidewalk.waiting < 1, `sidewalk merge still stalled for ${sidewalk.waiting} seconds`);
  assert.ok(crossing.waiting < 1, `crossing merge still stalled for ${crossing.waiting} seconds`);
  assert.ok(Math.hypot(sidewalk.x + 5.4413, sidewalk.y - 30.16) > 5);
  assert.ok(Math.hypot(crossing.x + 5, crossing.y - 29.7599) > 5);
});

test('crossing walkers do not develop a late deadlock beside queued traffic', () => {
  const city = buildCity(), backdrop = skyline(city) as THREE.InstancedMesh;
  const boxes = collectSkylineColliders(backdrop), probe = new Player(city);
  probe.extraBlocked = (x, y, z, height) => overlapsPlayer(boxes, x, y, z, height);
  const sim = new StreetSimulation({
    carBlocked: (x, y, heading) => overlapsVehicle(boxes, x, y, heading, 2.15, 0.92) || trafficOverlapsWorld(city, x, y, heading),
    pedestrianBlocked: (x, y) => probe.blocked(x, y, 0, 1.8),
  });
  const frame: LifeFrame = { car: { x: -25, y: -9, heading: Math.PI / 2, speed: 0 }, player: { x: -27, y: -12, z: 0, driving: false } };
  for (let step = 0; step < 300 * 60; step++) {
    const positions = sim.state.pedestrians.map(p => ({ x: p.x, y: p.y }));
    sim.update(1 / 60, frame);
    sim.state.pedestrians.forEach((p, i) => assert.ok(Math.hypot(p.x - positions[i].x, p.y - positions[i].y) <= 0.055, `walker ${p.id} jumped`));
    for (let i = 0; i < sim.state.pedestrians.length; i++) for (let j = i + 1; j < sim.state.pedestrians.length; j++) {
      const a = sim.state.pedestrians[i], b = sim.state.pedestrians[j];
      assert.equal(Math.abs(a.x - b.x) < 0.4 && Math.abs(a.y - b.y) < 0.4, false, 'pedestrian footprints overlapped');
    }
  }
  for (const p of sim.state.pedestrians) assert.ok(p.waiting < 20, `walker ${p.id} has waited ${p.waiting} seconds`);
  assert.ok(sim.state.stops.pedestrian > 0);
  backdrop.geometry.dispose(); (backdrop.material as THREE.Material).dispose();
});

test('a blast scares nearby walkers for a short period, preserving their population and identity', () => {
  const sim = new StreetSimulation(CLEAR), p = sim.state.pedestrians[0], ids = sim.state.pedestrians.map(p => p.id);
  sim.scare(p.x - 1, p.y, 4);
  assert.ok(p.scared > 0);
  const original = { x: p.x, y: p.y }; advance(sim, 1);
  assert.ok(Math.hypot(p.x - original.x, p.y - original.y) > 1);
  advance(sim, 4);
  assert.equal(p.scared, 0); assert.deepEqual(sim.state.pedestrians.map(p => p.id), ids);
});

test('traffic/player collision and occlusion agree, with clear space above the actors', () => {
  const life = new CityLife(buildCity(), []), car = life.state.cars[0];
  assert.equal(life.blocksPlayer(car.x, car.y, 0, 1.8), true);
  assert.equal(life.blocksPlayer(car.x, car.y, 2, 1.8), false);
  assert.equal(life.blocksCar(car.x, car.y, car.heading), true);
  const dx = Math.cos(car.heading), dy = Math.sin(car.heading);
  const distance = life.rayHit([car.x - dx * 8, car.y - dy * 8, 0.6], [dx, dy, 0], 8);
  assert.ok(distance !== null && distance >= 5.7 && distance <= 5.9);
  assert.equal(life.rayHit([car.x - dx * 8, car.y - dy * 8, 2], [dx, dy, 0], 8), null);
  life.dispose();
});

test('reset updates world probes while reusing all render resources and actor counts', () => {
  const city = buildCity(), life = new CityLife(city, []), meshes = [...life.object.children];
  const frame: LifeFrame = { car: { x: -25, y: -9, heading: Math.PI / 2, speed: 0 }, player: { x: -27, y: -12, z: 0, driving: false } };
  life.update(1 / 30, frame);
  for (let i = 0; i < 5; i++) life.reset(city, []);
  assert.deepEqual(life.object.children, meshes);
  assert.equal(life.state.cars.length, 8); assert.equal(life.state.pedestrians.length, 14);
  assert.equal(life.state.time, 0); assert.equal(life.diagnostics.renderBatches, 7);
  assert.equal(life.blocksCar(-25, -9, Math.PI / 2), false);
  const empty = { ...city, buildings: [] }, blocker = { minX: -200, maxX: 200, minY: -200, maxY: 200, minZ: 0, maxZ: 30 };
  life.reset(empty, [blocker]); life.update(0.1, EMPTY_FRAME);
  assert.ok(life.diagnostics.worldStops > 0);
  life.reset(empty, []); life.update(0.1, EMPTY_FRAME);
  assert.equal(life.diagnostics.worldStops, 0);
  life.dispose();
});
