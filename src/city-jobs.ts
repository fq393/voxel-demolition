import * as THREE from 'three/webgpu';
import { loadCityProgress, saveCityProgress, type CityProgress, type CityPose, type ProgressStorage } from './city-progress.ts';
import type { CleanupZone, ContractFrame } from './city-contracts.ts';
import { VEHICLES, type VehicleId } from './vehicle-spec.ts';
import { State, type City } from './world.ts';
import { indoorInstruction, indoorMission, indoorTarget } from './indoor-mission-state.ts';
import type { DistrictId } from './district-layout.ts';

const ZONES = [
  {id:'west-corner',name:'西南街角',position:[-12,-13.6] as const},
  {id:'west-bench',name:'西侧人行道',position:[-13.6,7.2] as const},
  {id:'bus-stop',name:'南边公交站',position:[11,-15.6] as const},
];
const CSS = `
.city-jobs{position:fixed;left:calc(env(safe-area-inset-left) + 14px);top:calc(env(safe-area-inset-top) + 64px);z-index:4;width:236px;padding:10px 12px;box-sizing:border-box;border-left:3px solid #9cccba;border-radius:0 8px 8px 0;background:#162321e8;color:#f4e7ce;font:11px/1.4 system-ui,sans-serif;pointer-events:none}
.city-jobs[hidden]{display:none}.city-jobs .cj-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}.cj-coins{color:#edc785;font-variant-numeric:tabular-nums;white-space:nowrap}.city-jobs .cj-note{margin:5px 0 8px;color:#c8d8ca;min-height:15px}.city-jobs .cj-progress{color:#f1cb83;font-size:10px;min-height:14px}
.city-jobs button,.cj-menu button{min-height:44px;border:1px solid #779b8550;border-radius:6px;background:#30483b;color:#f4e7ce;font:600 11px system-ui;cursor:pointer;touch-action:manipulation}.city-jobs button{pointer-events:auto;width:100%;margin-top:5px}.city-jobs button:hover,.cj-menu button:hover{border-color:#edc785}.city-jobs button:focus-visible,.cj-menu button:focus-visible{outline:2px solid #edc785;outline-offset:2px}.cj-menu button:disabled{opacity:.5;cursor:default}
.menu:has(.cj-menu){padding-top:64px;padding-bottom:16px}
.cj-menu{margin:12px 0;border-top:1px solid #ffffff20;padding-top:10px}.cj-menu .cj-tabs{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px}.cj-menu .cj-tabs button{padding:0 12px}.cj-menu button[aria-pressed=true]{border-color:#edc785;background:#514125}.cj-menu .cj-options{display:grid;gap:6px}.cj-menu .cj-offer{display:grid;grid-template-columns:1fr auto;gap:3px 12px;text-align:left;padding:9px 11px}.cj-offer small{grid-column:1/-1;color:#c8d8ca;font-weight:400;font-size:10px}.cj-menu .cj-wallet{margin-left:auto;font-size:12px;color:#edc785;white-space:nowrap}.cj-menu .cj-actions{display:flex;gap:6px;margin-top:6px}.cj-actions button{flex:1}.cj-menu .cj-save{display:block;margin-top:8px;font-size:10px;line-height:1.5;color:#a9bcb0}.cj-menu .cj-save[data-error=true]{color:#ffb99b}.cj-menu .cj-garage[hidden],.cj-menu .cj-options[hidden]{display:none}
.cj-vehicle{display:grid;grid-template-columns:70px 1fr auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid #ffffff15}.cj-vehicle svg{width:70px;height:40px}.cj-vehicle strong{font-size:12px}.cj-vehicle small{display:block;color:#bdcfc2;font-size:10px;margin-top:3px;line-height:1.4}.cj-vehicle button{padding:0 10px;min-width:80px}.cj-menu .cj-caption{font-size:10px;color:#bdcfc2;margin:8px 0 0}.cj-menu .cj-description{font-size:11px;color:#f1cb83;margin:8px 0 0}
body.city-jobs-active:not(.touch) .hud .keys{top:218px}@media(orientation:portrait) and (max-width:680px){.city-jobs{top:calc(env(safe-area-inset-top) + 150px);width:236px;padding:8px 10px}.city-jobs .cj-note{margin:3px 0 4px;font-size:10px}body.city-jobs-active .city-guide{top:calc(env(safe-area-inset-top) + 294px)}.cj-vehicle{grid-template-columns:54px 1fr auto;gap:5px}.cj-vehicle svg{width:54px}.cj-vehicle button{min-width:72px;padding:0 6px}}
@media(orientation:landscape){body.touch .city-jobs{width:230px}body.touch.city-jobs-active .city-guide{left:calc(env(safe-area-inset-left) + 250px);width:178px;grid-template-columns:64px 88px;gap:8px}body.touch.city-jobs-active .city-guide .cg-status,body.touch.city-jobs-active .city-guide .cg-map-note{display:none}body.touch.city-jobs-active .city-guide .cg-legend{gap:4px;font-size:7px}body.touch.city-jobs-active .city-guide .cg-heading{font-size:8px}}
@media(max-height:640px) and (min-width:681px){body.city-jobs-active:not(.touch) .hud .keys{display:none}}
`;
function button(text:string,action:()=>void):HTMLButtonElement {
  const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',()=>{b.blur();action();});return b;
}
function vehicleIcon(id:VehicleId):string {
  const body=id==='sedan'?'M6 27L10 19H24L32 10H49L60 21L66 24V32H6Z':id==='pickup'?'M5 18H30L33 11H46L54 22H66V32H5Z':'M5 10H49L59 20H66V32H5Z';
  const color=id==='sedan'?'#c97864':id==='pickup'?'#d8b47f':'#83b4a6';
  return `<svg viewBox="0 0 72 42" aria-hidden="true"><path d="${body}" fill="${color}" stroke="#f4e7ce" stroke-width="1"/><path d="M35 13H46L53 21H32Z" fill="#507e83"/><path d="M8 29H65" stroke="#35454a"/><circle cx="17" cy="32" r="6" fill="#263435"/><circle cx="56" cy="32" r="6" fill="#263435"/><circle cx="17" cy="32" r="3" fill="#c6cfc3"/><circle cx="56" cy="32" r="3" fill="#c6cfc3"/></svg>`;
}

