import type { DamageTarget, DamageTargetKind, WorldDamageEvent, WorldDamageRequest } from './world-damage-types.ts';
export interface ActorPose { x:number; y:number; heading:number }
export interface DamageBody {
 id:string; kind:DamageTargetKind; pose:ActorPose; halfLength:number; halfWidth:number;
 minZ:number; maxZ:number; maxHp:number; hp:number; age:number; flash:number; tint:number; enabled:()=>boolean;
}
export function damageBody(id:string,kind:DamageTargetKind,pose:ActorPose,halfLength:number,halfWidth:number,minZ:number,maxZ:number,maxHp:number,tint:number,enabled:()=>boolean=()=>true):DamageBody {
 return {id,kind,pose,halfLength,halfWidth,minZ,maxZ,maxHp,hp:maxHp,age:0,flash:0,tint,enabled};
}
export function validDamage(r:WorldDamageRequest):boolean {
 return Array.isArray(r.at) && r.at.length===3 && r.at.every(Number.isFinite) && [r.radius,r.amount,r.impulse].every(Number.isFinite)
 && r.radius>=0 && r.radius<=1000 && r.amount>0 && r.amount<=100000 && r.impulse>=0 && ['bullet','hammer','laser','explosion','impact'].includes(r.kind)
 && (r.directId===undefined || typeof r.directId==='string');
}
export function bodyDistance(b:DamageBody,at:ArrayLike<number>):number {
 const c=Math.cos(b.pose.heading),s=Math.sin(b.pose.heading),dx=at[0]-b.pose.x,dy=at[1]-b.pose.y;
 return Math.hypot(Math.max(0,Math.abs(dx*c+dy*s)-b.halfLength),Math.max(0,Math.abs(-dx*s+dy*c)-b.halfWidth),Math.max(b.minZ-at[2],0,at[2]-b.maxZ));
}
export function damageBodies(bodies:readonly DamageBody[],request:WorldDamageRequest):WorldDamageEvent[] {
 if(!validDamage(request))return[];
 const out:WorldDamageEvent[]=[];
 for(const b of bodies){
  if(b.hp<=0 || !b.enabled() || (request.directId!==undefined && request.directId!==b.id))continue;
  const distance=bodyDistance(b,request.at);
  if(request.directId===undefined && distance>request.radius)continue;
  const amount=request.directId!==undefined ? request.amount : request.amount*(request.radius>0 ? Math.max(.2,1-distance/request.radius) : 1);
  b.hp=Math.max(0,b.hp-amount);b.flash=.16;b.age=0;
  out.push({id:b.id,kind:b.kind,at:[b.pose.x,b.pose.y,(b.minZ+b.maxZ)/2],tint:b.tint,destroyed:b.hp===0,parts:b.kind==='person'?6:b.kind==='garage'?8:10});
 }
 return out;
}
export function tickDamage(bodies:readonly DamageBody[],dt:number):void {
 if(!Number.isFinite(dt)||dt<=0)return;
 for(const b of bodies){b.flash=Math.max(0,b.flash-Math.min(dt,.25));if(b.hp===0)b.age=Math.min(10,b.age+Math.min(dt,.25));}
}
/** Ray/OBB intersection with the actual entered face normal, including rotated cars. */
export function rayDamageBody(b:DamageBody,origin:ArrayLike<number>,direction:ArrayLike<number>,reach:number):DamageTarget|null {
 if(b.hp<=0||!b.enabled()||!Number.isFinite(reach)||reach<0||![origin[0],origin[1],origin[2],direction[0],direction[1],direction[2]].every(Number.isFinite))return null;
 if(Math.hypot(direction[0],direction[1],direction[2])<1e-8)return null;
 const c=Math.cos(b.pose.heading),s=Math.sin(b.pose.heading),dx=origin[0]-b.pose.x,dy=origin[1]-b.pose.y;
 const o=[dx*c+dy*s,-dx*s+dy*c,origin[2]],v=[direction[0]*c+direction[1]*s,-direction[0]*s+direction[1]*c,direction[2]];
 const low=[-b.halfLength,-b.halfWidth,b.minZ],high=[b.halfLength,b.halfWidth,b.maxZ];
 let near=0,far=reach,axis=-1,sign=0;
 for(let i=0;i<3;i++){
  if(Math.abs(v[i])<1e-12){if(o[i]<low[i]||o[i]>high[i])return null;continue;}
  const a=(low[i]-o[i])/v[i],z=(high[i]-o[i])/v[i],entry=Math.min(a,z);
  if(entry>near){near=entry;axis=i;sign=a<z?-1:1;}far=Math.min(far,Math.max(a,z));
  if(near>far)return null;
 }
 let normal:[number,number,number]=axis===0?[sign*c,sign*s,0]:axis===1?[-sign*s,sign*c,0]:axis===2?[0,0,sign]:[-direction[0],-direction[1],-direction[2]];
 if(axis<0){const length=Math.hypot(...normal);normal=normal.map(n=>n/length) as typeof normal;}
 return{id:b.id,kind:b.kind,t:near,normal};
}
export function nearestDamageRay(bodies:readonly DamageBody[],origin:ArrayLike<number>,direction:ArrayLike<number>,reach:number):DamageTarget|null {
 let nearest:DamageTarget|null=null;
 for(const b of bodies){const h=rayDamageBody(b,origin,direction,nearest?.t??reach);if(h)nearest=h;}
 return nearest;
}
export function snapshotBodies(bodies:readonly DamageBody[]):object {
 return {version:1,bodies:bodies.map(b=>({id:b.id,hp:b.hp,destroyed:b.hp===0,x:b.pose.x,y:b.pose.y,heading:b.pose.heading}))};
}
/** Validate every entry before modifying a live actor. Restores never replay flashes/falls. */
export function restoreBodies(bodies:readonly DamageBody[],value:unknown):boolean {
 if(!value||typeof value!=='object')return false;
 const v=value as {version?:unknown;bodies?:unknown};
 if(v.version!==1||!Array.isArray(v.bodies)||v.bodies.length!==bodies.length)return false;
 const validated:{hp:number;x:number;y:number;heading:number}[]=[];
 for(let i=0;i<bodies.length;i++){
  const s=v.bodies[i];if(!s||typeof s!=='object')return false;
  const b=bodies[i],p=s as Record<string,unknown>;
  if(p.id!==b.id||typeof p.hp!=='number'||!Number.isFinite(p.hp)||p.hp<0||p.hp>b.maxHp||p.destroyed!==(p.hp===0))return false;
  if(![p.x,p.y,p.heading].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<10000))return false;
  validated.push({hp:p.hp,x:p.x as number,y:p.y as number,heading:p.heading as number});
 }
 validated.forEach((s,i)=>{const b=bodies[i];b.hp=s.hp;b.flash=0;b.age=s.hp===0?10:0;Object.assign(b.pose,{x:s.x,y:s.y,heading:s.heading});});
 return true;
}
export function bodyFade(b:DamageBody):number{return b.hp>0?1:Math.max(0,1-Math.max(0,b.age-1.2)/1.8);}
