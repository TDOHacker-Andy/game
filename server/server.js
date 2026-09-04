import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join as pathJoin, normalize } from 'node:path';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 10000);
const TICK = 0.05;
const PREP = 110;
const LIMIT = 1400;
const DAY_END = Math.round(360*LIMIT/900), DUSK_END = Math.round(480*LIMIT/900), NIGHT_END = Math.round(780*LIMIT/900);
const WORLD = { w: 22000, h: 13200 };
const rooms = new Map();
let nextRoom = 2800;
let nextUnit = 1;

const UNIT = {
  INF: { name:'突擊兵', short:'突', cost:700, max:180, speed:105, range:520, acc:.46, dmg:8, rof:.9, vision:520, armor:0, pen:0, land:true, role:'主力／佔領' },
  TANK:{ name:'裝甲部隊', short:'甲', cost:2500, max:60, speed:180, range:700, acc:.58, dmg:22, rof:.34, vision:460, armor:150, pen:180, land:true, role:'肉盾／突破' },
  RECON:{ name:'偵察兵', short:'偵', cost:950, max:90, speed:240, range:430, acc:.34, dmg:5, rof:1.2, vision:1080, armor:0, pen:0, land:true, role:'4格視野／情報' },
  SF:{ name:'特戰部隊', short:'特', cost:1550, max:90, speed:280, range:560, acc:.62, dmg:12, rof:1.05, vision:800, armor:15, pen:50, land:true, role:'高速／側翼' },
  AT:{ name:'反裝甲部隊', short:'反', cost:1050, max:75, speed:120, range:760, acc:.66, dmg:34, rof:.42, vision:580, armor:20, pen:210, land:true, role:'伏擊／反裝甲' },
  FIRE:{ name:'火力支援', short:'火', cost:1800, max:40, speed:95, range:980, acc:.34, dmg:28, rof:.18, vision:640, armor:20, pen:120, land:true, role:'遠程／壓制' },
  PATROL:{ name:'巡邏艇', short:'巡', cost:1200, max:24, speed:260, range:720, acc:.44, dmg:18, rof:.42, vision:1200, armor:60, pen:90, naval:true, role:'近岸巡防' },
  FRIGATE:{ name:'護衛艦', short:'艦', cost:2600, max:40, speed:190, range:1200, acc:.52, dmg:34, rof:.22, vision:1500, armor:110, pen:160, naval:true, role:'海上火力' },
  TRANSPORT:{ name:'運輸艦', short:'運', cost:2200, max:20, speed:150, range:250, acc:.08, dmg:2, rof:.08, vision:900, armor:40, pen:0, naval:true, role:'跨海運輸（可搭載1隊陸軍）' }
};

// Two fictional home islands (Taiwan-inspired SW, Japan-inspired NE) separated by open sea,
// with one small neutral relay island in the strait. No land bridges — crossing requires a transport.
const TAIWAN_POLY = [[3000,6200],[4600,6500],[5800,7500],[6500,9000],[6700,10600],[6100,12100],[4900,13000],[3500,13100],[2300,12300],[1600,10900],[1400,9200],[1800,7600],[2400,6700]];
const JAPAN_POLY = [[15400,900],[17400,500],[19400,1000],[20800,2300],[21400,4000],[20900,5700],[19600,7000],[17700,7700],[15900,7200],[14700,5900],[14300,4100],[14500,2300]];
const MID_POLY = [[10600,6800],[11500,6600],[12100,7200],[11900,7900],[11000,8100],[10400,7500]];
const PASSES = [
  { id:'passTW', name:'台灣中央山口', x:5300, y:9000, r:420 },
  { id:'passJP', name:'日本中央山口', x:17300, y:4600, r:420 },
];

