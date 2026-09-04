import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join as pathJoin, normalize } from 'node:path';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 10000);
const TICK = 0.05;
const PREP = 120;
const LIMIT = 1560;
const DAY_END = Math.round(360*LIMIT/900), DUSK_END = Math.round(480*LIMIT/900), NIGHT_END = Math.round(780*LIMIT/900);
const WORLD = { w: 45000, h: 42000 };
const FACTORY_INCOME_INTERVAL = 12;
const FACTORY_INCOME_AMOUNT = 400;
const FACTORY_ARMOR = 100;
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

// Real-world-inspired coastlines: Taiwan's main island and Kyushu (southern Japan), simplified from
// public-domain coastline data (Natural Earth via datasets/geo-countries, CC0) and scaled ~2.3x around
// each island's own centroid for playable deployment area, while keeping true relative bearing/distance
// between them — so the diagonal strait, corridor placement, and city-based facility names line up with
// real geography. A neutral relay island (Ryukyu-inspired) sits mid-strait, reachable only by sea; two
// long land corridors (north / south) physically connect the home landmasses on either flank.
const TAIWAN_POLY = [[16735.1,23001.9],[16400.9,23439.7],[16333.2,23790.1],[16366.2,24408.3],[16419.1,24507.5],[16637.9,24622.5],[16471.3,24656.9],[16532.8,24840],[16519.9,24929.8],[16427.7,24983.9],[16468,25158.1],[16224.4,25382],[16137.2,25843.6],[16194.7,25949.9],[15748.5,26484.1],[15523.4,27018.8],[15611.6,27303.5],[15174.3,28942.4],[14933.4,30394.5],[14716.9,30801.3],[14681.2,31303.1],[14467.3,31589.1],[14273,32160.2],[14094.5,32442.6],[13829.1,32693.8],[13776.8,32990.6],[13174.3,33547.7],[12846.1,34149.1],[12742.9,34618.5],[12574.4,34981.1],[12565.8,36315.6],[12502.3,36531.2],[12389,36631],[12407.8,37011.2],[12111.6,36759.6],[11989.3,36728.1],[11984.4,36835.4],[11896.1,36859.9],[11763.3,36468.7],[11825.4,36051.5],[11518,35215],[11308.4,34852.7],[11074.1,34618.5],[10673.2,34353.7],[10541.6,34346.5],[10340,34181.6],[10152.9,33904.1],[10349.9,34153],[10267.9,33917.9],[9967.8,33540.6],[9995.3,33306.8],[9806.8,32927],[9821.1,32709.9],[9571.8,32063],[9686.2,31910.8],[9669.7,31826.4],[9571.8,31811.8],[9458.1,31937.2],[9433,31748.9],[9218.8,31771.4],[9236,31623.3],[9402.6,31526.2],[9236,31463.3],[9357,31430.7],[9236,31277.6],[9347.7,31135],[9314,31020.3],[9437,30653.6],[9501.1,30615.4],[9443.5,30575.3],[9468,30510],[9599.6,30490],[9485.2,30402.6],[9523.3,30311.9],[9663.1,30308.5],[9524.9,29897.8],[9634.6,29711.6],[9502.5,29720.1],[9499.4,29580.3],[9570.2,29497.8],[9578,29037.4],[9743.7,28456.2],[10181.7,27777.5],[10417.7,27197.2],[10667.6,26926.6],[10708.9,26672.4],[10997.8,26311.3],[11261.5,25597.3],[11630.4,25146.5],[11846.6,24580.2],[11951,24548.3],[12154.9,24310.1],[12352.3,24308.4],[12337.4,24221.1],[12687.4,23614.7],[12659.7,23523],[12755.8,23302.7],[12867.9,23209.3],[13078.8,22769.2],[13297.3,22541.3],[13913,22261.1],[14397.6,22171.2],[14594.6,22045.8],[14856.4,22144.8],[14663.7,21931.4],[14828.3,21661.7],[15078.1,21490.1],[15415.3,21470.4],[15694.9,21865.7],[15836.1,21850],[15803.7,21947.2],[15915.1,22050.7],[16682.5,22249.5],[16789.6,22671],[16986,22675.5],[17139.7,22763.6],[16735.1,23001.9]];
const JAPAN_POLY = [[34069.6,11839.3],[34188.8,12092.7],[33946.2,12253.5],[33206.5,14599],[33241.5,14851.6],[33405.8,14971.3],[33239.2,15776.5],[32977.1,16108.1],[32989,16373.9],[32763.6,16918.6],[32404.6,16847.3],[32253.6,16540.9],[32001.7,16464.5],[31681.4,16564.5],[31445.1,16962.6],[31812.3,17120],[31691.3,17335],[31926.4,17346.9],[31634.6,17596.2],[31423,17615.7],[31148.9,18074.6],[30546.5,18274.6],[29999.7,18618],[30022.5,18313],[30344.8,18074.8],[30558.3,17048.3],[30363.6,16629.4],[30185.3,16519.9],[30153.4,16122],[29728.2,15937.1],[29919.1,15768.8],[30122,15783.2],[30262.1,15885],[30263.5,16041],[30409.5,16039.3],[30619.4,15638.3],[30481.6,15365.4],[29947.1,15344.9],[29477.4,16271.7],[29424.6,16547.4],[29613.6,17094.6],[29861.4,17364.7],[30010.3,17384.1],[29927,17774.9],[29710.1,17917.8],[29447.4,17856.7],[29338,17587.4],[29160.6,17485.5],[28230.8,17499.7],[28056.9,17124.9],[28172.2,17084.3],[27811.6,16753],[27987.7,16691.8],[28255.5,16878.7],[28519.4,16587.1],[28686.8,16045.6],[28650.1,15679.1],[28024.6,14998.1],[28101.3,14791.3],[28283.2,14862.9],[28128.4,14683.7],[28223.6,14356.6],[28035.4,14038.4],[28157,13810.6],[28058.8,13602.8],[28336.8,13417.5],[28460.1,13570.3],[28626.3,13488.8],[29203.4,12652.9],[29235.5,12436],[29409.7,12477],[29399.8,12291.7],[29648.7,11954],[29564,11770.9],[29760.4,11708.1],[29621.9,11519.6],[30042.7,11048.4],[29147.9,11174.2],[29624.9,10842.9],[29870.8,10794.3],[29732.6,10588.6],[29811.3,10419.5],[29120.5,9783.9],[29036.9,9029.8],[28809.8,8787.2],[28507.9,8744.6],[28308.7,8566.8],[27941.1,8918],[27846.4,8876.4],[28231.2,9546.8],[28094,9822.2],[27756,10003.5],[27952.3,10157.4],[28317.6,10006.4],[28706.9,10092.4],[28850.8,10443.9],[28793.8,10868.1],[28002.5,11305.1],[28017,11184.9],[27854.1,11083.5],[27848.7,10886.9],[28100.5,10747.8],[28171.4,10572.7],[28053,10385.3],[27709.2,10376.3],[27291,10596.9],[27159.8,10514.7],[26901.5,10984.3],[26683.6,11091.4],[26446.6,11394.6],[26273.7,11417.9],[26574.9,10985],[26503.5,10848.4],[26655.6,10839.7],[26755.9,10699.9],[26612.6,10711.6],[26398.2,10288.5],[26242.7,10327.1],[25859.8,9770.6],[25835.3,9528.8],[26035.1,8999.9],[26352.2,9212.4],[26279,9473.9],[26379.2,9350.1],[26610.5,9526.8],[26543.1,9825.1],[26463,9672.8],[26546.4,9957.4],[26493.2,10008.1],[26700.5,10176.5],[26853.9,10004.5],[27341.1,10144],[27049,9759.8],[27107.4,9360.2],[26846.8,9144],[26612.9,9234.3],[26505.9,9077.1],[26298.6,9131],[26244.8,8965.2],[26309.6,8981.3],[26348.1,8793.6],[26225.7,8870.1],[26149.5,8684.9],[26126.5,8918.4],[25973.8,8966.9],[25956.8,8850.7],[26057.1,8778.4],[25917.6,8557.5],[25509.3,8393.8],[25562.9,8181.2],[25669.1,8129],[25587.8,7957.7],[25624.1,7726.1],[25883.9,7765.8],[26000.9,7599.4],[26015.9,7765.6],[26113.9,7808.9],[26546.3,7831.3],[26725.5,8144.6],[26683.8,7979.2],[26794.9,7604.4],[26464.2,7341.9],[26590.9,7205.3],[26714.5,7397.4],[26805.8,7395.2],[26665.6,7071.7],[26732,6891.2],[27093.3,6986.9],[27171,7074],[27089.5,7226.8],[27396.8,7382.1],[27552.9,7154.7],[28010.6,6975.9],[28035.7,6917.1],[27855.9,6948.6],[27706.1,6794.9],[27964.6,6642.8],[27976.3,6536.6],[28131.5,6518.1],[28173.1,6373.3],[28507.3,6791.4],[28608.9,6684.8],[28915.8,6650.3],[28947.6,6354.7],[28745.7,6483.5],[28503.2,6297.6],[28731.6,6385.3],[29134,6128.9],[29237.2,5923.5],[29154.2,5742.4],[29314.2,5498],[29554.8,5381.2],[29899.5,5373.3],[30108.1,5135.2],[30399,5091.8],[30692.2,5110.6],[30664.2,5199.4],[30827,5175.1],[30905.9,5311.4],[31038.9,5333.3],[31184.6,5117],[31418.9,4988.8],[31389.2,5412.9],[31234.2,5678],[31418.1,5692.5],[31429.6,6000.4],[31808.1,6561.1],[32883,6788.6],[33086.4,6757],[33506.1,6321.4],[34100.4,6363.6],[34352.9,6763.6],[34384.4,7203.5],[34258.3,7548.6],[33990.5,7516.5],[33967.4,7712.4],[33811.5,7825.5],[33445.1,7762.6],[33462.8,8175],[33876.4,8269.2],[34277.1,8189.9],[34729.2,8310.1],[35055.9,8208.9],[34678,8845.5],[35091.8,8858.5],[34919.1,8998.7],[34966.1,9087.5],[35163.9,9118.6],[35217.4,9006.9],[35354.3,9155.6],[35435.6,9010.8],[35489.8,9197.3],[35165.3,9216.1],[35058.1,9510.6],[35285.9,9687.9],[35781.2,9693.8],[35379.1,9943.7],[35452.1,10024.8],[35271,10226],[35442.5,10216.3],[35437.6,10304.2],[35163.9,10452.7],[34974.2,10428.9],[34866.2,10876.7],[34728.2,10800.3],[34409,11328.1],[34252.1,11357.4],[34172.3,11629.4],[34381.2,11770.9],[34214.6,11878.8],[34069.6,11839.3]];
const MID_POLY = [[22928.8,19782.6],[22118.7,20772.5],[21128.8,21582.6],[20138.9,20772.5],[19328.8,19782.6],[20138.9,18792.7],[21128.8,17982.6],[22118.7,18792.7]];
const NORTH_CORRIDOR_POLY = [[14201.2,24891.9],[19236.2,15704.3],[28179.5,12492.1],[27117.6,9815],[17644.9,13907.6],[11716.1,23436.2]];
const SOUTH_CORRIDOR_POLY = [[14845.2,29275.8],[26734.6,24675],[33008.5,16403.9],[30663.5,14732],[25349.5,22715],[13865.7,26567.5]];
const CORRIDORS = [
  { id:'north', name:'北部走廊', pass:{x:18440.6,y:14806.0}, twEntry:{x:12958.6,y:24164.0}, jpEntry:{x:27648.5,y:11153.6} },
  { id:'south', name:'南部走廊', pass:{x:26042.0,y:23695.0}, twEntry:{x:14355.5,y:27921.7}, jpEntry:{x:31836.0,y:15568.0} },
];
const PASSES = [
  { id:'passTW', name:'台灣中央山口', x:13624.9, y:27096.4, r:820 },
  { id:'passJP', name:'九州中央山口', x:32039.7, y:9363.7, r:820 },
  { id:'passNorth', name:'北部走廊隘口', x:18440.6, y:14806.0, r:820 },
  { id:'passSouth', name:'南部走廊隘口', x:26042.0, y:23695.0, r:820 },
];

