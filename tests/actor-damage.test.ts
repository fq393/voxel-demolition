import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { CityLife } from '../src/city-life.ts';
import { CityPolice } from '../src/police.ts';
import { buildCity } from '../src/world.ts';
import { inGarage, type PoliceFrame } from '../src/police-types.ts';
import { damageBody, rayDamageBody } from '../src/actor-damage.ts';
import type { WorldDamageRequest } from '../src/world-damage-types.ts';
const hit=(id:string,at:readonly[number,number,number],amount=500):WorldDamageRequest=>({directId:id,at,amount,radius:0,impulse:3,kind:'bullet'});
const quiet:PoliceFrame={player:{x:-120,y:-120,z:0,driving:false,flying:false},car:null,traffic:[],pedestrians:[],wanted:{stars:0,phase:'quiet',target:null},safe:false};
const dead=(value:object)=>JSON.parse(JSON.stringify(value));

test('rotated OBB faces supply real normals; invalid rays do not produce targets',()=>{
 const b=damageBody('c','vehicle',{x:0,y:0,heading:Math.PI/2},2,1,0,2,120,0);
 const h=rayDamageBody(b,[0,-5,1],[0,1,0],10)!;
 assert.equal(h.t,3);assert.ok(Math.abs(h.normal[0])<1e-12);assert.equal(h.normal[1],-1);
 assert.equal(rayDamageBody(b,[0,0,1],[0,0,0],10),null);
 assert.equal(rayDamageBody(b,[NaN,0,1],[1,0,0],10),null);
});

test('street targets use actual poses; death removes simulation/collision/occlusion without another event',()=>{
 const life=new CityLife(buildCity(),[]),p=life.state.pedestrians[0],car=life.state.cars[0];
 Object.assign(p,{x:-45,y:-20,heading:0,moving:true});Object.assign(car,{x:-45,y:-30,heading:Math.PI/2,speed:8});
 assert.equal(life.damageRay([-48,-20,1.4],[1,0,0],4)?.id,'life-person:0');
 assert.equal(life.damageRay([-45,-35,.8],[0,1,0],6)?.id,'life-car:0');
 assert.equal(life.damage(hit('life-person:0',[-45,-20,1])).length,1);
 assert.equal(life.damage(hit('life-car:0',[-45,-30,.8])).length,1);
 assert.equal(life.state.pedestrians.length,13);assert.equal(life.state.cars.length,7);
 assert.equal(car.speed,0);assert.equal(p.moving,false);
 assert.equal(life.blocksPlayer(-45,-20,0,1.8),false);assert.equal(life.blocksCar(-45,-30,0),false);
 assert.equal(life.damageRay([-48,-20,1.4],[1,0,0],4),null);
 assert.deepEqual(life.damage(hit('life-person:0',[-45,-20,1])),[]);
 const pos=[p.x,p.y,car.x,car.y];
 for(let i=0;i<120;i++)life.update(1/60,quiet);
 assert.deepEqual([p.x,p.y,car.x,car.y],pos);
 life.dispose();
});

test('radial body distance and direct IDs do not accidentally damage neighbouring actors; input validation is atomic',()=>{
 const life=new CityLife(buildCity(),[]),a=life.state.pedestrians[0],b=life.state.pedestrians[1];
 Object.assign(a,{x:-45,y:-20,heading:0});Object.assign(b,{x:-40,y:-20,heading:0});
 assert.equal(life.damage({...hit('life-person:0',[-45,-20,1],20),directId:undefined,radius:.5}).length,1);
 assert.equal((life.snapshotDamage() as any).bodies[8].hp,40);
 assert.equal((life.snapshotDamage() as any).bodies[9].hp,60);
 const before=life.snapshotDamage();
 for(const r of [{...hit('life-person:0',[NaN,0,0]),amount:3},{...hit('life-person:0',[0,0,0]),radius:-1},{...hit('life-person:0',[0,0,0]),amount:Infinity}])assert.deepEqual(life.damage(r),[]);
 assert.deepEqual(life.snapshotDamage(),before);life.dispose();
});

test('restoring actors is strict and silent; pause freezes falls, reset restores bodies and reuses resources',()=>{
 const city=buildCity(),life=new CityLife(city,[]),p=life.state.pedestrians[2];
 Object.assign(p,{x:-46,y:-17});life.damage(hit('life-person:2',[-46,-17,1]));
 const save=life.snapshotDamage(),resources=life.object.children.map(c=>(c as THREE.InstancedMesh).geometry);
 life.update(0,quiet);const frozen=life.object.children.map(c=>(c as THREE.InstancedMesh).instanceMatrix.array.slice());
 life.update(0,quiet);life.object.children.forEach((c,i)=>assert.deepEqual((c as THREE.InstancedMesh).instanceMatrix.array,frozen[i]));
 life.reset(city,[]);assert.equal(life.state.pedestrians.length,14);
 assert.equal(life.restoreDamage(save),true);assert.equal(life.state.pedestrians.some(p=>p.id===2),false);
 assert.deepEqual(life.damage(hit('life-person:2',[-46,-17,1])),[]);
 const bad=dead(save);bad.bodies[0].hp=121;const before=life.snapshotDamage();
 assert.equal(life.restoreDamage(bad),false);assert.deepEqual(life.snapshotDamage(),before);
 life.reset(city,[]);assert.equal(life.state.pedestrians.length,14);assert.deepEqual(life.object.children.map(c=>(c as THREE.InstancedMesh).geometry),resources);
 life.dispose();life.dispose();
});

