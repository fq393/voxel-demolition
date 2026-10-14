import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateContracts, validateContract, CONTRACT_DELIVERY_STOPS, CONTRACT_ROAD_STOPS, type CleanupZone } from '../src/city-contracts.ts';
import { buildCity } from '../src/world.ts';
import { Player } from '../src/player.ts';
const zones: CleanupZone[] = [
  { id: 'west-corner', name: '西南街角', position: [-12, -13.6], remaining: 373 },
  { id: 'west-bench', name: '西侧人行道', position: [-13.6, 7.2], remaining: 220 },
  { id: 'bus-stop', name: '南边公交站', position: [11, -15.6], remaining: 85 },
];

test('offers are reproducible per seed/serial, varied over rotations, and use reachable distinct anchors', () => {
  const first = generateContracts(393, 1, zones);
  assert.deepEqual(generateContracts(393, 1, zones), first);
  const tours = new Set<string>(), deliveries = new Set<string>(), cleanups = new Set<string>();
  for (let serial = 1; serial <= 150; serial++) {
    const offers = generateContracts(393, serial, zones);
    assert.equal(offers.length, 3); assert.equal(new Set(offers.map(o => o.id)).size, 3);
    for (const offer of offers) {
      assert.deepEqual(validateContract(offer, 393, serial, zones), offer); assert.ok(offer.reward >= 90 && offer.reward <= 180);
      if (offer.type === 'tour') {
        assert.ok(offer.stops.every(p => CONTRACT_ROAD_STOPS.some(anchor => anchor[0] === p[0] && anchor[1] === p[1])));
        assert.equal(new Set(offer.stops.map(p => p.join(','))).size, offer.stops.length); tours.add(JSON.stringify(offer.stops));
      } else if (offer.type === 'delivery') {
        assert.notDeepEqual(offer.stops[0], offer.stops[1]);
        assert.ok(offer.stops.every(p => CONTRACT_DELIVERY_STOPS.some(anchor => anchor[0] === p[0] && anchor[1] === p[1])));
        assert.ok(Math.hypot(offer.stops[0][0] - offer.stops[1][0], offer.stops[0][1] - offer.stops[1][1]) > 6);
        deliveries.add(JSON.stringify(offer.stops));
      } else {
        const zone = zones.find(z => z.id === offer.cleanupZoneId)!;
        assert.ok(offer.cleanupTarget >= 60 && offer.cleanupTarget <= 120 && offer.cleanupTarget <= zone.remaining);
        cleanups.add(`${offer.cleanupZoneId}:${offer.cleanupTarget}`);
      }
    }
  }
  assert.ok(tours.size >= 12); assert.ok(deliveries.size >= 15); assert.ok(cleanups.size >= 12);
  assert.notDeepEqual(generateContracts(394, 1, zones), first);
});

test('depleted and invalid cleanup zones cannot generate impossible cleanup contracts', () => {
  const depleted = zones.map(zone => ({ ...zone, remaining: 59 }));
  assert.deepEqual(generateContracts(393, 1, depleted).map(o => o.type), ['tour', 'delivery', 'delivery']);
  const invalid = zones.map(zone => ({ ...zone, position: [Infinity, 0] as const }));
  assert.equal(generateContracts(393, 1, invalid).some(o => o.type === 'cleanup'), false);
  const tiny = [{ ...zones[0], remaining: 60 }];
  for (let serial = 1; serial <= 20; serial++) assert.equal(generateContracts(393, serial, tiny)[2].cleanupTarget, 60);
});

test('every delivery marker leaves standing room in the real voxel street geometry', () => {
  const player = new Player(buildCity());
  for (const [x, y] of CONTRACT_DELIVERY_STOPS) assert.equal(player.blocked(x, y, 0, 1.8), false, `parcel marker ${x},${y} is inside a street prop`);
});