// Facility mix is deliberately asymmetric but value-balanced (see score() weights): Taiwan runs more
// forts/depots/watchtowers (army-heavy), Kyushu runs more ports/air bases (navy-heavy). Positions are
// anchored to real cities (Taichung/Taipei/Kaohsiung/Hualien/Keelung; Kumamoto/Fukuoka/Nagasaki/Kagoshima/Oita).
const FACILITIES = [
  {id:'B-HQ', name:'台中・統帥部', type:'HQ', x:11756.6,y:26682.4, side:0, hp:1000, r:1000},
  {id:'B-FORT1', name:'台北要塞', type:'FORT', x:15330.7,y:22542.4, side:0, hp:780, r:820},
  {id:'B-FORT2', name:'花蓮要塞', type:'FORT', x:15493.2,y:27510.4, side:0, hp:780, r:820},
  {id:'B-DEPOT1', name:'台中補給站', type:'DEPOT', x:12656.6,y:26082.4, side:0, hp:480, r:700},
  {id:'B-DEPOT2', name:'高雄補給站', type:'DEPOT', x:10913.2,y:32774.4, side:0, hp:480, r:700},
  {id:'B-AIR', name:'台中空軍基地', type:'AIR', x:10856.6,y:27382.4, side:0, hp:580, r:820},
  {id:'B-PORT1', name:'高雄軍港', type:'PORT', x:10213.2,y:33674.4, side:0, hp:650, r:840},
  {id:'B-PORT2', name:'基隆軍港', type:'PORT', x:16061.8,y:22174.4, side:0, hp:650, r:840},
  {id:'B-FAC1', name:'台灣第一兵工廠', type:'FACTORY', x:13156.6,y:26982.4, side:0, hp:900, r:660},
  {id:'B-FAC2', name:'台灣第二兵工廠', type:'FACTORY', x:14293.2,y:26110.4, side:0, hp:900, r:660},
  {id:'B-RADAR', name:'北部雷達站', type:'RADAR', x:12958.6,y:24164.0, side:0, hp:500, r:590, visionBoost:2400},
  {id:'B-WATCH1', name:'花蓮哨塔', type:'WATCHTOWER', x:14355.5,y:27921.7, side:0, hp:380, r:510, visionBoost:1400},
  {id:'B-WATCH2', name:'基隆哨塔', type:'WATCHTOWER', x:16251.5,y:22387.5, side:0, hp:380, r:510, visionBoost:1400},
  {id:'R-HQ', name:'熊本・統帥部', type:'HQ', x:30212.0,y:10398.7, side:1, hp:1000, r:1000},
  {id:'R-PORT1', name:'福岡軍港', type:'PORT', x:29034.2,y:6718.7, side:1, hp:650, r:840},
  {id:'R-PORT2', name:'長崎軍港', type:'PORT', x:26800.3,y:10582.7, side:1, hp:650, r:840},
  {id:'R-PORT3', name:'鹿兒島軍港', type:'PORT', x:29602.8,y:15872.7, side:1, hp:650, r:840},
  {id:'R-PORT4', name:'大分軍港', type:'PORT', x:33867.4,y:8328.7, side:1, hp:650, r:840},
  {id:'R-AIR1', name:'福岡空軍基地', type:'AIR', x:29734.2,y:7418.7, side:1, hp:580, r:820},
  {id:'R-AIR2', name:'熊本空軍基地', type:'AIR', x:31012.0,y:9698.7, side:1, hp:580, r:820},
  {id:'R-DEPOT', name:'熊本補給站', type:'DEPOT', x:29412.0,y:11098.7, side:1, hp:480, r:700},
  {id:'R-FORT', name:'鹿兒島要塞', type:'FORT', x:30302.8,y:15172.7, side:1, hp:780, r:820},
  {id:'R-FAC1', name:'日本第一兵工廠', type:'FACTORY', x:30912.0,y:11198.7, side:1, hp:900, r:660},
  {id:'R-FAC2', name:'日本第二兵工廠', type:'FACTORY', x:33167.4,y:9028.7, side:1, hp:900, r:660},
  {id:'R-RADAR', name:'長崎雷達站', type:'RADAR', x:27956.1,y:11094.5, side:1, hp:500, r:590, visionBoost:2400},
  {id:'R-WATCH', name:'鹿兒島哨塔', type:'WATCHTOWER', x:31836.0,y:15568.0, side:1, hp:380, r:510, visionBoost:1400},
  {id:'C-PORT', name:'琉球中繼島港', type:'PORT', x:21128.8,y:19782.6, side:-1, hp:420, r:740},
  {id:'N-PASS', name:'北部走廊隘口哨站', type:'FORT', x:18440.6,y:14806.0, side:-1, hp:620, r:700},
  {id:'S-PASS', name:'南部走廊隘口哨站', type:'FORT', x:26042.0,y:23695.0, side:-1, hp:620, r:700},
];

