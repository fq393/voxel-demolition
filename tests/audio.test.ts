import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Sounds} from '../src/audio.ts';

test('empty hammer hits and stopped impacts never ramp a Web Audio envelope to zero',()=>{
  const ramps:number[]=[];
  const param=()=>({value:0,setValueAtTime(){},exponentialRampToValueAtTime(value:number){assert.ok(value>0,'Web Audio rejects zero exponential targets');ramps.push(value);}});
  const node=()=>({gain:param(),frequency:param(),Q:param(),playbackRate:param(),connect(target:unknown){return target;},start(){},stop(){}});
  const sounds=new Sounds();
  Object.assign(sounds,{ctx:{currentTime:0,createBufferSource:node,createBiquadFilter:node,createGain:node,createOscillator:node},master:node()});
  assert.doesNotThrow(()=>sounds.sledge(10,0));
  assert.doesNotThrow(()=>sounds.wreck(10,0));
  assert.doesNotThrow(()=>sounds.land(0));
  assert.ok(ramps.length>0,'audible impact layers still schedule normally');
});
