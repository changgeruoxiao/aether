import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $=id=>document.getElementById(id);
const state={speed:1,glow:.7,explode:0,playing:!matchMedia('(prefers-reduced-motion: reduce)').matches,auto:false,particles:true,color:'cyan',sound:false};
const colors={cyan:0x77dfc9,amber:0xffb765,violet:0xb4a0ff};
const container=$('viewport');
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(36,1,.1,80);
camera.position.set(.3,.75,12.5);
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance',preserveDrawingBuffer:true});}
catch(error){$('loading').innerHTML='<span>无法启动 3D 渲染，请开启浏览器硬件加速后刷新。</span>';throw error;}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));
renderer.setClearColor(0x000000,0);
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=.85;
container.appendChild(renderer.domElement);
renderer.domElement.tabIndex=0;
renderer.domElement.setAttribute('aria-label','机械蝴蝶三维视图。拖动旋转，滚轮缩放；方向键旋转，加减号缩放。');
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=.065;controls.enablePan=false;
controls.minDistance=5.0;controls.maxDistance=19;controls.autoRotateSpeed=.65;
controls.target.set(0,.2,0);
const pmrem=new THREE.PMREMGenerator(renderer);
const room=new RoomEnvironment();
const env=pmrem.fromScene(room,.04);
scene.environment=env.texture;
scene.environmentIntensity=.65;
room.dispose();pmrem.dispose();
scene.add(new THREE.AmbientLight(0xb6c6bc,.5));
const key=new THREE.DirectionalLight(0xffe0a3,2.5);key.position.set(-3,5,7);scene.add(key);
const cool=new THREE.DirectionalLight(0x94d1d3,1.5);cool.position.set(5,1,4);scene.add(cool);
const rim=new THREE.DirectionalLight(0xffb45d,1.8);rim.position.set(1,-4,-2);scene.add(rim);
const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(900,700),.3,.45,1.15);
composer.addPass(bloom);composer.addPass(new OutputPass());

const mat={
 gold:new THREE.MeshStandardMaterial({color:0x99703e,metalness:.88,roughness:.29}),
 edge:new THREE.MeshStandardMaterial({color:0xdac18e,metalness:.82,roughness:.24}),
 dark:new THREE.MeshStandardMaterial({color:0x273d38,metalness:.86,roughness:.32}),
 copper:new THREE.MeshStandardMaterial({color:0x895737,metalness:.9,roughness:.3}),
 steel:new THREE.MeshStandardMaterial({color:0xa6b8ae,metalness:.94,roughness:.22}),
 black:new THREE.MeshStandardMaterial({color:0x101a19,metalness:.75,roughness:.3}),
 light:new THREE.MeshStandardMaterial({color:0x72c3ae,emissive:colors.cyan,emissiveIntensity:2.0,metalness:.35,roughness:.2}),
 glass:new THREE.MeshPhysicalMaterial({color:0x20524a,metalness:.5,roughness:.22,transparent:true,opacity:.2,side:THREE.DoubleSide,depthWrite:false}),
 membrane:new THREE.MeshStandardMaterial({color:0x234b43,metalness:.6,roughness:.35,transparent:true,opacity:.31,side:THREE.DoubleSide,depthWrite:false}),
};
const model=new THREE.Group();model.rotation.set(-.08,-.08,-.02);scene.add(model);
const gears=[],wings=[],energyOrbs=[];
let meshCount=0;
const V=(x,y,z=0)=>new THREE.Vector3(x,y,z);
function mesh(g,m,p,x=0,y=0,z=0){const o=new THREE.Mesh(g,m);o.position.set(x,y,z);p.add(o);meshCount++;return o;}
function tube(points,r,m,parent,closed=false){const curve=new THREE.CatmullRomCurve3(points.map(p=>Array.isArray(p)?V(...p):p),closed,'centripetal');return mesh(new THREE.TubeGeometry(curve,Math.max(12,points.length*7),r,6,closed),m,parent);}
function rod(a,b,r,m,parent){const av=Array.isArray(a)?V(...a):a,bv=Array.isArray(b)?V(...b):b;const d=bv.clone().sub(av);const o=mesh(new THREE.CylinderGeometry(r,r,d.length(),6),m,parent);o.position.copy(av.clone().add(bv).multiplyScalar(.5));o.quaternion.setFromUnitVectors(V(0,1,0),d.normalize());return o;}
function ring(r,t,m,parent,x=0,y=0,z=0){return mesh(new THREE.TorusGeometry(r,t,6,64),m,parent,x,y,z);}
function bead(x,y,z,r,m,parent){return mesh(new THREE.SphereGeometry(r,10,8),m,parent,x,y,z);}
function bolt(parent,x,y,z,r=.028){const b=mesh(new THREE.CylinderGeometry(r,r,.027,6),mat.steel,parent,x,y,z);b.rotation.x=Math.PI/2;rod([x-r*.55,y,z+.016],[x+r*.55,y,z+.016],.004,mat.black,parent);}
// Collapse stationary parts by material: thousands of modeled pieces, few draw calls.
function batch(group){group.updateMatrixWorld(true);const byMat=new Map();for(const child of [...group.children]){if(!child.isMesh)continue;child.updateMatrix();const g=child.geometry.clone().applyMatrix4(child.matrix);if(!byMat.has(child.material))byMat.set(child.material,[]);byMat.get(child.material).push(g);group.remove(child);child.geometry.dispose();}for(const [m,geometries] of byMat){const g=mergeGeometries(geometries.map(g=>g.index?g.toNonIndexed():g));mesh(g,m,group);geometries.forEach(g=>g.dispose());}}