const terrainSpeed={plain:1,road:1.25,urban:.78,forest:.66,hill:.54,mountain:.30,swamp:.52,water:0};
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function pointInPoly(x,y,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];const intersect=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+1e-9)+xi);if(intersect)inside=!inside;}return inside;}
function terrainLandOf(x,y){
  if(pointInPoly(x,y,TAIWAN_POLY))return 'TW';
  if(pointInPoly(x,y,JAPAN_POLY))return 'JP';
  if(pointInPoly(x,y,MID_POLY))return 'MID';
  if(pointInPoly(x,y,NORTH_CORRIDOR_POLY))return 'CN';
  if(pointInPoly(x,y,SOUTH_CORRIDOR_POLY))return 'CS';
  return null;
}
function islandOf(x,y){const l=terrainLandOf(x,y);return (l==='TW'||l==='JP'||l==='MID')?l:null;}
function countryAt(x,y){const isl=islandOf(x,y);return isl==='TW'?0:isl==='JP'?1:-1;}
function onLand(x,y){return terrainLandOf(x,y)!==null;}
function onMid(x,y){return terrainLandOf(x,y)==='MID';}
function terrainAt(x,y){
  const land=terrainLandOf(x,y);
  if(!land)return 'water';
  if(land==='CN'||land==='CS'){
    const p=land==='CN'?CORRIDORS[0].pass:CORRIDORS[1].pass;
    if(Math.hypot(x-p.x,y-p.y)<1100)return 'mountain';
    return 'hill';
  }
  const mountainBand = Math.sin(x/980)+Math.cos(y/1270)+Math.sin((x+y)/1640);
  if(mountainBand>1.35) return 'mountain';
  const urban = (land==='TW'&&Math.hypot(x-15330.7,y-22542.4)<2100)||(land==='JP'&&Math.hypot(x-29034.2,y-6718.7)<2300);
  if(urban)return 'urban';
  const forest = Math.sin(x/500)+Math.cos(y/590)+Math.sin((x-y)/890)>1.1;
  if(forest)return 'forest';
  const hill = Math.sin(x/1230)+Math.cos(y/1020)>0.85;
  if(hill)return 'hill';
  const road = (land==='TW'&&Math.abs(y-26682)<420)||(land==='JP'&&Math.abs(y-10399)<420);
  if(road)return 'road';
  const swamp = land==='TW'&&Math.hypot(x-10500,y-33800)<1500;
  if(swamp)return 'swamp';
  return 'plain';
}
function isLandUnit(q){return !UNIT[q.kind].naval;}
function findShore(sx,sy,tx,ty){let last={x:sx,y:sy};for(let t=0.02;t<=1;t+=0.02){const x=sx+(tx-sx)*t,y=sy+(ty-sy)*t;if(terrainAt(x,y)==='water')last={x,y};else break;}return last;}
function findLandEdge(sx,sy,tx,ty){let last={x:sx,y:sy};for(let t=0.02;t<=1;t+=0.02){const x=sx+(tx-sx)*t,y=sy+(ty-sy)*t;if(terrainAt(x,y)!=='water')last={x,y};else break;}return last;}
function crossesWater(sx,sy,tx,ty){
  const steps=60;
  for(let i=0;i<=steps;i++){const t=i/steps;if(terrainAt(sx+(tx-sx)*t,sy+(ty-sy)*t)==='water')return true;}
  return false;
}
function nearestCorridorRoute(sx,sy,tx,ty){
  let best=null,bd=Infinity;
  for(const c of CORRIDORS){
    const dsA=Math.hypot(sx-c.twEntry.x,sy-c.twEntry.y)+Math.hypot(tx-c.jpEntry.x,ty-c.jpEntry.y);
    const dsB=Math.hypot(sx-c.jpEntry.x,sy-c.jpEntry.y)+Math.hypot(tx-c.twEntry.x,ty-c.twEntry.y);
    const [nearS,nearT]=dsA<=dsB?[c.twEntry,c.jpEntry]:[c.jpEntry,c.twEntry];
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
    const route=nearestCorridorRoute(sx,sy,tx,ty);
    if(route){
      pts.push({x:route.entry.x,y:route.entry.y,kind:'corridor'});
      pts.push({x:route.pass.x,y:route.pass.y,kind:'corridor'});
      pts.push({x:route.exit.x,y:route.exit.y,kind:'corridor'});
    }
  } else if(terrainAt(tx,ty)==='mountain' || terrainAt(sx,sy)==='mountain'){
    const pass=PASSES.slice().sort((a,b)=>Math.hypot(a.x-sx,a.y-sy)+Math.hypot(a.x-tx,a.y-ty)-Math.hypot(b.x-sx,b.y-sy)-Math.hypot(b.x-tx,b.y-ty))[0];
    if(pass && Math.hypot(pass.x-sx,pass.y-sy)+Math.hypot(pass.x-tx,pass.y-ty)<Math.hypot(tx-sx,ty-sy)*1.55)pts.push({x:pass.x,y:pass.y,kind:'pass'});
  }
  pts.push({x:tx,y:ty,kind:'target'});return pts;
}
const TRANSPORT_CAPACITY = 3;
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
// Composition is asymmetric but roughly value-balanced (see UNIT costs): Taiwan starts army-heavy
// (~15,850 in land units, light navy), Kyushu starts navy-heavy (~15,200 in ships, light army) —
// same starting budget, very different opening options for both sides.
function initUnits(s){
  const blue=[['INF',11656.6,27082.4,180],['INF',12856.6,26882.4,180],['INF',12056.6,28282.4,180],['TANK',13256.6,27882.4,60],['TANK',11456.6,28182.4,60],['AT',12656.6,26582.4,75],['FIRE',13456.6,27282.4,40],['RECON',11156.6,27382.4,90],['SF',13056.6,28582.4,80],['PATROL',9526.4,34154.6,24],['TRANSPORT',10477.2,34391.6,20]];
  const red=[['INF',29372.8,11121.2,180],['TANK',30246.7,10583.0,60],['PATROL',28136.8,6426.7,24],['PATROL',29740.7,5326.7,24],['FRIGATE',28466.0,6586.9,40],['FRIGATE',29336.8,5426.7,40],['TRANSPORT',27736.8,6126.7,20],['TRANSPORT',30259.7,5082.8,20]];
  for(const a of blue)addUnit(s,0,...a);for(const a of red)addUnit(s,1,...a);
}
function homePoint(side, kind){
  if(UNIT[kind]?.naval) return side===0?{x:10126.4,y:33854.6}:{x:28936.8,y:6126.7};
  return side===0?{x:12356.6,y:27582.4}:{x:29646.7,y:11083.0};
}

