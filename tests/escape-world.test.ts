import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCity, State } from '../src/world.ts';
import { warehouseBreachOpen } from '../src/escape-world.ts';
import { Player } from '../src/player.ts';
test('escape requires a standing passage through the actual west wall, partial upper damage is insufficient',()=>{
  const city=buildCity();assert.equal(warehouseBreachOpen(city),false);
  for(let v=0;v<city.count;v++){const [x,y,z]=city.position.subarray(v*3,v*3+3);if(x>=40&&x<40.5&&y>=46.5&&y<=48&&z>=1&&z<2.25)city.state[v]=State.Gone;}
  assert.equal(warehouseBreachOpen(city),false);
  for(let v=0;v<city.count;v++){const [x,y,z]=city.position.subarray(v*3,v*3+3);if(x>=40&&x<40.5&&y>=46.5&&y<=48&&z>=.25&&z<2.25)city.state[v]=State.Gone;}
  assert.equal(warehouseBreachOpen(city),true);
  const player=new Player(city);player.flying=false;player.position.set(41.3,47.25,.25);player.yaw=Math.PI;
  for(let i=0;i<40;i++)player.update(1/60,{forward:1,right:0,jump:false,sprint:false,crouch:false,rise:0,slow:false});
  assert.ok(player.position.x<39.5);assert.equal(warehouseBreachOpen(buildCity()),false);
});
