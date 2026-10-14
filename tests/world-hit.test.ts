import test from 'node:test';import assert from 'node:assert/strict';import {rayOwnedCar} from '../src/world-hit.ts';
test('owned-car ray respects orientation, roof height, nearest reach and real surface normal',()=>{
 const car={x:4,y:2,heading:Math.PI/2,size:[4,2,1.5]};
 assert.equal(rayOwnedCar([4,-5,1],[0,1,0],10,car)?.t,5);
 const h=rayOwnedCar([0,2,1],[1,0,0],10,car)!;assert.equal(h.t,3);assert.ok(Math.abs(h.normal[0]+1)<1e-8);
 assert.equal(rayOwnedCar([0,2,3],[1,0,0],10,car),null);assert.equal(rayOwnedCar([0,2,1],[1,0,0],2,car),null);
 assert.equal(rayOwnedCar([NaN,2,1],[1,0,0],10,car),null);
});
