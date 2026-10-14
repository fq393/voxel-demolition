import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { buildCity } from '../src/world.ts';
import { skyline } from '../src/skyline.ts';
import { CityAmbience } from '../src/city-ambience.ts';
import { collectSkylineColliders, overlapsVehicle } from '../src/city-colliders.ts';
import { CityPolice } from '../src/police.ts';
import { CityLife, trafficOverlapsWorld } from '../src/city-life.ts';
import { vehicleFootprintsOverlap } from '../src/city-life-state.ts';
import type { PoliceFrame } from '../src/police-types.ts';

function encounter(target: readonly [number, number, number]) {
  const city = buildCity(), backdrop = skyline(city), boxes = collectSkylineColliders(backdrop);
  const ambience = new CityAmbience(boxes), police = new CityPolice(city, [...boxes, ...ambience.colliders]);
  const solids = [...boxes, ...ambience.colliders, ...police.colliders], life = new CityLife(city, solids);
  life.extraCarBlocked = (x,y,h) => police.blocksCar(x,y,h,[4.3,1.84,1.36]);
  life.extraPedestrianBlocked = (x,y) => police.blocksPlayer(x,y,0,1.8);
  const player = { x:target[0], y:target[1], z:target[2], driving:false, flying:false };
  const car = {x:-24.5,y:-9,heading:Math.PI/2,speed:0};
  const frame: PoliceFrame = { player, car, traffic:life.state.cars, pedestrians:life.state.pedestrians,
    wanted:{stars:2,phase:'chase',target},safe:false };
  return { police, life, city, solids, player, car, frame,
    dispose(){life.dispose(); police.dispose(); ambience.dispose(); backdrop.geometry.dispose(); (backdrop.material as THREE.Material).dispose();} };
}

for (const target of [[46.75,49,0],[46,0,0],[0,46,0]] as const) {
  test(`mutual police/traffic collisions release intersection queues while pursuing ${target}`, () => {
    const e = encounter(target), lateTravel = new Array(8).fill(0); let policeProgress = false;
    try {
      for (let step=0;step<120*60;step++) {
        const before=e.life.state.cars.map(car=>[car.x,car.y]);
        const cops=e.police.units.map(u=>[u.x,u.y]);
        e.life.update(1/60,{player:e.player,car:e.car}); e.police.update(1/60,e.frame);
        for(const u of e.police.units) {
          assert.ok(Math.hypot(u.x-cops[u.id][0],u.y-cops[u.id][1])<0.3);
          assert.equal(trafficOverlapsWorld(e.city,u.x,u.y,u.heading),false);
          assert.equal(overlapsVehicle(e.solids,u.x,u.y,u.heading,2.15,.92),false);
          for(const t of e.life.state.cars) assert.equal(vehicleFootprintsOverlap(u,t),false);
          policeProgress ||= u.id===0 && u.y>0;
        }
        if(step>=90*60) e.life.state.cars.forEach((car,i)=>lateTravel[i]+=Math.hypot(car.x-before[i][0],car.y-before[i][1]));
      }
      assert.ok(policeProgress,`lead police never passed: ${JSON.stringify(e.police.units)} traffic ${JSON.stringify(e.life.state.cars.map(c=>[c.id,c.x,c.y,c.waiting]))}`);
      assert.ok(lateTravel.every(d=>d>5),`traffic stranded ${lateTravel}: police ${JSON.stringify(e.police.units)} cars ${JSON.stringify(e.life.state.cars.map(c=>[c.id,c.x,c.y,c.waiting,c.stopped]))}`);
    } finally {e.dispose();}
  });
}

test('unreachable exact lane target backs off replans instead of evaluating paths every frame',()=>{
  const e=encounter([-23,0,0]);
  try {
    for(let i=0;i<120*60;i++) { e.life.update(1/60,{player:e.player,car:e.car}); e.police.update(1/60,e.frame); }
    assert.ok(e.police.diagnostics.replans<150,`unbounded replans: ${e.police.diagnostics.replans}`);
  } finally {e.dispose();}
});
