import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EscapeAttempt, emptyEscapeState, escapeEarned, escapeTarget, ESCAPE_PARCEL, ESCAPE_REWARD, validateEscapeState,
  type ActiveEscapeMission, type EscapeFrame } from '../src/escape-state.ts';
import { CityProgress, validateCityProgress, deserializeCityProgress } from '../src/city-progress.ts';
import { buildCity } from '../src/world.ts';

const frame = (x: number, y: number, z = 0.25, extra: Partial<EscapeFrame> = {}): EscapeFrame => ({
  dt: 1 / 60, player: { x, y, z, driving: false, flying: false, grounded: true }, wantedStars: 2, breachOpen: true, safe: false, ...extra,
});
function walk(advance: (f: EscapeFrame) => unknown, from: readonly number[], to: readonly number[], breachOpen = true): void {
  const steps = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.1);
  for (let i = 1; i <= steps; i++) advance(frame(from[0] + (to[0] - from[0]) * i / steps,
    from[1] + (to[1] - from[1]) * i / steps, 0.25, { breachOpen }));
}
function reachEscape(progress: CityProgress): void {
  progress.advanceEscape(frame(...ESCAPE_PARCEL));
  walk(f => progress.advanceEscape(f), ESCAPE_PARCEL, [41, 47.25]);
  walk(f => progress.advanceEscape(f), [41, 47.25], [39.4, 47.25]);
  assert.equal(progress.escape.active?.stage, 2);
}
const finishFrame = (): EscapeFrame => frame(-35.5, -10, 0, { player: { x: -35.5, y: -10, z: 0, driving: true, flying: false, grounded: true }, safe: true, wantedStars: 0 });

test('escape stage progression requires grounded pickup, actual open wall, and continuous walking through the breach', () => {
  const active: ActiveEscapeMission = { stage: 0 }, attempt = new EscapeAttempt(active);
  const pickup = frame(...ESCAPE_PARCEL);
  for (const player of [{ ...pickup.player, flying: true }, { ...pickup.player, driving: true },
    { ...pickup.player, grounded: false }, { ...pickup.player, z: 3.25 }]) attempt.advance({ ...pickup, player });
  assert.equal(active.stage, 0);
  attempt.advance(pickup); assert.equal(active.stage, 1); assert.deepEqual(escapeTarget(active), [40.25, 47.25, 0.25]);
  // A coordinate jump to outside the west wall cannot substitute for walking through it.
  attempt.advance(frame(39.4, 47.25)); assert.equal(active.stage, 1);
  walk(f => attempt.advance(f), [39.4, 47.25], [41, 47.25], false);
  walk(f => attempt.advance(f), [41, 47.25], [39.4, 47.25], false); assert.equal(active.stage, 1);
  walk(f => attempt.advance(f), [39.4, 47.25], [41, 47.25]);
  walk(f => attempt.advance(f), [41, 47.25], [39.4, 47.25]); assert.equal(active.stage, 2);
});

test('mission completion needs a grounded vehicle, safe garage coordinates and cleared stars', () => {
  const active: ActiveEscapeMission = { stage: 2 }, attempt = new EscapeAttempt(active), valid = finishFrame();
  for (const extra of [{ safe: false }, { wantedStars: 1 }, { dt: 0 }, { dt: NaN },
    { player: { ...valid.player, driving: false } }, { player: { ...valid.player, flying: true } },
    { player: { ...valid.player, grounded: false } }, { player: { ...valid.player, z: 4 } },
    { player: { ...valid.player, x: 46 } }]) assert.equal(attempt.advance({ ...valid, ...extra }), false);
  assert.equal(attempt.advance(valid), true);
});

test('pause, invalid frames, roof/flying breach passage never advance an attempt', () => {
  const active: ActiveEscapeMission = { stage: 0 }, attempt = new EscapeAttempt(active), pickup = frame(...ESCAPE_PARCEL);
  attempt.advance({ ...pickup, dt: 0 }); attempt.advance({ ...pickup, dt: Infinity });
  attempt.advance({ ...pickup, player: { ...pickup.player, x: NaN } }); assert.equal(active.stage, 0);
  attempt.advance(pickup); walk(f => attempt.advance(f), ESCAPE_PARCEL, [41, 47.25]);
  attempt.advance({ ...frame(39.4, 47.25), player: { x: 39.4, y: 47.25, z: 0.25, flying: true, driving: false, grounded: true } });
  assert.equal(active.stage, 1);
  attempt.advance(frame(39.4, 47.25)); assert.equal(active.stage, 1, 'landing outside is not a wall crossing');
});

test('strict escape schema migrates missing fields, rejects reward injections and inconsistent active completion', () => {
  assert.deepEqual(validateEscapeState(undefined), emptyEscapeState());
  for (const invalid of [null, {}, { active: null, completed: 'yes' }, { active: null, completed: false, reward: 900 },
    { active: { stage: 3 }, completed: false }, { active: { stage: 1, reward: 240 }, completed: false },
    { active: { stage: 1 }, completed: true }]) assert.equal(validateEscapeState(invalid), null);
  assert.equal(escapeEarned({ active: null, completed: true }), ESCAPE_REWARD);
});

