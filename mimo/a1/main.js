import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ═══════════════════════════════════════════
   Palette & State
═══════════════════════════════════════════ */
const C = {
  void: 0x05060a,
  brass: 0xc9a66b,
  brassHot: 0xe8c98a,
  bronze: 0x5c4a38,
  bronzeDeep: 0x3a2e24,
  gunmetal: 0x2a2e3a,
  gunmetalLit: 0x4a5162,
  cyan: 0x4de8ff,
  cyanDeep: 0x0a6f88,
  amber: 0xffb84d,
  amberHot: 0xffd28a,
  bone: 0xe8e0d4,
  membrane: 0x1a3a48,
};

const state = {
  speed: 1,
  gearRatio: 2.4,
  glow: 0.48,
  spread: 72,
  bloomThreshold: 0.45,
  paused: false,
  winding: 1, // 0→1 startup
  pulse: 0, // 0..1 energy pulse envelope
  phase: 0,
  view: 'hero',
  clock: 0,
  hoverGear: null,
};

const VIEW_PRESETS = {
  hero: { pos: [0.15, 2.35, 3.1], target: [0, 0.0, 0.0], fov: 40, label: '全景观察' },
  gears: { pos: [0.35, 0.55, 1.85], target: [0.0, 0.08, 0.25], fov: 36, label: '机芯特写' },
  wings: { pos: [0.0, 3.4, 0.9], target: [0, 0.0, 0.0], fov: 42, label: '羽翼能量' },
  side: { pos: [3.6, 0.55, 0.35], target: [0, 0.05, 0.0], fov: 34, label: '侧写剖面' },
};

const CAPTIONS = {
  hero: '发条能量沿翅脉流动，齿轮系与扑翼同步咬合',
  gears: '主驱动轮带动行星从动，差动机构把旋转化为扑翼相位差',
  wings: '半透明能量膜在翅脉间导光，辉光随扑动周期起伏',
  side: '侧向观察翼根摇臂与机身段节的铰接关系',
};

/* ═══════════════════════════════════════════
   DOM
═══════════════════════════════════════════ */
const stageEl = document.getElementById('stage');
const statusChip = document.getElementById('status-chip');
const viewChip = document.getElementById('view-chip');
const tRpm = document.getElementById('t-rpm');
const tRatio = document.getElementById('t-ratio');
const tEnergy = document.getElementById('t-energy');
const stageHint = document.getElementById('stage-hint');
const stageCaption = document.getElementById('stage-caption');
const gearReadoutBody = document.getElementById('gear-readout-body');
const plateStatus = document.getElementById('plate-status');

const ctlSpeed = document.getElementById('ctl-speed');
const ctlRatio = document.getElementById('ctl-ratio');
const ctlGlow = document.getElementById('ctl-glow');
const ctlSpread = document.getElementById('ctl-spread');
const ctlBloom = document.getElementById('ctl-bloom');
const outSpeed = document.getElementById('out-speed');
const outRatio = document.getElementById('out-ratio');
const outGlow = document.getElementById('out-glow');
const outSpread = document.getElementById('out-spread');
const outBloom = document.getElementById('out-bloom');

/* ═══════════════════════════════════════════
   Renderer / Scene / Camera
═══════════════════════════════════════════ */
const scene = new THREE.Scene();
scene.background = new THREE.Color(C.void);
scene.fog = new THREE.FogExp2(C.void, 0.055);

const camera = new THREE.PerspectiveCamera(VIEW_PRESETS.hero.fov, 1, 0.05, 80);
camera.position.set(...VIEW_PRESETS.hero.pos);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(stageEl.clientWidth || 800, stageEl.clientHeight || 500);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stageEl.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 0.9;
controls.maxDistance = 9;
controls.target.set(...VIEW_PRESETS.hero.target);
controls.maxPolarAngle = Math.PI * 0.88;
controls.enablePan = false;

// Camera tween
const camTween = {
  active: false,
  t: 0,
  dur: 1.35,
  fromPos: new THREE.Vector3(),
  toPos: new THREE.Vector3(),
  fromTarget: new THREE.Vector3(),
  toTarget: new THREE.Vector3(),
  fromFov: 40,
  toFov: 40,
};

function startViewTween(key) {
  const p = VIEW_PRESETS[key];
  if (!p) return;
  state.view = key;
  viewChip.textContent = p.label;
  stageCaption.textContent = CAPTIONS[key] || CAPTIONS.hero;
  camTween.fromPos.copy(camera.position);
  camTween.toPos.set(...p.pos);
  camTween.fromTarget.copy(controls.target);
  camTween.toTarget.set(...p.target);
  camTween.fromFov = camera.fov;
  camTween.toFov = p.fov;
  camTween.t = 0;
  camTween.active = true;
}

