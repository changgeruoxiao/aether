// ============================================================================
//  Procedural Ocean · 程序化海洋
//  WebGPURenderer + TSL — 五组 Gerstner 波 / 三层梯度噪声 FBM / 解析天空
//  原生 ES Modules,无框架、无构建、无外部资源(仅 three.js CDN)
// ============================================================================

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform,
  positionLocal, positionWorld, cameraPosition, modelWorldMatrix,
  mix, clamp, max, abs, pow, normalize, length, dot, cross, reflect,
  fract, floor, sin, cos, pass
} from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const clampJs = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

let ready = false; // 防止正常关页后的异步报错误触错误界面

function showError(detail) {
  if (ready) return;
  const box = $('errbox');
  $('errMsg').textContent = String(detail || '未知错误');
  box.hidden = false;
  const ov = $('overlay');
  ov.classList.add('done');
  try { renderer?.setAnimationLoop(null); } catch { /* ignore */ }
}
window.addEventListener('error', (e) => showError(e.message));
window.addEventListener('unhandledrejection', (e) =>
  showError(e.reason?.message || String(e.reason)));
$('retryBtn').addEventListener('click', () => location.reload());

// ============================================================================
//  五组 Gerstner 波(方向 / 波长 / 振幅 / 陡峭占比 / 相位偏移)
//  深水色散:omega = sqrt(g · k)
// ============================================================================
const RAW_WAVES = [
  { dir: [ 1.00,  0.30], len: 96,  amp: 1.60, sf: 0.30, ph: 0.0 },
  { dir: [-0.62,  0.79], len: 58,  amp: 1.05, sf: 0.24, ph: 1.7 },
  { dir: [ 0.28, -0.96], len: 33,  amp: 0.55, sf: 0.19, ph: 3.1 },
  { dir: [-0.88, -0.47], len: 18,  amp: 0.30, sf: 0.15, ph: 4.6 },
  { dir: [ 0.95, -0.31], len: 10,  amp: 0.14, sf: 0.12, ph: 5.9 },
];
const WAVES = RAW_WAVES.map((w) => {
  const l = Math.hypot(w.dir[0], w.dir[1]);
  const k = (Math.PI * 2) / w.len;
  return {
    dx: float(w.dir[0] / l), dz: float(w.dir[1] / l),
    k: float(k), om: float(Math.sqrt(9.81 * k)),
    amp: float(w.amp), sf: float(w.sf), ph0: float(w.ph),
  };
});
const AMP_SUM = RAW_WAVES.reduce((s, w) => s + w.amp, 0);

// ============================================================================
//  Uniforms
// ============================================================================
const uTime      = uniform(0);              // 墙钟模拟时间(暂停/标签页隐藏即停)
const uWaveTime  = uniform(0);              // 波相时间(随海况改变推进速率,平滑无跳变)
const uAmp       = uniform(0.6);            // 全局振幅缩放
const uChop      = uniform(0.7);            // 水平卷曲度(≤1,保证稳定不翻卷)
const uSea       = uniform(0.42);           // 海况归一值(泡沫/细节)
const uDetail    = uniform(1.1);            // 细节法线强度
const uInvMaxH   = uniform(1 / (AMP_SUM * 0.6));
const uSunDir    = uniform(new THREE.Vector3(0, 1, 0));
// 解析天空 / 光照调色(sRGB hex 经 THREE.Color 转线性)
const uZenith    = uniform(new THREE.Color(0x265eb8));
const uHorizon   = uniform(new THREE.Color(0xb8d2e8));
const uGlowCol   = uniform(new THREE.Color(0xe8dcc0));
const uSunCol    = uniform(new THREE.Color(0xfff0d8));   // 太阳辐照(HDR 由 discI 单独给出)
const uSunDisc   = uniform(new THREE.Color(0xffffff));   // 日盘(HDR)
const uAmbient   = uniform(new THREE.Color(0x8298b0));
const uDeep      = uniform(new THREE.Color(0x052e44));
const uShallow   = uniform(new THREE.Color(0x0e6a68));
const uSSS       = uniform(new THREE.Color(0x138878));
const uCloudLit  = uniform(new THREE.Color(0xf4f8ff));
const uCloudDark = uniform(new THREE.Color(0x94a4ba));
const uFoam      = uniform(new THREE.Color(0xc0d0da));
const uGlowPow   = uniform(4.6);
const uZenCurve  = uniform(1.4);            // 天顶渐变曲线(白天更宽的蓝)