/** Sandbox contracts and garage share one versioned progression save, separate from rankings. */
export class CityJobs {
  readonly progressState:CityProgress;
  readonly object=new THREE.Group();
  private readonly root=document.createElement('aside');
  private readonly name=document.createElement('strong');
  private readonly wallet=document.createElement('span');
  private readonly note=document.createElement('div');
  private readonly progressLabel=document.createElement('div');
  private readonly choose:HTMLButtonElement;
  private readonly ringMaterial=new THREE.MeshBasicMaterial({color:0x9de0c4,transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false});
  private readonly ring=new THREE.Mesh(new THREE.RingGeometry(2.8,3.05,48),this.ringMaterial);
  private readonly beacon=new THREE.Group();
  private readonly materials:THREE.Material[]=[this.ringMaterial];
  private readonly geometries:THREE.BufferGeometry[]=[this.ring.geometry];
  private readonly storageKeyId:string;
  private readonly storage:ProgressStorage;
  private city:City;
  private readonly watch=new Map<string,number[]>();
  private readonly counted=new Map<string,Set<number>>();
  private scanElapsed=0;private clock=0;private eligible=true;
  private menu:HTMLElement|null=null;private offers:HTMLElement|null=null;private garage:HTMLElement|null=null;
  private menuWallet:HTMLElement|null=null;private saveNote:HTMLElement|null=null;private description:HTMLElement|null=null;
  private tab:'jobs'|'indoors'|'garage'='indoors';private lastPaint='';private saved=true;private lastComplete='';
  private furnitureWatch:number[]=[];private furnitureRemoved=0;private damageSaved=true;private damageMessage='';
  private readonly onChoose:()=>void;
  private readonly onFeedback:(text:string,complete:boolean)=>void;
  private readonly onVehicleChange:(id:VehicleId)=>boolean;
  constructor(city:City,playerId:string,onChoose:()=>void,onFeedback:(text:string,complete:boolean)=>void,onVehicleChange:(id:VehicleId)=>boolean) {
    this.onChoose=onChoose;this.onFeedback=onFeedback;this.onVehicleChange=onVehicleChange;
    this.city=city;this.storageKeyId=playerId;this.buildWatch();
    try { this.storage=localStorage; } catch { this.storage={getItem:()=>{throw new Error('storage unavailable');},setItem:()=>{throw new Error('storage unavailable');}}; }
    const loaded=loadCityProgress(this.storage,playerId,this.zones());this.progressState=loaded.progress;
    this.progressState.rebaseCleanup(this.demolished());this.saved=loaded.status!=='unavailable';
    const style=document.createElement('style');style.textContent=CSS;document.head.append(style);
    this.root.className='city-jobs';this.root.hidden=true;this.root.setAttribute('aria-label','城市委托与金币');
    const heading=document.createElement('div');heading.className='cj-heading';this.wallet.className='cj-coins';heading.append(this.name,this.wallet);
    this.note.className='cj-note';this.progressLabel.className='cj-progress';this.choose=button('委托 / 车库 · G',this.onChoose);
    for(const kind of ['pointerdown','pointerup','mousedown','mouseup'])this.root.addEventListener(kind,e=>e.stopPropagation());
    this.root.append(heading,this.note,this.progressLabel,this.choose);document.body.append(this.root);
    this.object.name='city-task-target';this.object.visible=false;this.ring.position.z=.035;this.object.add(this.ring,this.beacon);
    const box=new THREE.BoxGeometry(.7,.7,.7),trim=new THREE.BoxGeometry(.73,.12,.73);
    const parcel=new THREE.MeshStandardMaterial({color:0xd3a66c,roughness:.85}),ribbon=new THREE.MeshStandardMaterial({color:0xf6e7bc,roughness:.7});
    this.materials.push(parcel,ribbon);this.geometries.push(box,trim);
    const body=new THREE.Mesh(box,parcel);body.castShadow=true;const strip=new THREE.Mesh(trim,ribbon),strip2=new THREE.Mesh(trim,ribbon);strip2.rotation.z=Math.PI/2;this.beacon.add(body,strip,strip2);
    this.persist();this.paint();
  }
  get target3(){return indoorTarget(this.progressState.activeIndoor,this.city.district??[]);}
  get state(){const a=this.progressState.active,i=this.progressState.activeIndoor,t=this.target3;return {active:i?.id??a?.contract.type??null,stage:i?.stage??a?.stage??0,progress:i?.stage??a?.progress??0,complete:!!this.lastComplete&&!a&&!i,target:t?[t[0],t[1]] as const:this.progressState.target};}
  setDamageSaveStatus(ok:boolean,message=''):void {this.damageSaved=ok;this.damageMessage=message;this.paint();}
  get pose():CityPose|null{return this.progressState.pose;}
  mountMenu(menu:HTMLElement):void {
    this.menu=document.createElement('section');this.menu.className='cj-menu';
    const tabs=document.createElement('div');tabs.className='cj-tabs';
    for(const [id,label] of [['jobs','街区委托'],['indoors','进屋任务'],['garage','我的车库']] as const){const b=button(label,()=>{this.tab=id;this.paint(true);});b.dataset.tab=id;tabs.append(b);}
    this.menuWallet=document.createElement('strong');this.menuWallet.className='cj-wallet';tabs.append(this.menuWallet);
    this.offers=document.createElement('div');this.offers.className='cj-options';this.garage=document.createElement('div');this.garage.className='cj-garage';
    for(const spec of VEHICLES){const row=document.createElement('div');row.className='cj-vehicle';row.innerHTML=vehicleIcon(spec.id);const copy=document.createElement('div'),name=document.createElement('strong'),info=document.createElement('small');name.textContent=spec.name;info.textContent=spec.description;copy.append(name,info);const b=button('',()=>this.chooseVehicle(spec.id));b.dataset.vehicle=spec.id;row.append(copy,b);this.garage.append(row);}
    const caption=document.createElement('p');caption.className='cj-caption';caption.textContent='选车后交到街边停车位 · 已购车辆可免费切换';this.garage.append(caption);
    this.description=document.createElement('p');this.description.className='cj-description';this.saveNote=document.createElement('small');this.saveNote.className='cj-save';
    this.menu.append(tabs,this.offers,this.garage,this.description,this.saveNote);menu.querySelector('.buttons')?.before(this.menu);this.paint(true);
  }
  start(id:string):boolean {
    if(!this.eligible)return false;this.scan();this.progressState.setCleanupZones(this.zones());
    if(['store','home','warehouse'].includes(id)){
      if(!this.progressState.acceptIndoor(id)){this.onFeedback('先完成或取消当前委托；已完成的室内任务不能重复领取',false);return false;}
      const info=indoorMission(id as DistrictId);this.lastComplete='';this.persist();this.onFeedback(`${info.name} · 跟着目标进屋，完成后到门口领取 ${info.reward} 金币`,false);this.paint(true);return true;
    }
    const offer=this.progressState.offers.find(j=>j.id===id)??this.progressState.offers.find(j=>j.type===id);
    if(!offer||!this.progressState.acceptContract(offer.id,this.demolished(offer.cleanupZoneId))){this.onFeedback('先完成或取消当前委托；清空的街角可按 R 重建',false);return false;}
    this.lastComplete='';this.persist();this.onFeedback(`${offer.name} · 完成可得 ${offer.reward} 金币`,false);this.paint(true);return true;
  }
  cancel():void {this.progressState.cancelContract();this.progressState.cancelIndoor();this.lastComplete='';this.persist();this.paint(true);}
  private chooseVehicle(id:VehicleId):void {
    if(!this.eligible)return;
    const result=this.progressState.purchase(id);
    if(result==='insufficient'){this.onFeedback('金币还不够，完成几单委托再来',false);return;}
    if(result==='invalid')return;
    if(this.progressState.selected!==id){if(this.onVehicleChange(id)){this.progressState.selectVehicle(id);this.onFeedback('车辆已停在街边 · 继续游戏后按 F 上车',false);}}
    else if(result==='owned')this.onFeedback('这辆车已经在使用中',false);
    this.persist();this.paint(true);
  }
  reset(city:City):void {this.city=city;this.buildWatch();this.progressState.setCleanupZones(this.zones());this.progressState.rebaseCleanup(this.demolished());this.persist();this.paint(true);}
  setEligible(value:boolean):void {if(value&&!this.eligible){this.scan();this.progressState.setCleanupZones(this.zones());this.progressState.rebaseCleanup(this.demolished());this.persist();}this.eligible=value;this.paint(true);}
  savePose(pose:CityPose):void {if(!this.eligible)return;this.progressState.capturePose(pose);this.persist();}
  update(dt:number,active:boolean,frame:Omit<ContractFrame,'demolished'>):void {
    this.root.hidden=!active||!this.eligible;document.body.classList.toggle('city-jobs-active',!this.root.hidden);this.object.visible=active&&this.eligible&&!!this.state.target;
    if(!active||!this.eligible)return;
    this.clock+=dt;this.scanElapsed+=dt;if(this.scanElapsed>=.25){this.scan();this.progressState.setCleanupZones(this.zones());this.scanElapsed=0;}
    const previous=this.progressState.active,previousStage=previous?.stage,previousProgress=previous?.progress,indoorStage=this.progressState.activeIndoor?.stage;
    const result=this.progressState.advanceContract({...frame,demolished:this.demolished()});
    if(result){this.lastComplete=`${result.contract.name}完成 · +${result.reward} 金币`;this.progressState.setCleanupZones(this.zones());this.persist();this.onFeedback(this.lastComplete,true);}
    else if(previousStage!==this.progressState.active?.stage||previousProgress!==this.progressState.active?.progress)this.persist();
    const indoor=this.progressState.advanceIndoor({...frame,flying:frame.flying??false,removedFurniture:this.furnitureRemoved},this.city.district??[]);
    if(indoor){this.lastComplete=`${indoorMission(indoor.id).name}完成 · +${indoor.reward} 金币`;this.persist();this.onFeedback(this.lastComplete,true);}
    else if(indoorStage!==this.progressState.activeIndoor?.stage){this.persist();this.onFeedback('目标完成，回到门口领取金币',false);}
    const target=this.state.target;if(target){this.object.position.set(target[0],target[1],this.target3?.[2]??0);this.beacon.position.z=2.25+Math.sin(this.clock*2.8)*.15;this.beacon.rotation.z=this.clock*.5;this.ring.rotation.z=this.clock*.1;this.ring.scale.setScalar(this.progressState.activeIndoor?.stage===0?.36:this.state.active==='cleanup'?1.32:1);}
    this.object.visible=active&&!!target;this.paint();
  }
  get diagnostics(){const a=this.progressState.active;return {...this.state,coins:this.progressState.coins,owned:this.progressState.owned,selected:this.progressState.selected,completed:this.progressState.completed,badges:this.progressState.badges,offers:this.progressState.offers,contract:a,indoor:this.progressState.indoor,furnitureRemoved:this.furnitureRemoved,damageSaveOK:this.damageSaved,regionVoxels:this.watch.get(a?.contract.cleanupZoneId??ZONES[0].id)?.length??0,demolished:this.demolished(),saveOK:this.saved};}
  dispose():void {this.root.remove();this.menu?.remove();for(const g of this.geometries)g.dispose();for(const m of this.materials)m.dispose();}
  private buildWatch():void {this.watch.clear();this.counted.clear();for(const zone of ZONES){const ids:number[]=[];for(let i=0;i<this.city.count;i++)if(Math.hypot(this.city.position[3*i]-zone.position[0],this.city.position[3*i+1]-zone.position[1])<=4&&this.city.position[3*i+2]<5)ids.push(i);this.watch.set(zone.id,ids);this.counted.set(zone.id,new Set());}const objects=new Set(this.city.district?.find(b=>b.id==='warehouse')?.furniture.map(f=>f.object)??[]);this.furnitureWatch=[];for(let v=0;v<this.city.count;v++)if(objects.has(this.city.building[v]))this.furnitureWatch.push(v);this.scanElapsed=0;this.scan();}
  private zones():CleanupZone[]{return ZONES.map(zone=>({...zone,remaining:(this.watch.get(zone.id)?.length??0)-(this.counted.get(zone.id)?.size??0)}));}
  private demolished(id:string|null=this.progressState?.active?.contract.cleanupZoneId??ZONES[0].id):number{return id?this.counted.get(id)?.size??0:0;}
  private scan():void {this.furnitureRemoved=0;for(const v of this.furnitureWatch)if(this.city.state[v]!==State.Fixed)this.furnitureRemoved++;for(const [id,watch] of this.watch){const set=this.counted.get(id)!;for(const v of watch)if(this.city.state[v]!==State.Fixed)set.add(v);}}
  private persist():void {this.saved=saveCityProgress(this.storage,this.storageKeyId,this.progressState).ok;this.paint();}
  private paint(force=false):void {
    const p=this.progressState,a=p.active,i=p.activeIndoor,info=i?indoorMission(i.id):null;
    const instruction=i?indoorInstruction(i,this.city.district??[]):p.instruction;
    const key=JSON.stringify([a,p.indoor,p.coins,p.selected,p.owned,p.completed,p.offers,this.eligible,this.tab,this.saved,this.damageSaved,this.damageMessage,this.lastComplete,this.furnitureRemoved]);
    if(!force&&key===this.lastPaint)return;this.lastPaint=key;
    this.name.textContent=info?.name??a?.contract.name??'城市探索';this.wallet.textContent=`◉ ${p.coins}`;
    this.note.textContent=(i||a)?instruction:this.lastComplete||'进屋逛逛，接个任务攒金币';
    this.progressLabel.textContent=i?`${i.stage===0?(i.id==='warehouse'?`拆旧家具 ${Math.min(40,this.furnitureRemoved)} / 40`:'寻找室内目标'):'回到门口交付'} · 奖励 ${info!.reward} 金币`:a?`${a.progress} / ${p.goal} · 奖励 ${a.contract.reward} 金币`:`街区 ${p.completed} 单 · 室内 ${p.completedIndoor.length} / 3`;
    this.choose.textContent='任务 / 车库 · G';
    if(this.menuWallet)this.menuWallet.textContent=`◉ ${p.coins} 金币`;
    this.menu?.querySelectorAll<HTMLButtonElement>('button[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===this.tab)));
    if(this.offers){
      this.offers.hidden=this.tab==='garage';this.offers.replaceChildren();
      if(this.tab==='indoors'){
        for(const id of ['store','home','warehouse'] as const){
          const task=indoorMission(id),done=p.completedIndoor.includes(id),b=button('',()=>this.start(id));
          b.className='cj-offer';b.dataset.indoor=id;
          const title=document.createElement('strong'),reward=document.createElement('span'),description=document.createElement('small');
          title.textContent=task.name;reward.textContent=done?'已完成':`+${task.reward} ◉`;description.textContent=task.description;
          b.append(title,reward,description);b.disabled=!this.eligible||!!a||!!i||done;b.setAttribute('aria-pressed',String(i?.id===id));this.offers.append(b);
        }
        const caption=document.createElement('small');caption.className='cj-caption';caption.textContent='便利店在东侧，住宅在北侧，仓库在东北 · 进屋需下车步行 · 目标在楼上时沿楼梯上去';this.offers.append(caption);
      }else if(this.tab==='jobs'){
        for(const offer of p.offers){
          const b=button('',()=>this.start(offer.id));b.className='cj-offer';b.dataset.contract=offer.id;b.dataset.job=offer.type;
          const title=document.createElement('strong'),reward=document.createElement('span'),description=document.createElement('small');title.textContent=offer.name;reward.textContent=`+${offer.reward} ◉`;description.textContent=offer.description;b.append(title,reward,description);b.disabled=!this.eligible||!!a||!!i;b.setAttribute('aria-pressed',String(a?.contract.id===offer.id));this.offers.append(b);
        }
      }
      const actions=document.createElement('div');actions.className='cj-actions';const cancel=button('取消当前委托',()=>this.cancel());cancel.disabled=(!a&&!i)||!this.eligible;actions.append(cancel);
      if(this.tab==='jobs'){const rotate=button('看看其他委托',()=>{this.scan();p.setCleanupZones(this.zones());if(p.rotateOffers()){this.persist();this.paint(true);}});rotate.disabled=!!a||!!i||!this.eligible;actions.append(rotate);}
      this.offers.append(actions);
    }
    if(this.garage){this.garage.hidden=this.tab!=='garage';for(const spec of VEHICLES){const b=this.garage.querySelector<HTMLButtonElement>(`button[data-vehicle=${spec.id}]`)!;const owned=p.owned.includes(spec.id);b.textContent=p.selected===spec.id?'使用中':owned?'开这辆车':p.coins<spec.price?`差 ${spec.price-p.coins} ◉`:`购买 ${spec.price} ◉`;b.disabled=!this.eligible||p.selected===spec.id||(!owned&&p.coins<spec.price);b.setAttribute('aria-pressed',String(p.selected===spec.id));}}
    if(this.description)this.description.textContent=!this.eligible?'90 秒挑战中暂停城市任务和车库':(a||i)?`${instruction} · 奖励 ${info?.reward??a!.contract.reward} 金币`:this.lastComplete||'室内任务各奖励一次；街区随机委托可以继续接。';
    if(this.saveNote){this.saveNote.textContent=!this.saved||!this.damageSaved?'存档未成功 · 当前进度仅保留在本次游戏中':this.damageMessage||'自动存档 · 金币、任务、位置和建筑损坏保存在本浏览器 · 刷新清理散落碎屑，R 修复街区';this.saveNote.dataset.error=String(!this.saved||!this.damageSaved);}
  }
}