test('destroyed cop car releases a living officer; destroyed officers cannot see/arrest, block or keep traffic stopped',()=>{
 const police=new CityPolice(buildCity(),[]),u=police.units[0];
 Object.assign(u,{x:-45,y:-20,heading:0});
 police.damage(hit('police-car:0',[-45,-20,1]));assert.equal(u.carDestroyed,true);
 police.update(1/60,quiet);assert.equal(u.officer.active,true);
 assert.equal(police.blocksCar(-45,-20,Math.PI/2,[1,1,1]),false);
 for(const unit of police.units){
  Object.assign(unit.officer,{active:true,x:-45,y:-16,heading:0});
  police.damage(hit(`police-person:${unit.id}`,[-45,-16,1]));
 }
 assert.equal(police.blocksPlayer(-45,-16,0,1.8),false);
 const frame={...quiet,player:{...quiet.player,x:-45,y:-16},wanted:{stars:3,phase:'chase' as const,target:[-45,-16,0] as const}};
 for(let i=0;i<300;i++)assert.deepEqual(police.update(1/60,frame),{seen:false,caught:false});
 assert.equal(police.units[0].officer.active,false);assert.equal(police.units[1].officer.active,false);
 const save=police.snapshotDamage();police.reset(buildCity(),[]);assert.equal(police.restoreDamage(save),true);
 assert.ok(police.units.every(u=>u.officerDestroyed));assert.deepEqual(police.update(1/60,frame),{seen:false,caught:false});
 police.dispose();
});

test('each garage section opens a real matching hole; safe ground survives all sections and reset restores six',()=>{
 const city=buildCity(),police=new CityPolice(city,[]),array=police.colliders;
 assert.equal(police.damageRay([-44,-10,1],[1,0,0],5)?.id,'garage:0');
 const revision=police.colliderRevision;
 assert.equal(police.blocksPlayer(-39.9,-10,0,1.8),true);
 police.damage(hit('garage:0',[-40,-10,1]));
 assert.equal(police.colliderRevision,revision+1);assert.equal(police.colliders,array);
 assert.equal(police.blocksPlayer(-39.9,-10,0,1.8),false);
 assert.equal(police.rayHit([-44,-10,1],[1,0,0],5),null);
 for(let i=1;i<6;i++)police.damage(hit(`garage:${i}`,[-35,-10,1]));
 assert.equal(police.colliders.length,0);assert.equal(inGarage(-35,-10,0),true);
 const save=police.snapshotDamage(),bad=dead(save);bad.bodies[4].x+=1;
 assert.equal(police.restoreDamage(bad),false);assert.equal(police.restoreDamage(save),true);
 assert.equal(police.colliders.length,0);police.reset(city,[]);assert.equal(police.colliders.length,6);
 police.dispose();
});

test('all populations can be destroyed without capped target counts; reset alone repopulates',()=>{
 const city=buildCity(),life=new CityLife(city,[]),police=new CityPolice(city,[]);
 police.units.forEach(u=>Object.assign(u.officer,{active:true,x:u.x+4,y:u.y}));
 const blast:WorldDamageRequest={at:[0,0,1],radius:300,amount:10000,impulse:10,kind:'explosion'};
 const all=[...life.damage(blast),...police.damage(blast)];
 assert.equal(all.length,32);assert.equal(new Set(all.map(e=>e.id)).size,32);assert.ok(all.every(e=>e.destroyed));
 assert.equal(life.state.cars.length,0);assert.equal(life.state.pedestrians.length,0);
 assert.equal(police.colliders.length,0);assert.ok(police.units.every(u=>u.carDestroyed&&u.officerDestroyed));
 for(let i=0;i<360;i++){life.update(1/60,quiet);police.update(1/60,quiet);}
 assert.equal(life.diagnostics.movingCars,0);assert.equal(life.diagnostics.walkingPedestrians,0);
 assert.equal(life.damage(blast).length+police.damage(blast).length,0);
 life.reset(city,[]);police.reset(city,[]);assert.equal(life.state.cars.length,8);assert.equal(life.state.pedestrians.length,14);
 assert.ok(police.units.every(u=>!u.carDestroyed&&!u.officerDestroyed));
 life.dispose();police.dispose();
});