// ============================================================================
//  TSL 工具:自定义 smoothstep / 取模(规避大参数 sin 哈希精度问题)
// ============================================================================
const sstep = Fn(([e0, e1, x]) => {
  const t = clamp(x.sub(e0).div(e1.sub(e0)), 0, 1);
  return t.mul(t).mul(t.mul(-2).add(3));
});
const modf = (a, b) => a.sub(float(b).mul(floor(a.div(b))));

// ============================================================================
//  三层梯度噪声(Perlin 梯度噪声)→ 3 阶 FBM
// ============================================================================
const hash22 = Fn(([p]) => {
  // Dave Hoskins 式 sin-free 哈希,WebGPU 上数值稳定
  const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(vec2(p3.x.add(p3.y), p3.z.add(p3.y)).mul(vec2(p3.z, p3.y)));
});

const gnoise = Fn(([p]) => {
  const i = floor(p);
  const f = p.sub(i);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const g00 = hash22(modf(i, 289)).mul(2).sub(1);
  const g10 = hash22(modf(i.add(vec2(1, 0)), 289)).mul(2).sub(1);
  const g01 = hash22(modf(i.add(vec2(0, 1)), 289)).mul(2).sub(1);
  const g11 = hash22(modf(i.add(vec2(1, 1)), 289)).mul(2).sub(1);
  const n00 = dot(g00, f);
  const n10 = dot(g10, f.sub(vec2(1, 0)));
  const n01 = dot(g01, f.sub(vec2(0, 1)));
  const n11 = dot(g11, f.sub(vec2(1, 1)));
  return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y).mul(1.45);
});

// 三层梯度噪声 FBM,输出约 [-1, 1]
const fbm3 = Fn(([p]) =>
  gnoise(p).mul(0.5)
    .add(gnoise(p.mul(2.02).add(vec2(11.7, 5.3))).mul(0.25))
    .add(gnoise(p.mul(4.05).add(vec2(27.1, 9.7))).mul(0.125))
    .mul(1.1428)
);

// ============================================================================
//  Gerstner 波场:位移 + 解析切线 / 副切线(逐波累加)
//  返回 TSL 变量组;顶点与片元各调用一次,法线逐像素稳定
// ============================================================================
function waveField(xz, att) {
  const dx = float(0).toVar(), dy = float(0).toVar(), dz = float(0).toVar();
  const Tx = float(1).toVar(), Ty = float(0).toVar(), Tz = float(0).toVar();
  const Bx = float(0).toVar(), By = float(0).toVar(), Bz = float(1).toVar();
  for (const w of WAVES) {
    const A = w.amp.mul(uAmp).mul(att);        // 距离衰减后的振幅
    const H = A.mul(uChop);                    // 水平卷曲幅度(≤A,永不自交)
    const kA = w.k.mul(A);
    const kH = w.k.mul(H);
    const ph = w.k.mul(w.dx.mul(xz.x).add(w.dz.mul(xz.y)))
      .sub(uWaveTime.mul(w.om)).add(w.ph0);
    const s = sin(ph), c = cos(ph);
    dx.addAssign(H.mul(w.dx).mul(c));
    dz.addAssign(H.mul(w.dz).mul(c));
    dy.addAssign(A.mul(s));
    // ∂P/∂x 与 ∂P/∂z 的解析导数
    Tx.addAssign(kH.mul(w.dx).mul(w.dx).mul(s).negate());
    Ty.addAssign(kA.mul(w.dx).mul(c));
    Tz.addAssign(kH.mul(w.dx).mul(w.dz).mul(s).negate());
    Bx.addAssign(kH.mul(w.dx).mul(w.dz).mul(s).negate());
    By.addAssign(kA.mul(w.dz).mul(c));
    Bz.addAssign(kH.mul(w.dz).mul(w.dz).mul(s).negate());
  }
  return { dx, dy, dz, Tx, Ty, Tz, Bx, By, Bz };
}

const distFade = (dCam) => {
  const a = dCam.mul(0.0032);
  return a.mul(a).add(1).reciprocal();
};