/* ═══════════════════════════════════════════
   Materials
═══════════════════════════════════════════ */
const mat = {
  brass: new THREE.MeshStandardMaterial({
    color: C.brass,
    metalness: 0.92,
    roughness: 0.28,
    envMapIntensity: 1.2,
  }),
  brassHot: new THREE.MeshStandardMaterial({
    color: C.brassHot,
    metalness: 0.88,
    roughness: 0.22,
    emissive: C.amber,
    emissiveIntensity: 0.08,
  }),
  bronze: new THREE.MeshStandardMaterial({
    color: C.bronze,
    metalness: 0.85,
    roughness: 0.4,
  }),
  bronzeDeep: new THREE.MeshStandardMaterial({
    color: C.bronzeDeep,
    metalness: 0.78,
    roughness: 0.48,
  }),
  gunmetal: new THREE.MeshStandardMaterial({
    color: C.gunmetal,
    metalness: 0.9,
    roughness: 0.32,
  }),
  gunmetalLit: new THREE.MeshStandardMaterial({
    color: C.gunmetalLit,
    metalness: 0.88,
    roughness: 0.28,
  }),
  vein: new THREE.MeshStandardMaterial({
    color: 0x9ab8c4,
    metalness: 0.7,
    roughness: 0.28,
    emissive: C.cyan,
    emissiveIntensity: 0.4,
  }),
  veinCore: new THREE.MeshBasicMaterial({
    color: 0x7aeeff,
    transparent: true,
    opacity: 0.75,
  }),
  membrane: new THREE.MeshPhysicalMaterial({
    color: 0x08202c,
    metalness: 0.0,
    roughness: 0.45,
    transparent: true,
    opacity: 0.32,
    emissive: 0x0a4054,
    emissiveIntensity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
  membraneCell: new THREE.MeshPhysicalMaterial({
    color: 0x0c2e3c,
    metalness: 0.05,
    roughness: 0.5,
    transparent: true,
    opacity: 0.16,
    emissive: 0x0a5068,
    emissiveIntensity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
  wingFrame: new THREE.MeshStandardMaterial({
    color: 0xc9a66b,
    metalness: 0.88,
    roughness: 0.28,
    emissive: C.amber,
    emissiveIntensity: 0.08,
  }),
  glassEye: new THREE.MeshStandardMaterial({
    color: C.cyan,
    metalness: 0.15,
    roughness: 0.2,
    emissive: C.cyan,
    emissiveIntensity: 0.28,
  }),
  spark: new THREE.PointsMaterial({
    color: C.cyan,
    size: 0.02,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  }),
  dust: new THREE.PointsMaterial({
    color: C.brass,
    size: 0.012,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  }),
};

/* ═══════════════════════════════════════════
   Lighting
═══════════════════════════════════════════ */
scene.add(new THREE.AmbientLight(0x6a7a90, 0.35));
scene.add(new THREE.HemisphereLight(0x8ab0d0, 0x1a1410, 0.45));

const keyLight = new THREE.DirectionalLight(0xfff2dd, 1.65);
keyLight.position.set(4.5, 6, 3.5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 20;
keyLight.shadow.camera.left = -4;
keyLight.shadow.camera.right = 4;
keyLight.shadow.camera.top = 4;
keyLight.shadow.camera.bottom = -4;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x6ec8ff, 0.55);
fillLight.position.set(-4, 2, -2);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffb84d, 0.7);
rimLight.position.set(1.5, 0.5, -4);
scene.add(rimLight);

const wingGlowLight = new THREE.PointLight(C.cyan, 0, 6, 2);
wingGlowLight.position.set(0, 0.2, 0.2);
scene.add(wingGlowLight);

const gearGlowLight = new THREE.PointLight(C.amber, 0.6, 4, 2);
gearGlowLight.position.set(0.05, 0.35, 0.45);
scene.add(gearGlowLight);

const topFill = new THREE.PointLight(0xffe2b0, 0.85, 8, 2);
topFill.position.set(0.2, 2.2, 0.8);
scene.add(topFill);

const underFill = new THREE.PointLight(0x4de8ff, 0.25, 5, 2);
underFill.position.set(0, -0.8, 0.3);
scene.add(underFill);

/* ═══════════════════════════════════════════
   Geometry helpers
═══════════════════════════════════════════ */
function createGearShape(outerR, innerR, teeth, holeR) {
  const shape = new THREE.Shape();
  const toothAngle = (Math.PI * 2) / teeth;
  const tipW = toothAngle * 0.34;
  const gapW = toothAngle * 0.3;

  for (let i = 0; i < teeth; i++) {
    const a0 = i * toothAngle;
    const aTipStart = a0 + gapW * 0.5 + (toothAngle - tipW - gapW) * 0.15;
    const aTipEnd = aTipStart + tipW;

    if (i === 0) {
      shape.moveTo(Math.cos(a0) * innerR, Math.sin(a0) * innerR);
    }
    // root arc toward tip
    shape.absarc(0, 0, innerR, a0, aTipStart, false);
    shape.lineTo(Math.cos(aTipStart) * outerR, Math.sin(aTipStart) * outerR);
    shape.absarc(0, 0, outerR, aTipStart, aTipEnd, false);
    shape.lineTo(Math.cos(aTipEnd) * innerR, Math.sin(aTipEnd) * innerR);
    const aNext = (i + 1) * toothAngle;
    if (i < teeth - 1) shape.absarc(0, 0, innerR, aTipEnd, aNext, false);
    else shape.absarc(0, 0, innerR, aTipEnd, Math.PI * 2, false);
  }

  if (holeR > 0) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  return shape;
}

function createGearGeometry({ outerR, rootR, teeth, thickness, holeR, spoke = true }) {
  const shape = createGearShape(outerR, rootR, teeth, holeR * 0.55);
  // spoke cutouts as holes
  if (spoke && outerR > 0.25) {
    const n = Math.min(6, Math.max(3, Math.floor(teeth / 4)));
    const spokeR = (rootR + holeR) * 0.45;
    const mid = (rootR * 0.72 + holeR * 0.9);
    const cutR = mid * 0.28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.2;
      const hole = new THREE.Path();
      const cx = Math.cos(a) * mid;
      const cy = Math.sin(a) * mid;
      hole.absarc(cx, cy, Math.max(cutR, rootR * 0.12), 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.12,
    bevelSize: Math.min(0.008, thickness * 0.2),
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.translate(0, 0, -thickness / 2);
  geo.computeVertexNormals();
  return geo;
}

function createGear({ outerR, rootR, teeth, thickness, holeR, material, name, gearData }) {
  const geo = createGearGeometry({ outerR, rootR, teeth, thickness, holeR });
  const mesh = new THREE.Mesh(geo, material.clone());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name || 'gear';
  mesh.userData.gear = {
    teeth,
    outerR,
    rootR,
    thickness,
    name: name || '齿轮',
    label: gearData || `${name || '齿轮'} ${teeth}T · 节圆 ${rootR.toFixed(2)}`,
  };

  // hub ring
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(holeR * 1.35, holeR * 1.35, thickness * 1.15, 20),
    mat.bronze.clone()
  );
  hub.rotation.x = Math.PI / 2;
  mesh.add(hub);

  // axle pin
  const pin = new THREE.Mesh(
    new THREE.CylinderGeometry(holeR * 0.55, holeR * 0.55, thickness * 1.8, 12),
    mat.gunmetal.clone()
  );
  pin.rotation.x = Math.PI / 2;
  mesh.add(pin);

  return mesh;
}

function tubeFromPoints(points, radius, material, tubular = 32, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
  return new THREE.Mesh(geo, material);
}

function makeSegmentedAbdomen(length, segments, matA, matB) {
  const g = new THREE.Group();
  const segH = length / segments;
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const r0 = 0.1 * (1 - t * 0.55);
    const r1 = 0.1 * (1 - (t + 1 / segments) * 0.55);
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.max(r1, 0.02), r0, segH * 0.88, 16),
      i % 2 === 0 ? matA : matB
    );
    seg.position.y = -i * segH - segH * 0.5;
    seg.castShadow = true;
    g.add(seg);

    // rivet ring
    if (i < segments - 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(Math.max(r1, 0.025) * 1.05, 0.008, 6, 20),
        mat.brassHot
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -i * segH - segH;
      g.add(ring);
    }
  }
  return g;
}

/* ═══════════════════════════════════════════
   Butterfly assembly
═══════════════════════════════════════════ */
const butterfly = new THREE.Group();
butterfly.name = 'mechanical-butterfly';
scene.add(butterfly);

const bodyGroup = new THREE.Group();
const gearGroup = new THREE.Group();
const wingL = new THREE.Group();
const wingR = new THREE.Group();
wingL.name = 'wing-left';
wingR.name = 'wing-right';

butterfly.add(bodyGroup, gearGroup, wingL, wingR);

// ── Head ──
const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 18), mat.bronze);
head.position.set(0, 0.22, 0.55);
head.scale.set(1.05, 0.95, 1.1);
head.castShadow = true;
bodyGroup.add(head);

