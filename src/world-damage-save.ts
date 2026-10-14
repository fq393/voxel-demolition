import type { ProgressStorage } from './city-progress.ts';
export interface ExpandedDamageSnapshot { version: 1; skyline: unknown; life: unknown; police: unknown }
const record = (v: unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function expandedDamageKey(playerId:string):string { return `city.expanded-damage.v1.${playerId}`; }
export function deserializeExpandedDamage(raw:string):ExpandedDamageSnapshot|null {
  if(raw.length>2_000_000)return null;
  try {
    const v:unknown=JSON.parse(raw);
    if(!record(v)||v.version!==1||Object.keys(v).some(k=>!['version','skyline','life','police'].includes(k))
      ||!record(v.skyline)||!record(v.life)||!record(v.police))return null;
    return {version:1,skyline:v.skyline,life:v.life,police:v.police};
  }catch{return null;}
}
export function loadExpandedDamage(storage:ProgressStorage,playerId:string):{data:ExpandedDamageSnapshot|null;status:'fresh'|'loaded'|'invalid'|'unavailable'} {
  try {const raw=storage.getItem(expandedDamageKey(playerId));if(raw===null)return{data:null,status:'fresh'};const data=deserializeExpandedDamage(raw);return{data,status:data?'loaded':'invalid'};}
  catch{return{data:null,status:'unavailable'};}
}
export function saveExpandedDamage(storage:ProgressStorage,playerId:string,data:ExpandedDamageSnapshot):{ok:boolean;error?:string} {
  try {const raw=JSON.stringify(data);if(!deserializeExpandedDamage(raw))return{ok:false,error:'人物与外围楼体存档未通过检查'};storage.setItem(expandedDamageKey(playerId),raw);return{ok:true};}
  catch{return{ok:false,error:'浏览器未能保存人物与外围楼体损坏；本次游戏中仍保留'};}
}