// ============================================================================
//  解析天空(天空球与海面反射共用):基色渐变 + 太阳低空辉光
// ============================================================================
const skyBase = Fn(([dirIn]) => {
  const dir = normalize(dirIn);
  const y = dir.y;
  const cosSun = clamp(dot(dir, uSunDir), 0, 1);
  // 地平线色随方位变化:向阳侧暖,背阳侧自然偏冷(向天顶色过渡)
  const hz = mix(mix(uHorizon, uZenith, 0.45), uHorizon, cosSun.pow(1.5));
  const col = mix(hz, uZenith, pow(clamp(y, 0, 1), uZenCurve)).toVar();
  // 太阳越低,地平线辉光越强
  const low = sstep(0.5, -0.05, uSunDir.y);
  col.addAssign(
    uGlowCol.mul(cosSun.pow(uGlowPow))
      .mul(low.mul(0.8).add(0.25))
      .mul(sstep(0.55, 0.0, abs(y)).mul(0.8).add(0.2))
  );
  return col;
});

// 完整天空:辉光 + 光晕 + 日盘 + 低空程序化云带(FBM)
const skyFull = Fn(([dirIn]) => {
  const dir = normalize(dirIn);
  const col = skyBase(dir).toVar();
  const cosSun = dot(dir, uSunDir);
  const cosSunP = clamp(cosSun, 0, 1);
  col.addAssign(uSunCol.mul(pow(cosSunP, 320).mul(0.35)));            // 宽光晕
  col.addAssign(uSunDisc.mul(sstep(0.99965, 0.99985, cosSun)));       // 日盘(软边)
  // 低空云带:视线与云层平面求交 + FBM 密度
  const band = sstep(-0.01, 0.07, dir.y).mul(sstep(0.78, 0.12, dir.y)).mul(sstep(0.012, 0.05, dir.y));
  const cp = dir.xz.div(max(dir.y, 0.03)).mul(0.10)
    .add(vec2(uTime.mul(0.006), uTime.mul(0.0023)));
  const den = fbm3(cp);
  const c0 = mix(0.30, -0.20, 0.55);
  const m = sstep(-0.02, 0.32, den).mul(band);
  const edge = clamp(den.mul(2.2), 0, 1);
  const cCol = mix(uCloudDark, uCloudLit, edge).toVar();
  cCol.addAssign(uSunCol.mul(pow(cosSunP, 5).mul(0.45).mul(m).mul(edge.oneMinus().mul(0.7).add(0.3))));
  col.assign(mix(col, cCol, m.mul(0.9)));
  return col;
});

// ============================================================================
//  海面材质
// ============================================================================
const waterMat = new THREE.MeshBasicNodeMaterial();

// 顶点:Gerstner 位移(按相机距离衰减,远处趋平,与雾无缝衔接)
waterMat.positionNode = Fn(() => {
  const dCam = length(modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz.sub(cameraPosition));
  const f = waveField(positionLocal.xz, distFade(dCam));
  return positionLocal.add(vec3(f.dx, f.dy, f.dz));
})();

