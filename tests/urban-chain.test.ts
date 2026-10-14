import { test } from 'node:test';
import assert from 'node:assert/strict';
import { State, type City } from '../src/world.ts';
import { UrbanChain } from '../src/urban-chain.ts';

function fixtures(count = 3): City {
  const voxels = count * 10;
  return {
    count: voxels, position: new Float32Array(voxels * 3), material: new Uint8Array(voxels),
    building: new Uint16Array(voxels), cell: new Int32Array(voxels), color: new Uint32Array(voxels),
    state: new Uint8Array(voxels), exposed: new Uint8Array(voxels), pane: new Int32Array(voxels), panes: [],
    pitch: 30, street: 16, blocks: 1,
    buildings: Array.from({ length: count }, (_, i) => ({ x0: i * 4, y0: 0, w: 2, d: 1, h: 5, cells: Int32Array.from({ length: 10 }, (_, v) => i * 10 + v) })),
    urbanProps: Array.from({ length: count }, (_, i) => ({ id: `fuel-${i}`, name: 'Fuel barrel', kind: 'fuelBarrel', object: i,
      initial: 10, center: [i * 4, 0, 0.7] as const, size: [0.5, 0.5, 1.2] as const, explosive: { radius: 3, push: 12 } })),
  };
}
const damage = (city: City, object: number): void => { city.state[object * 10] = State.Loose; city.state[object * 10 + 1] = State.Gone; };

test('damage needs the threshold and a short fuse before a container detonates only once', () => {
  const city = fixtures(1), chain = new UrbanChain(city);
  city.state[0] = State.Loose;
  assert.deepEqual(chain.update(1, true), []);
  assert.equal(chain.diagnostics.pending, 0);
  city.state[1] = State.Carried;
  assert.deepEqual(chain.update(0.016, true), []);
  assert.equal(chain.diagnostics.pending, 1);
  assert.deepEqual(chain.update(0.1, true), []);
  const events = chain.update(0.15, true);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { id: 'fuel-0', at: [0, 0, 0.7], radius: 3, push: 12 });
  assert.deepEqual(chain.update(10, true), []);
  assert.equal(chain.diagnostics.detonated, 1);
});

test('a blast can damage its neighbour and that neighbour waits for its own fuse', () => {
  const city = fixtures(3), chain = new UrbanChain(city);
  damage(city, 0); chain.update(0.016, true);
  assert.deepEqual(chain.update(0.3, true).map(event => event.id), ['fuel-0']);
  damage(city, 1);
  assert.deepEqual(chain.update(0.016, true), []);
  assert.deepEqual(chain.update(0.3, true).map(event => event.id), ['fuel-1']);
  assert.equal(chain.diagnostics.armed, 1);
});

test('many queued containers are bounded to three detonations per update without losing the remainder', () => {
  const city = fixtures(10), chain = new UrbanChain(city);
  for (let i = 0; i < 10; i++) damage(city, i);
  chain.update(0.016, true);
  const first = chain.update(1, true);
  assert.equal(first.length, 3); assert.equal(chain.diagnostics.pending, 7);
  const all = [...first, ...chain.update(0.016, true), ...chain.update(0.016, true), ...chain.update(0.016, true)];
  assert.equal(all.length, 10); assert.equal(new Set(all.map(event => event.id)).size, 10);
  assert.equal(chain.diagnostics.pending, 0);
});

test('paused, zero and invalid time neither detect new damage nor consume a pending fuse', () => {
  const city = fixtures(2), chain = new UrbanChain(city);
  damage(city, 0);
  for (const dt of [0, -1, NaN, Infinity]) assert.deepEqual(chain.update(dt, true), []);
  assert.deepEqual(chain.update(10, false), []); assert.equal(chain.diagnostics.pending, 0);
  chain.update(0.016, true);
  const before = chain.diagnostics;
  for (let i = 0; i < 10; i++) { chain.update(1, false); chain.update(0, true); }
  assert.deepEqual(chain.diagnostics, before);
  assert.deepEqual(chain.update(0.1, true), []);
  assert.equal(chain.update(0.15, true).length, 1);
});

test('refresh considers even slight restored damage spent; rebuilding an intact world rearms it', () => {
  const city = fixtures(2);
  city.state[0] = State.Gone;
  const chain = new UrbanChain(city);
  assert.equal(chain.diagnostics.spent, 1);
  damage(city, 0); assert.deepEqual(chain.update(5, true), []);
  const fresh = fixtures(2); chain.reset(fresh);
  assert.equal(chain.diagnostics.spent, 0); assert.equal(chain.diagnostics.armed, 2);
  damage(fresh, 0); chain.update(0.016, true);
  assert.equal(chain.update(0.3, true).length, 1);
});

test('a world without street props has no chain overhead, and timing is reproducible', () => {
  const city = fixtures(1); delete city.urbanProps;
  const chain = new UrbanChain(city);
  assert.deepEqual(chain.update(1, true), []); assert.equal(chain.diagnostics.watchedVoxels, 0);
  const a = fixtures(3), b = fixtures(3), left = new UrbanChain(a), right = new UrbanChain(b);
  damage(a, 0); damage(b, 0);
  for (let i = 0; i < 30; i++) assert.deepEqual(left.update(0.016, true), right.update(0.016, true));
});