test('breaking a garage wall updates actual police LOS and fixed probes without restarting the simulation',()=>{
 const police=new CityPolice(buildCity(),[]),u=police.units[0];
 Object.assign(u,{x:-35,y:-18,speed:0});Object.assign(police.units[1],{x:100,y:100});
 const frame={...quiet,player:{...quiet.player,x:-35,y:-10},wanted:{stars:1,phase:'chase' as const,target:[-35,-10,0] as const}};
 assert.equal(police.update(1/60,frame).seen,false);
 const before=police.diagnostics.time;
 police.damage(hit('garage:1',[-35,-14,1]));
 police.setStaticBoxes([]);assert.equal(police.update(1/60,frame).seen,true);
 assert.ok(police.diagnostics.time>before);assert.equal(police.units[0],u);
 police.dispose();
});

test('saved living officer keeps its out-of-car pose and cannot restore a malformed officer flag',()=>{
 const police=new CityPolice(buildCity(),[]),u=police.units[0];
 Object.assign(u.officer,{active:true,x:-45,y:-10,heading:.4});
 police.damage(hit('police-person:0',[-45,-10,1],20));
 const save=police.snapshotDamage();police.reset(buildCity(),[]);
 assert.equal(police.restoreDamage(save),true);assert.equal(police.units[0].officer.active,true);
 assert.equal(police.units[0].officer.x,-45);
 const bad=dead(save);bad.officerActive[0]='true';assert.equal(police.restoreDamage(bad),false);
 assert.deepEqual(police.snapshotDamage(),save);police.dispose();
});

test('healthy actors reject off-route or out-of-city saved poses atomically',()=>{
 const life=new CityLife(buildCity(),[]),police=new CityPolice(buildCity(),[]);
 const lifeBefore=life.snapshotDamage(),policeBefore=police.snapshotDamage();
 for(const [x,y] of [[999,999],[0,0],[100,100]]){
  const bad=dead(lifeBefore);bad.bodies[0].x=x;bad.bodies[0].y=y;bad.bodies[8].hp=1;
  assert.equal(life.restoreDamage(bad),false);assert.deepEqual(life.snapshotDamage(),lifeBefore);
  const badPolice=dead(policeBefore);badPolice.bodies[0].x=x;badPolice.bodies[0].y=y;badPolice.bodies[1].hp=1;
  assert.equal(police.restoreDamage(badPolice),false);assert.deepEqual(police.snapshotDamage(),policeBefore);
 }
 const badPed=dead(lifeBefore);badPed.bodies[8].x=100;badPed.bodies[8].y=100;
 assert.equal(life.restoreDamage(badPed),false);assert.deepEqual(life.snapshotDamage(),lifeBefore);
 const badOfficer=dead(policeBefore);badOfficer.officerActive[0]=true;badOfficer.bodies[1].x=43;badOfficer.bodies[1].y=40.75;
 assert.equal(police.restoreDamage(badOfficer),false);assert.deepEqual(police.snapshotDamage(),policeBefore);
 life.dispose();police.dispose();
});

test('running a city for 100 seconds then restoring legitimate poses cannot jump beyond one movement step',()=>{
 const city=buildCity(),life=new CityLife(city,[]),police=new CityPolice(city,[]);
 for(let i=0;i<6000;i++){life.update(1/60,quiet);police.update(1/60,quiet);}
 const lifeSave=life.snapshotDamage(),policeSave=police.snapshotDamage();
 life.reset(city,[]);police.reset(city,[]);
 assert.equal(life.restoreDamage(lifeSave),true);assert.equal(police.restoreDamage(policeSave),true);
 const cars=life.state.cars.map(c=>[c.x,c.y]),people=life.state.pedestrians.map(p=>[p.x,p.y]),cops=police.units.map(u=>[u.x,u.y]);
 life.update(1/60,quiet);police.update(1/60,quiet);
 life.state.cars.forEach((c,i)=>assert.ok(Math.hypot(c.x-cars[i][0],c.y-cars[i][1])<.15));
 life.state.pedestrians.forEach((p,i)=>assert.ok(Math.hypot(p.x-people[i][0],p.y-people[i][1])<=2.4/60+1e-9));
 police.units.forEach((u,i)=>assert.ok(Math.hypot(u.x-cops[i][0],u.y-cops[i][1])<.3));
 life.dispose();police.dispose();
});

test('police restore uses the exact live movement road band and atomically rejects a stranded shoulder pose',()=>{
 const police=new CityPolice(buildCity(),[]),before=police.snapshotDamage(),bad=dead(before);
 bad.bodies[0].x=-30.7;bad.bodies[0].y=-46;bad.bodies[0].heading=Math.PI/2;
 assert.equal(police.restoreDamage(bad),false);assert.deepEqual(police.snapshotDamage(),before);
 police.dispose();
});