function freshFacilities(){return FACILITIES.map(f=>({...f,control:f.side,capture:[0,0],hpNow:f.hp,destroyed:false}));}
function newState(code){const s={room:code,phase:'PREP',phaseTime:PREP,time:0,result:-1,reason:'',budget:[30000,30000],spent:[0,0],losses:[0,0],units:[],facilities:freshFacilities(),events:[],shots:[],fx:[],weather:'CLEAR',dayPhase:'DAY',front:23100};initUnits(s);event(s,`跨海戰役初始化完成｜${Math.round(LIMIT/60)} 分鐘戰役目標已啟用`,'system');return s;}
function event(s,text,kind='info'){s.events.unshift({id:Date.now()+Math.random(),t:Math.floor(s.time),text,kind});s.events=s.events.slice(0,20);}
function visible(s,q,side){
  if(q.side===side)return true;
  if(s.units.filter(u=>u.active&&u.side===side).some(w=>Math.hypot(w.x-q.x,w.y-q.y)<=w.vision*(s.dayPhase==='NIGHT'?.72:1)))return true;
  return s.facilities.some(f=>f.control===side&&!f.destroyed&&f.visionBoost&&Math.hypot(f.x-q.x,f.y-q.y)<=f.visionBoost);
}
function filtered(r,side){const s=structuredClone(r.state);const known=new Set(s.units.filter(q=>visible(r.state,q,side)).map(q=>q.id));s.units=s.units.filter(q=>known.has(q.id));return s;}
function snap(r){for(const p of r.players)send(p.ws,{t:'snapshot',state:filtered(r,p.side)});}
function makeRoom(ws,name){const code=String(nextRoom++).padStart(4,'0');const p={ws,name,side:0,ready:false,room:code,connected:true};const r={code,players:[p],state:newState(code),started:true,finished:false,ai:true,disconnectTimer:0,lastTick:Date.now()};rooms.set(code,r);ws.player=p;send(ws,{t:'room',code,side:0,mode:'AI'});snap(r);}
function joinRoom(ws,code){const r=rooms.get(String(code).trim());if(!r)return send(ws,{t:'error',message:'找不到房間'});if(r.players.length>=2||r.state.phase!=='PREP')return send(ws,{t:'error',message:'房間已滿或戰鬥已開始'});r.ai=false;const p={ws,name:ws.name||'指揮官',side:1,ready:false,room:r.code,connected:true};r.players.push(p);ws.player=p;send(ws,{t:'room',code:r.code,side:1,mode:'PVP'});broadcast(r,{t:'opponent_joined'});snap(r);}
function tryEarlyStart(r){const ok=r.players.length===2?r.players.every(p=>p.ready):r.players[0]?.ready;if(ok)r.state.phaseTime=Math.min(r.state.phaseTime,2);}
function own(r,p,id){return r.state.units.find(q=>q.id===Number(id)&&q.side===p.side&&q.active);}
function handle(ws,m){
  const t=m?.t,p=ws.player;
  if(t==='hello'){ws.name=String(m.name||'指揮官').slice(0,20);return send(ws,{t:'hello_ok',version:'31.0'});}
  if(t==='create')return makeRoom(ws,ws.name||'指揮官');
  if(t==='join')return joinRoom(ws,m.code);
  if(t==='ready'&&p){p.ready=true;const r=rooms.get(p.room);if(r&&r.state.phase==='PREP'){broadcast(r,{t:'ready',count:r.players.filter(x=>x.ready).length});tryEarlyStart(r);}return;}
  if(!p)return;const r=rooms.get(p.room);if(!r)return;
  if(t==='rematch'&&r.state.phase==='RESULT'){for(const x of r.players)x.ready=false;r.state=newState(r.code);r.started=true;r.finished=false;r.ai=r.players.length===1;broadcast(r,{t:'rematch_lobby'});snap(r);return;}
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
    cancelFerryWait(r.state,q);
    const x=Number(m.x),y=Number(m.y);if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const cx=clamp(x,50,WORLD.w-50),cy=clamp(y,50,WORLD.h-50);
    if(isLandUnit(q)){
      if(!onLand(cx,cy))return send(ws,{t:'error',message:'陸軍無法移動到海上，請先搭乘運輸艦'});
      if(onMid(cx,cy)||onMid(q.x,q.y)){
        if(!tryFerry(r.state,q,cx,cy))return send(ws,{t:'error',message:'前往／離開中繼島需要運輸艦接應'});
        return snap(r);
      }
      if(crossesWater(q.x,q.y,cx,cy)&&tryFerry(r.state,q,cx,cy))return snap(r);
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
        if(crossesWater(q.x,q.y,f.x,f.y)&&tryFerry(r.state,q,f.x,f.y))return snap(r);
      }
      q.target={x:f.x,y:f.y};q.path=buildPath(q,f.x,f.y);q.pathIndex=0;q.intent='ATTACK';q.attackFacility=f.id;q.status='砲擊接近中';return snap(r);
    }
    const b=r.state.units.find(e=>e.id===Number(m.targetId)&&e.side!==p.side&&e.active);if(!b)return;
    if(isLandUnit(q)){
      if(!onLand(b.x,b.y))return send(ws,{t:'error',message:'陸軍無法攻擊海上目標，請改派海軍或先搭乘運輸艦'});
      if(onMid(b.x,b.y)||onMid(q.x,q.y)){if(!tryFerry(r.state,q,b.x,b.y))return send(ws,{t:'error',message:'需要運輸艦接應才能攻擊該目標'});return snap(r);}
      if(crossesWater(q.x,q.y,b.x,b.y)&&tryFerry(r.state,q,b.x,b.y))return snap(r);
    }
    q.target={x:b.x,y:b.y};q.path=buildPath(q,b.x,b.y);q.pathIndex=0;q.intent='ATTACK';q.attackFacility=null;q.status='接敵';return;
  }
  if(t==='stance'&&r.state.phase==='BATTLE'){const q=own(r,p,m.id);if(q){q.stance=['ATTACK','DEFEND','MOBILE'].includes(m.value)?m.value:q.stance;}return snap(r);}
}
function speedFactor(q){const t=terrainAt(q.x,q.y);const naval=UNIT[q.kind].naval;if(t==='water')return naval?1:0;return naval?0:(terrainSpeed[t]||1);}
function stepMove(s,q,dt){if(q.reserve)return;if(!q.path.length)return;const node=q.path[Math.min(q.pathIndex,q.path.length-1)];const dx=node.x-q.x,dy=node.y-q.y,d=Math.hypot(dx,dy);if(d<25){q.pathIndex++;if(q.pathIndex>=q.path.length){q.path=[];q.status=q.intent==='ATTACK'?'交戰位置':'就位';return;}return;}if(d>4)q.heading=Math.atan2(dx,-dy)*180/Math.PI;let sp=UNIT[q.kind].speed*speedFactor(q);if(q.stance==='ATTACK')sp*=1.04;if(q.stance==='DEFEND')sp*=.84;if(q.stance==='MOBILE')sp*=1.18;if(q.suppression>.62)sp*=.58;if(q.morale<.5)sp*=.8;q.x+=dx/d*Math.min(d,sp*dt);q.y+=dy/d*Math.min(d,sp*dt);}
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
function updateFacilities(s,dt){for(const f of s.facilities){if(f.type==='FACTORY'||f.destroyed)continue;const count=[0,0];for(const q of s.units)if(q.active&&!q.reserve&&Math.hypot(q.x-f.x,q.y-f.y)<f.r*.62&&isLandUnit(q))count[q.side]++;if(count[0]&&count[1])continue;const owner=count[0]?0:count[1]?1:-1;if(owner<0)continue;if(f.control!==owner){f.capture[owner]=clamp(f.capture[owner]+dt*(count[owner]*1.6),0,100);f.capture[1-owner]=Math.max(0,f.capture[1-owner]-dt*.7);if(f.capture[owner]>=100){f.control=owner;event(s,`${f.name} 被${owner===0?'藍軍':'紅軍'}攻佔`,'facility');}}}}
function updateFactories(s,dt){
  for(const f of s.facilities){
    if(f.type!=='FACTORY'||f.destroyed)continue;
    f._income=(f._income||0)+dt;
    if(f._income>=FACTORY_INCOME_INTERVAL){f._income-=FACTORY_INCOME_INTERVAL;s.budget[f.side]+=FACTORY_INCOME_AMOUNT;event(s,`${f.name} 挹注軍費 +¥${FACTORY_INCOME_AMOUNT}`,'economy');}
  }
}
function updateFront(s,dt){let balance=0;for(const q of s.units)if(q.active&&isLandUnit(q)){const w=q.personnel*q.morale*(1-q.suppression*.5);balance+=(q.side===0?1:-1)*w;}s.front=clamp(s.front+balance*dt*.015,14000,32500);}
function aiThink(r,dt){
  if(!r.ai||!r.started||r.finished||r.state.phase!=='BATTLE')return;const s=r.state;
  const goTo=(q,tx,ty,intent,status)=>{
    if(isLandUnit(q)){
      if(!onLand(tx,ty)||onMid(tx,ty))return;
      q.attackFacility=null;
    }
    q.target={x:tx,y:ty};q.path=buildPath(q,tx,ty);q.pathIndex=0;q.intent=intent;q.status=status;
  };
  for(const q of s.units){
    if(!q.active||q.side!==1||q.reserve||q.carrier||q.kind==='TRANSPORT'||q._invade)continue;
    q._ai=(q._ai||0)-dt;if(q._ai>0)continue;q._ai=2+Math.random()*3;
    const enemy=s.units.filter(e=>e.active&&e.side===0);
    const seen=enemy.find(e=>visible(s,e,1)&&Math.hypot(e.x-q.x,e.y-q.y)<UNIT[q.kind].range*1.35);
    if(seen){goTo(q,seen.x,seen.y,'ATTACK','AI 接敵');continue;}
    const fac=s.facilities.filter(f=>f.control!==1&&f.type!=='FACTORY'&&!f.destroyed).sort((a,b)=>Math.hypot(q.x-a.x,q.y-a.y)-Math.hypot(q.x-b.x,q.y-b.y))[0];
    if(fac){goTo(q,fac.x,fac.y,'CAPTURE','AI 奪取設施');continue;}
    const tx=WORLD.w*0.62+Math.random()*WORLD.w*0.14,ty=WORLD.h*0.15+Math.random()*WORLD.h*0.2;goTo(q,tx,ty,q.intent,'AI 機動');
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
  const target=s.facilities.filter(f=>f.control!==1&&f.type!=='FACTORY'&&!f.destroyed).sort((a,b)=>Math.hypot(a.x-port.x,a.y-port.y)-Math.hypot(b.x-port.x,b.y-port.y))[0]||s.facilities.find(f=>f.type==='HQ'&&f.side===0);
  if(!target)return;
  for(const u of wave){u._invade={x:target.x,y:target.y};u.target={x:port.x,y:port.y};u.path=buildPath(u,port.x,port.y);u.pathIndex=0;u.intent='ATTACK';u.status='AI 集結上船';}
  const escorts=s.units.filter(u=>u.active&&u.side===1&&(u.kind==='FRIGATE'||u.kind==='PATROL')&&!u.reserve&&!u.carrier&&u.intent!=='ATTACK');
  const midX=(port.x+target.x)/2, midY=(port.y+target.y)/2;
  for(const e of escorts){e.target={x:midX,y:midY};e.path=buildPath(e,midX,midY);e.pathIndex=0;e.intent='ESCORT';e.status='AI 護航中';}
  event(s,'紅軍發動跨海登陸作戰，艦隊已出港','system');
}
function victory(s){const hq=s.facilities.filter(f=>f.type==='HQ');if(hq.every(f=>f.control!==0))return 1;if(hq.every(f=>f.control!==1))return 0;const alive=[0,1].map(side=>s.units.some(q=>q.side===side&&q.active&&!q.reserve));if(!alive[0])return 1;if(!alive[1])return 0;return -1;}
function score(s){let p=[0,0];for(const q of s.units)if(q.active)p[q.side]+=q.personnel*q.morale*(1-q.suppression*.4);for(const f of s.facilities)if(f.control>=0)p[f.control]+=f.type==='HQ'?1200:f.type==='FORT'?550:f.type==='FACTORY'?450:f.type==='RADAR'?300:f.type==='WATCHTOWER'?200:260; p[0]+=s.losses[1]*30;p[1]+=s.losses[0]*30;return p[0]>=p[1]?0:1;}
function finish(r,w,reason){if(r.finished)return;r.finished=true;r.state.phase='RESULT';r.state.result=w;r.state.reason=reason;event(r.state,`${w===0?'藍軍':'紅軍'} 勝利｜${reason}`,'result');broadcast(r,{t:'result',winner:w,reason});snap(r);}
// Snapshot broadcasts are throttled independently of the simulation tick (TICK stays 20Hz for
// physics/combat smoothness) purely to cut WebSocket bandwidth: PREP only needs to be smooth
// enough for a countdown timer, BATTLE needs to still read as fluid combat.
const PREP_SNAP_EVERY = 6;   // ~3.3Hz
const BATTLE_SNAP_EVERY = 2; // ~10Hz
function tick(r,dt){if(!r.started||r.finished)return;const s=r.state;r._tickCount=(r._tickCount||0)+1;if(s.phase==='PREP'){s.phaseTime=Math.max(0,s.phaseTime-dt);if(s.phaseTime<=0){s.phase='BATTLE';event(s,'戰鬥開始｜所有建軍介面關閉','system');broadcast(r,{t:'battle_live'});}if(r._tickCount%PREP_SNAP_EVERY===0)snap(r);return;}s.time+=dt;s.dayPhase=s.time<DAY_END?'DAY':s.time<DUSK_END?'DUSK':s.time<NIGHT_END?'NIGHT':'DAWN';s.weather=Math.floor(s.time/180)%5===3?'RAIN':'CLEAR';for(const q of s.units)if(q.active)stepMove(s,q,dt);updateFerries(s);updateFerryDispatch(s);combat(s,dt);updateFacilities(s,dt);updateFactories(s,dt);updateFront(s,dt);aiThink(r,dt);aiInvasionPlanner(r,dt);for(const fx of s.fx)fx.t-=dt;s.fx=s.fx.filter(f=>f.t>0);const w=victory(s);if(w>=0)return finish(r,w,w===0?'紅軍全滅／主城失守':'藍軍全滅／主城失守');if(s.time>=LIMIT)return finish(r,score(s),`${Math.round(LIMIT/60)} 分鐘戰役結算`);if(r._tickCount%BATTLE_SNAP_EVERY===0)snap(r);}

const server=http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,rooms:rooms.size,version:'31.0'}));}let p=req.url?.split('?')[0]||'/';if(p==='/')p='/index.html';p=normalize(p).replace(/^\.\.(\/|\\)/,'');const file=pathJoin(process.cwd(),'public',p);if(!existsSync(file)){res.writeHead(404);return res.end('Not found');}const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};const cache=p.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache';res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':cache});res.end(readFileSync(file));});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{ws.name='指揮官';ws.on('message',b=>{try{handle(ws,JSON.parse(b.toString()));}catch(err){console.error(err);send(ws,{t:'error',message:'伺服器處理指令失敗'});}});ws.on('close',()=>{const p=ws.player;if(!p)return;const r=rooms.get(p.room);if(r&&r.players.length===2&&!r.finished){r.disconnectTimer=30;p.connected=false;}});send(ws,{t:'server_ok',protocol:30});});
function send(ws,m){try{if(ws.readyState===1)ws.send(JSON.stringify(m));}catch{}}
function broadcast(r,m){for(const p of r.players)send(p.ws,m);}
setInterval(()=>{const now=Date.now();for(const r of rooms.values()){const dt=Math.min(.2,(now-(r.lastTick||now))/1000);r.lastTick=now;tick(r,dt);}},1000*TICK);
server.listen(PORT,()=>console.log(`TACTICAL BORDER v31 Cross-Strait listening on ${PORT}`));