// 片元:解析大尺度法线 + FBM 细节法线 + Fresnel 反射 + 浪尖透光 + 太阳闪光 + 泡沫 + 地平线雾
waterMat.colorNode = Fn(() => {
  const P = positionWorld;
  const toCam = cameraPosition.sub(P);
  const dCam = max(length(toCam), 1e-4).toVar();
  const V = toCam.div(dCam);
  const att = distFade(dCam);
  const f = waveField(P.xz, att);
  const Nbig = normalize(cross(vec3(f.Bx, f.By, f.Bz), vec3(f.Tx, f.Ty, f.Tz)));

  // 细节法线:fbm3 三点采样梯度(远处淡出抑制闪烁)
  const detailFade = dCam.mul(-0.0055).exp();
  const np = P.xz.mul(0.35).add(vec2(uTime.mul(0.020), uTime.mul(-0.012)));
  const e = float(0.85);
  const hC = fbm3(np);
  const hX = fbm3(np.add(vec2(e, 0)));
  const hZ = fbm3(np.add(vec2(0, e)));
  const sx = hX.sub(hC).mul(0.35);
  const sz = hZ.sub(hC).mul(0.35);
  const N = normalize(Nbig.add(vec3(sx, 0, sz).negate().mul(uDetail.mul(detailFade))));

  const sunDir = normalize(uSunDir);
  const NdotV = clamp(dot(N, V), 0, 1);
  const NdotL = clamp(dot(N, sunDir), 0, 1);

  // Fresnel(Schlick,F0=0.02)
  const F = float(0.02).add(NdotV.oneMinus().pow(5).mul(0.98)).toVar();

  // 天空反射(共用解析天空 → 云与日盘自然入射,镜像日盘即太阳闪光带)
  const Rr = reflect(V.negate(), N);
  const R = normalize(vec3(Rr.x, max(Rr.y, 0.03), Rr.z));
  const skyR = skyFull(R).toVar();

  // 水体色:深浅水渐变 + 环境光/太阳辐照
  const yn = clamp(f.dy.mul(uInvMaxH).mul(0.5).add(0.5), 0, 1).toVar();
  const body = mix(uDeep, uShallow, sstep(0.2, 0.92, yn));
  const col = body.mul(uAmbient.add(uSunCol.mul(NdotL).mul(0.28))).toVar();

  // 浪尖透光(SSS):背对太阳的波峰透出青绿光
  col.addAssign(
    uSSS.mul(pow(clamp(dot(V, sunDir.negate()), 0, 1), 3))
      .mul(sstep(0.2, 1.0, yn))
      .mul(1.2)
      .mul(NdotV.oneMinus().mul(0.7).add(0.3))
  );

  col.assign(mix(col, skyR.mul(0.92), F));

  // 太阳闪光:高光幂次镜面反射(逐像素法线抖动 → 粼粼波光)
  const H = normalize(V.add(sunDir));
  col.addAssign(uSunCol.mul(pow(clamp(dot(N, H), 0, 1), 560).mul(1.8).mul(F.mul(1.6).add(0.06))));

  // 泡沫:波峰高度 + FBM 密度,高海况时出现白浪花
  const foamN = fbm3(P.xz.mul(0.075).add(vec2(uTime.mul(0.033), uTime.mul(-0.021))));
  const fine = gnoise(P.xz.mul(0.55).add(vec2(uTime.mul(0.11), uTime.mul(0.07)))).mul(0.5).add(0.5);
  const gate = sstep(0.45, 0.8, uSea);
  const crest = yn.mul(0.68).add(foamN.mul(0.42)).add(fine.mul(0.22));
  const fm = sstep(mix(0.95, 0.62, uSea), 1.08, crest)
    .mul(gate)
    .mul(fine.mul(0.55).add(foamN.mul(0.35)).add(0.55).saturate())
    .mul(detailFade.mul(0.85).add(0.15));
  const foamCol = uFoam.mul(uAmbient.mul(1.2).add(uSunCol.mul(NdotL).mul(0.18)));
  col.assign(mix(col, foamCol, fm));

  // 地平线雾:指数雾 + 远缘强制融合(与解析天空在低角度处同色)
  const hd = normalize(vec3(toCam.x.negate(), 0, toCam.z.negate()));
  const fogCol = skyBase(vec3(hd.x, 0.03, hd.z));
  const fogF = max(dCam.mul(-0.0013).exp().oneMinus(), sstep(460, 730, dCam));
  col.assign(mix(col, fogCol, fogF));

  return vec4(col, 1);
})();

// ============================================================================
//  场景组装(boot 中执行)
// ============================================================================
let renderer, scene, camera, controls, postProcessing;
const SUN = new THREE.Vector3();

function buildScene() {
  scene = new THREE.Scene();

  // 天空球:与海面共用 skyFull
  const skyMat = new THREE.MeshBasicNodeMaterial();
  skyMat.colorNode = skyFull(normalize(positionWorld.sub(cameraPosition)));
  skyMat.side = THREE.BackSide;
  skyMat.depthWrite = false;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3600, 64, 40), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // 高密度海面(旋转烘焙进几何体,局部即世界朝向)
  const waterGeo = new THREE.PlaneGeometry(1600, 1600, 384, 384);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.frustumCulled = false;
  scene.add(water);

  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 9000);
  camera.position.set(24, 5.2, 32);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.4, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.7;
  controls.enablePan = false;
  controls.minDistance = 7;
  controls.maxDistance = 140;
  controls.maxPolarAngle = 1.35;
}

async function buildPost() {
  // Bloom 节点:r171 起位于 addons/tsl/display/,旧版本回退 addons/display/
  let bloomFn;
  try {
    ({ bloom: bloomFn } = await import('three/addons/tsl/display/BloomNode.js'));
  } catch {
    ({ bloom: bloomFn } = await import('three/addons/display/BloomNode.js'));
  }
  postProcessing = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode();
  postProcessing.outputNode = sceneColor.add(bloomFn(sceneColor, 0.42, 0.6, 1.02));
}

