import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join as pathJoin, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { SCENARIOS, DEFAULT_SCENARIO, listScenarios } from '../scenarios/index.js';

const PORT = Number(process.env.PORT || 10000);
const TICK = 0.05;
const PREP = 120;
const FACTORY_INCOME_INTERVAL = 12;
const FACTORY_INCOME_AMOUNT = 400;
const FACTORY_ARMOR = 100;
const TRANSPORT_CAPACITY = 3;
const rooms = new Map();
let nextRoom = 2800;
let nextUnit = 1;

const UNIT = {
  INF: { name:'突擊兵', short:'突', cost:700, max:180, speed:247, range:1092, acc:.46, dmg:8, rof:.9, vision:1092, armor:0, pen:0, land:true, role:'主力／佔領' },
  TANK:{ name:'裝甲部隊', short:'甲', cost:2500, max:60, speed:423, range:1470, acc:.58, dmg:22, rof:.34, vision:966, armor:150, pen:180, land:true, role:'肉盾／突破' },
  RECON:{ name:'偵察兵', short:'偵', cost:950, max:90, speed:564, range:903, acc:.34, dmg:5, rof:1.2, vision:2268, armor:0, pen:0, land:true, role:'4格視野／情報' },
  SF:{ name:'特戰部隊', short:'特', cost:1550, max:90, speed:658, range:1176, acc:.62, dmg:12, rof:1.05, vision:1680, armor:15, pen:50, land:true, role:'高速／側翼' },
  AT:{ name:'反裝甲部隊', short:'反', cost:1050, max:75, speed:282, range:1596, acc:.66, dmg:34, rof:.42, vision:1218, armor:20, pen:210, land:true, role:'伏擊／反裝甲' },
  FIRE:{ name:'火力支援', short:'火', cost:1800, max:40, speed:223, range:2058, acc:.34, dmg:28, rof:.18, vision:1344, armor:20, pen:120, land:true, role:'遠程／壓制' },
  PATROL:{ name:'巡邏艇', short:'巡', cost:1200, max:24, speed:611, range:1512, acc:.44, dmg:18, rof:.42, vision:2520, armor:60, pen:90, naval:true, role:'近岸巡防' },
  FRIGATE:{ name:'護衛艦', short:'艦', cost:2600, max:40, speed:447, range:2520, acc:.52, dmg:34, rof:.22, vision:3150, armor:110, pen:160, naval:true, role:'海上火力' },
  TRANSPORT:{ name:'運輸艦', short:'運', cost:2200, max:20, speed:353, range:525, acc:.08, dmg:2, rof:.08, vision:1890, armor:40, pen:0, naval:true, role:'跨海運輸（可搭載3隊陸軍）' }
};

// Single mutable "currently active scenario" pointer. Room creation/handling always reloads it via
// loadScenario(room.scenarioId) before touching geometry, so multiple rooms with different scenarios
// can coexist across the process lifetime even though only one scenario's data is "live" at a time —
// safe because Node is single-threaded and every handler/tick reloads before it reads CURRENT.
let CURRENT = null;
function loadScenario(id){ CURRENT = SCENARIOS[id] || SCENARIOS[DEFAULT_SCENARIO]; return CURRENT; }