test('one-time escape reward participates in wallet arithmetic and cannot be farmed after save, cancel or reset', () => {
  const progress = new CityProgress({ seed: 393 }); assert.equal(progress.acceptEscape(), true); reachEscape(progress);
  const result = progress.advanceEscape(finishFrame()); assert.equal(result?.reward, ESCAPE_REWARD);
  assert.equal(progress.coins, 240); assert.equal(progress.earned, 240); assert.equal(progress.completed, 0);
  assert.equal(progress.advanceEscape(finishFrame()), null); assert.equal(progress.acceptEscape(), false);
  progress.restartEscape(); progress.cancelEscape(); assert.equal(progress.escape.completed, true);
  const restored = new CityProgress({ snapshot: progress.snapshot() });
  assert.equal(restored.coins, 240); assert.equal(restored.acceptEscape(), false); assert.ok(deserializeCityProgress(progress.serialize()));
  const edited = progress.snapshot(); edited.earned++; edited.coins++; assert.equal(validateCityProgress(edited), null);
  const missingCompletion = progress.snapshot(); missingCompletion.escape.completed = false; assert.equal(validateCityProgress(missingCompletion), null);
});

test('escape is mutually exclusive with outdoor/indoor jobs and old v0.6 wallets migrate without money changes', () => {
  const progress = new CityProgress({ seed: 393 }); progress.acceptEscape();
  assert.equal(progress.acceptContract(progress.offers[0].id), false); assert.equal(progress.acceptIndoor('store'), false);
  assert.equal(progress.rotateOffers(), false); progress.cancelEscape(); assert.equal(progress.acceptIndoor('store'), true);
  assert.equal(progress.acceptEscape(), false); progress.cancelIndoor(); assert.equal(progress.acceptContract(progress.offers[0].id), true);
  assert.equal(progress.acceptEscape(), false);
  const legacy: Record<string, unknown> = { ...new CityProgress().snapshot() }; delete legacy.escape;
  const migrated = validateCityProgress(legacy)!; assert.deepEqual(migrated.escape, emptyEscapeState()); assert.equal(migrated.coins, 0);
  const inconsistent = new CityProgress().snapshot(); inconsistent.escape.active = { stage: 0 }; inconsistent.indoor.active = { id: 'store', stage: 0 };
  assert.equal(validateCityProgress(inconsistent), null);
});

test('active attempts restart at pickup on reload or world rebuild while preserving existing indoor and wallet data', () => {
  const progress = new CityProgress({ seed: 393 }), city = buildCity();
  progress.acceptIndoor('store'); const store = city.district!.find(b => b.id === 'store')!;
  progress.advanceIndoor({ x: store.target[0], y: store.target[1], z: 0.25, flying: false, driving: false, removedFurniture: 0 }, city.district!);
  progress.advanceIndoor({ x: store.entrance[0], y: store.entrance[1], z: 0.25, flying: false, driving: false, removedFurniture: 0 }, city.district!);
  assert.equal(progress.coins, 110);
  progress.acceptEscape(); reachEscape(progress);
  const restored = new CityProgress({ snapshot: progress.snapshot() }); assert.equal(restored.escape.active?.stage, 0);
  assert.equal(restored.coins, 110); assert.deepEqual(restored.completedIndoor, ['store']);
  assert.equal(restored.advanceEscape(finishFrame()), null); reachEscape(restored); restored.restartEscape();
  assert.equal(restored.escape.active?.stage, 0); assert.equal(restored.coins, 110);
});


test('a real grounded entry may step off shattered floor while crossing the open doorway', () => {
  const active:ActiveEscapeMission={stage:1},attempt=new EscapeAttempt(active);
  attempt.advance(frame(41.2,47.25,.61));
  for(let x=41.1;x>=39.3;x-=.1){const z=Math.max(0,.61-(41.1-x)*.14);attempt.advance(frame(x,47.25,z,{player:{x,y:47.25,z,driving:false,flying:false,grounded:x>40.9},dt:1/60}));}
  assert.equal(active.stage,2);
  const airborne:ActiveEscapeMission={stage:1},noEntry=new EscapeAttempt(airborne);
  for(let x=41.2;x>=39.3;x-=.1)noEntry.advance(frame(x,47.25,.3,{player:{x,y:47.25,z:.3,driving:false,flying:false,grounded:false}}));
  assert.equal(airborne.stage,1);
});

test('a grounded warehouse approach can jump over real rubble through the opened hole, roofs cannot substitute',()=>{
  const a:ActiveEscapeMission={stage:1},attempt=new EscapeAttempt(a);attempt.advance(frame(42.8,47.25));
  for(let x=42.7;x>39.3;x-=.1){const z=.25+Math.min(.95,(42.8-x)*.8);attempt.advance(frame(x,47.25,z,{player:{x,y:47.25,z,grounded:false,driving:false,flying:false}}));}
  assert.equal(a.stage,2);
  const roof:ActiveEscapeMission={stage:1},high=new EscapeAttempt(roof);high.advance(frame(42.8,47.25,3.25));
  walk(f=>high.advance({...f,player:{...f.player,z:3.25}}),[42.8,47.25],[39.3,47.25]);assert.equal(roof.stage,1);
});
