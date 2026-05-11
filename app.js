import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const container = document.getElementById('scene');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c1c1a);
scene.fog = new THREE.FogExp2(0x1c1c1a, 0.018);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(0, 1.5, 6);

// Image-based lighting for soft, believable stone shading
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.6).texture;

// ---------------------------------------------------------------------------
// Lights — warm key + cool fill, slow "cinematic" rim
// ---------------------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0xb9c4d0, 0x2a2620, 0.55);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff1d8, 2.4);
key.position.set(4, 7, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 30;
key.shadow.camera.left = -4;
key.shadow.camera.right = 4;
key.shadow.camera.top = 6;
key.shadow.camera.bottom = -2;
key.shadow.bias = -0.0004;
scene.add(key);

const fill = new THREE.DirectionalLight(0x8ab0ff, 0.5);
fill.position.set(-5, 3, -2);
scene.add(fill);

const rim = new THREE.SpotLight(0xffd9a0, 18, 18, Math.PI / 7, 0.5, 1.2);
rim.position.set(-3, 6, -5);
scene.add(rim);

// Soft ground catch for the shadow
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(14, 64),
  new THREE.ShadowMaterial({ opacity: 0.32 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Subtle floating dust
const dust = (() => {
  const N = 320;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3 + 0] = (Math.random() - 0.5) * 10;
    pos[i * 3 + 1] = Math.random() * 6;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({
    size: 0.012, color: 0xd9c79a, transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending
  });
  const p = new THREE.Points(g, m);
  scene.add(p);
  return p;
})();

// ---------------------------------------------------------------------------
// Load the statue (MTL + OBJ)
// ---------------------------------------------------------------------------
const ASSET_DIR = 'assets/source/Maria_C/';
const loadMgr = new THREE.LoadingManager();

const loaderEl = document.getElementById('loader');
const barFill = document.getElementById('bar-fill');
const pctEl = document.getElementById('loader-pct');

function setProgress(p, label) {
  const v = Math.max(0, Math.min(1, p));
  barFill.style.width = `${Math.round(v * 100)}%`;
  pctEl.textContent = label || `${Math.round(v * 100)}%`;
}

let statue = null;
let modelHeight = 2;       // world units, filled after load
let centerY = 1;           // vertical centre of the model in world space

const mtlLoader = new MTLLoader(loadMgr).setPath(ASSET_DIR);
mtlLoader.load('Maria_C.mtl', (materials) => {
  materials.preload();
  const objLoader = new OBJLoader(loadMgr).setPath(ASSET_DIR);
  objLoader.setMaterials(materials);
  objLoader.load('Maria_C.obj', (obj) => {
    setProgress(1, 'building…');
    // Normalise transform: centre on origin, scale to a known height,
    // sit it on the ground (y = 0 at the base).
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const targetHeight = 3.0;
    const s = targetHeight / size.y;
    obj.scale.setScalar(s);

    // Re-evaluate after scaling
    obj.position.x -= center.x * s;
    obj.position.z -= center.z * s;
    obj.position.y -= box.min.y * s;   // base to y = 0

    obj.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
        if (!c.geometry.getAttribute('normal')) c.geometry.computeVertexNormals();
        c.geometry.computeBoundingSphere();
        // Convert the MTL's Phong materials to physically-based StandardMaterial
        // so they pick up the environment lighting nicely.
        const convert = (mat) => {
          const map = mat.map || null;
          if (map) {
            map.colorSpace = THREE.SRGBColorSpace;
            map.anisotropy = renderer.capabilities.getMaxAnisotropy();
          }
          const std = new THREE.MeshStandardMaterial({
            map,
            color: map ? 0xffffff : (mat.color ? mat.color.clone() : new THREE.Color(0xcfc7b6)),
            roughness: 0.94,
            metalness: 0.0,
            envMapIntensity: 0.7,
          });
          // the "bottom"/plinth material in the mtl is a flat grey — keep it darker
          if (!map) { std.roughness = 0.98; std.color.multiplyScalar(0.8); }
          return std;
        };
        c.material = Array.isArray(c.material) ? c.material.map(convert) : convert(c.material);
      }
    });

    statue = obj;
    modelHeight = targetHeight;
    centerY = targetHeight * 0.5;
    scene.add(obj);

    // ground slightly under base
    ground.position.y = 0.001;

    // reveal
    requestAnimationFrame(() => {
      loaderEl.classList.add('hidden');
      setTimeout(() => loaderEl.remove(), 1400);
    });
  },
  // OBJ download progress (bytes) — this is the big one (~95 MB)
  (xhr) => {
    if (xhr.lengthComputable) setProgress(xhr.loaded / xhr.total);
    else setProgress(0, `${(xhr.loaded / 1048576).toFixed(1)} MB`);
  },
  (err) => { pctEl.textContent = 'failed to load model'; console.error(err); });
}, undefined, (err) => {
  pctEl.textContent = 'failed to load .mtl';
  console.error(err);
});