const terrainSpeed={plain:1,road:1.25,urban:.78,forest:.66,hill:.54,mountain:.30,swamp:.52,water:0};
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function pointInPoly(x,y,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];const intersect=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+1e-9)+xi);if(intersect)inside=!inside;}return inside;}
function landmassById(id){return CURRENT.landmasses.find(l=>l.id===id);}
function terrainLandOf(x,y){for(const lm of CURRENT.landmasses){if(pointInPoly(x,y,lm.poly))return lm.id;}return null;}
function homeLandmassId(side){const lm=CURRENT.landmasses.find(l=>l.kind===(side===0?'home0':'home1'));return lm?lm.id:null;}
function islandOf(x,y){const id=terrainLandOf(x,y);if(!id)return null;const k=landmassById(id).kind;return (k==='home0'||k==='home1'||k==='isolated')?id:null;}
function countryAt(x,y){const id=terrainLandOf(x,y);if(!id)return -1;const k=landmassById(id).kind;return k==='home0'?0:k==='home1'?1:-1;}
function onLand(x,y){return terrainLandOf(x,y)!==null;}
function onMid(x,y){const id=terrainLandOf(x,y);return !!id&&landmassById(id).kind==='isolated';}
function terrainAt(x,y){
  const id=terrainLandOf(x,y);
  if(!id)return 'water';
  const lm=landmassById(id);
  if(lm.kind==='neutral'&&lm.pass){
    if(Math.hypot(x-lm.pass.x,y-lm.pass.y)<1100)return 'mountain';
    return 'hill';
  }
  const tt=CURRENT.terrain;
  if(tt){
    if(tt.mountain){const {dx,dy,dxy,thresh}=tt.mountain;if(Math.sin(x/dx)+Math.cos(y/dy)+Math.sin((x+y)/dxy)>thresh)return 'mountain';}
    if(tt.urban&&tt.urban.some(u=>u.side===lm.side&&Math.hypot(x-u.x,y-u.y)<u.r))return 'urban';
    if(tt.forest){const {dx,dy,dxy,thresh}=tt.forest;if(Math.sin(x/dx)+Math.cos(y/dy)+Math.sin((x-y)/dxy)>thresh)return 'forest';}
    if(tt.hill){const {dx,dy,thresh}=tt.hill;if(Math.sin(x/dx)+Math.cos(y/dy)>thresh)return 'hill';}
    if(tt.road&&tt.road[lm.side]!=null&&Math.abs(y-tt.road[lm.side])<(tt.road.width||420))return 'road';
    if(tt.swamp&&tt.swamp.side===lm.side&&Math.hypot(x-tt.swamp.x,y-tt.swamp.y)<tt.swamp.r)return 'swamp';
  }
  return 'plain';
}
function isLandUnit(q){return !UNIT[q.kind].naval;}
function sideLabel(side){return CURRENT.sides?.[side]?.label ?? (side===0?'藍軍':'紅軍');}
// Finer sampling + a fixed buffer nudge back from the detected boundary, so the returned point isn't
// sitting right on a coin-flip edge of a jagged real coastline (which is what let units briefly stray
// into "water" mid-transit and trip the stepMove recovery net instead of following their real order).
function findShore(sx,sy,tx,ty){
  let last={x:sx,y:sy};
  for(let t=0.01;t<=1;t+=0.01){const x=sx+(tx-sx)*t,y=sy+(ty-sy)*t;if(terrainAt(x,y)==='water')last={x,y};else break;}
  const dx=tx-sx,dy=ty-sy,d=Math.hypot(dx,dy)||1,nx=last.x-dx/d*250,ny=last.y-dy/d*250;
  return terrainAt(nx,ny)==='water'?{x:nx,y:ny}:last;
}
function findLandEdge(sx,sy,tx,ty){
  let last={x:sx,y:sy};
  for(let t=0.01;t<=1;t+=0.01){const x=sx+(tx-sx)*t,y=sy+(ty-sy)*t;if(terrainAt(x,y)!=='water')last={x,y};else break;}
  const dx=tx-sx,dy=ty-sy,d=Math.hypot(dx,dy)||1,nx=last.x-dx/d*250,ny=last.y-dy/d*250;
  return terrainAt(nx,ny)!=='water'?{x:nx,y:ny}:last;
}
function crossesWater(sx,sy,tx,ty){
  const steps=60;
  for(let i=0;i<=steps;i++){const t=i/steps;if(terrainAt(sx+(tx-sx)*t,sy+(ty-sy)*t)==='water')return true;}
  return false;
}
// Strict landmass id (home territories only, not corridors) — used to tell "a real strait crossing"
// apart from "the straight line just clips a small bay on the same landmass", which should never need a ferry.
function strictLandmass(x,y){const id=terrainLandOf(x,y);if(!id)return null;const k=landmassById(id).kind;return (k==='home0'||k==='home1')?id:null;}
function nearestSpot(x,y,wantWater){
  if((terrainAt(x,y)==='water')===wantWater)return {x,y};
  for(let r=300;r<=8000;r+=300){
    for(let a=0;a<360;a+=24){
      const rad=a*Math.PI/180,px=x+Math.cos(rad)*r,py=y+Math.sin(rad)*r;
      if((terrainAt(px,py)==='water')===wantWater)return {x:px,y:py};
    }
  }
  return {x,y};
}
function detourVertices(){
  if(CURRENT._detourCache)return CURRENT._detourCache;
  const v=[];
  for(const lm of CURRENT.landmasses){if(lm.kind==='isolated')continue;for(const p of lm.poly)v.push(p);}
  return CURRENT._detourCache=v;
}
// One-hop "walk around the headland" detour via a visible land vertex, for the common case of a
// straight line clipping a small bay/inlet on the same connected land network. Not a full navmesh,
// but handles the vast majority of real coastline concavity without ever touching the ferry system.
function findLandDetour(sx,sy,tx,ty){
  let best=null,bd=Infinity;
  const candidates=[{x:sx,y:ty},{x:tx,y:sy}];
  for(const p of detourVertices())candidates.push({x:p[0],y:p[1]});
  for(const c of candidates){
    if(terrainAt(c.x,c.y)==='water')continue;
    if(crossesWater(sx,sy,c.x,c.y)||crossesWater(c.x,c.y,tx,ty))continue;
    const d=Math.hypot(c.x-sx,c.y-sy)+Math.hypot(tx-c.x,ty-c.y);
    if(d<bd){bd=d;best=c;}
  }
  return best;
}
// Ferry is only ever offered as the fast-but-risky shortcut for a genuine cross-strait order between
// two different home territories, and only in scenarios that have a navy at all. Any move that stays
// within one landmass — including one that merely clips a small bay — walks instead; see findLandDetour.
function wantsFerry(sx,sy,tx,ty){if(!CURRENT.hasNavy)return false;const a=strictLandmass(sx,sy),b=strictLandmass(tx,ty);return !!(a&&b&&a!==b);}
function nearestCorridorRoute(sx,sy,tx,ty){
  let best=null,bd=Infinity;
  for(const c of CURRENT.corridors){
    const dsA=Math.hypot(sx-c.a.x,sy-c.a.y)+Math.hypot(tx-c.b.x,ty-c.b.y);
    const dsB=Math.hypot(sx-c.b.x,sy-c.b.y)+Math.hypot(tx-c.a.x,ty-c.a.y);
    const [nearS,nearT]=dsA<=dsB?[c.a,c.b]:[c.b,c.a];
    const total=Math.hypot(sx-nearS.x,sy-nearS.y)+Math.hypot(nearS.x-c.pass.x,nearS.y-c.pass.y)+Math.hypot(c.pass.x-nearT.x,c.pass.y-nearT.y)+Math.hypot(nearT.x-tx,nearT.y-ty);
    if(total<bd){bd=total;best={entry:nearS,pass:c.pass,exit:nearT};}
  }
  return best;
}
function buildPath(q,tx,ty){
  const pts=[]; const naval=UNIT[q.kind].naval;
  if(naval){pts.push({x:tx,y:ty,kind:'target'});return pts;}
  const sx=q.x,sy=q.y;
  if(crossesWater(sx,sy,tx,ty)&&!onMid(tx,ty)&&!onMid(sx,sy)){
    const detour=findLandDetour(sx,sy,tx,ty);
    if(detour){
      pts.push({x:detour.x,y:detour.y,kind:'detour'});
    }else{
      const route=nearestCorridorRoute(sx,sy,tx,ty);
      if(route){
        pts.push({x:route.entry.x,y:route.entry.y,kind:'corridor'});
        pts.push({x:route.pass.x,y:route.pass.y,kind:'corridor'});
        pts.push({x:route.exit.x,y:route.exit.y,kind:'corridor'});
      }
    }
  } else if(terrainAt(tx,ty)==='mountain' || terrainAt(sx,sy)==='mountain'){
    const pass=CURRENT.passes.slice().sort((a,b)=>Math.hypot(a.x-sx,a.y-sy)+Math.hypot(a.x-tx,a.y-ty)-Math.hypot(b.x-sx,b.y-sy)-Math.hypot(b.x-tx,b.y-ty))[0];
    if(pass && Math.hypot(pass.x-sx,pass.y-sy)+Math.hypot(pass.x-tx,pass.y-ty)<Math.hypot(tx-sx,ty-sy)*1.55)pts.push({x:pass.x,y:pass.y,kind:'pass'});
  }
  pts.push({x:tx,y:ty,kind:'target'});return pts;
}
function transportFree(t){return TRANSPORT_CAPACITY-t.cargo.length-t._dispatchFor.length;}
function releaseDispatchSlot(t,qid){
  const idx=t._dispatchFor.indexOf(qid);
  if(idx>=0)t._dispatchFor.splice(idx,1);
  if(!t.cargo.length&&!t._dispatchFor.length){t.status='待命';t.intent='MOVE';}
}
function boardTransport(s,t,q,tx,ty){
  const firstAboard=t.cargo.length===0;
  t.cargo.push(q.id);q.carrier=t.id;q.reserve=true;q.status='登艦待命';q.ferryTarget={x:tx,y:ty};q.path=[];q.awaitingFerry=null;
  releaseDispatchSlot(t,q.id);
  if(firstAboard){
    const shore=findShore(t.x,t.y,tx,ty);
    t.target={x:shore.x,y:shore.y};t.path=buildPath(t,shore.x,shore.y);t.pathIndex=0;t.intent='FERRY';
  }
  t.status=`運輸中(${t.cargo.length}/${TRANSPORT_CAPACITY})`;
  return true;
}
function cancelFerryWait(s,q){
  if(!q.awaitingFerry)return;
  const t=s.units.find(u=>u.id===q.awaitingFerry.transportId);
  if(t)releaseDispatchSlot(t,q.id);
  q.awaitingFerry=null;q.reserve=false;
}
function fallbackToWalk(s,q){
  const t=q.awaitingFerry?s.units.find(u=>u.id===q.awaitingFerry.transportId):null;
  if(t)releaseDispatchSlot(t,q.id);
  const ft=q.ferryTarget||q.awaitingFerry;
  q.reserve=false;q.awaitingFerry=null;q.status='改為陸路行軍';q.intent='MOVE';
  q.target=ft;q.path=buildPath(q,ft.x,ft.y);q.pathIndex=0;
}
function tryFerry(s,q,tx,ty){
  const near=s.units.find(u=>u.active&&u.side===q.side&&u.kind==='TRANSPORT'&&!u.carrier&&transportFree(u)>0&&Math.hypot(u.x-q.x,u.y-q.y)<1400);
  if(near)return boardTransport(s,near,q,tx,ty);
  const candidates=s.units.filter(u=>u.active&&u.side===q.side&&u.kind==='TRANSPORT'&&!u.carrier&&u.cargo.length===0&&u._dispatchFor.length===0);
  if(!candidates.length)return false;
  const t=candidates.sort((a,b)=>Math.hypot(a.x-q.x,a.y-q.y)-Math.hypot(b.x-q.x,b.y-q.y))[0];
  t._dispatchFor.push(q.id);t.status='前往接應中';t.intent='FERRY_PICKUP';
  const shore=findShore(t.x,t.y,q.x,q.y);
  t.target={x:shore.x,y:shore.y};t.path=buildPath(t,shore.x,shore.y);t.pathIndex=0;
  const landEdge=findLandEdge(q.x,q.y,shore.x,shore.y);
  q.status='前往岸邊等待接應';q.intent='MOVE';q.ferryTarget={x:tx,y:ty};
  q.target=landEdge;q.path=buildPath(q,landEdge.x,landEdge.y);q.pathIndex=0;
  q.awaitingFerry={x:tx,y:ty,since:s.time,transportId:t.id,landEdge};
  return true;
}
function updateFerryDispatch(s){
  for(const q of s.units){
    if(!q.active||!q.awaitingFerry)continue;
    const t=s.units.find(u=>u.id===q.awaitingFerry.transportId);
    if(!t||!t.active){fallbackToWalk(s,q);continue;}
    if(!q.path.length&&q.status==='前往岸邊等待接應')q.status='岸邊待命中';
    if(t.cargo.length<TRANSPORT_CAPACITY&&Math.hypot(t.x-q.x,t.y-q.y)<1100){boardTransport(s,t,q,q.awaitingFerry.x,q.awaitingFerry.y);continue;}
    if(s.time-q.awaitingFerry.since>50)fallbackToWalk(s,q);
  }
}
function addUnit(s,side,kind,x,y,p){const u=UNIT[kind];s.units.push({id:nextUnit++,side,kind,x,y,heading:side===0?90:270,target:{x,y},path:[],pathIndex:0,personnel:p,maxPersonnel:p,ammo:100,morale:1,suppression:0,effectiveness:1,vision:u.vision,stance:'ATTACK',intent:'MOVE',reserve:false,carrier:null,cargo:[],ferryTarget:null,awaitingFerry:null,_dispatchFor:[],attackFacility:null,active:true,fireCd:0,lastDamage:0,status:'待命',kills:0});}
function initUnits(s){for(const a of CURRENT.initUnits.blue)addUnit(s,0,...a);for(const a of CURRENT.initUnits.red)addUnit(s,1,...a);}
function homePoint(side,kind){const hp=CURRENT.homePoints;if(UNIT[kind]?.naval)return side===0?hp.navalBlue:hp.navalRed;return side===0?hp.landBlue:hp.landRed;}
function freshFacilities(){return CURRENT.facilities.map(f=>({...f,control:f.side,capture:[0,0],hpNow:f.hp,destroyed:false}));}
function newState(code){
  const s={room:code,scenarioId:CURRENT.id,phase:'PREP',phaseTime:PREP,time:0,result:-1,reason:'',budget:[CURRENT.startBudget||30000,CURRENT.startBudget||30000],spent:[0,0],losses:[0,0],units:[],facilities:freshFacilities(),events:[],shots:[],fx:[],weather:'CLEAR',dayPhase:'DAY',front:CURRENT.frontStart??(CURRENT.world.w/2)};
  initUnits(s);
  event(s,`${CURRENT.name} 初始化完成｜${Math.round(CURRENT.limitSeconds/60)} 分鐘戰役目標已啟用`,'system');
  return s;
}
function event(s,text,kind='info'){s.events.unshift({id:Date.now()+Math.random(),t:Math.floor(s.time),text,kind});s.events=s.events.slice(0,20);}
function visible(s,q,side){
  if(q.side===side)return true;
  if(s.units.filter(u=>u.active&&u.side===side).some(w=>Math.hypot(w.x-q.x,w.y-q.y)<=w.vision*(s.dayPhase==='NIGHT'?.72:1)))return true;
  return s.facilities.some(f=>f.control===side&&!f.destroyed&&f.visionBoost&&Math.hypot(f.x-q.x,f.y-q.y)<=f.visionBoost);
}
function filtered(r,side){const s=structuredClone(r.state);const known=new Set(s.units.filter(q=>visible(r.state,q,side)).map(q=>q.id));s.units=s.units.filter(q=>known.has(q.id));return s;}
function snap(r){for(const p of r.players)send(p.ws,{t:'snapshot',state:filtered(r,p.side)});}
function scenarioMeta(){
  return {
    id:CURRENT.id,name:CURRENT.name,mode:CURRENT.mode,hasNavy:CURRENT.hasNavy,
    world:CURRENT.world,
    landmasses:CURRENT.landmasses.map(l=>({id:l.id,kind:l.kind,side:l.side??null,poly:l.poly,pass:l.pass||null})),
    corridors:CURRENT.corridors,passes:CURRENT.passes,
    facilities:CURRENT.facilities.map(f=>({id:f.id,name:f.name,type:f.type,x:f.x,y:f.y,side:f.side})),
    homePoints:CURRENT.homePoints,
    sides:CURRENT.sides,labels:CURRENT.labels||[],
    limitSeconds:CURRENT.limitSeconds,frontAxis:CURRENT.frontAxis||'x',frontBounds:CURRENT.frontBounds||[0,CURRENT.world.w],
  };
}
function makeRoom(ws,name,scenarioId){
  loadScenario(scenarioId);
  const code=String(nextRoom++).padStart(4,'0');
  const p={ws,name,side:0,ready:false,room:code,connected:true};
  const r={code,scenarioId:CURRENT.id,players:[p],state:newState(code),started:true,finished:false,ai:true,disconnectTimer:0,lastTick:Date.now()};
  rooms.set(code,r);ws.player=p;
  send(ws,{t:'room',code,side:0,mode:'AI',scenario:scenarioMeta()});
  snap(r);
}
function joinRoom(ws,code){
  const r=rooms.get(String(code).trim());
  if(!r)return send(ws,{t:'error',message:'找不到房間'});
  if(r.players.length>=2||r.state.phase!=='PREP')return send(ws,{t:'error',message:'房間已滿或戰鬥已開始'});
  loadScenario(r.scenarioId);
  r.ai=false;const p={ws,name:ws.name||'指揮官',side:1,ready:false,room:r.code,connected:true};
  r.players.push(p);ws.player=p;
  send(ws,{t:'room',code:r.code,side:1,mode:'PVP',scenario:scenarioMeta()});
  broadcast(r,{t:'opponent_joined'});snap(r);
}
function tryEarlyStart(r){const ok=r.players.length===2?r.players.every(p=>p.ready):r.players[0]?.ready;if(ok)r.state.phaseTime=Math.min(r.state.phaseTime,2);}
function own(r,p,id){return r.state.units.find(q=>q.id===Number(id)&&q.side===p.side&&q.active);}
function handle(ws,m){
  const t=m?.t,p=ws.player;
  if(t==='hello'){ws.name=String(m.name||'指揮官').slice(0,20);return send(ws,{t:'hello_ok',version:'32.0',scenarios:listScenarios()});}
  if(t==='create')return makeRoom(ws,ws.name||'指揮官',String(m.scenarioId||DEFAULT_SCENARIO));
  if(t==='join')return joinRoom(ws,m.code);
  if(t==='ready'&&p){p.ready=true;const r=rooms.get(p.room);if(r&&r.state.phase==='PREP'){broadcast(r,{t:'ready',count:r.players.filter(x=>x.ready).length});tryEarlyStart(r);}return;}
  if(!p)return;const r=rooms.get(p.room);if(!r)return;
  loadScenario(r.scenarioId);
  if(t==='rematch'&&r.state.phase==='RESULT'){for(const x of r.players)x.ready=false;r.state=newState(r.code);r.started=true;r.finished=false;r.ai=r.players.length===1;broadcast(r,{t:'rematch_lobby',scenario:scenarioMeta()});snap(r);return;}
  if(r.finished)return;
  if(t==='deploy'&&r.state.phase==='PREP'){
    const q=own(r,p,m.id),x=Number(m.x),y=Number(m.y);if(!q||!Number.isFinite(x)||!Number.isFinite(y))return; if(!isLandUnit(q)&&terrainAt(x,y)!=='water')return send(ws,{t:'error',message:'海軍只能部署在海域'}); if(isLandUnit(q)&&countryAt(x,y)!==p.side)return send(ws,{t:'error',message:'戰前只能部署在自己的本方領土'}); q.x=clamp(x,250,CURRENT.world.w-250);q.y=clamp(y,250,CURRENT.world.h-250);q.target={x:q.x,y:q.y};q.path=[];q.status='已部署';return snap(r);
  }
  if(t==='buy'&&(r.state.phase==='PREP'||r.state.phase==='BATTLE')){
    const u=UNIT[String(m.kind||'INF')];if(!u)return; if(u.naval&&!CURRENT.hasNavy)return send(ws,{t:'error',message:'此情境沒有海軍'}); if(r.state.budget[p.side]<u.cost)return send(ws,{t:'error',message:'軍費不足'});
    r.state.budget[p.side]-=u.cost;r.state.spent[p.side]+=u.cost;
    const hp=homePoint(p.side,String(m.kind));
    addUnit(r.state,p.side,String(m.kind),hp.x,hp.y,Math.round(u.max*.78));const q=r.state.units.at(-1);q.status='待部署';q.reserve=false;q.active=true;event(r.state,`${sideLabel(p.side)} 徵募${u.name}`,'build');snap(r);return;
  }
  if(t==='command'&&r.state.phase==='BATTLE'){
    const q=own(r,p,m.id);if(!q)return;if(q.carrier)return send(ws,{t:'error',message:'部隊正在海運途中，無法下令'});
    cancelFerryWait(r.state,q);
    const x=Number(m.x),y=Number(m.y);if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const cx=clamp(x,50,CURRENT.world.w-50),cy=clamp(y,50,CURRENT.world.h-50);
    if(isLandUnit(q)){
      if(!onLand(cx,cy))return send(ws,{t:'error',message:'陸軍無法移動到海上，請先搭乘運輸艦'});
      if(onMid(cx,cy)||onMid(q.x,q.y)){
        if(!tryFerry(r.state,q,cx,cy))return send(ws,{t:'error',message:'前往／離開中繼島需要運輸艦接應'});
        return snap(r);
      }
      if(crossesWater(q.x,q.y,cx,cy)&&wantsFerry(q.x,q.y,cx,cy)&&tryFerry(r.state,q,cx,cy))return snap(r);
    }
    q.target={x:cx,y:cy};q.intent='MOVE';q.attackFacility=null;q.path=buildPath(q,cx,cy);q.pathIndex=0;q.status='行軍';return snap(r);
  }
  if(t==='attack'&&r.state.phase==='BATTLE'){
    const q=own(r,p,m.id);if(!q)return;
    if(q.carrier)return send(ws,{t:'error',message:'部隊正在海運途中，無法下令'});
    cancelFerryWait(r.state,q);
    if(m.facilityId!=null){
      const f=r.state.facilities.find(x=>x.id===m.facilityId);
      if(!f||f.type!=='FACTORY'||f.destroyed||f.side===p.side)return send(ws,{t:'error',message:'目標無效'});
      if(isLandUnit(q)){
        if(!onLand(f.x,f.y))return;
        if(onMid(f.x,f.y)||onMid(q.x,q.y)){if(!tryFerry(r.state,q,f.x,f.y))return send(ws,{t:'error',message:'需要運輸艦接應才能攻擊該目標'});return snap(r);}
        if(crossesWater(q.x,q.y,f.x,f.y)&&wantsFerry(q.x,q.y,f.x,f.y)&&tryFerry(r.state,q,f.x,f.y))return snap(r);
      }
      q.target={x:f.x,y:f.y};q.path=buildPath(q,f.x,f.y);q.pathIndex=0;q.intent='ATTACK';q.attackFacility=f.id;q.status='砲擊接近中';return snap(r);
    }
    const b=r.state.units.find(e=>e.id===Number(m.targetId)&&e.side!==p.side&&e.active);if(!b)return;
    if(isLandUnit(q)){
      if(!onLand(b.x,b.y))return send(ws,{t:'error',message:'陸軍無法攻擊海上目標，請改派海軍或先搭乘運輸艦'});
      if(onMid(b.x,b.y)||onMid(q.x,q.y)){if(!tryFerry(r.state,q,b.x,b.y))return send(ws,{t:'error',message:'需要運輸艦接應才能攻擊該目標'});return snap(r);}
      if(crossesWater(q.x,q.y,b.x,b.y)&&wantsFerry(q.x,q.y,b.x,b.y)&&tryFerry(r.state,q,b.x,b.y))return snap(r);
    }
    q.target={x:b.x,y:b.y};q.path=buildPath(q,b.x,b.y);q.pathIndex=0;q.intent='ATTACK';q.attackFacility=null;q.status='接敵';return;
  }
  if(t==='stance'&&r.state.phase==='BATTLE'){const q=own(r,p,m.id);if(q){q.stance=['ATTACK','DEFEND','MOBILE'].includes(m.value)?m.value:q.stance;}return snap(r);}
  if(t==='surrender'&&r.state.phase==='BATTLE'){return finish(r,1-p.side,`${sideLabel(p.side)}投降`);}
}
function speedFactor(q){const t=terrainAt(q.x,q.y);const naval=UNIT[q.kind].naval;if(t==='water')return naval?1:0;return naval?0:(terrainSpeed[t]||1);}
// Safety net: a unit should never be permanently frozen because it ended up on the wrong side of the
// water/land line (imprecise shore-finding on a jagged real coastline, a ship parked mid-transfer, etc).
// If that happens, head for the nearest valid terrain for that unit type instead of sitting at 0 speed.
function stepMove(s,q,dt){
  if(q.reserve)return;
  const naval=!!UNIT[q.kind].naval;
  const onWater=terrainAt(q.x,q.y)==='water';
  if(naval!==onWater){
    const spot=nearestSpot(q.x,q.y,naval);
    const dx=spot.x-q.x,dy=spot.y-q.y,d=Math.hypot(dx,dy)||1;
    const sp=UNIT[q.kind].speed;
    q.x+=dx/d*Math.min(d,sp*dt);q.y+=dy/d*Math.min(d,sp*dt);
    q.status=naval?'脫離淺灘中':'撤離水域中';
    return;
  }
  if(!q.path.length)return;const node=q.path[Math.min(q.pathIndex,q.path.length-1)];const dx=node.x-q.x,dy=node.y-q.y,d=Math.hypot(dx,dy);if(d<25){q.pathIndex++;if(q.pathIndex>=q.path.length){q.path=[];q.status=q.intent==='ATTACK'?'交戰位置':'就位';return;}return;}if(d>4)q.heading=Math.atan2(dx,-dy)*180/Math.PI;let sp=UNIT[q.kind].speed*speedFactor(q);if(q.stance==='ATTACK')sp*=1.04;if(q.stance==='DEFEND')sp*=.84;if(q.stance==='MOBILE')sp*=1.18;if(q.suppression>.62)sp*=.58;if(q.morale<.5)sp*=.8;q.x+=dx/d*Math.min(d,sp*dt);q.y+=dy/d*Math.min(d,sp*dt);}
