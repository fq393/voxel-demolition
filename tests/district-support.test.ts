import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCity, State, VOXEL, voxelAt } from '../src/world.ts';
import { unsupportedInteriorFurniture } from '../src/district-support.ts';

test('intact floors support separate furniture and a removed upper floor releases the bed',()=>{
  const city=buildCity();assert.deepEqual(unsupportedInteriorFurniture(city),[]);
  const home=city.district!.find(b=>b.id==='home')!,bed=home.furniture.find(f=>f.id==='home-bed')!;
  const bedVoxels=[...city.buildings[bed.object].cells].filter(v=>v>=0);
  const lowest=Math.min(...bedVoxels.map(v=>city.position[3*v+2]));
  for(const v of bedVoxels)if(city.position[3*v+2]===lowest){const below=voxelAt(city,city.position[3*v],city.position[3*v+1],lowest-VOXEL);assert.ok(below>=0);city.state[below]=State.Gone;}
  const falling=unsupportedInteriorFurniture(city);assert.ok(falling.some(vs=>vs.length===bedVoxels.length&&vs.every(v=>city.building[v]===bed.object)));
  assert.ok(city.buildings[home.object].cells.some(v=>v>=0&&city.state[v]===State.Fixed));
});

test('a furniture object already loose is not repeatedly released',()=>{
  const city=buildCity(),bed=city.district!.find(b=>b.id==='home')!.furniture.find(f=>f.id==='home-bed')!;
  for(const v of city.buildings[bed.object].cells)if(v>=0)city.state[v]=State.Loose;
  assert.ok(unsupportedInteriorFurniture(city).every(vs=>vs.every(v=>city.building[v]!==bed.object)));
});