// A constant tooth module lets neighboring gears share the same pitch.
const moduleSize=.055;
function gear(parent,x,y,teeth=20,ratio=1,z=.16){
 const pitch=teeth*moduleSize/2,root=pitch-moduleSize*1.25,tip=pitch+moduleSize;
 const pressure=20*Math.PI/180,base=pitch*Math.cos(pressure);
 const involute=a=>Math.tan(a)-a;
 const halfAngle=r=>Math.PI/(2*teeth)+involute(pressure)-involute(Math.acos(Math.min(1,base/r)));
 const shape=new THREE.Shape();
 for(let i=0;i<teeth;i++){
  const center=i/teeth*Math.PI*2;
  const point=(r,a,first=false)=>{const x=Math.cos(a)*r,y=Math.sin(a)*r;if(first)shape.moveTo(x,y);else shape.lineTo(x,y);};
  point(root,center-halfAngle(base),i===0);
  for(let j=0;j<=5;j++){const r=base+(tip-base)*j/5;point(r,center-halfAngle(r));}
  for(let j=0;j<=4;j++)point(tip,center-halfAngle(tip)+2*halfAngle(tip)*j/4);
  for(let j=5;j>=0;j--){const r=base+(tip-base)*j/5;point(r,center+halfAngle(r));}
  point(root,center+halfAngle(base));
 }
 shape.closePath();
 const hole=new THREE.Path();hole.absarc(0,0,pitch*.63,0,Math.PI*2,true);shape.holes.push(hole);
 const assembly=new THREE.Group();assembly.position.set(x,y,z);parent.add(assembly);
 const detail=new THREE.Group();assembly.add(detail);
 mesh(new THREE.ExtrudeGeometry(shape,{depth:.058,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.008,bevelThickness:.008}),mat.gold,detail);
 ring(pitch*.69,.013,mat.edge,detail,0,0,.07);ring(pitch*.89,.009,mat.copper,detail,0,0,.073);
 for(let i=0;i<6;i++){const a=i*Math.PI/3;rod([Math.cos(a)*pitch*.16,Math.sin(a)*pitch*.16,.035],[Math.cos(a)*pitch*.69,Math.sin(a)*pitch*.69,.035],.025,mat.gold,detail);bolt(detail,Math.cos(a)*pitch*.79,Math.sin(a)*pitch*.79,.08,.018);}
 ring(pitch*.18,.025,mat.edge,detail,0,0,.063);
 const hub=mesh(new THREE.CylinderGeometry(pitch*.16,pitch*.16,.13,20),mat.dark,detail,0,0,.046);hub.rotation.x=Math.PI/2;
 bolt(detail,0,0,.125,.038);batch(detail);
 assembly.rotation.z=ratio<0?Math.PI/teeth:0;
 gears.push({object:assembly,teeth,ratio,phase:assembly.rotation.z});
 return assembly;
}
function spiral(parent,x,y,r,z,turns=3){const points=[];for(let i=0;i<=190;i++){const t=i/190,a=t*Math.PI*2*turns,rr=.022+t*r;points.push([x+Math.cos(a)*rr,y+Math.sin(a)*rr,z]);}tube(points,.009,mat.steel,parent);}