const eyeGeo = new THREE.SphereGeometry(0.035, 14, 10);
const eyeL = new THREE.Mesh(eyeGeo, mat.glassEye);
const eyeR = new THREE.Mesh(eyeGeo, mat.glassEye.clone());
eyeL.position.set(-0.07, 0.24, 0.64);
eyeR.position.set(0.07, 0.24, 0.64);
bodyGroup.add(eyeL, eyeR);

// clypeus / mandible plates
const clypeus = new THREE.Mesh(
  new THREE.BoxGeometry(0.12, 0.04, 0.08),
  mat.brass
);
clypeus.position.set(0, 0.16, 0.62);
bodyGroup.add(clypeus);

// ── Antennae ──
function buildAntenna(side) {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(
      new THREE.Vector3(
        side * (0.04 + t * 0.22 + Math.sin(t * 3) * 0.02),
        0.28 + t * 0.38,
        0.62 + t * 0.28 - t * t * 0.08
      )
    );
  }
  const stem = tubeFromPoints(pts, 0.008, mat.gunmetalLit, 28, 5);
  g.add(stem);

  // coil near base
  const coil = new THREE.Mesh(
    new THREE.TorusGeometry(0.035, 0.007, 6, 24, Math.PI * 1.6),
    mat.brass
  );
  coil.position.copy(pts[2]);
  coil.rotation.y = side * 0.6;
  g.add(coil);

  // tip
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), mat.glassEye.clone());
  tip.position.copy(pts[pts.length - 1]);
  tip.userData.antennaTip = true;
  g.add(tip);
  g.userData.tip = tip;
  return g;
}
const antL = buildAntenna(-1);
const antR = buildAntenna(1);
bodyGroup.add(antL, antR);

// ── Thorax (mechanical chassis) ──
const thorax = new THREE.Group();
thorax.position.set(0, 0.08, 0.12);
bodyGroup.add(thorax);

const thoraxShell = new THREE.Mesh(
  new THREE.CylinderGeometry(0.18, 0.16, 0.42, 20),
  mat.bronze
);
thoraxShell.rotation.x = Math.PI / 2;
thoraxShell.castShadow = true;
thorax.add(thoraxShell);

// side plates
for (const side of [-1, 1]) {
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.28, 0.34),
    mat.brass
  );
  plate.position.set(side * 0.17, 0, 0);
  plate.castShadow = true;
  thorax.add(plate);

  // vents
  for (let i = 0; i < 4; i++) {
    const vent = new THREE.Mesh(
      new THREE.BoxGeometry(0.015, 0.04, 0.012),
      mat.gunmetal
    );
    vent.position.set(side * 0.19, 0.08 - i * 0.05, 0.08);
    thorax.add(vent);
  }
}

// dorsal ridge
const ridge = new THREE.Mesh(
  new THREE.BoxGeometry(0.06, 0.04, 0.4),
  mat.brassHot
);
ridge.position.set(0, 0.17, 0);
thorax.add(ridge);

// wing hinge mounts
const hingeMountL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 12), mat.gunmetalLit);
const hingeMountR = hingeMountL.clone();
hingeMountL.position.set(-0.2, 0.02, 0.02);
hingeMountR.position.set(0.2, 0.02, 0.02);
thorax.add(hingeMountL, hingeMountR);

// ── Abdomen ──
const abdomen = makeSegmentedAbdomen(0.85, 7, mat.bronze, mat.brass);
abdomen.position.set(0, 0.02, -0.18);
bodyGroup.add(abdomen);

// abdomen tip glow
const tipCore = new THREE.Mesh(
  new THREE.SphereGeometry(0.035, 12, 10),
  mat.glassEye.clone()
);
tipCore.position.set(0, -0.82, -0.18);
tipCore.userData.abdomenTip = true;
bodyGroup.add(tipCore);

// ── Legs ──
function buildLeg(side, zOff, yOff, len) {
  const g = new THREE.Group();
  const upper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.01, len * 0.45, 6),
    mat.gunmetal
  );
  upper.position.y = -len * 0.22;
  upper.rotation.z = side * 0.35;
  const lower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.006, len * 0.55, 6),
    mat.gunmetal
  );
  lower.position.set(side * len * 0.12, -len * 0.55, 0.04);
  lower.rotation.z = side * 0.55;
  lower.rotation.x = 0.35;
  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), mat.brass);
  joint.position.set(side * len * 0.04, -len * 0.42, 0);
  g.add(upper, lower, joint);
  g.position.set(side * 0.12, yOff, zOff);
  g.userData.side = side;
  g.userData.phase = zOff * 4;
  return g;
}
const legs = [];
for (const side of [-1, 1]) {
  legs.push(buildLeg(side, 0.35, 0.05, 0.32));
  legs.push(buildLeg(side, 0.12, 0.02, 0.38));
  legs.push(buildLeg(side, -0.08, 0.0, 0.34));
}
legs.forEach((l) => bodyGroup.add(l));

