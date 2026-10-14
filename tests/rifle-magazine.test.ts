import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPACITY, RELOAD_SECONDS, RifleMagazine } from '../src/rifle-magazine.ts';

test('all 30 rounds fire, the last bullet starts automatic reload, and empty fire is blocked', () => {
  const magazine = new RifleMagazine();
  assert.equal(CAPACITY, 30); assert.equal(RELOAD_SECONDS, 1.8);
  for (let shot = 1; shot < CAPACITY; shot++) {
    assert.equal(magazine.fire(), true);
    assert.equal(magazine.rounds, CAPACITY - shot);
    assert.equal(magazine.reloading, false);
  }
  assert.equal(magazine.fire(), true, 'the final bullet must still be emitted by the caller');
  assert.equal(magazine.rounds, 0); assert.equal(magazine.reloading, true);
  assert.equal(magazine.reloadProgress, 0);
  assert.equal(magazine.fire(), false); assert.equal(magazine.rounds, 0);
});

test('manual reload preserves the partial magazine until completion and cannot restart its timer', () => {
  const magazine = new RifleMagazine();
  assert.equal(magazine.reload(), false, 'a full magazine needs no reload');
  magazine.fire(); magazine.fire();
  assert.equal(magazine.reload(), true);
  magazine.update(0.9); assert.equal(magazine.reloadProgress, 0.5);
  assert.equal(magazine.rounds, 28); assert.equal(magazine.fire(), false);
  assert.equal(magazine.reload(), false);
  assert.equal(magazine.reloadProgress, 0.5, 'repeated reload input must not reset its progress');
  magazine.update(0.89); assert.equal(magazine.reloading, true);
  assert.equal(magazine.fire(), false);
  magazine.update(0.01); assert.equal(magazine.reloading, false); assert.equal(magazine.rounds, CAPACITY);
  assert.equal(magazine.reloadProgress, 0);
});

test('tool switching, driving and pause freeze reload; invalid time cannot advance it', () => {
  const magazine = new RifleMagazine();
  magazine.fire(); magazine.reload(); magazine.update(0.6);
  const saved = magazine.diagnostics;
  for (const dt of [0, -1, NaN, Infinity, -Infinity]) magazine.update(dt);
  for (let i = 0; i < 20; i++) magazine.update(1, false);
  assert.deepEqual(magazine.diagnostics, saved);
  magazine.update(1.19, true); assert.equal(magazine.reloading, true);
  magazine.update(0.01, true); assert.equal(magazine.rounds, CAPACITY); assert.equal(magazine.reloading, false);
});

test('each completed reload fills only once and unlimited spare magazines support another complete cycle', () => {
  const magazine = new RifleMagazine();
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let shot = 0; shot < CAPACITY; shot++) assert.equal(magazine.fire(), true);
    for (let frame = 0; frame < 107; frame++) magazine.update(1 / 60);
    assert.equal(magazine.fire(), false, 'the reload has not reached 1.8 seconds');
    magazine.update(1 / 60); assert.equal(magazine.rounds, CAPACITY); assert.equal(magazine.reloading, false);
    magazine.fire(); assert.equal(magazine.rounds, CAPACITY - 1);
    magazine.update(100); assert.equal(magazine.rounds, CAPACITY - 1, 'idle time must not repeatedly refill a magazine');
    assert.equal(magazine.reload(), true); magazine.update(RELOAD_SECONDS);
  }
});

test('reset cancels a partial reload, restores a full magazine and leaves snapshots independent', () => {
  const magazine = new RifleMagazine();
  magazine.fire(); magazine.reload(); magazine.update(1);
  const snapshot = magazine.diagnostics;
  magazine.reset(); assert.equal(magazine.rounds, CAPACITY); assert.equal(magazine.reloading, false);
  assert.equal(magazine.reloadProgress, 0); magazine.update(1);
  assert.equal(magazine.fire(), true); assert.equal(magazine.rounds, CAPACITY - 1);
  assert.equal(snapshot.rounds, CAPACITY - 1); assert.equal(snapshot.reloading, true);
  assert.equal(snapshot.reloadProgress, 1 / RELOAD_SECONDS);
  magazine.reset(); magazine.reset(); assert.equal(magazine.rounds, CAPACITY);
});