// ============================================================================
//  昼夜连续调色:按太阳高度在关键帧间平滑插值(CPU 侧,逐帧写入 uniforms)
// ============================================================================
const COLOR_KEYS = ['zenith', 'horizon', 'glow', 'sun', 'disc', 'ambient',
  'deep', 'shallow', 'sss', 'cloudLit', 'cloudDark', 'foam'];
const NUM_KEYS = ['exposure', 'sunI', 'discI', 'glowPow', 'zenCurve'];

const STOPS = [
  { h: -1.00, zenith: 0x0a1424, horizon: 0x32425e, glow: 0x3c5478, sun: 0x46587a, disc: 0x000000, ambient: 0x1c2a44, deep: 0x061020, shallow: 0x0a2030, sss: 0x0c3040, cloudLit: 0x28344c, cloudDark: 0x101828, foam: 0x384858, exposure: 1.50, sunI: 0.50, discI: 0.0, glowPow: 6.0, zenCurve: 2.4 },
  { h: -0.45, zenith: 0x0c1628, horizon: 0x3c4e6c, glow: 0x46608a, sun: 0x506490, disc: 0x000000, ambient: 0x22304e, deep: 0x081424, shallow: 0x0c2436, sss: 0x0e3848, cloudLit: 0x2e3c56, cloudDark: 0x121a2c, foam: 0x405060, exposure: 1.45, sunI: 0.60, discI: 0.0, glowPow: 5.8, zenCurve: 2.3 },
  { h: -0.12, zenith: 0x101c34, horizon: 0x4c6084, glow: 0x5870a0, sun: 0x5e74a4, disc: 0x0a0d14, ambient: 0x2a3a5a, deep: 0x0a182a, shallow: 0x102a3e, sss: 0x124052, cloudLit: 0x384a64, cloudDark: 0x162034, foam: 0x4a5a6a, exposure: 1.40, sunI: 0.75, discI: 0.0, glowPow: 5.5, zenCurve: 2.1 },
  { h: -0.035, zenith: 0x050d1f, horizon: 0x7a4a34, glow: 0xa04e20, sun: 0x9a5c3c, disc: 0xc07040, ambient: 0x1e2a42, deep: 0x020f1a, shallow: 0x062432, sss: 0x0a3a44, cloudLit: 0x784c40, cloudDark: 0x161e2e, foam: 0x2a3640, exposure: 1.26, sunI: 1.1, discI: 1.6, glowPow: 4.8, zenCurve: 1.9 },
  { h: 0.02, zenith: 0x16345e, horizon: 0xc07a50, glow: 0xff6a14, sun: 0xffaa60, disc: 0xffdfb0, ambient: 0x2c3a4e, deep: 0x021a28, shallow: 0x0a4648, sss: 0x0e584e, cloudLit: 0xffbe92, cloudDark: 0x42445c, foam: 0x66767e, exposure: 1.12, sunI: 2.2, discI: 8.0, glowPow: 4.0, zenCurve: 1.7 },
  { h: 0.14, zenith: 0x1c4e94, horizon: 0xc89068, glow: 0xff8420, sun: 0xffd090, disc: 0xfff0d0, ambient: 0x3e5064, deep: 0x032636, shallow: 0x0c5456, sss: 0x10685e, cloudLit: 0xffd8b0, cloudDark: 0x5a5a70, foam: 0x84909a, exposure: 1.06, sunI: 3.6, discI: 12.0, glowPow: 4.2, zenCurve: 1.7 },
  { h: 0.45, zenith: 0x1e56b0, horizon: 0xb0cde6, glow: 0xd8d8c8, sun: 0xfff0d8, disc: 0xffffff, ambient: 0x6e84a0, deep: 0x04283e, shallow: 0x0a5056, sss: 0x0e7268, cloudLit: 0xf8fbff, cloudDark: 0x8c9cb4, foam: 0xb8c8d2, exposure: 1.00, sunI: 6.0, discI: 16.0, glowPow: 5.2, zenCurve: 1.0 },
  { h: 0.95, zenith: 0x1a4aa8, horizon: 0xc0dcf0, glow: 0xe4e0d0, sun: 0xfff6e8, disc: 0xffffff, ambient: 0x7e94ac, deep: 0x052e44, shallow: 0x0c5a5e, sss: 0x12806f, cloudLit: 0xffffff, cloudDark: 0x96a6b8, foam: 0xc6d4dc, exposure: 0.98, sunI: 6.6, discI: 18.0, glowPow: 5.6, zenCurve: 0.85 },
].map((s) => {
  const out = { h: s.h, exposure: s.exposure, sunI: s.sunI, discI: s.discI, glowPow: s.glowPow };
  for (const k of COLOR_KEYS) out[k] = new THREE.Color(s[k]);
  return out;
});

