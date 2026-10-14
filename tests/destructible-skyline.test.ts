import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three/webgpu';
import { DestructibleSkyline } from '../src/destructible-skyline.ts';
import { skyline } from '../src/skyline.ts';
import { buildCity } from '../src/world.ts';
import { CityAmbience } from '../src/city-ambience.ts';
import type { WorldDamageRequest } from '../src/world-damage-types.ts';

function one() {
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardNodeMaterial(),2);
  mesh.setMatrixAt(0,new THREE.Matrix4().makeScale(30,30,.12).setPosition(0,0,.06));
  mesh.setMatrixAt(1,new THREE.Matrix4().makeScale(10,10,9.6).setPosition(0,0,4.8));
  mesh.setColorAt(1,new THREE.Color(0xdb9f89));
  return new DestructibleSkyline(mesh);
}
function hit(id:string,amount=120):WorldDamageRequest {return {at:[0,0,0],radius:0,amount,impulse:10,kind:'bullet',directId:id};}
function countVisible(ambience:CityAmbience) {
  let n=0;const matrix=new THREE.Matrix4();
  ambience.object.traverse(o=> {if(o instanceof THREE.InstancedMesh)for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);if(matrix.elements[0]||matrix.elements[1]||matrix.elements[2])n++;}});
  return n;
}

test('healthy facade keeps one source batch, stable cell targets, HP and real holes',()=> {
  const d=one();
  assert.equal(d.diagnostics.buildings,1);assert.equal(d.diagnostics.cells,48);assert.equal(d.diagnostics.drawCalls,1);
  for(const mesh of d.object.children.slice(1) as THREE.InstancedMesh[]) {
    assert.ok(mesh.instanceColor);assert.equal(mesh.instanceColor.count,mesh.instanceMatrix.count);
    assert.equal(mesh.instanceColor.usage,THREE.DynamicDrawUsage);assert.equal(mesh.instanceMatrix.usage,THREE.DynamicDrawUsage);
    assert.ok(Array.from(mesh.instanceColor.array).every(v=>v===1));
  }
  assert.deepEqual(d.rayHit([-10,-3.75,1],[1,0,0],20),{id:'skyline:0:0',kind:'building',t:5,normal:[-1,0,0]});
  d.damage(hit('skyline:0:0',30));assert.equal(d.snapshot().buildings[0].cells[0][1],90);
  assert.equal(d.blocksPlayer(-4,-3.75,0,1.8),true);
  d.damage(hit('skyline:0:0',90));d.update(0);
  assert.equal(d.blocksPlayer(-4,-3.75,0,1.8),false);
  assert.equal(d.rayHit([-10,-3.75,1],[1,0,0],20)?.id,'skyline:0:1');
  assert.equal(d.rayHit([-10,-3.75,1],[1,0,0],20)?.t,7.5);
  assert.equal(d.rayHit([-10,-3.75,1],[1,0,0],7.49),null);
  assert.ok(d.diagnostics.visibleCells>0);assert.ok(d.diagnostics.visibleCells<d.diagnostics.cells);
  assert.equal(d.surfacePresent(-4,-3.75,1),false);assert.equal(d.surfacePresent(-1,-3.75,1),true);
  d.dispose();
});

test('complete traversable ground tunnel is shared by walking, rays and rotated cars',()=> {
  const d=one();
  for(let y=1;y<=2;y++)for(let x=0;x<4;x++)d.damage(hit(`skyline:0:${x+4*y}`));
  d.update(0);assert.equal(d.diagnostics.collapsedBuildings,0);
  assert.equal(d.rayHit([-10,0,1],[1,0,0],20),null);
  for(let x=-6;x<=6;x+=.2) {assert.equal(d.blocksPlayer(x,0,0,1.8),false);assert.equal(d.blocksCar(x,0,0,[4.6,2,1.35]),false);}
  assert.equal(d.blocksCar(0,0,Math.PI/4,[4.6,2,1.35]),false);
  assert.equal(d.blocksPlayer(0,2.4,0,1.8),true);assert.equal(d.blocksCar(0,1.7,Math.PI/4,[4.6,2,1.35]),true);
  assert.equal(d.blocksPlayer(0,0,3.1,1.8),true);
  d.dispose();
});

