import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLES, vehicleSpec } from '../src/vehicle-spec.ts';

test('a new player can drive the free sedan, with two distinct paid upgrades', () => {
  assert.equal(vehicleSpec(undefined).id, 'sedan');
  assert.equal(vehicleSpec('sedan').price, 0);
  assert.equal(vehicleSpec('pickup').price, 300);
  assert.equal(vehicleSpec('van').price, 650);
  assert.equal(new Set(VEHICLES.map((vehicle) => vehicle.id)).size, 3);
  assert.ok(vehicleSpec('sedan').maxSpeed > vehicleSpec('pickup').maxSpeed);
  assert.ok(vehicleSpec('pickup').maxSpeed > vehicleSpec('van').maxSpeed);
  assert.ok(vehicleSpec('sedan').mass < vehicleSpec('pickup').mass);
  assert.ok(vehicleSpec('pickup').mass < vehicleSpec('van').mass);
});

test('invalid save selections cannot escape the vehicle catalog or mutate shared dimensions', () => {
  for (const bad of [null, '', 'race', 'constructor', 3, {}, ['van']]) assert.equal(vehicleSpec(bad), vehicleSpec('sedan'));
  assert.ok(Object.isFrozen(VEHICLES));
  for (const vehicle of VEHICLES) {
    assert.ok(Object.isFrozen(vehicle));
    assert.ok(Object.isFrozen(vehicle.size));
    assert.ok(vehicle.size.every((dimension) => Number.isFinite(dimension) && dimension > 0));
  }
});