const PAL = {};
for (const k of COLOR_KEYS) PAL[k] = new THREE.Color();
const numPal = {};

function samplePalette(h) {
  const hh = clampJs(h, STOPS[0].h, STOPS[STOPS.length - 1].h);
  let i = 0;
  while (i < STOPS.length - 2 && hh > STOPS[i + 1].h) i++;
  const a = STOPS[i], b = STOPS[i + 1];
  let t = (hh - a.h) / (b.h - a.h);
  t = t * t * (3 - 2 * t);
  for (const k of COLOR_KEYS) PAL[k].copy(a[k]).lerp(b[k], t);
  for (const k of NUM_KEYS) numPal[k] = lerp(a[k], b[k], t);
}

function updateEnvironment(tod) {
  // 太阳轨迹:6 点升起、12 点正午(65°)、18 点落下;方位角自东向西连续旋转
  const elev = Math.sin(((tod - 6) / 12) * Math.PI) * 1.13;
  const az = ((tod - 6) / 12) * Math.PI + Math.PI * 0.5;
  const ce = Math.cos(elev);
  SUN.set(ce * Math.cos(az), Math.sin(elev), ce * Math.sin(az));
  uSunDir.value.copy(SUN);
  samplePalette(Math.sin(elev));
  uZenith.value.copy(PAL.zenith);
  uHorizon.value.copy(PAL.horizon);
  uGlowCol.value.copy(PAL.glow);
  uSunCol.value.copy(PAL.sun).multiplyScalar(numPal.sunI);
  uSunDisc.value.copy(PAL.disc).multiplyScalar(numPal.discI);
  uAmbient.value.copy(PAL.ambient);
  uDeep.value.copy(PAL.deep);
  uShallow.value.copy(PAL.shallow);
  uSSS.value.copy(PAL.sss);
  uCloudLit.value.copy(PAL.cloudLit);
  uCloudDark.value.copy(PAL.cloudDark);
  uFoam.value.copy(PAL.foam);
  uGlowPow.value = numPal.glowPow;
  uZenCurve.value = numPal.zenCurve;
  renderer.toneMappingExposure = numPal.exposure;
}

// ============================================================================
//  UI 与状态
// ============================================================================
// URL 参数可直达场景:?sea=0.8&tod=12&drift=0.2(便于分享特定画面)
const URLP = new URLSearchParams(location.search);
const numParam = (key, def, lo, hi) => {
  const v = parseFloat(URLP.get(key));
  return Number.isFinite(v) ? clampJs(v, lo, hi) : def;
};
const state = {
  sea: numParam('sea', 0.50, 0, 1), tod: numParam('tod', 17.5, 0, 24),
  drift: numParam('drift', 0.40, 0, 1), fpsCap: 60,
  cur: { amp: 0.6, speed: 1.0, detail: 1.1 }, // 平滑趋近目标,避免跳变
};
let dragging = false, lastInteract = -1e9;
let simTime = 0, waveTime = 0, lastNow = -1, lastRender = -1;
let emaMs = 16.6, lastAdapt = 0, renderScale = 1, frames = 0;
const BASE_DPR = clampJs(window.devicePixelRatio || 1, 1, 1.75);

function applySize() {
  renderer.setPixelRatio(BASE_DPR * renderScale);
  renderer.setSize(innerWidth, innerHeight);
  const w = Math.round(innerWidth * BASE_DPR * renderScale);
  const h = Math.round(innerHeight * BASE_DPR * renderScale);
  $('resRead').textContent = `RES ${w}×${h}`;
}

