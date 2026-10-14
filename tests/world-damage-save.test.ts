import test from 'node:test';import assert from 'node:assert/strict';
import { deserializeExpandedDamage,expandedDamageKey,loadExpandedDamage,saveExpandedDamage } from '../src/world-damage-save.ts';
const data={version:1 as const,skyline:{layout:'a',pieces:[]},life:{actors:[]},police:{units:[]}};
test('expanded damage is isolated per player and cannot mutate voxel or wallet keys',()=>{
 const map=new Map<string,string>([['city.progress.v1.a','wallet'],['city.damage.v1.a','voxels']]);
 const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)}};
 assert.equal(loadExpandedDamage(storage,'a').status,'fresh');assert.equal(saveExpandedDamage(storage,'a',data).ok,true);
 assert.deepEqual(loadExpandedDamage(storage,'a').data,data);assert.equal(loadExpandedDamage(storage,'b').status,'fresh');
 assert.equal(map.get('city.progress.v1.a'),'wallet');assert.equal(map.get('city.damage.v1.a'),'voxels');assert.ok(map.has(expandedDamageKey('a')));
});
test('malformed, unsupported or oversized snapshot rejected; storage failure reported without throwing',()=>{
 for(const raw of ['','null','[]','{}',JSON.stringify({...data,version:2}),JSON.stringify({...data,life:null}),JSON.stringify({...data,coins:1000}),' '.repeat(2_000_001)])assert.equal(deserializeExpandedDamage(raw),null);
 const storage={getItem:()=>{throw new Error('blocked')},setItem:()=>{throw new Error('blocked')}};
 assert.equal(loadExpandedDamage(storage,'a').status,'unavailable');assert.equal(saveExpandedDamage(storage,'a',data).ok,false);
});