const FACILITIES = [
  {id:'B-HQ', name:'台灣本島・統帥部', type:'HQ', x:3900,y:11500, side:0, hp:1000, r:520},
  {id:'B-PORT', name:'台灣軍港', type:'PORT', x:6400,y:9200, side:0, hp:650, r:430},
  {id:'B-AIR', name:'台灣空軍基地', type:'AIR', x:3200,y:12300, side:0, hp:580, r:420},
  {id:'B-DEP', name:'台灣補給站', type:'DEPOT', x:4700,y:10300, side:0, hp:480, r:360},
  {id:'B-F1', name:'台灣北岸砲台', type:'FORT', x:5900,y:7800, side:0, hp:780, r:480},
  {id:'B-F2', name:'台灣東岸要塞', type:'FORT', x:6300,y:10800, side:0, hp:780, r:480},
  {id:'R-HQ', name:'日本列島・統帥部', type:'HQ', x:18500,y:3800, side:1, hp:1000, r:520},
  {id:'R-PORT', name:'日本軍港', type:'PORT', x:14900,y:5200, side:1, hp:650, r:430},
  {id:'R-AIR', name:'日本空軍基地', type:'AIR', x:19700,y:2200, side:1, hp:580, r:420},
  {id:'R-DEP', name:'日本補給站', type:'DEPOT', x:17300,y:5000, side:1, hp:480, r:360},
  {id:'R-F1', name:'日本西岸砲台', type:'FORT', x:15400,y:3000, side:1, hp:780, r:480},
  {id:'R-F2', name:'日本南岸要塞', type:'FORT', x:15700,y:6600, side:1, hp:780, r:480},
  {id:'C-PORT', name:'海峽中繼島港', type:'PORT', x:11200,y:7300, side:-1, hp:420, r:380},
];