function makeWing(side){
 const pivot=new THREE.Group();pivot.position.set(side*.18,.3,0);pivot.scale.x=side;model.add(pivot);
 const frame=new THREE.Group(),detail=new THREE.Group(),mechanism=new THREE.Group();pivot.add(frame,detail,mechanism);
 const upper=new THREE.Shape();upper.moveTo(0,0);upper.bezierCurveTo(.36,1.28,1.47,2.54,3.13,2.73);upper.bezierCurveTo(3.36,2.71,3.21,1.94,2.84,1.3);upper.bezierCurveTo(2.41,.52,1.28,-.48,0,0);
 const lower=new THREE.Shape();lower.moveTo(.02,-.05);lower.bezierCurveTo(.85,.14,2.01,-.3,2.46,-.78);lower.bezierCurveTo(2.6,-1.01,2.12,-1.22,1.9,-1.55);lower.bezierCurveTo(1.62,-1.95,1.37,-2.58,1.0,-2.39);lower.bezierCurveTo(.38,-2.05,.08,-.88,.02,-.05);
 for(const [s,k] of [[upper,0],[lower,1]]){
  const pane=mesh(new THREE.ShapeGeometry(s,48),mat.glass,frame,0,0,-.035);
  pane.userData.wing=true;
  const pts=s.getPoints(75).map(p=>V(p.x,p.y,0));
  tube(pts,.031,mat.gold,frame,true);
  tube(pts.map(p=>V(p.x*.967,p.y*.967,.025)),.009,mat.edge,frame,true);
  tube(pts.map(p=>V(p.x*.94,p.y*.94,-.085)),.018,mat.copper,detail,true);
  // Riveted double frame and a sparse line of fiber-optic tip lights.
  for(let i=0;i<pts.length;i+=7){const p=pts[i];bolt(frame,p.x,p.y,.041,.023);if(i%14===0)rod([p.x,p.y,-.095],[p.x,p.y,.045],.012,mat.gold,detail);}
 }
 const root=V(.12,.06,.035);
 const upperTips=[[.89,1.63],[1.3,2.08],[1.78,2.4],[2.27,2.58],[2.77,2.69],[3.16,2.54],[3.14,2.04],[2.92,1.49],[2.63,.98],[2.15,.43],[1.54,.02]];
 upperTips.forEach(([x,y],i)=>{
   const p1=V(x*.3+.06,y*.37,.08),p2=V(x*.76,y*.73,.055),tip=V(x,y,0);
   tube([root,p1,p2,tip],i%3===0?.023:.014,i%3===0?mat.edge:mat.gold,frame);
   tube([V(.35,.18,.07),V(x*.4,y*.41+.05,.10),V(x*.78,y*.76+.03,.066),V(x*.98,y*.98,.04)],.006,mat.light,detail);
   // Individually machined narrow wing scales surround the primary veins.
   for(let j=0;j<3;j++){
    const t=.52+j*.135,px=x*t,py=y*t;
    tube([[px-.07,py-.065,.02],[px+.03,py+.06,.04],[x*(t+.07),y*(t+.07),.02]],.009,mat.copper,frame);
   }
   const leaf=new THREE.Shape();leaf.moveTo(x*.48,y*.48);leaf.quadraticCurveTo(x*.72-.13,y*.74+.08,x*.94,y*.95);leaf.quadraticCurveTo(x*.75+.065,y*.71-.07,x*.48,y*.48);
   mesh(new THREE.ShapeGeometry(leaf,12),mat.membrane,frame,0,0,.012);
   bead(x*.93,y*.93,.04,.023,mat.light,detail);
 });
 const lowerTips=[[2.36,-.79],[1.98,-1.2],[1.64,-1.79],[1.16,-2.35],[.7,-2.03],[.37,-1.33]];
 lowerTips.forEach(([x,y],i)=>{
  tube([[.13,-.12,.05],[x*.51,y*.31,.09],[x*.85,y*.7,.065],[x,y,0]],.018,mat.gold,frame);
  tube([[.2,-.17,.07],[x*.51+.03,y*.35,.10],[x*.87,y*.76,.09],[x*.97,y*.98,.04]],.007,mat.light,detail);
  const points=[];for(let j=0;j<20;j++){const a=j/19*Math.PI;points.push([x*.62+Math.cos(a)*.12,y*.68+Math.sin(a)*.23,.06]);}tube(points,.01,mat.edge,frame);
  bead(x*.96,y*.95,.055,.027,mat.light,detail);
 });
 // Transverse ribs form a reticulated, multilayer wing instead of a flat silhouette.
 for(let t=.52;t<.94;t+=.135){tube(upperTips.map(([x,y])=>[x*t,y*t,.03]),.009,mat.gold,frame);tube(lowerTips.map(([x,y])=>[x*t,y*t,-.035]),.009,mat.copper,detail);}
 // A visible gear train: center distance equals the sum of pitch radii.
 const train=[[.53,.24,18,1],[1.31,.56,13,-1],[1.50,1.20,11,1],[2.08,1.33,11,-1],[2.56,1.70,11,1]];
 // Exact tangent placement preserves the intended direction of each link.
 for(let i=1;i<train.length;i++){const prev=train[i-1],c=train[i];const angle=Math.atan2(c[1]-prev[1],c[0]-prev[0]);const d=(prev[2]+c[2])*moduleSize/2;c[0]=prev[0]+Math.cos(angle)*d;c[1]=prev[1]+Math.sin(angle)*d;}
  let previous=null;
  for(const [x,y,n,dir] of train){ring(n*moduleSize/2+.05,.012,mat.dark,frame,x,y,-.045);gear(mechanism,x,y,n,dir,.12);const current=gears.at(-1);if(previous){const a=Math.atan2(y-previous.y,x-previous.x);current.phase=(previous.gear.teeth*(a-previous.gear.phase)+n*(a+Math.PI)-Math.PI)/n;}previous={x,y,gear:current};rod([x-.14,y,-.075],[x+.14,y,-.075],.036,mat.dark,frame);}
 const lowerTrain=[[.55,-.53,16,-1],[1.11,-1.09,13,1],[1.14,-1.72,10,-1]];
 for(let i=1;i<lowerTrain.length;i++){const p=lowerTrain[i-1],c=lowerTrain[i],a=Math.atan2(c[1]-p[1],c[0]-p[0]),d=(p[2]+c[2])*moduleSize/2;c[0]=p[0]+Math.cos(a)*d;c[1]=p[1]+Math.sin(a)*d;}
 previous=null;for(const [x,y,n,dir] of lowerTrain){gear(mechanism,x,y,n,dir,.13);const current=gears.at(-1);if(previous){const a=Math.atan2(y-previous.y,x-previous.x);current.phase=(previous.gear.teeth*(a-previous.gear.phase)+n*(a+Math.PI)-Math.PI)/n;}previous={x,y,gear:current};}
 spiral(detail,.53,.24,.20,.30,3.7);spiral(detail,.55,-.53,.16,.28,3);
 // Open-work brass bridges, pivots, and actuator pistons.
 for(const [x,y] of [[.53,.24],[1.31,.56],[.55,-.53],[1.11,-1.09]]){
  tube([[x-.28,y-.12,.25],[x-.15,y-.18,.31],[x+.1,y+.13,.31],[x+.28,y+.12,.25]],.021,mat.edge,detail);
  bolt(detail,x-.25,y-.1,.28);bolt(detail,x+.25,y+.1,.28);
 }
 rod([.07,.16,.18],[.77,1.3,.18],.038,mat.dark,frame);rod([.34,.59,.18],[.82,1.42,.18],.019,mat.steel,detail);
 for(let i=0;i<7;i++){const t=i/7;ring(.045,.008,mat.gold,detail,.16+t*.31,.31+t*.55,.18).rotation.x=Math.PI/2;}
 for(let i=0;i<5;i++){const a=i*1.256;bead(.53+Math.cos(a)*.25,.24+Math.sin(a)*.25,.31,.019,mat.light,detail);}
 batch(frame);batch(detail);
 wings.push({pivot,frame,detail,mechanism,side});
}
makeWing(-1);makeWing(1);