test('cut load-bearing floor collapses the entire tower and bounded debris settles on active time only',()=> {
  const d=one();
  let collapsed=false;
  for(let i=0;i<16;i++)collapsed=d.damage(hit(`skyline:0:${i}`)).some(e=>e.destroyed)||collapsed;
  assert.equal(collapsed,true);assert.equal(d.diagnostics.collapsedBuildings,1);
  assert.equal(d.rayHit([-10,0,8],[1,0,0],20),null);assert.equal(d.blocksPlayer(0,0,0,1.8),false);assert.equal(d.blocksCar(0,0,0,[4.6,2,1.4]),false);
  assert.equal(d.damage(hit('skyline:0:20')).length,0);
  d.update(.1);const before=d.diagnostics.debris;d.update(0);d.update(NaN);assert.equal(d.diagnostics.debris,before);
  for(let i=0;i<40;i++)d.update(.1);
  assert.equal(d.diagnostics.debris,0);
  d.reset();assert.equal(d.diagnostics.damagedBuildings,0);assert.equal(d.blocksPlayer(0,0,0,1.8),true);
  d.dispose();
});

test('high roof hits use actual z cells and empty upper holes do not disable supported lower facade',()=> {
  const d=one();const t=d.rayHit([-3.75,-3.75,20],[0,0,-1],30)!;
  assert.equal(t.id,'skyline:0:32');assert.ok(Math.abs(t.t-10.4)<1e-5);
  d.damage(hit(t.id));assert.equal(d.rayHit([-3.75,-3.75,20],[0,0,-1],30)?.id,'skyline:0:16');
  assert.equal(d.blocksPlayer(-3.75,-3.75,6.5,1.8),false);assert.equal(d.blocksPlayer(-3.75,-3.75,3.2,1.8),true);
  assert.equal(d.diagnostics.collapsedBuildings,0);d.dispose();
});

test('strict snapshot restores occupancy without effects; corrupt versions, IDs, HP and layout are atomic rejects',()=> {
  const d=one();d.damage(hit('skyline:0:0'));d.damage(hit('skyline:0:1',23));
  const save=d.snapshot(),other=one();assert.equal(other.restore(save),true);assert.deepEqual(other.snapshot(),save);assert.equal(other.diagnostics.debris,0);
  for(const invalid of [null,{...save,version:2},{...save,layout:'another-layout'},{...save,extra:1},{...save,buildings:[...save.buildings,...save.buildings]},
    {...save,buildings:[{id:0,collapsed:false,cells:[[0,-1]]}]},{...save,buildings:[{id:0,collapsed:false,cells:[[999,0]]}]},
    {...save,buildings:[{id:0,collapsed:false,cells:[[1,0],[0,0]]}]},{...save,buildings:[{id:0,collapsed:true,cells:[[0,0]]}]},
    {...save,buildings:[{id:0,collapsed:false,cells:Array.from({length:16},(_,i)=>[i,0])}]}]) {
    assert.equal(other.restore(invalid),false);assert.deepEqual(other.snapshot(),save);
  }
  const identities=other.object.children.map(m=>(m as THREE.InstancedMesh).geometry);
  other.reset();assert.equal(other.diagnostics.visibleCells,0);assert.deepEqual(other.object.children.map(m=>(m as THREE.InstancedMesh).geometry),identities);
  other.dispose();other.dispose();d.dispose();
});