const terrainSpeed={plain:1,road:1.25,urban:.78,forest:.66,hill:.54,mountain:.30,swamp:.52,water:0};
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function pointInPoly(x,y,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];const intersect=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+1e-9)+xi);if(intersect)inside=!inside;}return inside;}
function islandOf(x,y){if(pointInPoly(x,y,TAIWAN_POLY))return 'TW';if(pointInPoly(x,y,JAPAN_POLY))return 'JP';if(pointInPoly(x,y,MID_POLY))return 'MID';return null;}
function terrainAt(x,y){
  const onLand = islandOf(x,y);
  if(!onLand)return 'water';
  const mountainBand = Math.sin(x/720)+Math.cos(y/930)+Math.sin((x+y)/1200);
  if(mountainBand>1.35) return 'mountain';
  const urban = (onLand==='TW'&&x<4200&&y>10800)||(onLand==='JP'&&x>18500&&y<4200);
  if(urban)return 'urban';
  const forest = Math.sin(x/370)+Math.cos(y/430)+Math.sin((x-y)/650)>1.1;
  if(forest)return 'forest';
  const hill = Math.sin(x/900)+Math.cos(y/750)>0.85;
  if(hill)return 'hill';
  const road = (onLand==='TW'&&Math.abs(y-9800)<150)||(onLand==='JP'&&Math.abs(y-5000)<150);
  if(road)return 'road';
  const swamp = onLand==='TW'&&x>4500&&x<6300&&y>10800&&y<12200;
  if(swamp)return 'swamp';
  return 'plain';
}
function countryAt(x,y){const isl=islandOf(x,y);return isl==='TW'?0:isl==='JP'?1:-1;}
function isLandUnit(q){return !UNIT[q.kind].naval;}
function findShore(sx,sy,tx,ty){let last={x:sx,y:sy};for(let t=0.02;t<=1;t+=0.02){const x=sx+(tx-sx)*t,y=sy+(ty-sy)*t;if(terrainAt(x,y)==='water')last={x,y};else break;}return last;}
function buildPath(q,tx,ty){
  const pts=[]; const naval=UNIT[q.kind].naval;
  if(naval){pts.push({x:tx,y:ty,kind:'target'});return pts;}
  const sx=q.x,sy=q.y;
  if(terrainAt(tx,ty)==='mountain' || terrainAt(sx,sy)==='mountain'){
    const pass=PASSES.slice().sort((a,b)=>Math.hypot(a.x-sx,a.y-sy)+Math.hypot(a.x-tx,a.y-ty)-Math.hypot(b.x-sx,b.y-sy)-Math.hypot(b.x-tx,b.y-ty))[0];
    if(pass && Math.hypot(pass.x-sx,pass.y-sy)+Math.hypot(pass.x-tx,pass.y-ty)<Math.hypot(tx-sx,ty-sy)*1.55)pts.push({x:pass.x,y:pass.y,kind:'pass'});
  }
  pts.push({x:tx,y:ty,kind:'target'});return pts;
}
function tryFerry(s,q,tx,ty){
  const transport=s.units.find(u=>u.active&&u.side===q.side&&u.kind==='TRANSPORT'&&!u.cargo&&!u.carrier&&Math.hypot(u.x-q.x,u.y-q.y)<1400);
  if(!transport)return false;
  transport.cargo=q.id;q.carrier=transport.id;q.reserve=true;q.status='登艦待命';q.ferryTarget={x:tx,y:ty};q.path=[];
  const shore=findShore(transport.x,transport.y,tx,ty);
  transport.target={x:shore.x,y:shore.y};transport.path=buildPath(transport,shore.x,shore.y);transport.pathIndex=0;transport.intent='FERRY';transport.status='運輸中';
  return true;
}
function addUnit(s,side,kind,x,y,p){const u=UNIT[kind];s.units.push({id:nextUnit++,side,kind,x,y,target:{x,y},path:[],pathIndex:0,personnel:p,maxPersonnel:p,ammo:100,morale:1,suppression:0,effectiveness:1,vision:u.vision,stance:'ATTACK',intent:'MOVE',reserve:false,carrier:null,cargo:null,ferryTarget:null,active:true,fireCd:0,lastDamage:0,status:'待命',kills:0});}
function initUnits(s){
  const blue=[['INF',4000,11200,180],['INF',4600,10800,180],['TANK',4200,11900,60],['RECON',4400,10600,90],['SF',4800,11600,80],['AT',5100,10900,75],['FIRE',4300,10200,40],['PATROL',7300,9000,24],['FRIGATE',7500,9400,40],['TRANSPORT',7200,9700,20]];
  const red=[['INF',18300,3800,180],['INF',18800,4300,180],['TANK',18400,3500,60],['RECON',18000,4600,90],['SF',18700,3300,80],['AT',19000,4700,75],['FIRE',18300,5000,40],['PATROL',13900,5000,24],['FRIGATE',13700,5300,40],['TRANSPORT',14000,5600,20]];
  for(const a of blue)addUnit(s,0,...a);for(const a of red)addUnit(s,1,...a);
}
function homePoint(side, kind){
  if(UNIT[kind]?.naval) return side===0?{x:7300,y:9300}:{x:13900,y:5200};
  return side===0?{x:4300,y:11000}:{x:18400,y:4000};
}

