import type { StaticBox } from './city-colliders.ts';
import type { DamageTarget, Point3 } from './world-damage-types.ts';
/** A normal-bearing slab ray for the owned car, kept separate from nearest voxel selection. */
export function rayOwnedCar(origin:ArrayLike<number>,direction:ArrayLike<number>,reach:number,car:{x:number;y:number;heading:number;size:readonly number[]}):DamageTarget|null {
 if(origin.length<3||direction.length<3||car.size.length<3||!car.size.every(n=>Number.isFinite(n)&&n>0))return null;
 if(![...Array.from(origin),...Array.from(direction),reach,car.x,car.y,car.heading].every(Number.isFinite)||reach<0)return null;
 const c=Math.cos(car.heading),s=Math.sin(car.heading),dx=origin[0]-car.x,dy=origin[1]-car.y;
 const from:Point3=[dx*c+dy*s,-dx*s+dy*c,origin[2]],dir:Point3=[direction[0]*c+direction[1]*s,-direction[0]*s+direction[1]*c,direction[2]];
 const box:StaticBox={minX:-car.size[0]/2,maxX:car.size[0]/2,minY:-car.size[1]/2,maxY:car.size[1]/2,minZ:.12,maxZ:.12+car.size[2]};
 const lo=[box.minX,box.minY,box.minZ],hi=[box.maxX,box.maxY,box.maxZ];let t=0,far=reach,normal:[number,number,number]=[0,0,0];
 for(let a=0;a<3;a++){
  if(Math.abs(dir[a])<1e-9){if(from[a]<lo[a]||from[a]>hi[a])return null;continue;}
  const entry=(lo[a]-from[a])/dir[a],exit=(hi[a]-from[a])/dir[a],near=Math.min(entry,exit);
  if(near>=t){t=near;normal=[0,0,0];normal[a]=entry<exit?-1:1;}far=Math.min(far,Math.max(entry,exit));if(t>far)return null;
 }
 if(t<0||t>reach)return null;
 const [nx,ny,nz]=normal;return{id:'owned-car',kind:'vehicle',t,normal:[nx*c-ny*s,nx*s+ny*c,nz]};
}