test('actual 78 authored buildings, including far tallest towers, all accept damage with one bounded resource set',()=> {
  const city=buildCity(7,true),d=new DestructibleSkyline(skyline(city));
  assert.equal(d.diagnostics.buildings,78);assert.ok(d.diagnostics.cells<100_000);
  assert.equal(city.count,122262);
  d.bounds.forEach((b,id)=> {
    const target=d.rayHit([(b.minX+b.maxX)/2,(b.minY+b.maxY)/2,b.maxZ+1],[0,0,-1],2);
    assert.ok(target);assert.equal(Number(target!.id.split(':')[1]),id);
    const events=d.damage(hit(target!.id,30));assert.equal(events.length,1);assert.equal(events[0].destroyed,false);
  });
  assert.equal(d.diagnostics.damagedBuildings,78);
  d.update(0);assert.ok(d.diagnostics.visibleCells>1000);
  const snapshot=d.snapshot();d.reset();assert.equal(d.restore(snapshot),true);assert.equal(d.diagnostics.damagedBuildings,78);assert.equal(d.diagnostics.debris,0);
  const events=d.damage({at:[0,0,0],radius:400,amount:1000,impulse:20,kind:'explosion'});
  assert.equal(events.length,78);assert.equal(d.diagnostics.collapsedBuildings,78);assert.ok(d.diagnostics.debris<=96);
  d.update(.1);assert.equal(d.diagnostics.visibleCells,0);assert.equal(d.blocksCar(140,140,0,[4.6,2,1.4]),false);
  const all=d.snapshot();d.reset();assert.equal(d.restore(all),true);assert.equal(d.diagnostics.collapsedBuildings,78);assert.equal(d.diagnostics.debris,0);
  d.reset();assert.equal(d.diagnostics.collapsedBuildings,0);assert.equal(d.diagnostics.drawCalls,1);assert.equal(city.count,122262);d.dispose();
});

test('destroyed facade/roof dressing disappears while independent park/cafe geometry stays visible and reset restores attachments',()=> {
  const d=new DestructibleSkyline(skyline(buildCity(7,true))),ambience=new CityAmbience(d.bounds);
  const before=countVisible(ambience);ambience.updateDestruction(d);assert.equal(countVisible(ambience),before);
  d.damage({at:[0,0,0],radius:400,amount:1000,impulse:1,kind:'explosion'});ambience.updateDestruction(d);
  const after=countVisible(ambience);assert.ok(after>0);assert.ok(after<before);
  d.reset();ambience.updateDestruction(d);assert.equal(countVisible(ambience),before);ambience.dispose();d.dispose();
});

test('randomized rays through partial cell damage agree with independent solid-box slab oracle',async()=> {
  const { firstStaticHit }=await import('../src/city-colliders.ts');
  const d=one();
  for(const c of [0,2,5,9,18,27,34,39])d.damage(hit(`skyline:0:${c}`));
  const hp=new Uint8Array(48).fill(120);for(const [c,v] of d.snapshot().buildings[0].cells)hp[c]=v;
  const top=d.bounds[0].maxZ,dz=top/3;
  const boxes=Array.from(hp,(_v,c)=> {const x=c%4,y=Math.floor(c/4)%4,z=Math.floor(c/16);return {minX:-5+x*2.5,maxX:-5+(x+1)*2.5,minY:-5+y*2.5,maxY:-5+(y+1)*2.5,minZ:z*dz,maxZ:(z+1)*dz};}).filter((_b,c)=>hp[c]);
  let seed=12;const rand=()=> {seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let n=0;n<2000;n++) {
    const o:[number,number,number]=[rand()*30-15,rand()*30-15,rand()*18-3];
    const dir:[number,number,number]=[rand()*2-1,rand()*2-1,rand()*2-1];
    if(n%5===0)dir[n%3]=0;
    const length=Math.hypot(...dir);dir.forEach((v,i)=>dir[i]=v/length);
    const oracle=firstStaticHit(boxes,o,dir,40),result=d.rayHit(o,dir,40);
    if(oracle===null)assert.equal(result,null,`ray ${n}`);else {assert.ok(result,`ray ${n}`);assert.ok(Math.abs(result.t-oracle)<1e-6,`ray ${n}: ${result.t} vs ${oracle}`);}
  }
  d.dispose();
});
