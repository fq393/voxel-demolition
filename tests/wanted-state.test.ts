import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WantedState } from '../src/wanted-state.ts';
const at = [1, 2, 0] as const;
const frame: { seen: boolean; safe: boolean; position: readonly [number,number,number] } = { seen: false, safe: false, position: at };
function advance(w: WantedState, seconds: number, f = frame) { for (let i = 0; i < seconds * 10; i++) w.update(.1, f); }
test('weapon reports are bounded and produce three wanted levels', () => {
  const w = new WantedState(); for (let i = 0; i < 4; i++) { w.report('shot', at); advance(w, .3); }
  assert.equal(w.stars, 1); w.report('mission', at); assert.equal(w.stars, 2);
  w.report('explosion', at); assert.equal(w.stars, 3);
  for (let i = 0; i < 1000; i++) w.report('explosion', at);
  assert.ok(w.diagnostics.heat <= 130);
});
test('hidden movement never updates last known target; real sighting does', () => {
  const w = new WantedState(); w.report('mission', at);
  advance(w, 1, { ...frame, position: [90,90,0] }); assert.deepEqual(w.command.target, at);
  w.update(.1, { ...frame, seen: true, position: [90,90,0] }); assert.deepEqual(w.command.target, [90,90,0]);
  advance(w, 25); assert.equal(w.stars, 0);
});
test('garage clears in active time and pause, invalid time or inactive mode cannot advance', () => {
  const w = new WantedState(); w.report('mission', at);
  for (const dt of [0, -1, NaN, Infinity]) w.update(dt, { ...frame, safe: true });
  assert.equal(w.diagnostics.shelter, 0); advance(w, 2.9, { ...frame, safe: true }); assert.equal(w.stars, 2);
  advance(w, .2, { ...frame, safe: true }); assert.equal(w.stars, 0);
  w.setEligible(false); assert.equal(w.report('mission', at), false);
  w.setEligible(true); w.setEnabled(false); assert.equal(w.report('mission', at), false);
});
test('rebuild reset removes cooldown, crime heat and old target without changing preference', () => {
  const w = new WantedState(); w.report('mission', at); w.reset();
  assert.deepEqual(w.command, { stars: 0, phase: 'quiet', target: null });
  assert.equal(w.report('mission', at), true); w.setEnabled(false); w.reset(); assert.equal(w.enabled, false);
});