const body=new THREE.Group();model.add(body);
const bodyStatic=new THREE.Group();body.add(bodyStatic);
// Caged thorax and segmented abdominal armor.
const thorax=mesh(new THREE.SphereGeometry(.27,24,16),mat.black,bodyStatic,0,.28,.10);thorax.scale.set(.85,1.55,.8);
for(const s of [-1,1]){
 tube([[s*.1,.78,.16],[s*.29,.46,.2],[s*.3,.02,.17],[s*.16,-.3,.14]],.032,mat.edge,bodyStatic);
 tube([[s*.1,.78,-.03],[s*.28,.4,-.15],[s*.19,-.3,-.03]],.023,mat.copper,bodyStatic);
 for(let i=0;i<4;i++)rod([s*.08,.67-i*.22,.27],[s*.27,.49-i*.19,.13],.015,mat.gold,bodyStatic);
 // Articulated tarsi stay delicate enough to read as an insect.
 for(let i=0;i<3;i++){const y=.26-i*.29;const points=[[s*.17,y,.05],[s*.44,y-.12,.24],[s*.64,y-.41,.34],[s*.5,y-.65,.29]];tube(points,.013,mat.copper,bodyStatic);bead(s*.44,y-.12,.24,.032,mat.gold,bodyStatic);bead(s*.64,y-.41,.34,.025,mat.steel,bodyStatic);}
}
gear(body,0,.23,13,1,.28);gear(body,0,-.36,8,-1,.23);
ring(.29,.014,mat.edge,bodyStatic,0,.23,.42);spiral(bodyStatic,0,.23,.15,.44,4.4);
for(let i=0;i<9;i++){const y=-.62-i*.115,r=.145*(1-i*.076);const o=mesh(new THREE.SphereGeometry(r,16,10),i%2?mat.dark:mat.gold,bodyStatic,0,y,.04);o.scale.set(1,.53,.8);ring(r*.86,.012,mat.edge,bodyStatic,0,y,.04).rotation.x=Math.PI/2;bead(0,y,.15,.024-i*.0018,mat.light,bodyStatic);}
tube([[0,-.6,.14],[0,-1.1,.15],[0,-1.63,.08]],.014,mat.light,bodyStatic);
const head=mesh(new THREE.SphereGeometry(.17,20,14),mat.gold,bodyStatic,0,.92,.1);head.scale.set(1,.85,.8);
for(const s of [-1,1]){bead(s*.125,.97,.19,.068,mat.dark,bodyStatic);bead(s*.132,.988,.24,.036,mat.light,bodyStatic);tube([[s*.085,1.04,.1],[s*.21,1.38,.06],[s*.54,1.68,.06],[s*.69,1.71,.13],[s*.71,1.58,.14]],.014,mat.edge,bodyStatic);bead(s*.71,1.58,.14,.043,mat.light,bodyStatic);}
batch(bodyStatic);