/* ── Gear train ── */
const gearMeshes = [];
const driveGear = createGear({
  outerR: 0.28,
  rootR: 0.23,
  teeth: 32,
  thickness: 0.05,
  holeR: 0.06,
  material: mat.brass,
  name: '主驱动轮',
  gearData: '主驱动轮 32T · 节圆 Ø0.46 · 源自发条盒',
});
driveGear.position.set(0, 0.05, 0.32);
gearGroup.add(driveGear);
gearMeshes.push(driveGear);

const midGear = createGear({
  outerR: 0.17,
  rootR: 0.14,
  teeth: 18,
  thickness: 0.045,
  holeR: 0.04,
  material: mat.brassHot,
  name: '行星从动',
  gearData: '行星从动 18T · 节圆 Ø0.28 · 一级减速',
});
const midDist = 0.23 + 0.16;
midGear.position.set(midDist * Math.cos(0.55), 0.05 + midDist * Math.sin(0.55), 0.32);
gearGroup.add(midGear);
gearMeshes.push(midGear);

const upperGear = createGear({
  outerR: 0.13,
  rootR: 0.105,
  teeth: 14,
  thickness: 0.04,
  holeR: 0.03,
  material: mat.brass,
  name: '翼根摇臂',
  gearData: '翼根摇臂 14T · 节圆 Ø0.21 · 驱动扑翼相位',
});
const upperDist = 0.14 + 0.12;
upperGear.position.set(
  midGear.position.x + upperDist * Math.cos(2.35),
  midGear.position.y + upperDist * Math.sin(2.35),
  0.32
);
gearGroup.add(upperGear);
gearMeshes.push(upperGear);

const wingGearL = createGear({
  outerR: 0.22,
  rootR: 0.18,
  teeth: 26,
  thickness: 0.035,
  holeR: 0.05,
  material: mat.bronze,
  name: '左翼传动',
  gearData: '左翼传动 26T · 扇动半轴',
});
wingGearL.position.set(-0.26, 0.06, 0.12);
wingGearL.rotation.y = Math.PI / 2;
gearGroup.add(wingGearL);
gearMeshes.push(wingGearL);

const wingGearR = createGear({
  outerR: 0.22,
  rootR: 0.18,
  teeth: 26,
  thickness: 0.035,
  holeR: 0.05,
  material: mat.bronze,
  name: '右翼传动',
  gearData: '右翼传动 26T · 扇动半轴',
});
wingGearR.position.set(0.26, 0.06, 0.12);
wingGearR.rotation.y = Math.PI / 2;
gearGroup.add(wingGearR);
gearMeshes.push(wingGearR);

const idlerA = createGear({
  outerR: 0.09,
  rootR: 0.07,
  teeth: 10,
  thickness: 0.03,
  holeR: 0.022,
  material: mat.brassHot,
  name: '惰轮 A',
  gearData: '惰轮 A 10T · 传动链补距',
});
idlerA.position.set(-0.14, 0.18, 0.42);
gearGroup.add(idlerA);
gearMeshes.push(idlerA);

const idlerB = createGear({
  outerR: 0.08,
  rootR: 0.06,
  teeth: 9,
  thickness: 0.028,
  holeR: 0.02,
  material: mat.brass,
  name: '惰轮 B',
  gearData: '惰轮 B 9T · 尾部同步',
});
idlerB.position.set(0.12, -0.05, 0.4);
gearGroup.add(idlerB);
gearMeshes.push(idlerB);

const crownGear = createGear({
  outerR: 0.12,
  rootR: 0.095,
  teeth: 16,
  thickness: 0.028,
  holeR: 0.028,
  material: mat.brassHot,
  name: '冠轮',
  gearData: '冠轮 16T · 顶部同步',
});
crownGear.position.set(0.02, 0.22, 0.22);
crownGear.rotation.x = Math.PI / 2.4;
gearGroup.add(crownGear);
gearMeshes.push(crownGear);

const barrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.1, 0.1, 0.11, 24),
  mat.bronzeDeep
);
barrel.rotation.x = Math.PI / 2;
barrel.position.set(0, 0.05, 0.32);
barrel.castShadow = true;
gearGroup.add(barrel);

for (let i = 0; i < 4; i++) {
  const coil = new THREE.Mesh(
    new THREE.TorusGeometry(0.065 - i * 0.008, 0.0055, 6, 28),
    mat.brassHot
  );
  coil.position.set(0, 0.05, 0.32 + i * 0.018 - 0.036);
  gearGroup.add(coil);
}

function axle(x1, y1, z1, x2, y2, z2) {
  const a = new THREE.Vector3(x1, y1, z1);
  const b = new THREE.Vector3(x2, y2, z2);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, len, 8),
    mat.gunmetal
  );
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return mesh;
}
gearGroup.add(axle(-0.2, 0.04, 0.05, -0.26, 0.06, 0.12));
gearGroup.add(axle(0.2, 0.04, 0.05, 0.26, 0.06, 0.12));
gearGroup.add(axle(0, 0.04, 0.15, 0, 0.05, 0.32));

// ── Wings ──
const wingParts = { L: { veins: [], membranes: [], cores: [] }, R: { veins: [], membranes: [], cores: [] } };