function wireUI() {
  const seaEl = $('seaState'), todEl = $('timeOfDay'), driftEl = $('drift');
  const sync = (el, out, fmt) => {
    const v = { seaState: state.sea, timeOfDay: state.tod, drift: state.drift }[el.id];
    el.value = v; out.textContent = fmt(v);
  };
  sync(seaEl, $('seaVal'), (v) => v.toFixed(2));
  sync(driftEl, $('driftVal'), (v) => v.toFixed(2));
  sync(todEl, $('todVal'), (v) => {
    const h = Math.floor(v) % 24, m = Math.floor((v % 1) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  });
  seaEl.addEventListener('input', () => {
    state.sea = parseFloat(seaEl.value);
    $('seaVal').textContent = state.sea.toFixed(2);
  });
  todEl.addEventListener('input', () => {
    state.tod = parseFloat(todEl.value);
    const h = Math.floor(state.tod) % 24;
    const m = Math.floor((state.tod % 1) * 60);
    $('todVal').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  });
  driftEl.addEventListener('input', () => {
    state.drift = parseFloat(driftEl.value);
    $('driftVal').textContent = state.drift.toFixed(2);
  });
  $('fpsSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-fps]');
    if (!btn) return;
    state.fpsCap = parseInt(btn.dataset.fps, 10);
    for (const b of $('fpsSeg').children) b.classList.toggle('on', b === btn);
  });
  const panel = $('panel'), toggle = $('panelToggle');
  toggle.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    toggle.textContent = panel.classList.contains('collapsed') ? '+' : '—';
  });
  if (innerWidth < 640) { // 小屏默认收起,留给海面
    panel.classList.add('collapsed');
    toggle.textContent = '+';
  }
  controls.addEventListener('start', () => { dragging = true; });
  controls.addEventListener('end', () => { dragging = false; lastInteract = performance.now(); });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    applySize();
  });
  // 标签页隐藏即暂停渲染与模拟,回前台恢复
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      renderer.setAnimationLoop(null);
    } else {
      lastNow = -1;
      renderer.setAnimationLoop(frame);
    }
  });
}

// ============================================================================
//  主循环:FPS 上限 / 自适应分辨率 / 自动漂移 / 相机防入水
// ============================================================================
function frame(now) {
  if (state.fpsCap > 0 && lastRender > 0 && now - lastRender < 1000 / state.fpsCap - 0.75) return;

  if (lastNow < 0) lastNow = now;
  let dt = (now - lastNow) / 1000;
  lastNow = now;
  dt = clampJs(dt, 0, 0.05);
  simTime += dt;

  // ---- 海况参数平滑趋近 ----
  const s = state.sea, cur = state.cur;
  const kk = Math.min(1, dt * 2.0);
  cur.amp = lerp(cur.amp, lerp(0.16, 1.25, Math.pow(s, 1.1)), kk);
  cur.speed = lerp(cur.speed, lerp(0.75, 1.5, s), kk);
  cur.detail = lerp(cur.detail, lerp(1.1, 2.0, s), kk);
  uAmp.value = cur.amp;
  uDetail.value = cur.detail;
  waveTime += dt * cur.speed;
  uWaveTime.value = waveTime;
  uTime.value = simTime;
  uSea.value = s;
  const maxH = AMP_SUM * cur.amp;
  uInvMaxH.value = 1 / maxH;

  updateEnvironment(state.tod);

  // ---- 相机:波峰防穿 + 慢速自动漂移(交互后 2.2s 恢复)----
  const d = camera.position.distanceTo(controls.target);
  const needY = 0.7 + maxH;
  controls.maxPolarAngle =
    Math.acos(clampJs((needY - controls.target.y) / d, 0.04, 0.999));
  controls.autoRotate =
    state.drift > 0.005 && !dragging && (now - lastInteract > 2200 || lastInteract < 0);
  controls.autoRotateSpeed = state.drift * 1.2;
  controls.update();
  if (camera.position.y < needY * 0.92) camera.position.y = needY * 0.92;

  postProcessing.render();

  // ---- 帧统计:FPS 读数 + 自适应分辨率(性能保护)----
  const rawDt = lastRender > 0 ? now - lastRender : 16.6;
  lastRender = now;
  emaMs += (rawDt - emaMs) * 0.08;
  frames++;
  if (frames === 2) {
    const ov = $('overlay');
    ov.classList.add('done');
    setTimeout(() => ov.remove(), 1200);
  }
  if (frames % 30 === 0) {
    $('fpsRead').textContent = `${Math.round(1000 / Math.max(emaMs, 1))} FPS`;
  }
  if (now > 8000 && now - lastAdapt > 2500) {
    if (emaMs > 24 && renderScale > 0.55) {
      renderScale = Math.max(0.55, renderScale * 0.85);
      applySize();
      lastAdapt = now;
    } else if (emaMs < 14 && renderScale < 1) {
      renderScale = Math.min(1, renderScale * 1.1);
      applySize();
      lastAdapt = now;
    }
  }
}