// Technical meridians, quiet enough to leave the specimen in focus.
const stage=new THREE.Group();scene.add(stage);stage.position.set(0,.12,-1.0);
const lineMat=new THREE.LineBasicMaterial({color:0x53644f,transparent:true,opacity:.22});
for(const radius of [2.92,3.16,3.64]){const points=[];for(let i=0;i<160;i++){const a=i/159*Math.PI*2;points.push(V(Math.cos(a)*radius,Math.sin(a)*radius,0));}const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),lineMat);stage.add(l);}
const marks=[];for(let i=0;i<144;i++){const a=i/144*Math.PI*2,r=3.18;marks.push(V(Math.cos(a)*r,Math.sin(a)*r,0),V(Math.cos(a)*(r+(i%6===0?.08:.03)),Math.sin(a)*(r+(i%6===0?.08:.03)),0));}
stage.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(marks),lineMat));
const groundRing=ring(3.0,.007,new THREE.MeshBasicMaterial({color:0x5d7553,transparent:true,opacity:.15}),scene,0,-2.85,-.2);groundRing.rotation.x=Math.PI/2;groundRing.scale.set(1.2,1,1);

// A seeded field makes the initial composition reproducible.
let seed=3401;function random(){seed=(seed*16807)%2147483647;return(seed-1)/2147483646;}
const particleCount=160,positions=new Float32Array(particleCount*3),particleBase=[];
for(let i=0;i<particleCount;i++){const p=[(random()-.5)*10,(random()-.5)*7,(random()-.5)*5];particleBase.push(p);positions.set(p,i*3);}
const pGeometry=new THREE.BufferGeometry();pGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
const pMaterial=new THREE.PointsMaterial({color:0xc3c99c,size:.018,transparent:true,opacity:.6,blending:THREE.AdditiveBlending,depthWrite:false});
const particles=new THREE.Points(pGeometry,pMaterial);scene.add(particles);

