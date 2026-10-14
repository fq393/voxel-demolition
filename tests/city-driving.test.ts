import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CITY_CAR_SPAWNS, findVehicleExit, playerOverlapsCar, safeExitSpeed } from '../src/city-driving.ts';
import { buildCity } from '../src/world.ts';
import { sweep } from '../src/car.ts';
import { Player } from '../src/player.ts';

test('city parking slots are clear of the real voxel map and leave a usable exit', () => {
  const city = buildCity(); const player = new Player(city);
  for (const [x, y, h] of CITY_CAR_SPAWNS) {
    assert.equal(sweep(city, x, y, h).length, 0);
    const exit = findVehicleExit(x, y, h, (px, py, pz) => player.blocked(px, py, pz, 1.8) || playerOverlapsCar(px, py, pz, 1.8, x, y, h));
    assert.ok(exit);
  }
});
test('standing player collides with rotated car while jumping clear remains possible', () => {
  assert.equal(playerOverlapsCar(0, 0, 0, 1.8, 0, 0, 0), true);
  assert.equal(playerOverlapsCar(0, 2, 0, 1.8, 0, 0, 0), false);
  assert.equal(playerOverlapsCar(0, 2, 0, 1.8, 0, 0, Math.PI / 2), true);
  assert.equal(playerOverlapsCar(0, 0, 1.4, 1.8, 0, 0, 0), false);
});
test('blocked left door uses the right door, blocked area refuses an unsafe exit', () => {
  assert.deepEqual(findVehicleExit(0, 0, 0, (_x, y) => y > 0), [0, -2.1, 0]);
  assert.equal(findVehicleExit(0, 0, 0, () => true), null);
});
test('rubble can raise exit footing and rotated exits still clear the vehicle', () => {
  const exit = findVehicleExit(12, -8, Math.PI / 3, (_x, _y, z) => z < 0.5);
  assert.ok(exit); assert.equal(exit[2], 0.5);
  assert.equal(playerOverlapsCar(...exit, 1.8, 12, -8, Math.PI / 3), false);
});
test('fast sideways drift cannot bypass the exit speed gate', () => {
  assert.equal(safeExitSpeed(0, 20), false);
  assert.equal(safeExitSpeed(-20, 0), false);
  assert.equal(safeExitSpeed(3, 3), false);
  assert.equal(safeExitSpeed(0, 0), true);
});