function buildWing(side) {
  const root = new THREE.Group();
  const wingBody = new THREE.Group();
  // hinge pivot at wing root — body axis is +Z (head), wings extend ±X
  wingBody.position.set(side * 0.2, 0.04, 0.05);
  root.add(wingBody);

  const key = side < 0 ? 'L' : 'R';
  const S = (v) => side * v;

  // Outline in (x, z): x = outward, z = body-forward. Yaw plane = horizontal XZ.
  const outlineFore = [
    [0, 0.08],
    [S(0.22), 0.28],
    [S(0.55), 0.55],
    [S(0.95), 0.72],
    [S(1.28), 0.78],
    [S(1.48), 0.68],
    [S(1.52), 0.48],
    [S(1.38), 0.22],
    [S(1.05), 0.02],
    [S(0.62), -0.08],
    [S(0.25), -0.1],
    [0, -0.04],
  ];

  const outlineHind = [
    [0, 0.02],
    [S(0.35), -0.05],
    [S(0.75), -0.22],
    [S(1.05), -0.42],
    [S(1.12), -0.62],
    [S(0.95), -0.82],
    [S(0.62), -0.95],
    [S(0.28), -0.88],
    [S(0.1), -0.62],
    [0, -0.32],
  ];

  function shapeFromOutline(outline) {
    // Shape XY → later laid flat into XZ via rotation.x = +PI/2
    const s = new THREE.Shape();
    s.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) s.lineTo(outline[i][0], outline[i][1]);
    s.closePath();
    return s;
  }

  function addFlatMembrane(outline, yOff, material) {
    const shape = shapeFromOutline(outline);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.008,
      bevelEnabled: false,
      curveSegments: 2,
    });
    const mesh = new THREE.Mesh(geo, material.clone());
    // Lay shape plane into world XZ: local +Y → world +Z, extrude +Z → world -Y
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = yOff;
    mesh.receiveShadow = true;
    wingBody.add(mesh);
    wingParts[key].membranes.push(mesh);
    return mesh;
  }

  addFlatMembrane(outlineFore, 0.01, mat.membrane);
  addFlatMembrane(outlineHind, 0.005, mat.membrane);

  // Cell panels (semi-transparent inset triangles for mechanical density)
  function addCell(pts) {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    const geo = new THREE.ShapeGeometry(s);
    const mesh = new THREE.Mesh(geo, mat.membraneCell.clone());
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = 0.012;
    wingBody.add(mesh);
    wingParts[key].membranes.push(mesh);
  }

  // Forewing cells
  addCell([[0, 0.05], [S(0.35), 0.35], [S(0.75), 0.55], [S(0.45), 0.2], [S(0.15), 0.02]]);
  addCell([[S(0.35), 0.35], [S(0.8), 0.62], [S(1.15), 0.72], [S(0.95), 0.45], [S(0.75), 0.55]]);
  addCell([[S(0.75), 0.55], [S(0.95), 0.45], [S(1.3), 0.55], [S(1.4), 0.4], [S(1.05), 0.25]]);
  addCell([[S(0.15), 0.02], [S(0.45), 0.2], [S(0.7), 0.05], [S(0.35), -0.05]]);
  addCell([[S(0.45), 0.2], [S(0.75), 0.55], [S(1.05), 0.25], [S(0.7), 0.05]]);

  // Hindwing cells
  addCell([[0, -0.05], [S(0.35), -0.12], [S(0.65), -0.35], [S(0.25), -0.4], [0, -0.28]]);
  addCell([[S(0.35), -0.12], [S(0.8), -0.3], [S(0.95), -0.5], [S(0.65), -0.35]]);
  addCell([[S(0.65), -0.35], [S(0.95), -0.5], [S(0.85), -0.75], [S(0.55), -0.7], [S(0.4), -0.5]]);
  addCell([[0, -0.28], [S(0.25), -0.4], [S(0.4), -0.5], [S(0.22), -0.7], [S(0.08), -0.55]]);

  // Veins — XZ plane at wing surface height
  function addVein(points, r = 0.009) {
    const pts3 = points.map(([x, z]) => new THREE.Vector3(x, 0.028, z));
    const tube = tubeFromPoints(pts3, r, mat.vein.clone(), 28, 5);
    wingBody.add(tube);
    wingParts[key].veins.push(tube);

    const corePts = points.map(([x, z]) => new THREE.Vector3(x, 0.03, z));
    const core = tubeFromPoints(corePts, Math.max(r * 0.28, 0.0025), mat.veinCore.clone(), 28, 4);
    wingBody.add(core);
    wingParts[key].cores.push(core);
  }

  // Forewing leading edge + radial veins
  addVein([[0, 0.06], [S(0.4), 0.4], [S(0.9), 0.65], [S(1.35), 0.72], [S(1.48), 0.6]], 0.012);
  addVein([[0, 0.04], [S(0.5), 0.35], [S(1.0), 0.45], [S(1.4), 0.42]], 0.009);
  addVein([[0, 0.02], [S(0.45), 0.12], [S(0.95), 0.15], [S(1.25), 0.18]], 0.008);
  addVein([[0, 0], [S(0.4), -0.02], [S(0.75), 0.02]], 0.007);
  addVein([[S(0.4), 0.4], [S(0.75), 0.3], [S(1.0), 0.2]], 0.006);
  addVein([[S(0.7), 0.58], [S(0.9), 0.38], [S(1.0), 0.2]], 0.005);
  addVein([[S(0.9), 0.65], [S(1.15), 0.5], [S(1.25), 0.18]], 0.005);

  // Hindwing veins
  addVein([[0, 0], [S(0.4), -0.18], [S(0.75), -0.4], [S(0.95), -0.62], [S(0.7), -0.88]], 0.009);
  addVein([[0, -0.05], [S(0.35), -0.4], [S(0.45), -0.75], [S(0.25), -0.85]], 0.008);
  addVein([[0, -0.15], [S(0.5), -0.35], [S(0.8), -0.55]], 0.007);
  addVein([[S(0.25), -0.25], [S(0.55), -0.55], [S(0.7), -0.75]], 0.006);
  addVein([[S(0.35), -0.4], [S(0.65), -0.7], [S(0.55), -0.9]], 0.005);

  // Leading-edge spars (gunmetal bones)
  const sparFore = tubeFromPoints(
    [
      new THREE.Vector3(0, 0.045, 0.06),
      new THREE.Vector3(S(0.45), 0.045, 0.48),
      new THREE.Vector3(S(1.0), 0.045, 0.72),
      new THREE.Vector3(S(1.45), 0.045, 0.68),
    ],
    0.02,
    mat.gunmetalLit,
    24,
    6
  );
  wingBody.add(sparFore);

  const sparHind = tubeFromPoints(
    [
      new THREE.Vector3(0, 0.04, 0),
      new THREE.Vector3(S(0.4), 0.04, -0.2),
      new THREE.Vector3(S(0.85), 0.04, -0.5),
      new THREE.Vector3(S(0.75), 0.04, -0.85),
    ],
    0.016,
    mat.gunmetalLit,
    20,
    6
  );
  wingBody.add(sparHind);

  // Brass outer frames along wing outlines (always-readable mechanical edge)
  function addFrame(outline, radius = 0.012) {
    const pts = outline.map(([x, z]) => new THREE.Vector3(x, 0.035, z));
    pts.push(pts[0].clone());
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const geo = new THREE.TubeGeometry(curve, 80, radius, 5, true);
    const mesh = new THREE.Mesh(geo, mat.wingFrame.clone());
    wingBody.add(mesh);
  }
  addFrame(outlineFore, 0.014);
  addFrame(outlineHind, 0.012);

  // Trailing-edge corrugation (mechanical scallops)
  function addScallops(outline) {
    for (let i = 1; i < outline.length - 1; i++) {
      const [x, z] = outline[i];
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.032, 0.02, 8),
        mat.wingFrame.clone()
      );
      disc.position.set(x, 0.03, z);
      wingBody.add(disc);
    }
  }
  addScallops(outlineFore);
  addScallops(outlineHind);

  // Mechanical wing-root plate + struts
  const link = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.045, 0.22), mat.brass);
  link.position.set(S(0.14), 0.03, 0.02);
  link.castShadow = true;
  wingBody.add(link);

  for (let i = 0; i < 4; i++) {
    const riv = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 8), mat.brassHot);
    riv.position.set(S(0.04 + i * 0.07), 0.055, 0.02);
    wingBody.add(riv);
  }

  // Diagonal brace strut
  const brace = tubeFromPoints(
    [
      new THREE.Vector3(S(0.05), 0.03, 0.08),
      new THREE.Vector3(S(0.28), 0.03, 0.22),
      new THREE.Vector3(S(0.45), 0.03, 0.35),
    ],
    0.014,
    mat.bronze,
    12,
    5
  );
  wingBody.add(brace);

  // Eyespot on forewing
  const spot = new THREE.Mesh(
    new THREE.TorusGeometry(0.075, 0.012, 8, 24),
    mat.brass.clone()
  );
  spot.position.set(S(0.95), 0.04, 0.42);
  spot.rotation.x = Math.PI / 2;
  wingBody.add(spot);
  const spotRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.045, 0.008, 6, 20),
    mat.brassHot.clone()
  );
  spotRing.position.set(S(0.95), 0.042, 0.42);
  spotRing.rotation.x = Math.PI / 2;
  wingBody.add(spotRing);
  const spotCore = new THREE.Mesh(
    new THREE.CircleGeometry(0.032, 20),
    mat.glassEye.clone()
  );
  spotCore.position.set(S(0.95), 0.044, 0.42);
  spotCore.rotation.x = Math.PI / 2;
  wingBody.add(spotCore);
  wingParts[key].cores.push(spotCore);

  // Secondary hindwing eyespot
  const spot2 = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 18), mat.brassHot.clone());
  spot2.position.set(S(0.55), 0.038, -0.48);
  spot2.rotation.x = Math.PI / 2;
  wingBody.add(spot2);
  const spot2Core = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), mat.glassEye.clone());
  spot2Core.position.set(S(0.55), 0.04, -0.48);
  spot2Core.rotation.x = Math.PI / 2;
  wingBody.add(spot2Core);
  wingParts[key].cores.push(spot2Core);

  return { root, wingBody };
}