let time=0,last=performance.now(),explosion=0,pulse=0,selectedWing=null;
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),2400);}
function rangeStyle(input){input.style.setProperty('--progress',`${(input.value-input.min)/(input.max-input.min)*100}%`);}
function updateRange(id,value){const input=$(id);input.value=value;rangeStyle(input);$(id+'-value').innerHTML=id==='speed'?`${(+value).toFixed(1)} <span>×</span>`:`${value} <span>%</span>`;}
for(const id of ['speed','glow','explode']){$(id).addEventListener('input',e=>{const v=+e.target.value;state[id]=id==='speed'?v:v/100;updateRange(id,v);});rangeStyle($(id));}
function syncPlay(){ $('play-icon').innerHTML=state.playing?'<path d="M8 5v14M16 5v14"/>':'<path d="m8 5 10 7-10 7Z"/>';$('play').setAttribute('aria-label',state.playing?'暂停动画':'继续动画');$('play-label').textContent=state.playing?'自由振翅':'静止观察';$('play-subtitle').textContent=state.playing?'FLIGHT MODE':'OBSERVATION MODE';$('state-label').textContent=state.playing?'生命系统运行中':'生命系统已暂停';}
$('play').onclick=()=>{state.playing=!state.playing;syncPlay();};syncPlay();
for(const [id,key] of [['autorotate','auto'],['particles','particles']])$(id).onclick=()=>{state[key]=!state[key];$(id).setAttribute('aria-checked',String(state[key]));};
function setColor(name){state.color=name;mat.light.emissive.set(colors[name]);mat.light.color.set(colors[name]);mat.glass.color.set(colors[name]).multiplyScalar(.22);mat.membrane.color.set(colors[name]).multiplyScalar(.25);pMaterial.color.set(colors[name]);document.querySelectorAll('.swatch').forEach(b=>{const on=b.dataset.color===name;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});}
document.querySelectorAll('.swatch').forEach(b=>b.onclick=()=>setColor(b.dataset.color));
let cameraTween=null;
function setView(name){const target=name==='side'?V(9,2,6):name==='focus'?V(.6,.8,5.3):V(.3,.75,12.5);cameraTween={from:camera.position.clone(),to:target,fromTarget:controls.target.clone(),target:V(0,.2,0),start:performance.now()};document.querySelectorAll('.view-button').forEach(b=>b.classList.toggle('active',b.id===(name==='focus'?'focus':'view-'+name)));state.auto=false;$('autorotate').setAttribute('aria-checked','false');}
$('view-front').onclick=()=>setView('front');$('view-side').onclick=()=>setView('side');$('focus').onclick=()=>setView('focus');
controls.addEventListener('start',()=>{cameraTween=null;document.querySelectorAll('.view-button').forEach(b=>b.classList.remove('active'));});
$('reset').onclick=()=>{Object.assign(state,{speed:1,glow:.7,explode:0,playing:true,auto:false,particles:true});updateRange('speed',1);updateRange('glow',70);updateRange('explode',0);$('particles').setAttribute('aria-checked','true');setColor('cyan');setView('front');syncPlay();toast('机械系统已恢复初始状态');};
$('fullscreen').onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch{toast('当前浏览器不支持全屏模式');}};
document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'退出全屏':'全屏显示');});
let audioContext=null,audioGain=null,audioNodes=[];
$('sound').onclick=async()=>{try{if(!audioContext){audioContext=new AudioContext();audioGain=audioContext.createGain();audioGain.gain.value=0;audioGain.connect(audioContext.destination);for(const [frequency,type,gain] of [[78,'sine',.13],[156,'triangle',.015],[312,'sine',.009]]){const o=audioContext.createOscillator(),g=audioContext.createGain();o.frequency.value=frequency;o.type=type;g.gain.value=gain;o.connect(g);g.connect(audioGain);o.start();audioNodes.push(o);}}await audioContext.resume();state.sound=!state.sound;audioGain.gain.setTargetAtTime(state.sound?.24:0,audioContext.currentTime,.3);$('sound').setAttribute('aria-label',state.sound?'关闭机械音效':'开启机械音效');$('sound').setAttribute('aria-pressed',String(state.sound));$('sound').innerHTML=state.sound?'<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4zM15 8q5 4 0 8m3-11q8 7 0 14"/></svg>':'<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6m0-6-5 6"/></svg>';toast(state.sound?'机械共鸣已开启':'机械共鸣已关闭');}catch{toast('音频暂时不可用');}};
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let pointerDown=null;
renderer.domElement.addEventListener('pointerdown',e=>pointerDown={x:e.clientX,y:e.clientY});
renderer.domElement.addEventListener('pointerup',e=>{if(!pointerDown||Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)>6)return;const r=container.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObject(model,true);if(hits.length){pulse=1;const point=model.worldToLocal(hits[0].point.clone());selectedWing=point.x<0?-1:1;toast('能量已注入 · 翼脉共鸣');}});
renderer.domElement.addEventListener('keydown',e=>{const offset=camera.position.clone().sub(controls.target),s=new THREE.Spherical().setFromVector3(offset);if(e.key==='ArrowLeft')s.theta-=.12;else if(e.key==='ArrowRight')s.theta+=.12;else if(e.key==='ArrowUp')s.phi=Math.max(.1,s.phi-.12);else if(e.key==='ArrowDown')s.phi=Math.min(Math.PI-.1,s.phi+.12);else if(e.key==='+'||e.key==='=')s.radius=Math.max(5,s.radius-.5);else if(e.key==='-')s.radius=Math.min(19,s.radius+.5);else if(e.code==='Space'){$('play').click();e.preventDefault();return;}else return;e.preventDefault();camera.position.copy(V().setFromSpherical(s).add(controls.target));});

