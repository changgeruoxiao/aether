/**
 * Ocean Cinema — WebGPU / Three.js TSL procedural ocean
 * Native ES Modules · no textures / models / HDRI / video
 */

/* ------------------------------------------------------------------ */
/* Module load (CDN import map)                                         */
/* ------------------------------------------------------------------ */

const loadingEl = document.getElementById('loading');
const loadingCard = document.getElementById('loading-card');
const loadingTitle = document.getElementById('loading-title');
const loadingDesc = document.getElementById('loading-desc');
const loadingStatus = document.getElementById('loading-status');
const hudEl = document.getElementById('hud');
const pauseTag = document.getElementById('pause-tag');
const backendBadge = document.getElementById('backend-badge');
const seaInput = document.getElementById('sea-state');
const todInput = document.getElementById('time-of-day');
const driftInput = document.getElementById('drift');
const seaVal = document.getElementById('sea-val');
const todVal = document.getElementById('tod-val');
const driftVal = document.getElementById('drift-val');
const fpsVal = document.getElementById('fps-val');
const dprVal = document.getElementById('dpr-val');
const canvas = document.getElementById('gl');

function setLoading(text, ok = false) {
  loadingStatus.textContent = text;
  loadingStatus.className = ok ? 'status ok' : 'status';
}

function showError(title, message, hints = []) {
  loadingCard.classList.add('error');
  loadingTitle.textContent = title;
  loadingDesc.textContent = message;
  loadingStatus.className = 'status err';
  loadingStatus.textContent = hints.length ? hints.join(' · ') : message;
  loadingEl.classList.remove('hidden');
}

let THREE;
let tsl;
let OrbitControls;
let bloomFn = null;

try {
  setLoading('加载 three.js WebGPU / TSL 模块…');
  THREE = await import('three/webgpu');
  tsl = await import('three/tsl');
  const addon = await import('three/addons/controls/OrbitControls.js');
  OrbitControls = addon.OrbitControls;

  // Bloom lives in addons for three@0.172 — not three/tsl
  try {
    const bloomMod = await import('three/addons/tsl/display/BloomNode.js');
    bloomFn = bloomMod.bloom;
  } catch (e) {
    console.warn('[Ocean] BloomNode addon unavailable:', e);
  }

  setLoading('模块就绪', true);
} catch (err) {
  console.error(err);
  showError('模块加载失败', '无法从 CDN 加载 three.js WebGPU 构建。', [
    '检查网络是否可访问 unpkg.com',
    '使用 Chrome 113+ / Edge 113+',
    '本地服务：npx serve . 或 python -m http.server',
  ]);
  throw err;
}

const {
  Fn,
  uniform,
  varyingProperty,
  positionLocal,
  cameraPosition,
  modelWorldMatrix,
  vec2,
  vec3,
  vec4,
  float,
  sin,
  cos,
  pow,
  exp,
  floor,
  fract,
  mix,
  max,
  min,
  clamp,
  smoothstep,
  dot,
  normalize,
  length,
  reflect,
  pass,
} = tsl;

/* ------------------------------------------------------------------ */
/* DOM state                                                            */
/* ------------------------------------------------------------------ */

const params = {
  seaState: 0.5,
  timeOfDay: 8.5,
  drift: 0.35,
};

function formatTOD(hours) {
  const h = ((Math.floor(hours) % 24) + 24) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

seaInput.addEventListener('input', () => {
  params.seaState = parseFloat(seaInput.value);
  seaVal.textContent = params.seaState.toFixed(2);
});

todInput.addEventListener('input', () => {
  params.timeOfDay = parseFloat(todInput.value);
  todVal.textContent = formatTOD(params.timeOfDay);
});

driftInput.addEventListener('input', () => {
  params.drift = parseFloat(driftInput.value);
  driftVal.textContent = params.drift.toFixed(2);
});

todVal.textContent = formatTOD(params.timeOfDay);
seaVal.textContent = params.seaState.toFixed(2);
driftVal.textContent = params.drift.toFixed(2);

/* ------------------------------------------------------------------ */
/* WebGPU detection                                                     */
/* ------------------------------------------------------------------ */

async function detectWebGPU() {
  if (!navigator.gpu) {
    throw new Error(
      '当前浏览器不支持 WebGPU（navigator.gpu 不存在）。请使用 Chrome 113+ 或 Edge 113+。'
    );
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error(
      '无法获取 GPU Adapter。请更新显卡驱动，或在 chrome://flags 确认 WebGPU 已启用。'
    );
  }
  return adapter;
}

/* ------------------------------------------------------------------ */
/* Math helpers (CPU)                                                   */
/* ------------------------------------------------------------------ */

function smoothstepJS(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-6)));
  return t * t * (3 - 2 * t);
}