const L = buildWing(-1);
const R = buildWing(1);
wingL.add(L.root);
wingR.add(R.root);
wingL.userData.wingBody = L.wingBody;
wingR.userData.wingBody = R.wingBody;

/* ── Particles ── */
const sparkCount = 280;
const sparkPos = new Float32Array(sparkCount * 3);
const sparkVel = new Float32Array(sparkCount * 3);
const sparkSeed = new Float32Array(sparkCount);
for (let i = 0; i < sparkCount; i++) {
  const a = Math.random() * Math.PI * 2;
  const r = 0.3 + Math.random() * 1.4;
  sparkPos[i * 3] = Math.cos(a) * r;
  sparkPos[i * 3 + 1] = (Math.random() - 0.5) * 1.4;
  sparkPos[i * 3 + 2] = Math.sin(a) * r * 0.7;
  sparkVel[i * 3] = Math.cos(a) * 0.02;
  sparkVel[i * 3 + 1] = 0.01 + Math.random() * 0.02;
  sparkVel[i * 3 + 2] = Math.sin(a) * 0.02;
  sparkSeed[i] = Math.random() * Math.PI * 2;
}
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
const sparks = new THREE.Points(sparkGeo, mat.spark);
scene.add(sparks);

const dustCount = 160;
const dustPos = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 6;
  dustPos[i * 3 + 1] = (Math.random() - 0.5) * 4;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 4;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, mat.dust);
scene.add(dust);

// ground reflection disc (subtle)
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(3.2, 48),
  new THREE.MeshStandardMaterial({
    color: 0x080a10,
    metalness: 0.6,
    roughness: 0.75,
  })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.35;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(8, 24, 0x1a2430, 0x101620);
grid.position.y = -1.34;
scene.add(grid);

/* ═══════════════════════════════════════════
   Post-processing
═══════════════════════════════════════════ */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(stageEl.clientWidth || 800, stageEl.clientHeight || 500),
  0.55,
  0.4,
  state.bloomThreshold
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

/* ═══════════════════════════════════════════
   Interaction
═══════════════════════════════════════════ */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pointerNDC = new THREE.Vector2();
let dragging = false;

function onPointerMove(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickGear() {
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(gearMeshes, true);
  if (hits.length) {
    let obj = hits[0].object;
    while (obj && !obj.userData.gear) obj = obj.parent;
    return obj;
  }
  return null;
}

function pickButterfly() {
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(butterfly.children, true);
  return hits.length > 0;
}

function triggerPulse() {
  state.pulse = 1;
  statusChip.textContent = '能量脉冲';
  statusChip.style.color = '#4de8ff';
  statusChip.style.borderColor = 'rgba(77,232,255,0.5)';
}

function resetView() {
  ctlSpeed.value = '1';
  ctlRatio.value = '2.4';
  ctlGlow.value = '48';
  ctlSpread.value = '72';
  ctlBloom.value = '0.45';
  syncControlsFromInputs();
  state.paused = false;
  document.getElementById('btn-pause').textContent = '暂停机芯';
  startViewTween('hero');
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.view === 'hero');
  });
}