// ============================================================================
//  启动:WebGPU 能力检测 → 初始化 → 首帧
// ============================================================================
async function boot() {
  try {
    const forceWebGL = new URLSearchParams(location.search).has('webgl2'); // 调试用逃生舱
    if (!forceWebGL) {
      if (!('gpu' in navigator)) throw new Error('当前浏览器未暴露 navigator.gpu(WebGPU 不可用)。');
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('WebGPU 适配器获取失败:GPU 驱动可能已禁用 WebGPU,或需要更新浏览器。');
    }
    renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    await renderer.init();
    renderer.domElement.id = 'gl';
    document.body.prepend(renderer.domElement);

    buildScene();
    applySize();
    wireUI();
    await buildPost();

    renderer.setAnimationLoop(frame);
    window.__step = (n = 1) => { for (let i = 0; i < n; i++) frame(performance.now()); }; // DEV-ONLY 手动驱动帧
    window.__frames = () => frames; // DEV-ONLY
    window.__shot = async () => { // DEV-ONLY 异步渲染后读回画布(暂停循环 + 黑帧重试)
      renderer.setAnimationLoop(null);
      await new Promise((r) => setTimeout(r, 80));
      let last = '';
      for (let t = 0; t < 5; t++) {
        await postProcessing.renderAsync();
        const src = renderer.domElement;
        const c = document.createElement('canvas');
        c.width = src.width; c.height = src.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(src, 0, 0);
        last = c.toDataURL('image/jpeg', 0.92);
        const d = ctx.getImageData(src.width >> 1, src.height >> 2, 8, 8).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
        if (sum > 120) break;
      }
      renderer.setAnimationLoop(frame);
      return last;
    };
    window.__shotRT = async () => { // DEV-ONLY 同步渲染到 RT 读像素(绕过合成器),JS 侧 ACES+sRGB
      const w = renderer.domElement.width, h = renderer.domElement.height;
      const rt = new THREE.RenderTarget(w, h);
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      const buf0 = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
      rt.dispose();
      const buf = (buf0 instanceof Uint8Array) ? buf0 : new Uint8Array(buf0);
      let _sum = 0, _max = 0, _nz = 0;
      for (let i = 0; i < buf.length; i++) { _sum += buf[i]; if (buf[i] > _max) _max = buf[i]; if (buf[i]) _nz++; }
      const _stat = { sum: _sum, max: _max, nz: _nz, len: buf.length, ctor: buf0.constructor.name };
      const stride = Math.floor(buf.length / h); // WebGPU 行对齐填充
      const exposure = renderer.toneMappingExposure || 1;
      const IM = [0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
      const OM = [1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.0736, -0.00605, 1.07602];
      const aces = (x, yv, z) => {
        const mx = (m) => [m[0] * x + m[3] * yv + m[6] * z, m[1] * x + m[4] * yv + m[7] * z, m[2] * x + m[5] * yv + m[8] * z];
        let c = mx(IM).map(v => {
          const a = v * (v + 0.0245786) - 0.000090537;
          const b = v * (0.983729 * v + 0.4329510) + 0.238081;
          return Math.max(a / b, 0);
        });
        c = mx(OM).map(v => Math.min(Math.max(v, 0), 1));
        return c.map(v => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
      };
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(w, h);
      const px = img.data;
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const si = (h - 1 - yy) * stride + xx * 4; // RT 原点在左下,按带填充的行距索引
          const di = (yy * w + xx) * 4;
          const rgb = aces(buf[si] / 255, buf[si + 1] / 255, buf[si + 2] / 255);
          px[di] = rgb[0] * 255; px[di + 1] = rgb[1] * 255; px[di + 2] = rgb[2] * 255; px[di + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      window.__lastStat = { ..._stat, w, h };
      return c.toDataURL('image/jpeg', 0.92);
    };
    window.__dev = { THREE, renderer, scene, camera, postProcessing }; // DEV-ONLY
    ready = true;
  } catch (err) {
    showError(err?.message || String(err));
  }
}
boot();