function mixRGB(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/* ------------------------------------------------------------------ */
/* Performance / visibility                                             */
/* ------------------------------------------------------------------ */

let perfDPR = 1;
let currentSegments = 280;
const PLANE_SIZE = 720;
let ready = false;
let paused = false;
let frames = 0;
let lastFpsTime = 0;
let fpsSmooth = 60;
let lowFpsTime = 0;
let dprReduceCooldown = 0;

function getDPR() {
  return Math.min(window.devicePixelRatio || 1, 2, perfDPR);
}

document.addEventListener('visibilitychange', () => {
  paused = document.hidden;
  pauseTag.classList.toggle('show', paused);
});

/* ------------------------------------------------------------------ */
/* Init                                                                 */
/* ------------------------------------------------------------------ */

async function init() {
  try {
    setLoading('检测 WebGPU 能力…');
    await detectWebGPU();
    setLoading('WebGPU adapter 可用', true);

    setLoading('创建 WebGPURenderer…');
    const renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setClearColor(0x050a12, 1);
    renderer.setPixelRatio(getDPR());

    setLoading('初始化图形后端…');
    await renderer.init();

    const backend = renderer.backend;
    let backendName = 'WebGPU';
    if (backend) {
      if (backend.isWebGPUBackend || backend.constructor?.name?.includes('WebGPU')) {
        backendName = 'WebGPU';
      } else if (backend.constructor?.name?.includes('WebGL')) {
        backendName = 'WebGL2 (fallback)';
      } else {
        backendName = backend.constructor?.name || 'WebGPU';
      }
    }
    backendBadge.textContent = backendName;

    const width = window.innerWidth;
    const height = window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 2000);
    camera.position.set(0, 7.5, 22);

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0.4, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minPolarAngle = 0.18;
    controls.maxPolarAngle = Math.PI * 0.485;
    controls.minDistance = 6;
    controls.maxDistance = 90;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.7;
    controls.panSpeed = 0.45;
    controls.autoRotate = true;
    controls.autoRotateSpeed = params.drift * 1.8;

    /* -------------------------------------------------------------- */
    /* Uniforms                                                       */
    /* -------------------------------------------------------------- */

    const uTime = uniform(0);
    const uSeaState = uniform(params.seaState);
    const uAmpMul = uniform(0.25 + params.seaState * 0.85);
    const uSteepMul = uniform(0.35 + params.seaState * 0.9);
    const uSunDir = uniform(new THREE.Vector3(0.4, 0.6, 0.5).normalize());
    const uSunColor = uniform(new THREE.Color(1, 0.92, 0.8));
    const uSunIntensity = uniform(0.9);
    const uSkyZenith = uniform(new THREE.Color(0.07, 0.2, 0.42));
    const uSkyHorizon = uniform(new THREE.Color(0.42, 0.58, 0.7));
    const uDayFactor = uniform(1);
    const uGoldenFactor = uniform(0);
    const uDeepColor = uniform(new THREE.Color(0.015, 0.06, 0.12));
    const uShallowColor = uniform(new THREE.Color(0.04, 0.18, 0.24));
    const uSSSColor = uniform(new THREE.Color(0.15, 0.55, 0.42));
    const uCloudCover = uniform(0.4);
    const uFogDensity = uniform(0.004);

    /* -------------------------------------------------------------- */
    /* TSL: gradient noise + FBM                                      */
    /* -------------------------------------------------------------- */

    const hash2 = Fn(([p]) => {
      const n = sin(p.dot(vec2(127.1, 311.7))).mul(43758.5453123);
      const a = fract(n).mul(float(6.28318530718));
      return vec2(cos(a), sin(a));
    });

    const gnoise = Fn(([p]) => {
      const i = floor(p);
      const f = fract(p);
      const u = f.mul(f).mul(f.mul(float(-2)).add(float(3)));
      const ga = hash2(i);
      const gb = hash2(i.add(vec2(1.0, 0.0)));
      const gc = hash2(i.add(vec2(0.0, 1.0)));
      const gd = hash2(i.add(vec2(1.0, 1.0)));
      const va = ga.dot(f);
      const vb = gb.dot(f.sub(vec2(1.0, 0.0)));
      const vc = gc.dot(f.sub(vec2(0.0, 1.0)));
      const vd = gd.dot(f.sub(vec2(1.0, 1.0)));
      return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y);
    });

    const fbm3 = Fn(([p]) => {
      const n1 = gnoise(p);
      const n2 = gnoise(p.mul(float(2.03)).add(vec2(19.7, 47.2)));
      const n3 = gnoise(p.mul(float(4.07)).add(vec2(73.1, 11.5)));
      return n1.mul(float(0.5)).add(n2.mul(float(0.25))).add(n3.mul(float(0.125)));
    });

    /* -------------------------------------------------------------- */
    /* TSL: shared analytic sky (sun disk, halo, cloud bands, grading) */
    /* -------------------------------------------------------------- */

    const skyFn = Fn(([dir]) => {
      const nd = normalize(dir);
      const up = max(nd.y, float(0.0));
      const zenith = uSkyZenith;
      const horizon = uSkyHorizon;
      const sunDir = uSunDir;
      const sunCol = uSunColor;
      const sunInt = uSunIntensity;
      const dayF = uDayFactor;

      const skyGrad = mix(horizon, zenith, pow(up, float(0.55)));

      const cosSun = max(dot(nd, sunDir), float(0.0));
      const sunDisk = smoothstep(float(0.99915), float(0.99975), cosSun);
      const halo =
        pow(cosSun, float(48.0)).mul(float(0.32))
          .add(pow(cosSun, float(10.0)).mul(float(0.14)))
          .add(pow(cosSun, float(2.5)).mul(float(0.05)));

      // Low-altitude procedural cloud bands (analytic, shared with reflection)
      const bandX = nd.x.div(max(nd.y, float(0.05)).mul(float(0.45)).add(float(0.03)));
      const bandZ = nd.z.div(max(nd.y, float(0.05)).mul(float(0.45)).add(float(0.03)));
      const wind = vec2(uTime.mul(float(0.008)), uTime.mul(float(0.0035)));
      const cloudP = vec2(bandX, bandZ).mul(float(0.12)).add(wind);
      const c1 = fbm3(cloudP);
      const c2 = fbm3(cloudP.mul(float(1.65)).add(vec2(4.2, 9.1)));
      const cloudRaw = c1.mul(float(0.62)).add(c2.mul(float(0.38)));
      const horizonBand = smoothstep(float(0.0), float(0.07), nd.y).mul(
        float(1.0).sub(smoothstep(float(0.12), float(0.52), nd.y))
      );
      const cloud = smoothstep(float(0.22), float(0.58), cloudRaw)
        .mul(horizonBand)
        .mul(uCloudCover);

      const cloudCol = zenith.mul(float(0.75))
        .add(horizon.mul(float(0.55)))
        .add(sunCol.mul(pow(cosSun, float(3.0))).mul(float(0.28)).mul(dayF));

      const withClouds = mix(skyGrad, cloudCol, cloud.mul(float(0.88)));
      const withSun = withClouds
        .add(sunCol.mul(sunDisk).mul(sunInt).mul(float(22.0)))
        .add(sunCol.mul(halo).mul(sunInt));

      // WGSL requires edge0 < edge1: invert to get 0 at horizon, 1 below
      const below = float(1.0).sub(smoothstep(float(-0.08), float(0.0), nd.y));
      return mix(withSun, horizon.mul(float(0.32)), below.mul(float(0.85)));
    });

    /* -------------------------------------------------------------- */
    /* TSL: Gerstner ×5 + analytic tangents                           */
    /* -------------------------------------------------------------- */

    function waveNodes(px, pz, dx0, dy0, amp, steep, wavelength, speed) {
      const d = vec2(dx0, dy0).normalize();
      const A = float(amp).mul(uAmpMul);
      const w = float(Math.PI * 2).div(float(wavelength));
      const Q = float(steep)
        .mul(uSteepMul)
        .div(w.mul(A).mul(float(5)).add(float(0.0001)));
      const phase = w.mul(d.x.mul(px).add(d.y.mul(pz))).add(float(speed).mul(uTime));
      const s = sin(phase);
      const c = cos(phase);
      const dispX = Q.mul(A).mul(d.x).mul(c);
      const dispY = A.mul(s);
      const dispZ = Q.mul(A).mul(d.y).mul(c);
      const wa = w.mul(A);
      const ws = w.mul(A).mul(Q);
      return { d, A, s, c, dispX, dispY, dispZ, wa, ws };
    }

    const vWorldPos = varyingProperty('vec3');
    const vNormal = varyingProperty('vec3');
    const vFoam = varyingProperty('float');
    const vCrest = varyingProperty('float');
    const vWaveH = varyingProperty('float');

    const oceanMaterial = new THREE.MeshBasicNodeMaterial({
      color: 0x0a3050,
      side: THREE.FrontSide,
    });

    oceanMaterial.positionNode = Fn(() => {
      const px = positionLocal.x;
      const pz = positionLocal.z;

      // Five Gerstner waves — high-density sea state
      const w1 = waveNodes(px, pz, 0.85, 0.32, 0.48, 0.32, 22.0, 0.75);
      const w2 = waveNodes(px, pz, 0.62, 0.78, 0.30, 0.28, 14.0, 0.95);
      const w3 = waveNodes(px, pz, -0.35, 0.92, 0.20, 0.30, 9.5, 1.1);
      const w4 = waveNodes(px, pz, 0.9, -0.28, 0.14, 0.26, 6.2, 1.25);
      const w5 = waveNodes(px, pz, -0.55, -0.72, 0.09, 0.22, 3.8, 1.4);

      const dx = w1.dispX.add(w2.dispX).add(w3.dispX).add(w4.dispX).add(w5.dispX);
      const dy = w1.dispY.add(w2.dispY).add(w3.dispY).add(w4.dispY).add(w5.dispY);
      const dz = w1.dispZ.add(w2.dispZ).add(w3.dispZ).add(w4.dispZ).add(w5.dispZ);

      // Analytical tangents: T = ∂P/∂x, B = ∂P/∂z
      const txx = float(1)
        .sub(w1.ws.mul(w1.d.x).mul(w1.d.x).mul(w1.s))
        .sub(w2.ws.mul(w2.d.x).mul(w2.d.x).mul(w2.s))
        .sub(w3.ws.mul(w3.d.x).mul(w3.d.x).mul(w3.s))
        .sub(w4.ws.mul(w4.d.x).mul(w4.d.x).mul(w4.s))
        .sub(w5.ws.mul(w5.d.x).mul(w5.d.x).mul(w5.s));

      const txy = w1.wa.mul(w1.d.x).mul(w1.c)
        .add(w2.wa.mul(w2.d.x).mul(w2.c))
        .add(w3.wa.mul(w3.d.x).mul(w3.c))
        .add(w4.wa.mul(w4.d.x).mul(w4.c))
        .add(w5.wa.mul(w5.d.x).mul(w5.c));

      const txz = float(0)
        .sub(w1.ws.mul(w1.d.x).mul(w1.d.y).mul(w1.s))
        .sub(w2.ws.mul(w2.d.x).mul(w2.d.y).mul(w2.s))
        .sub(w3.ws.mul(w3.d.x).mul(w3.d.y).mul(w3.s))
        .sub(w4.ws.mul(w4.d.x).mul(w4.d.y).mul(w4.s))
        .sub(w5.ws.mul(w5.d.x).mul(w5.d.y).mul(w5.s));

      const bzx = float(0)
        .sub(w1.ws.mul(w1.d.x).mul(w1.d.y).mul(w1.s))
        .sub(w2.ws.mul(w2.d.x).mul(w2.d.y).mul(w2.s))
        .sub(w3.ws.mul(w3.d.x).mul(w3.d.y).mul(w3.s))
        .sub(w4.ws.mul(w4.d.x).mul(w4.d.y).mul(w4.s))
        .sub(w5.ws.mul(w5.d.x).mul(w5.d.y).mul(w5.s));

      const bzy = w1.wa.mul(w1.d.y).mul(w1.c)
        .add(w2.wa.mul(w2.d.y).mul(w2.c))
        .add(w3.wa.mul(w3.d.y).mul(w3.c))
        .add(w4.wa.mul(w4.d.y).mul(w4.c))
        .add(w5.wa.mul(w5.d.y).mul(w5.c));

      const bzz = float(1)
        .sub(w1.ws.mul(w1.d.y).mul(w1.d.y).mul(w1.s))
        .sub(w2.ws.mul(w2.d.y).mul(w2.d.y).mul(w2.s))
        .sub(w3.ws.mul(w3.d.y).mul(w3.d.y).mul(w3.s))
        .sub(w4.ws.mul(w4.d.y).mul(w4.d.y).mul(w4.s))
        .sub(w5.ws.mul(w5.d.y).mul(w5.d.y).mul(w5.s));

      // N = normalize(cross(B, T)) → (By*Tz-Bz*Ty, Bz*Tx-Bx*Tz, Bx*Ty-By*Tx)
      const nrm = normalize(
        vec3(
          bzy.mul(txz).sub(bzz.mul(txy)),
          bzz.mul(txx).sub(bzx.mul(txz)),
          bzx.mul(txy).sub(bzy.mul(txx))
        )
      );

      // Foam: Jacobian fold + crest height
      const jac = txx.mul(bzz).sub(txz.mul(bzx));
      const fold = clamp(
        float(1.0).sub(clamp(jac, float(0.15), float(1.4))).mul(float(1.15)),
        float(0),
        float(1)
      );
      const hNorm = dy.div(uAmpMul.mul(float(2.1)).add(float(0.02)));
      const crest = smoothstep(float(0.12), float(0.7), hNorm);
      const foam = max(fold, crest.mul(float(0.8))).mul(
        uSeaState.mul(float(0.65)).add(float(0.35))
      );

      const displaced = vec3(px.add(dx), dy, pz.add(dz));
      const wp = modelWorldMatrix.mul(vec4(displaced, float(1.0))).xyz;

      vWorldPos.assign(wp);
      vNormal.assign(nrm);
      vFoam.assign(foam);
      vCrest.assign(crest);
      vWaveH.assign(hNorm);

      return displaced;
    })();

    oceanMaterial.colorNode = Fn(() => {
      const N = normalize(vNormal);
      const P = vWorldPos;
      const V = normalize(cameraPosition.sub(P));
      const L = uSunDir;
      const R = reflect(V.mul(float(-1.0)), N);

      const dayF = uDayFactor;
      const sunCol = uSunColor;
      const sunInt = uSunIntensity;

      const NdV = max(dot(N, V), float(0.0));
      const fresnel = float(0.02).add(
        float(0.98).mul(pow(float(1.0).sub(NdV), float(5.0)))
      );

      const wh = clamp(vWaveH.mul(float(0.5)).add(float(0.5)), float(0.0), float(1.0));
      const baseWater = mix(
        uDeepColor,
        uShallowColor,
        wh.mul(float(0.8)).add(vFoam.mul(float(0.2)))
      );

      // Three-layer gradient noise / FBM detail on color + micro-normal feel
      const detail = fbm3(P.xz.mul(float(0.22)).add(uTime.mul(float(0.04))));
      const micro = fbm3(P.xz.mul(float(0.9)).sub(uTime.mul(float(0.07))));
      const detailMix = detail.mul(float(0.35)).add(micro.mul(float(0.15)));

      const skyUp = skyFn(vec3(float(0.0), float(1.0), float(0.0)));
      const skySide = skyFn(normalize(vec3(R.x, float(0.18), R.z)));
      const ambient = skyUp.mul(float(0.30)).add(skySide.mul(float(0.22)));
      const refl = skyFn(R);

      const VdotL = max(dot(V.mul(float(-1.0)), L), float(0.0));
      const sss = pow(VdotL, float(3.0))
        .mul(vCrest)
        .mul(uSSSColor)
        .mul(sunInt)
        .mul(dayF)
        .mul(float(0.9));

      const H = normalize(L.add(V));
      const NdH = max(dot(N, H), float(0.0));
      const glitterBreak = smoothstep(
        float(0.25),
        float(0.8),
        fbm3(N.xz.mul(float(16.0)).add(uTime.mul(float(0.35))))
      );
      const spec1 = pow(NdH, float(240.0)).mul(float(2.6));
      const spec2 = pow(NdH, float(42.0)).mul(float(0.42));
      const glitter = spec1
        .add(spec2)
        .mul(float(0.35).add(float(0.65).mul(glitterBreak)))
        .mul(sunCol)
        .mul(sunInt)
        .mul(dayF);

      const body = baseWater
        .mul(ambient.mul(float(1.15)).add(baseWater.mul(float(0.4)).mul(dayF)))
        .mul(float(0.85).add(detailMix));

      const waterCol = body
        .add(refl.mul(fresnel.mul(float(0.95))))
        .add(glitter)
        .add(sss);

      const foamN = fbm3(P.xz.mul(float(0.4)).add(uTime.mul(float(0.03))));
      const foamDetail = fbm3(P.xz.mul(float(1.5)).sub(uTime.mul(float(0.06))));
      const foamMask = clamp(
        vFoam
          .mul(float(0.7))
          .add(foamN.mul(float(0.4)).mul(vFoam))
          .sub(foamDetail.mul(float(0.12))),
        float(0),
        float(1)
      );
      const foam = smoothstep(float(0.2), float(0.65), foamMask);
      const foamBase = mix(
        vec3(0.62, 0.68, 0.74),
        vec3(0.93, 0.96, 1.0),
        dayF
      );
      const foamLit = foamBase
        .mul(
          ambient.mul(float(1.15)).add(
            sunCol.mul(max(dot(N, L), float(0.0))).mul(sunInt).mul(float(0.55))
          )
        )
        .add(refl.mul(float(0.12)));

      const mixed = mix(waterCol, foamLit, foam);

      // Horizon fog — blend into analytic sky horizon
      const toCam = P.sub(cameraPosition);
      const dist = length(toCam);
      const fogF = clamp(
        float(1.0).sub(exp(dist.mul(uFogDensity).mul(float(-1.0)))),
        float(0.0),
        float(0.93)
      );
      const fogCol = uSkyHorizon
        .mul(float(0.88))
        .add(uSkyZenith.mul(float(0.12)))
        .add(uSunColor.mul(uGoldenFactor).mul(float(0.15)));
      return mix(mixed, fogCol, fogF);
    })();

    /* -------------------------------------------------------------- */
    /* Ocean mesh                                                     */
    /* -------------------------------------------------------------- */

    let oceanMesh = null;

    function buildOceanGeometry(segments) {
      const geo = new THREE.PlaneGeometry(
        PLANE_SIZE,
        PLANE_SIZE,
        segments,
        segments
      );
      geo.rotateX(-Math.PI / 2);
      return geo;
    }

    function rebuildOcean(segments) {
      const old = oceanMesh;
      oceanMesh = new THREE.Mesh(buildOceanGeometry(segments), oceanMaterial);
      oceanMesh.frustumCulled = false;
      oceanMesh.renderOrder = 0;
      scene.add(oceanMesh);
      if (old) {
        scene.remove(old);
        old.geometry?.dispose?.();
      }
      currentSegments = segments;
    }

    setLoading('构建高密度海面网格…');
    rebuildOcean(currentSegments);

    /* -------------------------------------------------------------- */
    /* Sky dome (shares skyFn + sun uniforms)                         */
    /* -------------------------------------------------------------- */

    const skyMaterial = new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: true,
    });

    skyMaterial.colorNode = Fn(() => {
      const dir = normalize(positionLocal);
      return skyFn(dir);
    })();

    const skyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(900, 48, 32),
      skyMaterial
    );
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -1;
    scene.add(skyMesh);

    /* -------------------------------------------------------------- */
    /* Atmosphere (day-night continuous grading)                      */
    /* -------------------------------------------------------------- */

    const sunDirTmp = new THREE.Vector3();

    function updateAtmosphere(timeOfDay, seaState) {
      const dayAngle = ((timeOfDay - 6) / 24) * Math.PI * 2;
      const sunY = Math.sin(dayAngle);
      const sunX = Math.cos(dayAngle) * 0.9;
      const sunZ = Math.cos(dayAngle) * 0.35 + 0.2;
      sunDirTmp.set(sunX, sunY, sunZ).normalize();

      const dayF = smoothstepJS(-0.08, 0.22, sunY);
      const goldenF = Math.exp(-Math.pow((sunY - 0.1) * 5.5, 2));

      const zenithN = [0.008, 0.014, 0.04];
      const zenithD = [0.07, 0.2, 0.42];
      const zenithG = [0.2, 0.24, 0.42];
      const horizonN = [0.025, 0.04, 0.08];
      const horizonD = [0.42, 0.58, 0.7];
      const horizonG = [0.88, 0.48, 0.28];

      const zenith = mixRGB(mixRGB(zenithN, zenithD, dayF), zenithG, goldenF * 0.45);
      const horizon = mixRGB(mixRGB(horizonN, horizonD, dayF), horizonG, goldenF * 0.72);

      let sunCol = mixRGB([0.55, 0.65, 0.85], [1.0, 0.96, 0.88], dayF);
      sunCol = mixRGB(sunCol, [1.0, 0.52, 0.22], goldenF * 0.85);
      const sunInt = dayF * (0.35 + 0.65 * Math.max(sunY, 0)) + 0.04 * (1 - dayF);

      const deep = mixRGB([0.004, 0.008, 0.02], [0.015, 0.06, 0.12], dayF);
      const shallow = mixRGB([0.008, 0.02, 0.04], [0.04, 0.18, 0.24], dayF);
      const shallowG = mixRGB(shallow, [0.09, 0.2, 0.18], goldenF * 0.5);
      const sss = mixRGB([0.05, 0.08, 0.12], [0.15, 0.55, 0.42], dayF);

      uSunDir.value.copy(sunDirTmp);
      uSunColor.value.setRGB(sunCol[0], sunCol[1], sunCol[2]);
      uSunIntensity.value = sunInt;
      uSkyZenith.value.setRGB(zenith[0], zenith[1], zenith[2]);
      uSkyHorizon.value.setRGB(horizon[0], horizon[1], horizon[2]);
      uDayFactor.value = dayF;
      uGoldenFactor.value = goldenF;
      uDeepColor.value.setRGB(deep[0], deep[1], deep[2]);
      uShallowColor.value.setRGB(shallowG[0], shallowG[1], shallowG[2]);
      uSSSColor.value.setRGB(sss[0], sss[1], sss[2]);
      uCloudCover.value = 0.22 + seaState * 0.58;
      uFogDensity.value = 0.0032 + seaState * 0.0022;
    }

    /* -------------------------------------------------------------- */
    /* Post-processing: TSL Bloom + ACES                              */
    /* -------------------------------------------------------------- */

    let postProcessing = null;
    try {
      if (typeof THREE.PostProcessing === 'function' && typeof bloomFn === 'function') {
        setLoading('配置 TSL Bloom…');
        postProcessing = new THREE.PostProcessing(renderer);
        const scenePass = pass(scene, camera);
        const sceneColor = scenePass.getTextureNode();
        // bloom(inputNode, strength, radius, threshold)
        const bloomPass = bloomFn(sceneColor, 0.48, 0.8, 0.75);
        postProcessing.outputNode = sceneColor.add(bloomPass);
      } else {
        console.warn(
          '[Ocean] PostProcessing/Bloom unavailable, using direct render.',
          { PostProcessing: !!THREE.PostProcessing, bloomFn: typeof bloomFn }
        );
      }
    } catch (err) {
      console.warn('[Ocean] Bloom setup failed:', err);
      postProcessing = null;
    }

    /* -------------------------------------------------------------- */
    /* Resize                                                           */
    /* -------------------------------------------------------------- */

    function onResize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(getDPR());
    }

    window.addEventListener('resize', onResize);
    onResize();

    /* -------------------------------------------------------------- */
    /* FPS + performance protection                                   */
    /* -------------------------------------------------------------- */

    function updateFPS(now) {
      frames += 1;
      if (now - lastFpsTime < 400) return;
      const fps = (frames * 1000) / (now - lastFpsTime);
      fpsSmooth = fpsSmooth * 0.7 + fps * 0.3;
      frames = 0;
      lastFpsTime = now;

      fpsVal.textContent = fpsSmooth.toFixed(0);
      fpsVal.className =
        'stat-v ' + (fpsSmooth >= 45 ? 'ok' : fpsSmooth >= 25 ? 'warn' : 'bad');
      dprVal.textContent = getDPR().toFixed(2);

      if (dprReduceCooldown > 0) {
        dprReduceCooldown -= 1;
        return;
      }

      if (fpsSmooth < 28) {
        lowFpsTime += 0.4;
        if (lowFpsTime > 2.0) {
          if (perfDPR > 0.75) {
            perfDPR = Math.max(0.75, perfDPR - 0.25);
            renderer.setPixelRatio(getDPR());
            dprReduceCooldown = 5;
          } else if (currentSegments > 140) {
            rebuildOcean(Math.max(140, Math.floor(currentSegments * 0.7)));
            dprReduceCooldown = 8;
          }
          lowFpsTime = 0;
        }
      } else {
        lowFpsTime = Math.max(0, lowFpsTime - 0.25);
      }
    }

    /* -------------------------------------------------------------- */
    /* Animation                                                      */
    /* -------------------------------------------------------------- */

    let elapsed = 0;
    let lastTime = performance.now();

    renderer.setAnimationLoop((now) => {
      if (paused || !ready) {
        lastTime = now;
        return;
      }

      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      elapsed += dt;

      uTime.value = elapsed;
      uSeaState.value = params.seaState;
      uAmpMul.value = 0.25 + params.seaState * 0.85;
      uSteepMul.value = 0.35 + params.seaState * 0.9;
      updateAtmosphere(params.timeOfDay, params.seaState);

      controls.autoRotate = params.drift > 0.005;
      controls.autoRotateSpeed = params.drift * 1.8;
      controls.update();

      skyMesh.position.copy(camera.position);

      if (postProcessing) {
        postProcessing.render();
      } else {
        renderer.render(scene, camera);
      }

      updateFPS(now);
    });

    /* -------------------------------------------------------------- */
    /* Warm-up frame + reveal UI                                      */
    /* -------------------------------------------------------------- */

    setLoading('热身渲染…');
    updateAtmosphere(params.timeOfDay, params.seaState);
    skyMesh.position.copy(camera.position);
    if (postProcessing) postProcessing.render();
    else renderer.render(scene, camera);

    ready = true;
    lastFpsTime = performance.now();
    backendBadge.textContent = backendName;
    dprVal.textContent = getDPR().toFixed(2);

    setLoading('就绪 · 五组 Gerstner 波已驱动', true);
    loadingEl.classList.add('hidden');
    hudEl.hidden = false;

    console.info(
      `[Ocean Cinema] ready · backend=${backendName} · segments=${currentSegments} · dpr=${getDPR()}`
    );
  } catch (err) {
    console.error(err);
    showError('初始化失败', err?.message || String(err), [
      '确认浏览器支持 WebGPU',
      '通过 localhost/HTTPS 打开（ES Modules 需要）',
      '查看开发者工具控制台获取详情',
    ]);
  }
}

init();