function syncControlsFromInputs() {
  state.speed = parseFloat(ctlSpeed.value);
  state.gearRatio = parseFloat(ctlRatio.value);
  state.glow = parseInt(ctlGlow.value, 10) / 100;
  state.spread = parseFloat(ctlSpread.value);
  state.bloomThreshold = parseFloat(ctlBloom.value);
  outSpeed.textContent = `${state.speed.toFixed(2)}×`;
  outRatio.textContent = state.gearRatio.toFixed(2);
  outGlow.textContent = `${Math.round(state.glow * 100)}%`;
  outSpread.textContent = `${state.spread.toFixed(0)}°`;
  outBloom.textContent = state.bloomThreshold.toFixed(2);
  tRatio.textContent = `1 : ${state.gearRatio.toFixed(1)}`;
  bloomPass.threshold = state.bloomThreshold;
}

[ctlSpeed, ctlRatio, ctlGlow, ctlSpread, ctlBloom].forEach((el) => {
  el.addEventListener('input', syncControlsFromInputs);
});
syncControlsFromInputs();

document.getElementById('btn-pulse').addEventListener('click', triggerPulse);
document.getElementById('btn-reset').addEventListener('click', resetView);
document.getElementById('btn-pause').addEventListener('click', (e) => {
  state.paused = !state.paused;
  e.target.textContent = state.paused ? '继续机芯' : '暂停机芯';
  plateStatus.textContent = state.paused ? '已暂停' : '运行中';
  statusChip.textContent = state.paused ? '已暂停' : '运行中';
});

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    startViewTween(btn.dataset.view);
  });
});

renderer.domElement.addEventListener('pointermove', onPointerMove);
renderer.domElement.addEventListener('pointerdown', () => {
  dragging = true;
});
renderer.domElement.addEventListener('pointerup', () => {
  dragging = false;
});
renderer.domElement.addEventListener('click', () => {
  if (pickButterfly()) triggerPulse();
});
renderer.domElement.addEventListener('dblclick', (e) => {
  // only reset if not selecting gear-heavy area — still ok
  if (e.target === renderer.domElement) resetView();
});

/* ═══════════════════════════════════════════
   Resize
═══════════════════════════════════════════ */
function onResize() {
  const w = stageEl.clientWidth || 800;
  const h = stageEl.clientHeight || 500;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloomPass.setSize(w, h);
}
window.addEventListener('resize', onResize);
onResize();

/* ═══════════════════════════════════════════
   Animation loop
═══════════════════════════════════════════ */
const clock = new THREE.Clock();
const gearRotBase = new Map();
gearMeshes.forEach((g, i) => {
  // alternate direction for visual meshing
  gearRotBase.set(g, i % 2 === 0 ? 1 : -1);
});

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animateWing(wingGroup, side, flapAngle, twist) {
  const body = wingGroup.userData.wingBody;
  if (!body) return;
  // Body axis = Z; wings lie in XZ and lift via rotation about Z.
  body.rotation.z = side * flapAngle;
  // Pitch twist around outward axis approx via X (adds slight angle-of-attack lag)
  body.rotation.y = -twist * side;
}

function tickGears(driveAngle) {
  driveGear.rotation.z = driveAngle;
  midGear.rotation.z = -driveAngle * (32 / 18) + Math.PI / 18;
  upperGear.rotation.z = driveAngle * (32 / 18) * (18 / 14);
  wingGearL.rotation.y = Math.PI / 2;
  wingGearR.rotation.y = Math.PI / 2;
  wingGearL.rotation.z = driveAngle * state.gearRatio * 0.55;
  wingGearR.rotation.z = -driveAngle * state.gearRatio * 0.55;
  idlerA.rotation.z = -driveAngle * 2.2;
  idlerB.rotation.z = driveAngle * 3.1;
  crownGear.rotation.z = driveAngle * 1.6;
  barrel.rotation.z = -driveAngle * 0.25;
}

function updateGlow(dt) {
  const pulseBoost = state.pulse * state.pulse;
  const g = state.glow * (0.55 + 0.45 * state.winding) + pulseBoost * 0.75;
  const breathe = 0.88 + Math.sin(state.clock * 2.2) * 0.12;
  const em = g * breathe;

  [...wingParts.L.veins, ...wingParts.R.veins].forEach((v) => {
    v.material.emissiveIntensity = 0.35 + em * 0.85;
  });
  [...wingParts.L.cores, ...wingParts.R.cores].forEach((c) => {
    if (c.material.transparent && c.material.opacity !== undefined) {
      c.material.opacity = Math.min(1, 0.45 + em * 0.4);
    }
    if (c.material.emissiveIntensity !== undefined) {
      c.material.emissiveIntensity = 0.5 + em * 0.7 + pulseBoost;
    }
  });
  [...wingParts.L.membranes, ...wingParts.R.membranes].forEach((m) => {
    const isCell = m.geometry.type === 'ShapeGeometry';
    m.material.emissiveIntensity = (isCell ? 0.12 : 0.16) + em * (isCell ? 0.4 : 0.55);
    m.material.opacity = isCell ? 0.12 + g * 0.16 : 0.22 + g * 0.22;
  });

  const eyeEm = 0.28 + em * 0.3 + pulseBoost * 0.8;
  eyeL.material.emissiveIntensity = eyeEm;
  eyeR.material.emissiveIntensity = eyeEm;
  if (antL.userData.tip) antL.userData.tip.material.emissiveIntensity = eyeEm * 1.1;
  if (antR.userData.tip) antR.userData.tip.material.emissiveIntensity = eyeEm * 1.1;
  tipCore.material.emissiveIntensity = 0.35 + em * 0.6 + pulseBoost * 1.1;

  wingGlowLight.intensity = (g * 0.9 + pulseBoost * 1.6) * state.winding;
  gearGlowLight.intensity = 0.55 + pulseBoost * 1.2 + state.winding * 0.25;
  topFill.intensity = 0.7 + pulseBoost * 0.25 + state.winding * 0.15;
  mat.brassHot.emissiveIntensity = 0.08 + pulseBoost * 0.35;
  bloomPass.strength = 0.36 + g * 0.22 + pulseBoost * 0.45;

  mat.spark.opacity = 0.2 + g * 0.35 + pulseBoost * 0.4;
  mat.spark.size = 0.014 + pulseBoost * 0.025 + g * 0.008;
}