// ---------------------------------------------------------------------------
// Scroll-driven cinematic camera
// ---------------------------------------------------------------------------
// Each keyframe is expressed in spherical-ish terms around the statue:
//   t        : normalised scroll position [0..1]
//   radius   : distance from the look-at point
//   azimuth  : horizontal angle (radians) — increasing = revolve around
//   height   : camera Y in world units
//   lookY    : Y of the point the camera aims at (fraction-free, world units)
//   fov      : field of view for extra "zoom" punch
const KEYS = [
  { t: 0.00, radius: 7.2, azimuth: 0.0,            height: 1.7,  lookY: 1.55, fov: 42 }, // wide establishing
  { t: 0.14, radius: 2.2, azimuth: 0.35,           height: 2.55, lookY: 2.62, fov: 30 }, // push in to the face
  { t: 0.30, radius: 5.5, azimuth: Math.PI * 0.85, height: 2.0,  lookY: 1.8,  fov: 40 }, // pull out, swing to side
  { t: 0.46, radius: 1.8, azimuth: Math.PI * 1.15, height: 2.05, lookY: 2.05, fov: 28 }, // close on the gilded heart
  { t: 0.62, radius: 6.0, azimuth: Math.PI * 1.7,  height: 1.5,  lookY: 1.4,  fov: 42 }, // sweep around the drapery
  { t: 0.80, radius: 2.4, azimuth: Math.PI * 2.15, height: 0.55, lookY: 0.45, fov: 34 }, // drop to the base
  { t: 1.00, radius: 8.5, azimuth: Math.PI * 2.6,  height: 1.9,  lookY: 1.5,  fov: 44 }, // final wide, low, turned
];

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function sampleCamera(t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  }
  const span = (b.t - a.t) || 1;
  const k = easeInOutCubic((t - a.t) / span);
  return {
    radius: THREE.MathUtils.lerp(a.radius, b.radius, k),
    azimuth: THREE.MathUtils.lerp(a.azimuth, b.azimuth, k),
    height: THREE.MathUtils.lerp(a.height, b.height, k),
    lookY: THREE.MathUtils.lerp(a.lookY, b.lookY, k),
    fov: THREE.MathUtils.lerp(a.fov, b.fov, k),
  };
}

// Smoothed scroll value
let scrollTarget = 0;   // [0..1]
let scrollNow = 0;

function updateScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  scrollTarget = max > 0 ? window.scrollY / max : 0;
}
window.addEventListener('scroll', updateScroll, { passive: true });
updateScroll();

// Hide the scroll hint once the user moves
const hintEl = document.getElementById('hint');
window.addEventListener('scroll', () => {
  if (window.scrollY > 40) hintEl.style.opacity = '0';
  else hintEl.style.opacity = '';
}, { passive: true });

// Panel reveal on scroll
const panels = [...document.querySelectorAll('.panel')];
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => e.target.classList.toggle('in', e.isIntersecting));
}, { threshold: 0.35 });
panels.forEach((p) => io.observe(p));

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
const lookAt = new THREE.Vector3();
const clock = new THREE.Clock();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);

  // ease the scroll position for buttery camera motion
  scrollNow += (scrollTarget - scrollNow) * (1 - Math.pow(0.0015, dt));

  const cam = sampleCamera(scrollNow);

  // a gentle, ever-present revolve layered on top of the scroll choreography
  const drift = clock.elapsedTime * 0.06;
  const az = cam.azimuth + drift;

  const targetPos = new THREE.Vector3(
    Math.sin(az) * cam.radius,
    cam.height,
    Math.cos(az) * cam.radius
  );

  // soft follow so even fast scrolls feel cinematic
  camera.position.lerp(targetPos, 1 - Math.pow(0.0008, dt));

  lookAt.set(0, cam.lookY, 0);
  // tiny breathing offset on the look target
  lookAt.x += Math.sin(clock.elapsedTime * 0.4) * 0.02;
  camera.lookAt(lookAt);

  const targetFov = cam.fov;
  camera.fov += (targetFov - camera.fov) * (1 - Math.pow(0.02, dt));
  camera.updateProjectionMatrix();

  // animate the dust
  dust.rotation.y += dt * 0.02;

  // keep the rim light orbiting slowly for moving highlights
  rim.position.x = Math.sin(clock.elapsedTime * 0.15) * 5;
  rim.position.z = Math.cos(clock.elapsedTime * 0.15) * 5;

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