function resize(){const w=container.clientWidth,h=container.clientHeight;camera.aspect=w/h;renderer.setSize(w,h);composer.setSize(w,h);camera.fov=w<600?38:36;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(container);resize();
let frameCount=0;
function animate(now){requestAnimationFrame(animate);const dt=Math.min((now-last)/1000,.05);last=now;
 if(document.hidden)return;
 if(state.playing)time+=dt*state.speed;
 explosion=THREE.MathUtils.damp(explosion,state.explode,5,dt);pulse=Math.max(0,pulse-dt*.65);
 for(const w of wings){const flutter=Math.sin(time*2.8)*.20+.13+Math.sin(time*5.6)*.035;w.pivot.rotation.y=w.side*(flutter+(w.side===selectedWing?Math.sin(pulse*Math.PI)*.18:0));w.pivot.rotation.z=w.side*Math.sin(time*2.8-.18)*.018;w.pivot.position.x=w.side*(.18+explosion*.72);w.detail.position.z=explosion*.75;w.mechanism.position.z=explosion*.42;}
 for(const g of gears)g.object.rotation.z=g.phase+time*g.ratio*(18/g.teeth)*.42;
 model.position.y=Math.sin(time*1.4)*.075;model.rotation.z=-.025+Math.sin(time*.66)*.016;
 mat.light.emissiveIntensity=(state.glow*3.0)*(1+Math.sin(time*2)*.12)+pulse*2;
 bloom.strength=state.glow*.36+pulse*.35;
 particles.visible=state.particles;
 if(state.particles){for(let i=0;i<particleCount;i++){const p=particleBase[i];positions[i*3]=p[0]+Math.sin(time*.14+i)*.12;positions[i*3+1]=((p[1]+time*.09+3.5)%7)-3.5;positions[i*3+2]=p[2]+Math.cos(time*.12+i)*.12;}pGeometry.attributes.position.needsUpdate=true;}
 controls.autoRotate=state.auto&&state.playing;
 if(cameraTween){const t=Math.min(1,(now-cameraTween.start)/1050),e=1-Math.pow(1-t,3);camera.position.lerpVectors(cameraTween.from,cameraTween.to,e);controls.target.lerpVectors(cameraTween.fromTarget,cameraTween.target,e);if(t===1)cameraTween=null;}
 controls.update();
 if(audioContext&&state.sound){audioGain.gain.setTargetAtTime(state.playing?.21+Math.sin(time*2.8)*.04:.035,audioContext.currentTime,.1);audioNodes.forEach((o,i)=>o.frequency.setTargetAtTime([78,156,312][i]*(.8+state.speed*.2),audioContext.currentTime,.2));}
 composer.render();if(++frameCount===2)$('loading').classList.add('hidden');
}
requestAnimationFrame(animate);
$('gear-count').textContent=`${gears.length} 枚联动齿轮`;
// A small inspection API also backs the site's structured interaction tools.
window.butterfly={getState:()=>({...state,gears:gears.length,modeledParts:meshCount}),setState:changes=>{
 if(!changes||typeof changes!=='object'||Array.isArray(changes))throw new Error('Expected an object');
 for(const [k,v] of Object.entries(changes)){
  if(['speed','glow','explode'].includes(k)){const [min,max]=k==='speed'?[.2,2.5]:[0,1];if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error(`Invalid ${k}`);}
  else if(k==='color'){if(!Object.hasOwn(colors,v))throw new Error('Invalid color');}
  else if(k==='playing'){if(typeof v!=='boolean')throw new Error('Expected boolean');}
  else throw new Error(`Unknown parameter: ${k}`);
 }
 for(const [k,v] of Object.entries(changes)){if(['speed','glow','explode'].includes(k)){state[k]=v;updateRange(k,k==='speed'?v:Math.round(v*100));}else if(k==='color')setColor(v);else if(k==='playing'){state.playing=v;syncPlay();}}
 return {...state};
}};
if(document.modelContext?.registerTool){
 const lifecycle=new AbortController();
 const definitions=[
  {name:'read_butterfly_state',title:'读取机械蝴蝶状态',description:'Read the visible butterfly animation and mechanism settings.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:()=>window.butterfly.getState()},
  {name:'configure_butterfly',title:'调整机械蝴蝶',description:'Set wing speed, glow, exploded structure, color or playback. Changes immediately update the visible controls and 3D butterfly.',inputSchema:{type:'object',properties:{speed:{type:'number',minimum:.2,maximum:2.5},glow:{type:'number',minimum:0,maximum:1},explode:{type:'number',minimum:0,maximum:1},color:{type:'string',enum:['cyan','amber','violet']},playing:{type:'boolean'}},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:input=>window.butterfly.setState(input)}
 ];
 for(const definition of definitions){try{Promise.resolve(document.modelContext.registerTool(definition,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
 window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();$('loading').innerHTML='<span>3D 渲染已中断，请刷新页面重新载入。</span>';$('loading').classList.remove('hidden');});