function updateFerries(s){
  for(const t of s.units){
    if(!t.active||t.kind!=='TRANSPORT'||!t.cargo.length)continue;
    t.cargo=t.cargo.filter(cid=>{const cargo=s.units.find(u=>u.id===cid);return cargo&&cargo.active;});
    for(const cid of t.cargo){const cargo=s.units.find(u=>u.id===cid);cargo.x=t.x;cargo.y=t.y;}
    if(!t.path.length){
      for(const cid of t.cargo){
        const cargo=s.units.find(u=>u.id===cid);
        const ft=cargo.ferryTarget||{x:cargo.x,y:cargo.y};
        cargo.carrier=null;cargo.reserve=false;cargo.status='搶灘上岸';cargo.intent='MOVE';
        cargo.target=ft;cargo.path=buildPath(cargo,ft.x,ft.y);cargo.pathIndex=0;
        event(s,`${UNIT[cargo.kind].name} 登陸`,'ferry');
      }
      t.cargo=[];t.status='待命';t.intent='MOVE';
    }
  }
}
function chooseTarget(s,a){let best=null,bd=Infinity;for(const b of s.units){if(!b.active||b.side===a.side||b.reserve)continue;if(!visible(s,b,a.side))continue;const d=Math.hypot(a.x-b.x,a.y-b.y);if(d<=UNIT[a.kind].range&&d<bd){best=b;bd=d;}}return best;}
function fire(s,a,b,dt){const ua=UNIT[a.kind],ub=UNIT[b.kind];a.fireCd=Math.max(0,a.fireCd-dt);if(a.fireCd>0||a.ammo<=0)return;a.fireCd=1/ua.rof;a.ammo=Math.max(0,a.ammo-.15);const hit=Math.random()<ua.acc*(1-a.suppression*.4);const fx={kind:hit?'hit':'miss',x1:a.x,y1:a.y,x2:b.x,y2:b.y,t:1.0,damage:0};s.fx.push(fx);if(!hit)return;let dmg=ua.dmg*(.75+.5*Math.random());if(ub.armor>0)dmg*=ua.pen>=ub.armor?.92:.18;if(b.stance==='DEFEND')dmg*=.8;dmg*=a.effectiveness;b.personnel=Math.max(0,b.personnel-dmg);b.lastDamage=dmg;b.suppression=clamp(b.suppression+(ua.dmg>20?.16:.07),0,1);b.morale=clamp(b.morale-(ua.dmg>20?.025:.012),.05,1);fx.damage=Math.round(dmg*10)/10;event(s,`${UNIT[a.kind].name} → ${UNIT[b.kind].name}｜命中 ${dmg.toFixed(1)}`,'combat');
  if(b.personnel<=0){
    b.active=false;a.kills++;s.losses[b.side]++;event(s,`${UNIT[b.kind].name} 被殲滅`,'combat');s.fx.push({kind:'death',x1:b.x,y1:b.y,x2:b.x,y2:b.y,t:1.2,damage:0});
    if(b.kind==='TRANSPORT'&&b.cargo.length){for(const cid of b.cargo){const carried=s.units.find(u=>u.id===cid);if(carried){carried.active=false;carried.personnel=0;s.losses[carried.side]++;event(s,`${UNIT[carried.kind].name} 隨運輸艦沉沒`,'combat');s.fx.push({kind:'death',x1:carried.x,y1:carried.y,x2:carried.x,y2:carried.y,t:1.2,damage:0});}}}
  }
}
function fireFacility(s,a,f,dt){
  const ua=UNIT[a.kind];
  a.fireCd=Math.max(0,a.fireCd-dt);if(a.fireCd>0||a.ammo<=0)return;
  a.fireCd=1/ua.rof;a.ammo=Math.max(0,a.ammo-.15);
  let dmg=ua.dmg*(.8+.4*Math.random());dmg*=ua.pen>=FACTORY_ARMOR?1:.22;
  f.hpNow=Math.max(0,f.hpNow-dmg);
  s.fx.push({kind:'hit',x1:a.x,y1:a.y,x2:f.x,y2:f.y,t:1.0,damage:Math.round(dmg*10)/10});
  event(s,`${UNIT[a.kind].name} 砲擊 ${f.name}｜命中 ${dmg.toFixed(1)}`,'combat');
  if(f.hpNow<=0&&!f.destroyed){
    f.destroyed=true;f.control=-1;
    event(s,`${f.name} 被摧毀，經濟收入永久中斷`,'facility');
    s.fx.push({kind:'death',x1:f.x,y1:f.y,x2:f.x,y2:f.y,t:1.4,damage:0});
  }
}
function combat(s,dt){
  for(const a of s.units){
    if(!a.active||a.reserve)continue;
    a.suppression=Math.max(0,a.suppression-dt*.018);
    const b=chooseTarget(s,a);
    if(b){a.intent='ATTACK';a.status='交火中';fire(s,a,b,dt);continue;}
    if(a.attackFacility){
      const f=s.facilities.find(x=>x.id===a.attackFacility);
      if(!f||f.destroyed||f.side===a.side){a.attackFacility=null;continue;}
      const d=Math.hypot(a.x-f.x,a.y-f.y);
      if(d<=UNIT[a.kind].range){a.status='砲擊中';fireFacility(s,a,f,dt);}
    }
  }
}
function updateFacilities(s,dt){for(const f of s.facilities){if(f.destroyed)continue;if(f.type==='FACTORY'&&CURRENT.mode!=='conquest')continue;const count=[0,0];for(const q of s.units)if(q.active&&!q.reserve&&Math.hypot(q.x-f.x,q.y-f.y)<f.r*.62&&isLandUnit(q))count[q.side]++;if(count[0]&&count[1])continue;const owner=count[0]?0:count[1]?1:-1;if(owner<0)continue;if(f.control!==owner){f.capture[owner]=clamp(f.capture[owner]+dt*(count[owner]*1.6),0,100);f.capture[1-owner]=Math.max(0,f.capture[1-owner]-dt*.7);if(f.capture[owner]>=100){f.control=owner;event(s,`${f.name} 被${sideLabel(owner)}攻佔`,'facility');}}}}
function updateFactories(s,dt){
  for(const f of s.facilities){
    if(f.type!=='FACTORY'||f.destroyed)continue;
    const owner=f.control;
    if(owner<0)continue;
    f._income=(f._income||0)+dt;
    if(f._income>=FACTORY_INCOME_INTERVAL){f._income-=FACTORY_INCOME_INTERVAL;s.budget[owner]+=FACTORY_INCOME_AMOUNT;event(s,`${f.name} 挹注軍費 +¥${FACTORY_INCOME_AMOUNT}`,'economy');}
  }
}
function updateFront(s,dt){let balance=0;for(const q of s.units)if(q.active&&isLandUnit(q)){const w=q.personnel*q.morale*(1-q.suppression*.5);balance+=(q.side===0?1:-1)*w;}const b=CURRENT.frontBounds||[0,CURRENT.world.w];s.front=clamp(s.front+balance*dt*.015,b[0],b[1]);}
function aiThink(r,dt){
  if(!r.ai||!r.started||r.finished||r.state.phase!=='BATTLE')return;const s=r.state;
  const goTo=(q,tx,ty,intent,status)=>{
    if(isLandUnit(q)){
      if(!onLand(tx,ty)||onMid(tx,ty))return;
      q.attackFacility=null;
    }
    q.target={x:tx,y:ty};q.path=buildPath(q,tx,ty);q.pathIndex=0;q.intent=intent;q.status=status;
  };
  const home1=CURRENT.homePoints.landRed,home0=CURRENT.homePoints.landBlue;
  const box=CURRENT.aiPatrolBox;
  for(const q of s.units){
    if(!q.active||q.side!==1||q.reserve||q.carrier||q.kind==='TRANSPORT'||q._invade)continue;
    q._ai=(q._ai||0)-dt;if(q._ai>0)continue;q._ai=2+Math.random()*3;
    const enemy=s.units.filter(e=>e.active&&e.side===0);
    const seen=enemy.find(e=>visible(s,e,1)&&Math.hypot(e.x-q.x,e.y-q.y)<UNIT[q.kind].range*1.35);
    if(seen){goTo(q,seen.x,seen.y,'ATTACK','AI 接敵');continue;}
    const fac=s.facilities.filter(f=>f.control!==1&&f.type!=='FACTORY'&&!f.destroyed).sort((a,b)=>Math.hypot(q.x-a.x,q.y-a.y)-Math.hypot(q.x-b.x,q.y-b.y))[0];
    if(fac){goTo(q,fac.x,fac.y,'CAPTURE','AI 奪取設施');continue;}
    let tx,ty;
    if(box){tx=CURRENT.world.w*box.x0+Math.random()*CURRENT.world.w*box.xw;ty=CURRENT.world.h*box.y0+Math.random()*CURRENT.world.h*box.yw;}
    else{const dx=home0.x-home1.x,dy=home0.y-home1.y,t=0.3+Math.random()*0.3;tx=home1.x+dx*t;ty=home1.y+dy*t;}
    goTo(q,tx,ty,q.intent,'AI 機動');
  }
}
function aiFerryStaging(s){
  for(const u of s.units){
    if(!u.active||u.side!==1||!isLandUnit(u)||u.reserve||u.carrier||!u._invade)continue;
    if(u.path.length)continue;
    if(tryFerry(s,u,u._invade.x,u._invade.y))u._invade=null;
  }
}
function aiInvasionPlanner(r,dt){
  if(!CURRENT.hasNavy||!r.ai||!r.started||r.finished||r.state.phase!=='BATTLE')return;const s=r.state;
  r.invasionCooldown=(r.invasionCooldown??25)-dt;
  aiFerryStaging(s);
  if(r.invasionCooldown>0)return;
  r.invasionCooldown=35+Math.random()*20;
  const homeId=homeLandmassId(1);
  const idleLand=s.units.filter(u=>u.active&&u.side===1&&isLandUnit(u)&&!u.reserve&&!u.carrier&&!u._invade&&islandOf(u.x,u.y)===homeId);
  if(idleLand.length<2)return;
  const waveSize=Math.min(5,3+Math.floor(s.time/300));
  const wave=idleLand.slice(0,waveSize);
  const port=homePoint(1,'PATROL');
  const target=s.facilities.filter(f=>f.control!==1&&f.type!=='FACTORY'&&!f.destroyed).sort((a,b)=>Math.hypot(a.x-port.x,a.y-port.y)-Math.hypot(b.x-port.x,b.y-port.y))[0]||s.facilities.find(f=>f.type==='HQ'&&f.side===0);
  if(!target)return;
  for(const u of wave){u._invade={x:target.x,y:target.y};u.target={x:port.x,y:port.y};u.path=buildPath(u,port.x,port.y);u.pathIndex=0;u.intent='ATTACK';u.status='AI 集結上船';}
  const escorts=s.units.filter(u=>u.active&&u.side===1&&(u.kind==='FRIGATE'||u.kind==='PATROL')&&!u.reserve&&!u.carrier&&u.intent!=='ATTACK');
  const midX=(port.x+target.x)/2, midY=(port.y+target.y)/2;
  for(const e of escorts){e.target={x:midX,y:midY};e.path=buildPath(e,midX,midY);e.pathIndex=0;e.intent='ESCORT';e.status='AI 護航中';}
  event(s,`${sideLabel(1)}發動跨海登陸作戰，艦隊已出港`,'system');
}
function victory(s){
  const hq=s.facilities.filter(f=>f.type==='HQ');
  if(hq.length){if(hq.every(f=>f.control!==0))return 1;if(hq.every(f=>f.control!==1))return 0;}
  if(CURRENT.mode==='conquest'){
    const claim=s.facilities.filter(f=>!f.destroyed);
    if(claim.length){if(claim.every(f=>f.control===0))return 0;if(claim.every(f=>f.control===1))return 1;}
  }
  const alive=[0,1].map(side=>s.units.some(q=>q.side===side&&q.active&&!q.reserve));
  if(!alive[0])return 1;if(!alive[1])return 0;
  return -1;
}
function score(s){let p=[0,0];for(const q of s.units)if(q.active)p[q.side]+=q.personnel*q.morale*(1-q.suppression*.4);for(const f of s.facilities)if(f.control>=0)p[f.control]+=f.type==='HQ'?1200:f.type==='FORT'?550:f.type==='FACTORY'?450:f.type==='RADAR'?300:f.type==='WATCHTOWER'?200:260; p[0]+=s.losses[1]*30;p[1]+=s.losses[0]*30;return p[0]>=p[1]?0:1;}
function finish(r,w,reason){if(r.finished)return;r.finished=true;r.state.phase='RESULT';r.state.result=w;r.state.reason=reason;event(r.state,`${sideLabel(w)} 勝利｜${reason}`,'result');broadcast(r,{t:'result',winner:w,reason});snap(r);}
// Snapshot broadcasts are throttled independently of the simulation tick (TICK stays 20Hz for
// physics/combat smoothness) purely to cut WebSocket bandwidth: PREP only needs to be smooth
// enough for a countdown timer, BATTLE needs to still read as fluid combat.
const PREP_SNAP_EVERY = 6;   // ~3.3Hz
const BATTLE_SNAP_EVERY = 2; // ~10Hz
function tick(r,dt){
  if(!r.started||r.finished)return;
  loadScenario(r.scenarioId);
  const s=r.state;
  r._tickCount=(r._tickCount||0)+1;
  if(s.phase==='PREP'){s.phaseTime=Math.max(0,s.phaseTime-dt);if(s.phaseTime<=0){s.phase='BATTLE';event(s,'戰鬥開始｜所有建軍介面關閉','system');broadcast(r,{t:'battle_live'});}if(r._tickCount%PREP_SNAP_EVERY===0)snap(r);return;}
  s.time+=dt;
  const L=CURRENT.limitSeconds;
  const dayEnd=Math.round(360*L/900), duskEnd=Math.round(480*L/900), nightEnd=Math.round(780*L/900);
  s.dayPhase=s.time<dayEnd?'DAY':s.time<duskEnd?'DUSK':s.time<nightEnd?'NIGHT':'DAWN';
  s.weather=Math.floor(s.time/180)%5===3?'RAIN':'CLEAR';
  for(const q of s.units)if(q.active)stepMove(s,q,dt);
  updateFerries(s);updateFerryDispatch(s);combat(s,dt);updateFacilities(s,dt);updateFactories(s,dt);updateFront(s,dt);aiThink(r,dt);aiInvasionPlanner(r,dt);
  for(const fx of s.fx)fx.t-=dt;s.fx=s.fx.filter(f=>f.t>0);
  const w=victory(s);
  if(w>=0)return finish(r,w,`${sideLabel(1-w)}全滅／主城失守`);
  if(s.time>=L)return finish(r,score(s),`${Math.round(L/60)} 分鐘戰役結算`);
  if(r._tickCount%BATTLE_SNAP_EVERY===0)snap(r);
}