function freshFacilities(){return FACILITIES.map(f=>({...f,control:f.side,capture:[0,0],hpNow:f.hp}));}
function newState(code){const s={room:code,phase:'PREP',phaseTime:PREP,time:0,result:-1,reason:'',budget:[20000,20000],spent:[0,0],losses:[0,0],units:[],facilities:freshFacilities(),events:[],shots:[],fx:[],weather:'CLEAR',dayPhase:'DAY',front:10800};initUnits(s);event(s,`跨海戰役初始化完成｜${Math.round(LIMIT/60)} 分鐘戰役目標已啟用`,'system');return s;}
function event(s,text,kind='info'){s.events.unshift({id:Date.now()+Math.random(),t:Math.floor(s.time),text,kind});s.events=s.events.slice(0,20);}
function visible(s,q,side){if(q.side===side)return true;return s.units.filter(u=>u.active&&u.side===side).some(w=>Math.hypot(w.x-q.x,w.y-q.y)<=w.vision*(s.dayPhase==='NIGHT'?.72:1));}
function filtered(r,side){const s=structuredClone(r.state);const known=new Set(s.units.filter(q=>visible(r.state,q,side)).map(q=>q.id));s.units=s.units.filter(q=>known.has(q.id));return s;}
function snap(r){for(const p of r.players)send(p.ws,{t:'snapshot',state:filtered(r,p.side)});}
function makeRoom(ws,name){const code=String(nextRoom++).padStart(4,'0');const p={ws,name,side:0,ready:false,room:code,connected:true};const r={code,players:[p],state:newState(code),started:false,finished:false,ai:true,disconnectTimer:0,lastTick:Date.now()};rooms.set(code,r);ws.player=p;send(ws,{t:'room',code,side:0,mode:'AI'});snap(r);}
function joinRoom(ws,code){const r=rooms.get(String(code).trim());if(!r)return send(ws,{t:'error',message:'找不到房間'});if(r.players.length>=2||r.started)return send(ws,{t:'error',message:'房間已滿或戰鬥已開始'});r.ai=false;const p={ws,name:ws.name||'指揮官',side:1,ready:false,room:r.code,connected:true};r.players.push(p);ws.player=p;send(ws,{t:'room',code:r.code,side:1,mode:'PVP'});broadcast(r,{t:'opponent_joined'});snap(r);}
function startIfReady(r){const ok=r.players.length===2?r.players.every(p=>p.ready):r.players[0]?.ready;if(!ok||r.started)return; r.started=true; r.state.phase='PREP';r.state.phaseTime=PREP;broadcast(r,{t:'prep_start'});snap(r);}
function own(r,p,id){return r.state.units.find(q=>q.id===Number(id)&&q.side===p.side&&q.active);}
function handle(ws,m){
  const t=m?.t,p=ws.player;
  if(t==='hello'){ws.name=String(m.name||'指揮官').slice(0,20);return send(ws,{t:'hello_ok',version:'29.0'});}
  if(t==='create')return makeRoom(ws,ws.name||'指揮官');
  if(t==='join')return joinRoom(ws,m.code);
  if(t==='ready'&&p){p.ready=true;const r=rooms.get(p.room);if(r){broadcast(r,{t:'ready',count:r.players.filter(x=>x.ready).length});startIfReady(r);}return;}
  if(!p)return;const r=rooms.get(p.room);if(!r)return;
  if(t==='rematch'&&r.state.phase==='RESULT'){for(const x of r.players)x.ready=false;r.state=newState(r.code);r.started=false;r.finished=false;r.ai=r.players.length===1;broadcast(r,{t:'rematch_lobby'});snap(r);return;}
  if(r.finished)return;
  if(t==='deploy'&&r.state.phase==='PREP'){
    const q=own(r,p,m.id),x=Number(m.x),y=Number(m.y);if(!q||!Number.isFinite(x)||!Number.isFinite(y))return; if(!isLandUnit(q)&&terrainAt(x,y)!=='water')return send(ws,{t:'error',message:'海軍只能部署在海域'}); if(isLandUnit(q)&&countryAt(x,y)!==p.side)return send(ws,{t:'error',message:'戰前只能部署在自己的本島領土'}); q.x=clamp(x,250,WORLD.w-250);q.y=clamp(y,250,WORLD.h-250);q.target={x:q.x,y:q.y};q.path=[];q.status='已部署';return snap(r);
  }
  if(t==='buy'&&r.state.phase==='PREP'){
    const u=UNIT[String(m.kind||'INF')];if(!u)return; if(r.state.budget[p.side]<u.cost)return send(ws,{t:'error',message:'軍費不足'});
    r.state.budget[p.side]-=u.cost;r.state.spent[p.side]+=u.cost;
    const hp=homePoint(p.side,String(m.kind));
    addUnit(r.state,p.side,String(m.kind),hp.x,hp.y,Math.round(u.max*.78));const q=r.state.units.at(-1);q.status='待部署';q.reserve=false;q.active=true;event(r.state,`${p.side?'紅軍':'藍軍'} 徵募${u.name}`,'build');snap(r);return;
  }
  if(t==='command'&&r.state.phase==='BATTLE'){
    const q=own(r,p,m.id);if(!q)return;if(q.carrier)return send(ws,{t:'error',message:'部隊正在海運途中，無法下令'});
    const x=Number(m.x),y=Number(m.y);if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const cx=clamp(x,50,WORLD.w-50),cy=clamp(y,50,WORLD.h-50);
    if(isLandUnit(q)){
      const from=islandOf(q.x,q.y),to=islandOf(cx,cy);
      if(to===null)return send(ws,{t:'error',message:'陸軍無法移動到海上，請先搭乘運輸艦'});
      if(from&&from!==to){if(!tryFerry(r.state,q,cx,cy))return send(ws,{t:'error',message:'附近沒有可用運輸艦，請先派遣運輸艦接應'});return snap(r);}
    }
    q.target={x:cx,y:cy};q.intent='MOVE';q.path=buildPath(q,cx,cy);q.pathIndex=0;q.status='行軍';return snap(r);
  }
  if(t==='attack'&&r.state.phase==='BATTLE'){
    const q=own(r,p,m.id),b=r.state.units.find(e=>e.id===Number(m.targetId)&&e.side!==p.side&&e.active);if(!q||!b)return;
    if(q.carrier)return send(ws,{t:'error',message:'部隊正在海運途中，無法下令'});
    if(isLandUnit(q)){
      const from=islandOf(q.x,q.y),to=islandOf(b.x,b.y);
      if(to===null)return send(ws,{t:'error',message:'陸軍無法攻擊海上目標，請改派海軍或先搭乘運輸艦'});
      if(from&&from!==to){if(!tryFerry(r.state,q,b.x,b.y))return send(ws,{t:'error',message:'附近沒有可用運輸艦，請先派遣運輸艦接應'});return snap(r);}
    }
    q.target={x:b.x,y:b.y};q.path=buildPath(q,b.x,b.y);q.pathIndex=0;q.intent='ATTACK';q.status='接敵';return;
  }
  if(t==='stance'&&r.state.phase==='BATTLE'){const q=own(r,p,m.id);if(q){q.stance=['ATTACK','DEFEND','MOBILE'].includes(m.value)?m.value:q.stance;}return snap(r);}
}
function speedFactor(q){const t=terrainAt(q.x,q.y);if(t==='water')return UNIT[q.kind].naval?1:0;return terrainSpeed[t]||1;}
function stepMove(s,q,dt){if(q.reserve)return;if(!q.path.length)return;const node=q.path[Math.min(q.pathIndex,q.path.length-1)];const dx=node.x-q.x,dy=node.y-q.y,d=Math.hypot(dx,dy);if(d<25){q.pathIndex++;if(q.pathIndex>=q.path.length){q.path=[];q.status=q.intent==='ATTACK'?'交戰位置':'就位';return;}return;}let sp=UNIT[q.kind].speed*speedFactor(q);if(q.stance==='ATTACK')sp*=1.04;if(q.stance==='DEFEND')sp*=.84;if(q.stance==='MOBILE')sp*=1.18;if(q.suppression>.62)sp*=.58;if(q.morale<.5)sp*=.8;q.x+=dx/d*Math.min(d,sp*dt);q.y+=dy/d*Math.min(d,sp*dt);}
function updateFerries(s){
  for(const t of s.units){
    if(!t.active||t.kind!=='TRANSPORT'||!t.cargo)continue;
    const cargo=s.units.find(u=>u.id===t.cargo);
    if(!cargo||!cargo.active){t.cargo=null;continue;}
    cargo.x=t.x;cargo.y=t.y;
    if(!t.path.length){
      const ft=cargo.ferryTarget||{x:cargo.x,y:cargo.y};
      cargo.carrier=null;cargo.reserve=false;cargo.status='搶灘上岸';cargo.intent='MOVE';
      cargo.target=ft;cargo.path=buildPath(cargo,ft.x,ft.y);cargo.pathIndex=0;
      t.cargo=null;t.status='待命';t.intent='MOVE';
      event(s,`${UNIT[cargo.kind].name} 登陸`,'ferry');
    }
  }
}
function chooseTarget(s,a){let best=null,bd=Infinity;for(const b of s.units){if(!b.active||b.side===a.side||b.reserve)continue;if(!visible(s,b,a.side))continue;const d=Math.hypot(a.x-b.x,a.y-b.y);if(d<=UNIT[a.kind].range&&d<bd){best=b;bd=d;}}return best;}
function fire(s,a,b,dt){const ua=UNIT[a.kind],ub=UNIT[b.kind];a.fireCd=Math.max(0,a.fireCd-dt);if(a.fireCd>0||a.ammo<=0)return;a.fireCd=1/ua.rof;a.ammo=Math.max(0,a.ammo-.15);const hit=Math.random()<ua.acc*(1-a.suppression*.4);const fx={kind:hit?'hit':'miss',x1:a.x,y1:a.y,x2:b.x,y2:b.y,t:1.0,damage:0};s.fx.push(fx);if(!hit)return;let dmg=ua.dmg*(.75+.5*Math.random());if(ub.armor>0)dmg*=ua.pen>=ub.armor?.92:.18;if(b.stance==='DEFEND')dmg*=.8;dmg*=a.effectiveness;b.personnel=Math.max(0,b.personnel-dmg);b.lastDamage=dmg;b.suppression=clamp(b.suppression+(ua.dmg>20?.16:.07),0,1);b.morale=clamp(b.morale-(ua.dmg>20?.025:.012),.05,1);fx.damage=Math.round(dmg*10)/10;event(s,`${UNIT[a.kind].name} → ${UNIT[b.kind].name}｜命中 ${dmg.toFixed(1)}`,'combat');
  if(b.personnel<=0){
    b.active=false;a.kills++;s.losses[b.side]++;event(s,`${UNIT[b.kind].name} 被殲滅`,'combat');s.fx.push({kind:'death',x1:b.x,y1:b.y,x2:b.x,y2:b.y,t:1.2,damage:0});
    if(b.kind==='TRANSPORT'&&b.cargo){const carried=s.units.find(u=>u.id===b.cargo);if(carried){carried.active=false;carried.personnel=0;s.losses[carried.side]++;event(s,`${UNIT[carried.kind].name} 隨運輸艦沉沒`,'combat');s.fx.push({kind:'death',x1:carried.x,y1:carried.y,x2:carried.x,y2:carried.y,t:1.2,damage:0});}}
  }
}
function combat(s,dt){for(const a of s.units){if(!a.active||a.reserve)continue;a.suppression=Math.max(0,a.suppression-dt*.018);const b=chooseTarget(s,a);if(b){a.intent='ATTACK';a.status='交火中';fire(s,a,b,dt);}}}
function updateFacilities(s,dt){for(const f of s.facilities){const count=[0,0];for(const q of s.units)if(q.active&&!q.reserve&&Math.hypot(q.x-f.x,q.y-f.y)<f.r*.62&&isLandUnit(q))count[q.side]++;if(count[0]&&count[1])continue;const owner=count[0]?0:count[1]?1:-1;if(owner<0)continue;if(f.control!==owner){f.capture[owner]=clamp(f.capture[owner]+dt*(count[owner]*1.6),0,100);f.capture[1-owner]=Math.max(0,f.capture[1-owner]-dt*.7);if(f.capture[owner]>=100){f.control=owner;event(s,`${f.name} 被${owner===0?'藍軍':'紅軍'}攻佔`,'facility');}}}}
function updateFront(s,dt){let balance=0;for(const q of s.units)if(q.active&&isLandUnit(q)){const w=q.personnel*q.morale*(1-q.suppression*.5);balance+=(q.side===0?1:-1)*w;}s.front=clamp(s.front+balance*dt*.015,7200,14800);}
function aiThink(r,dt){
  if(!r.ai||!r.started||r.finished||r.state.phase!=='BATTLE')return;const s=r.state;
  const goTo=(q,tx,ty,intent,status)=>{
    if(isLandUnit(q)){
      const from=islandOf(q.x,q.y),to=islandOf(tx,ty);
      if(to===null)return;
      if(from&&from!==to)return; // cross-island moves are only launched by the coordinated invasion planner
    }
    q.target={x:tx,y:ty};q.path=buildPath(q,tx,ty);q.pathIndex=0;q.intent=intent;q.status=status;
  };
  for(const q of s.units){
    if(!q.active||q.side!==1||q.reserve||q.carrier||q.kind==='TRANSPORT'||q._invade)continue;
    q._ai=(q._ai||0)-dt;if(q._ai>0)continue;q._ai=2+Math.random()*3;
    const enemy=s.units.filter(e=>e.active&&e.side===0);
    const seen=enemy.find(e=>visible(s,e,1)&&Math.hypot(e.x-q.x,e.y-q.y)<UNIT[q.kind].range*1.35);
    if(seen){goTo(q,seen.x,seen.y,'ATTACK','AI 接敵');continue;}
    const fac=s.facilities.filter(f=>f.control!==1).sort((a,b)=>Math.hypot(q.x-a.x,q.y-a.y)-Math.hypot(q.x-b.x,q.y-b.y))[0];
    if(fac){goTo(q,fac.x,fac.y,'CAPTURE','AI 奪取設施');continue;}
    const tx=16500+Math.random()*3500,ty=2000+Math.random()*4500;goTo(q,tx,ty,q.intent,'AI 機動');
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
  if(!r.ai||!r.started||r.finished||r.state.phase!=='BATTLE')return;const s=r.state;
  r.invasionCooldown=(r.invasionCooldown??25)-dt;
  aiFerryStaging(s);
  if(r.invasionCooldown>0)return;
  r.invasionCooldown=35+Math.random()*20;
  const idleLand=s.units.filter(u=>u.active&&u.side===1&&isLandUnit(u)&&!u.reserve&&!u.carrier&&!u._invade&&islandOf(u.x,u.y)==='JP');
  if(idleLand.length<2)return;
  const waveSize=Math.min(5,3+Math.floor(s.time/300));
  const wave=idleLand.slice(0,waveSize);
  const port=homePoint(1,'PATROL');
  const target=s.facilities.filter(f=>f.control!==1).sort((a,b)=>Math.hypot(a.x-port.x,a.y-port.y)-Math.hypot(b.x-port.x,b.y-port.y))[0]||s.facilities.find(f=>f.type==='HQ'&&f.side===0);
  if(!target)return;
  for(const u of wave){u._invade={x:target.x,y:target.y};u.target={x:port.x,y:port.y};u.path=buildPath(u,port.x,port.y);u.pathIndex=0;u.intent='ATTACK';u.status='AI 集結上船';}
  const escorts=s.units.filter(u=>u.active&&u.side===1&&(u.kind==='FRIGATE'||u.kind==='PATROL')&&!u.reserve&&!u.carrier&&u.intent!=='ATTACK');
  const midX=(port.x+target.x)/2, midY=(port.y+target.y)/2;
  for(const e of escorts){e.target={x:midX,y:midY};e.path=buildPath(e,midX,midY);e.pathIndex=0;e.intent='ESCORT';e.status='AI 護航中';}
  event(s,'紅軍發動跨海登陸作戰，艦隊已出港','system');
}
function victory(s){const hq=s.facilities.filter(f=>f.type==='HQ');if(hq.every(f=>f.control!==0))return 1;if(hq.every(f=>f.control!==1))return 0;const alive=[0,1].map(side=>s.units.some(q=>q.side===side&&q.active&&!q.reserve));if(!alive[0])return 1;if(!alive[1])return 0;return -1;}
function score(s){let p=[0,0];for(const q of s.units)if(q.active)p[q.side]+=q.personnel*q.morale*(1-q.suppression*.4);for(const f of s.facilities)if(f.control>=0)p[f.control]+=f.type==='HQ'?1200:f.type==='FORT'?550:260; p[0]+=s.losses[1]*30;p[1]+=s.losses[0]*30;return p[0]>=p[1]?0:1;}
function finish(r,w,reason){if(r.finished)return;r.finished=true;r.state.phase='RESULT';r.state.result=w;r.state.reason=reason;event(r.state,`${w===0?'藍軍':'紅軍'} 勝利｜${reason}`,'result');broadcast(r,{t:'result',winner:w,reason});snap(r);}
function tick(r,dt){if(!r.started||r.finished)return;const s=r.state;if(s.phase==='PREP'){s.phaseTime=Math.max(0,s.phaseTime-dt);if(s.phaseTime<=0){s.phase='BATTLE';event(s,'戰鬥開始｜所有建軍介面關閉','system');broadcast(r,{t:'battle_live'});}snap(r);return;}s.time+=dt;s.dayPhase=s.time<DAY_END?'DAY':s.time<DUSK_END?'DUSK':s.time<NIGHT_END?'NIGHT':'DAWN';s.weather=Math.floor(s.time/180)%5===3?'RAIN':'CLEAR';for(const q of s.units)if(q.active)stepMove(s,q,dt);updateFerries(s);combat(s,dt);updateFacilities(s,dt);updateFront(s,dt);aiThink(r,dt);aiInvasionPlanner(r,dt);for(const fx of s.fx)fx.t-=dt;s.fx=s.fx.filter(f=>f.t>0);const w=victory(s);if(w>=0)return finish(r,w,w===0?'紅軍全滅／主城失守':'藍軍全滅／主城失守');if(s.time>=LIMIT)return finish(r,score(s),`${Math.round(LIMIT/60)} 分鐘戰役結算`);snap(r);}

const server=http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,rooms:rooms.size,version:'29.0'}));}let p=req.url?.split('?')[0]||'/';if(p==='/')p='/index.html';p=normalize(p).replace(/^\.\.(\/|\\)/,'');const file=pathJoin(process.cwd(),'public',p);if(!existsSync(file)){res.writeHead(404);return res.end('Not found');}const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':'no-cache'});res.end(readFileSync(file));});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{ws.name='指揮官';ws.on('message',b=>{try{handle(ws,JSON.parse(b.toString()));}catch(err){console.error(err);send(ws,{t:'error',message:'伺服器處理指令失敗'});}});ws.on('close',()=>{const p=ws.player;if(!p)return;const r=rooms.get(p.room);if(r&&r.players.length===2&&!r.finished){r.disconnectTimer=30;p.connected=false;}});send(ws,{t:'server_ok',protocol:29});});
function send(ws,m){try{if(ws.readyState===1)ws.send(JSON.stringify(m));}catch{}}
function broadcast(r,m){for(const p of r.players)send(p.ws,m);}
setInterval(()=>{const now=Date.now();for(const r of rooms.values()){const dt=Math.min(.2,(now-(r.lastTick||now))/1000);r.lastTick=now;tick(r,dt);}},1000*TICK);
server.listen(PORT,()=>console.log(`TACTICAL BORDER v29 Cross-Strait listening on ${PORT}`));