function updateParticles(dt) {
  const pos = sparkGeo.attributes.position.array;
  const burst = state.pulse * state.pulse;
  for (let i = 0; i < sparkCount; i++) {
    const s = sparkSeed[i];
    pos[i * 3] += (sparkVel[i * 3] + Math.sin(state.clock + s) * 0.002) * (1 + burst * 6);
    pos[i * 3 + 1] += (sparkVel[i * 3 + 1] + Math.cos(state.clock * 1.3 + s) * 0.002) * (1 + burst * 4);
    pos[i * 3 + 2] += (sparkVel[i * 3 + 2] + Math.sin(state.clock * 0.7 + s) * 0.002) * (1 + burst * 5);

    // soft wrap
    if (Math.abs(pos[i * 3]) > 2.2) pos[i * 3] *= -0.3;
    if (pos[i * 3 + 1] > 1.6) pos[i * 3 + 1] = -1.2;
    if (pos[i * 3 + 1] < -1.3) pos[i * 3 + 1] = 1.2;
    if (Math.abs(pos[i * 3 + 2]) > 2.0) pos[i * 3 + 2] *= -0.3;
  }
  sparkGeo.attributes.position.needsUpdate = true;

  dust.rotation.y += dt * 0.02;
  sparks.rotation.y -= dt * 0.05;
}

function updateHover() {
  const gear = pickGear();
  gearMeshes.forEach((g) => {
    const mat = g.material;
    const isHot = gear === g;
    if (mat.emissive) {
      mat.emissive.setHex(isHot ? C.amber : 0x000000);
      mat.emissiveIntensity = isHot ? 0.45 : 0;
    }
  });
  if (gear && gear.userData.gear) {
    const g = gear.userData.gear;
    const rpm = Math.round(state.speed * state.gearRatio * 60 * state.winding);
    gearReadoutBody.textContent = `${g.label} · 约 ${rpm} RPM · 啮合比 1:${state.gearRatio.toFixed(2)}`;
  } else {
    gearReadoutBody.textContent = `主驱动轮 32T · 行星从动 18T · 翼根摇臂 14T\n传动比 1:${state.gearRatio.toFixed(2)} · 扑动 ${state.speed.toFixed(2)}×`;
  }
}

function updateCameraTween(dt) {
  if (!camTween.active) return;
  camTween.t = Math.min(1, camTween.t + dt / camTween.dur);
  const k = easeInOutCubic(camTween.t);
  camera.position.lerpVectors(camTween.fromPos, camTween.toPos, k);
  controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, k);
  camera.fov = THREE.MathUtils.lerp(camTween.fromFov, camTween.toFov, k);
  camera.updateProjectionMatrix();
  if (camTween.t >= 1) camTween.active = false;
}

function updateTelemetry() {
  const rpm = Math.round(state.speed * state.gearRatio * 55 * state.winding);
  tRpm.textContent = String(rpm);
  tEnergy.textContent = `${Math.round((state.glow * 0.7 + state.pulse * 0.3) * 100)}%`;
  if (!state.paused) {
    statusChip.textContent = state.winding < 0.95 ? '上弦中' : state.pulse > 0.15 ? '能量脉冲' : '运行中';
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  state.clock += dt;

  // wind-up
  if (state.winding < 1) {
    state.winding = Math.min(1, state.winding + dt * 0.45);
  }

  // pulse decay
  if (state.pulse > 0) {
    state.pulse = Math.max(0, state.pulse - dt * 1.35);
  }

  if (!state.paused) {
    state.phase += dt * state.speed * (0.55 + state.winding * 0.45);
  }

  const driveAngle = state.phase * Math.PI * 2 * 0.35;
  tickGears(driveAngle);

  // nonlinear flap — open dihedral + oscillation
  const base = state.spread * (Math.PI / 180);
  const flapWave = Math.sin(state.phase * Math.PI * 2);
  const flapWave2 = Math.sin(state.phase * Math.PI * 2 - 0.45);
  const amplitude = base * (0.4 + 0.6 * state.winding) * (1 + state.pulse * 0.4);
  const flapR = base * 0.1 + amplitude * 0.16 * flapWave;
  const flapL = flapR;
  const twist = (flapWave2 - flapWave) * 0.22 + flapWave * 0.05;

  animateWing(wingL, -1, flapL, twist);
  animateWing(wingR, 1, flapR, twist);

  // slight body sway + mouse tilt — keep specimen readable from above
  const mx = pointerNDC.x || 0;
  const my = pointerNDC.y || 0;
  butterfly.rotation.y = THREE.MathUtils.lerp(butterfly.rotation.y, mx * 0.12, 0.04);
  butterfly.rotation.x = THREE.MathUtils.lerp(butterfly.rotation.x, -my * 0.05 + 0.08, 0.04);
  butterfly.position.y = Math.sin(state.clock * 0.7) * 0.03 + state.pulse * 0.05;
  bodyGroup.rotation.z = Math.sin(state.phase * Math.PI * 2) * 0.02;

  // legs micro-motion
  legs.forEach((leg, i) => {
    leg.rotation.x = Math.sin(state.phase * Math.PI * 2 + leg.userData.phase + i) * 0.08;
  });

  // antenna tips shimmer
  const shimmer = 0.5 + Math.sin(state.clock * 3) * 0.2 + state.pulse;
  if (antL.userData.tip) antL.userData.tip.scale.setScalar(0.9 + shimmer * 0.25);
  if (antR.userData.tip) antR.userData.tip.scale.setScalar(0.9 + shimmer * 0.25);

  updateGlow(dt);
  updateParticles(dt);
  updateHover();
  updateCameraTween(dt);
  updateTelemetry();

  controls.update();
  composer.render();
}

// hide hint after first frames
setTimeout(() => {
  stageHint.textContent = '机芯已点亮 · 可交互操作';
  setTimeout(() => stageHint.classList.add('is-hidden'), 1800);
}, 1200);

animate();