const server=http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,rooms:rooms.size,version:'32.0'}));}let p=req.url?.split('?')[0]||'/';if(p==='/')p='/index.html';p=normalize(p).replace(/^\.\.(\/|\\)/,'');const file=pathJoin(process.cwd(),'public',p);if(!existsSync(file)){res.writeHead(404);return res.end('Not found');}const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};const cache=p.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache';res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':cache});res.end(readFileSync(file));});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{ws.name='指揮官';ws.on('message',b=>{try{handle(ws,JSON.parse(b.toString()));}catch(err){console.error(err);send(ws,{t:'error',message:'伺服器處理指令失敗'});}});ws.on('close',()=>{const p=ws.player;if(!p)return;const r=rooms.get(p.room);if(r&&r.players.length===2&&!r.finished){r.disconnectTimer=30;p.connected=false;}});send(ws,{t:'server_ok',protocol:32});});
function send(ws,m){try{if(ws.readyState===1)ws.send(JSON.stringify(m));}catch{}}
function broadcast(r,m){for(const p of r.players)send(p.ws,m);}
setInterval(()=>{const now=Date.now();for(const r of rooms.values()){const dt=Math.min(.2,(now-(r.lastTick||now))/1000);r.lastTick=now;tick(r,dt);}},1000*TICK);
server.listen(PORT,()=>console.log(`TACTICAL BORDER v32 Multi-Scenario listening on ${PORT}`));
