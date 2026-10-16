import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import './style.css';
import * as net from './net.js';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */
const CFG = {
  roadWidth: 12,
  lanes: [-4, 0, 4],
  maxSpeed: 75,          // m/s  (270 km/h)
  boostSpeed: 100,       // m/s  (360 km/h) with nitro
  accel: 26,
  brake: 55,
  drag: 7,
  lateral: 9,
  nitroDrain: 30,        // per second
  nitroRegen: 7,         // per second
  trafficCount: 8,
  dashSpacing: 9,
  dashCount: 36,
  treeSpacing: 14,
  treePerSide: 18,
  trails: 4,
  coinsPerTrail: 6,
  coinGap: 5,
};

/* ------------------------------------------------------------------ */
/*  HUD                                                                */
/* ------------------------------------------------------------------ */
function buildGauge() {
  const P = (v, r) => {
    const a = ((-135 + (v / 360) * 270) * Math.PI) / 180;
    return [100 + r * Math.sin(a), 100 - r * Math.cos(a)];
  };
  let s = '<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="97" class="g-face"/>';
  const [bx1, by1] = P(270, 87);
  const [bx2, by2] = P(360, 87);
  s += `<path d="M${bx1} ${by1} A87 87 0 0 1 ${bx2} ${by2}" class="g-boost"/>`;
  for (let v = 0; v <= 360; v += 20) {
    const major = v % 40 === 0;
    const [x1, y1] = P(v, 93);
    const [x2, y2] = P(v, major ? 77 : 84);
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${major ? 't-major' : 't-minor'}"/>`;
    if (major) {
      const [tx, ty] = P(v, 63);
      s += `<text x="${tx}" y="${ty}" class="t-lbl">${v}</text>`;
    }
  }
  s += '<g id="needle"><line x1="100" y1="108" x2="100" y2="30" class="g-needle"/><circle cx="100" cy="100" r="7" class="g-hub"/></g>';
  s += '<text x="100" y="146" id="gNum" class="g-num">0</text><text x="100" y="162" class="g-unit">km/h</text></svg>';
  return s;
}

document.querySelector('#app').innerHTML = `
  <div id="hud">
    <div class="score"><small>Score</small><span id="score">0</span></div>
    <div class="stats">
      <span class="coin-dot"></span><b id="coins">0</b>
      <span>Distance <b id="dist">0</b> m</span>
      <span>Best <b id="best">0</b></span>
    </div>
    <div id="help">
      W / ↑ gas &nbsp; S / ↓ brake &nbsp; A D / ← → steer<br>
      Shift nitro &nbsp; P pause &nbsp; R restart &nbsp; M sound
    </div>
  </div>
  <div id="dash">
    <div id="gauge">${buildGauge()}</div>
    <div id="nitro"><i id="nitroFill"></i><span>Nitro</span></div>
  </div>
  <div id="message">
    <h1 id="msgTitle"></h1>
    <p id="msgSub"></p>
    <button id="msgBtn" type="button">Start</button>
  </div>
  <div id="touch">
    <div class="pad">
      <button data-k="left">◀</button>
      <button data-k="right">▶</button>
    </div>
    <div class="pad">
      <button data-k="brake">Brake</button>
      <button data-k="nitro" class="nitro-btn">Nitro</button>
      <button data-k="gas">Gas</button>
    </div>
  </div>
`;
const $ = s => document.querySelector(s);
const el = {
  score: $('#score'), coins: $('#coins'), dist: $('#dist'), best: $('#best'),
  msg: $('#message'), title: $('#msgTitle'), sub: $('#msgSub'), btn: $('#msgBtn'),
  needle: $('#needle'), gNum: $('#gNum'), nitro: $('#nitro'), nitroFill: $('#nitroFill'),
};

/* Multiplayer lobby menu */
const lobby = document.createElement('div');

lobby.id = 'multiplayer-lobby';
lobby.style.cssText = `
  position:fixed;top:50%;left:50%;
  transform:translate(-50%,-50%);
  z-index:1000;background:#151923;color:white;
  padding:24px;border-radius:16px;
  width:min(320px,85vw);font-family:Arial;
  text-align:center;box-shadow:0 8px 35px #0009;
`;

lobby.innerHTML = `
  <h2>🏁 Online Race</h2>
  <input id="mp-name" placeholder="Your name"
    maxlength="16" value="Driver"
    style="width:90%;padding:10px;margin:6px">
  <button id="mp-create">Create Room</button>
  <hr>
  <input id="mp-code" placeholder="Room code"
    maxlength="4" style="width:90%;padding:10px;margin:6px;
    text-transform:uppercase">
  <button id="mp-join">Join Room</button>
  <p id="mp-status">Create a room or join your friend.</p>
  <button id="mp-start" disabled>Start Race</button>
  <button id="mp-close">Close</button>
`;

document.body.appendChild(lobby);

const mp = id => document.querySelector('#mp-' + id);

mp('create').onclick = async () => {
  mp('status').textContent = 'Connecting...';
  try {
    await net.connect();
    const result = await net.createRoom(mp('name').value);
    if (!result.ok) throw new Error(result.error);
    mp('code').value = result.room.code;
    mp('status').textContent =
      'Room: ' + result.room.code + '. Share this code with your friend!';
  } catch (err) {
    mp('status').textContent = err.message;
  }
};

mp('join').onclick = async () => {
  mp('status').textContent = 'Joining room...';
  try {
    await net.connect();
    const result = await net.joinRoom(
      mp('code').value.trim().toUpperCase(),
      mp('name').value
    );
    if (!result.ok) throw new Error(result.error);
    mp('status').textContent = 'Joined room: ' + result.room.code;
  } catch (err) {
    mp('status').textContent = err.message;
  }
};

net.on('room', room => {
  mp('code').value = room.code;
  mp('status').textContent =
    'Room ' + room.code + ' | Players: ' +
    room.players.map(p => p.name).join(', ');
  mp('start').disabled = room.players.length < 2;
});

mp('start').onclick = async () => {
  const result = await net.startRace();
  mp('status').textContent = result.ok
    ? 'Race starting!'
    : result.error;
};

mp('close').onclick = () => lobby.style.display = 'none';


/* ------------------------------------------------------------------ */
/*  Renderer / scene / camera                                          */
/* ------------------------------------------------------------------ */
const SKY = 0x87ceeb;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 45, 190);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, 4.8, 11.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

// Reflections make the car paint look real
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
scene.environmentIntensity = 0.6;

scene.add(new THREE.HemisphereLight(0xffffff, 0x52664b, 1.2));

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.set(-10, 20, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 60 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;
const std = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

function box(w, h, d, color, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(color));
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

/* ------------------------------------------------------------------ */
/*  Environment                                                        */
/* ------------------------------------------------------------------ */
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 700),
  std(0x397c3b, { roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.z = -250;
ground.receiveShadow = true;
scene.add(ground);

box(CFG.roadWidth, 0.12, 700, 0x292d33, 0, 0.04, -250);
for (const x of [-CFG.roadWidth / 2 + 0.1, CFG.roadWidth / 2 - 0.1]) {
  box(0.18, 0.15, 700, 0xffffff, x, 0.1, -250);
}

const dashGeo = new THREE.BoxGeometry(0.14, 0.03, 4.2);
const dashMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.6 });
const dashes = [];
for (const x of [-2, 2]) {
  for (let i = 0; i < CFG.dashCount; i++) {
    const d = new THREE.Mesh(dashGeo, dashMat);
    d.position.set(x, 0.11, 20 - i * CFG.dashSpacing);
    d.receiveShadow = true;
    scene.add(d);
    dashes.push(d);
  }
}
const dashSpan = CFG.dashCount * CFG.dashSpacing;

/* ---- Realistic trees: every variant is ONE merged mesh (trunk, branches, leaf clumps) ---- */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _e = new THREE.Euler(), _q = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
function M(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

// Merge parts into one geometry with vertex colours (+ light/dark shading by height)
function mergeParts(parts) {
  const P = [], N = [], C = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  const m3 = new THREE.Matrix3();
  for (const { geo, matrix, color, shade } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position, nor = g.attributes.normal;
    m3.getNormalMatrix(matrix);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const k = shade ? shade(v) : 1;
      v.applyMatrix4(matrix);
      P.push(v.x, v.y, v.z);
      n.fromBufferAttribute(nor, i).applyMatrix3(m3).normalize();
      N.push(n.x, n.y, n.z);
      c.set(color).multiplyScalar(k);
      C.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return out;
}

// Lumpy leaf clump: noisy sphere with smooth normals
function blobGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + 0.13 * (Math.sin(v.x * 3.3 + seed) * Math.cos(v.y * 2.9 + seed * 1.7) + Math.sin(v.z * 3.9 + seed * 0.6));
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
    v.normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

// Ragged-edged pine tier
function coneGeo(seed) {
  const g = new THREE.ConeGeometry(1, 1, 10, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      const f = 1 + 0.14 * Math.sin(a * 7 + seed) + 0.08 * Math.sin(a * 13 + seed * 2);
      pos.setX(i, pos.getX(i) * f);
      pos.setZ(i, pos.getZ(i) * f);
    }
  }
  return g;
}

function trunkGeo(h, r0, r1) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 8, 3);
  g.translate(0, h / 2, 0);
  return g;
}
const flareGeo = r => {
  const g = new THREE.CylinderGeometry(r * 0.95, r * 1.5, 0.35, 8);
  g.translate(0, 0.17, 0);
  return g;
};
const limbGeo = new THREE.CylinderGeometry(0.05, 0.12, 1.4, 6).translate(0, 0.7, 0);

function broadleaf(seed, o) {
  const rng = mulberry32(seed);
  const parts = [];
  const h = o.h * (0.9 + rng() * 0.2);
  parts.push({ geo: trunkGeo(h, o.r0, o.r1), matrix: M(0, 0, 0), color: o.bark });
  parts.push({ geo: flareGeo(o.r0), matrix: M(0, 0, 0), color: o.bark });
  for (let i = 0; i < 3; i++) {
    parts.push({
      geo: limbGeo,
      matrix: M(0, h * (0.55 + rng() * 0.25), 0, 0, rng() * 6.28, 0.55 + rng() * 0.4, 0.8 + rng() * 0.4),
      color: o.bark,
    });
  }
  for (let i = 0; i < o.blobs; i++) {
    const r = o.rMin + rng() * (o.rMax - o.rMin);
    const a = rng() * 6.283;
    const d = i === 0 ? 0 : o.spread * (0.5 + rng() * 0.6);
    const y = h + o.lift + (i === 0 ? 0.5 : rng() * o.height);
    parts.push({
      geo: blobGeo(seed + i * 7),
      matrix: M(Math.cos(a) * d, y, Math.sin(a) * d, 0, rng() * 6.28, 0, r, r * o.squash, r),
      color: o.leaf[i % o.leaf.length],
      shade: v => 0.68 + 0.32 * clamp((v.y + 1) / 2, 0, 1),
    });
  }
  return mergeParts(parts);
}

function pine(seed, o) {
  const rng = mulberry32(seed);
  const parts = [{ geo: trunkGeo(o.h, 0.14, 0.3), matrix: M(0, 0, 0), color: 0x4a3321 }];
  for (let i = 0; i < o.tiers; i++) {
    const t = i / (o.tiers - 1);
    const r = o.r * (1 - t * 0.78) * (0.9 + rng() * 0.2);
    const hh = o.tierH * (1 - t * 0.25);
    parts.push({
      geo: coneGeo(seed + i),
      matrix: M(0, o.base + i * o.step + hh / 2, 0, 0, rng() * 6.28, 0, r, hh, r),
      color: o.leaf[i % o.leaf.length],
      shade: v => 0.62 + 0.45 * clamp(v.y + 0.5, 0, 1),
    });
  }
  return mergeParts(parts);
}

function bush(seed, leaf) {
  const rng = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const r = 0.5 + rng() * 0.45;
    parts.push({
      geo: blobGeo(seed + i),
      matrix: M((rng() - 0.5) * 1.3, r * 0.55, (rng() - 0.5) * 1.3, 0, rng() * 6.28, 0, r, r * 0.75, r),
      color: leaf[i % leaf.length],
      shade: v => 0.65 + 0.35 * clamp((v.y + 1) / 2, 0, 1),
    });
  }
  return mergeParts(parts);
}

const oak = { h: 2.6, r0: 0.38, r1: 0.2, bark: 0x5a3d26, blobs: 7, rMin: 1.3, rMax: 2.1, spread: 1.5, lift: 0.7, height: 1.6, squash: 0.85 };
const treeVariants = [
  broadleaf(11, { ...oak, leaf: [0x2f7d32, 0x3a8c3c, 0x2a6f2d] }),
  broadleaf(23, { ...oak, leaf: [0x3f8f3a, 0x4fa244, 0x357a30], rMax: 2.3 }),
  broadleaf(37, { ...oak, leaf: [0x6aa339, 0x7db843, 0x5a9230], h: 2.2, spread: 1.3 }),
  broadleaf(41, { h: 3.4, r0: 0.2, r1: 0.1, bark: 0xe4e0d4, leaf: [0x8fbf4a, 0x7aae3e], blobs: 5, rMin: 0.9, rMax: 1.4, spread: 0.9, lift: 0.8, height: 1.8, squash: 1.1 }),
  pine(5, { h: 1.4, tiers: 6, r: 2.1, tierH: 1.9, base: 1.1, step: 0.85, leaf: [0x1f5a34, 0x28693b] }),
  pine(9, { h: 1.2, tiers: 7, r: 1.8, tierH: 1.7, base: 0.9, step: 0.78, leaf: [0x1b5230, 0x246338] }),
];
const bushVariants = [
  bush(3, [0x3c8a3a, 0x2f7a31]),
  bush(8, [0x4d9a3e, 0x3a8a38]),
  bush(15, [0x2c6e30, 0x377d34]),
];
const pickTree = () => treeVariants[Math.floor(Math.random() * treeVariants.length)];
const pickBush = () => bushVariants[Math.floor(Math.random() * bushVariants.length)];

const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

const trees = [];
const bushes = [];
const BUSH_PER_SIDE = 22, BUSH_SPACING = 11;
for (const side of [-1, 1]) {
  for (let i = 0; i < CFG.treePerSide; i++) {
    const t = new THREE.Mesh(pickTree(), treeMat);
    t.castShadow = true;
    t.position.set(side * rand(10, 21), 0, 20 - i * CFG.treeSpacing + rand(-4, 4));
    t.rotation.y = rand(0, 6.28);
    t.scale.setScalar(rand(0.9, 1.4));
    t.userData.side = side;
    scene.add(t);
    trees.push(t);
  }
  for (let i = 0; i < BUSH_PER_SIDE; i++) {
    const b = new THREE.Mesh(pickBush(), treeMat);
    b.position.set(side * rand(7.5, 9.5), 0, 20 - i * BUSH_SPACING + rand(-3, 3));
    b.rotation.y = rand(0, 6.28);
    b.scale.setScalar(rand(0.8, 1.3));
    b.userData.side = side;
    scene.add(b);
    bushes.push(b);
  }
}
const treeSpan = CFG.treePerSide * CFG.treeSpacing;
const bushSpan = BUSH_PER_SIDE * BUSH_SPACING;

/* ------------------------------------------------------------------ */
/*  Realistic car (smooth extruded body, glass cabin, rims, lights)    */
/* ------------------------------------------------------------------ */
// Side profiles are drawn with x = forward, then rotated so forward = -z.
function extrude(shape, depth, bevelT, bevelS) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevelT, bevelSize: bevelS,
    bevelSegments: 6, curveSegments: 18,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

const bodyShape = new THREE.Shape();
bodyShape.moveTo(-1.9, 0.3);
bodyShape.lineTo(1.9, 0.3);
bodyShape.quadraticCurveTo(2.3, 0.3, 2.3, 0.62);
bodyShape.quadraticCurveTo(2.3, 0.82, 1.85, 0.88);
bodyShape.lineTo(0.9, 1.0);
bodyShape.lineTo(-1.2, 1.02);
bodyShape.quadraticCurveTo(-2.25, 1.0, -2.3, 0.7);
bodyShape.quadraticCurveTo(-2.35, 0.3, -1.9, 0.3);

const cabinShape = new THREE.Shape();
cabinShape.moveTo(0.95, 0.98);
cabinShape.lineTo(0.2, 1.4);
cabinShape.quadraticCurveTo(0.1, 1.46, -0.1, 1.46);
cabinShape.lineTo(-0.7, 1.46);
cabinShape.quadraticCurveTo(-0.95, 1.44, -1.1, 1.35);
cabinShape.lineTo(-1.55, 1.0);
cabinShape.closePath();

const bodyGeo = extrude(bodyShape, 1.5, 0.14, 0.12);
const cabinGeo = extrude(cabinShape, 1.18, 0.07, 0.06);
const roofGeo = new THREE.BoxGeometry(1.2, 0.05, 1.0);
const tireGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 32);
const rimGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.29, 24);
const spokeGeo = new THREE.BoxGeometry(0.05, 0.3, 0.46);
const archGeo = new THREE.CircleGeometry(0.46, 24, -0.2, Math.PI + 0.4);
const lampGeo = new THREE.SphereGeometry(0.17, 16, 12);
const tailGeo = new THREE.BoxGeometry(0.5, 0.1, 0.06);
const pipeGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12);
const flameGeo = new THREE.ConeGeometry(0.16, 1, 12);
flameGeo.translate(0, 0.5, 0);

const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x0b1622, metalness: 0.2, roughness: 0.05, clearcoat: 1,
});
const rubberMat = std(0x111111, { roughness: 0.95 });
const rimMat = std(0x26262a, { metalness: 0.8, roughness: 0.35 });
const spokeMat = std(0xd9dde2, { metalness: 1, roughness: 0.2 });
const archMat = new THREE.MeshBasicMaterial({ color: 0x080808 });
const darkMat = std(0x0e0e10, { roughness: 0.5 });
const headMat = new THREE.MeshStandardMaterial({
  color: 0xffffff, emissive: 0xfff1b8, emissiveIntensity: 1.6,
});
const chromeMat = std(0x9aa0a8, { metalness: 1, roughness: 0.25 });

function makeCar(color, player = false) {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05,
  });
  const mesh = (geo, mat, x, y, z, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    g.add(m);
    return m;
  };

  mesh(bodyGeo, paint, 0, 0, 0);
  mesh(cabinGeo, glassMat, 0, 0, 0);
  mesh(roofGeo, paint, 0, 1.51, 0.35);

  // side mirrors, grille, plate, splitter, exhaust
  for (const s of [-1, 1]) {
    mesh(new THREE.BoxGeometry(0.16, 0.09, 0.2), paint, s * 0.82, 1.04, -0.75);
    const pipe = mesh(pipeGeo, chromeMat, s * 0.5, 0.38, 2.4);
    pipe.rotation.x = Math.PI / 2;
  }
  mesh(new THREE.BoxGeometry(0.9, 0.14, 0.05), darkMat, 0, 0.55, -2.42);
  mesh(new THREE.BoxGeometry(1.7, 0.04, 0.35), darkMat, 0, 0.3, -2.3);
  mesh(new THREE.BoxGeometry(0.5, 0.12, 0.02), std(0xf2f2f2), 0, 0.62, 2.43, false);

  // lights
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x440000, emissive: 0xff1010, emissiveIntensity: 0.3,
  });
  for (const s of [-1, 1]) {
    const lamp = mesh(lampGeo, headMat, s * 0.62, 0.76, -2.3, false);
    lamp.scale.set(1.5, 0.55, 0.9);
    mesh(tailGeo, tailMat, s * 0.58, 0.82, 2.41, false);
  }

  // wheels + wheel arches
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const z of [-1.3, 1.35]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.8, 0.38, z);
      const wheel = new THREE.Group();
      wheel.add(new THREE.Mesh(tireGeo, rubberMat));
      wheel.add(new THREE.Mesh(rimGeo, rimMat));
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Mesh(spokeGeo, spokeMat);
        sp.rotation.y = (i * Math.PI) / 3;
        wheel.add(sp);
      }
      wheel.rotation.z = Math.PI / 2;
      wheel.children.forEach(m => (m.castShadow = true));
      pivot.add(wheel);
      g.add(pivot);
      wheels.push(pivot);

      const arch = new THREE.Mesh(archGeo, archMat);
      arch.position.set(sx * 0.9, 0.38, z);
      arch.rotation.y = sx * (Math.PI / 2);
      g.add(arch);
    }
  }

  const flames = [];
  if (player) {
    // rear wing
    mesh(new THREE.BoxGeometry(1.55, 0.05, 0.38), darkMat, 0, 1.3, 2.1);
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.05, 0.28, 0.1), darkMat, s * 0.55, 1.15, 2.1);

    // nitro flames at the exhausts
    for (const s of [-1, 1]) {
      const f = new THREE.Group();
      f.position.set(s * 0.5, 0.38, 2.48);
      const outer = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({
        color: 0xff7a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const inner = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({
        color: 0x7fd8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      inner.scale.set(0.5, 0.55, 0.5);
      outer.rotation.x = inner.rotation.x = Math.PI / 2;
      f.add(outer, inner);
      f.visible = false;
      g.add(f);
      flames.push(f);
    }
  }

  scene.add(g);
  return { group: g, wheels, tailMat, flames };
}

const player = makeCar(0xe32135, true);
const car = player.group;
// Multiplayer opponent car
const opponent = makeCar(0x2196f3, true);
opponent.group.visible = false;

let opponentState = null;
// Receive opponent car position from server
net.on('state', data => {
  opponentState = data;
  opponent.group.visible = true;
});
// Start the race when the server signals
net.on('start', data => {
  multiplayerActive = true;
  start();

  const wait = Math.max(0, data.startAt - net.now());
  state = 'ready';

  setTimeout(() => {
    if (multiplayerActive) start();
  }, wait);
});
let multiplayerActive = false;
const TRAFFIC_COLORS = [0x2f6fed, 0xf2b705, 0x22a559, 0xf1f1f1, 0x8a3ffc, 0xff7a1a, 0x2b2b30];
const traffic = [];
for (let i = 0; i < CFG.trafficCount; i++) {
  const t = makeCar(TRAFFIC_COLORS[i % TRAFFIC_COLORS.length]);
  t.speed = rand(14, 30);
  traffic.push(t);
}

function placeTraffic(t, near = false) {
  for (let tries = 0; tries < 12; tries++) {
    const lane = CFG.lanes[Math.floor(Math.random() * CFG.lanes.length)];
    const z = near ? -rand(50, 320) : -rand(230, 380);
    const clear = traffic.every(o =>
      o === t || Math.abs(o.group.position.x - lane) > 1 || Math.abs(o.group.position.z - z) > 30
    );
    if (clear) {
      t.group.position.set(lane, 0, z);
      t.speed = rand(14, 30);
      return;
    }
  }
  t.group.position.set(CFG.lanes[0], 0, -400);
}

/* ------------------------------------------------------------------ */
/*  Coins                                                              */
/* ------------------------------------------------------------------ */
const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.09, 24);
coinGeo.rotateX(Math.PI / 2);
const coinMat = new THREE.MeshStandardMaterial({
  color: 0xffc933, metalness: 0.9, roughness: 0.25, emissive: 0x663d00, emissiveIntensity: 0.6,
});
const trails = [];
for (let i = 0; i < CFG.trails; i++) {
  const coins = [];
  for (let j = 0; j < CFG.coinsPerTrail; j++) {
    const c = new THREE.Mesh(coinGeo, coinMat);
    c.castShadow = true;
    scene.add(c);
    coins.push(c);
  }
  trails.push({ coins, lane: 0, z: 0 });
}
function resetTrail(tr, z) {
  tr.lane = CFG.lanes[Math.floor(Math.random() * CFG.lanes.length)];
  tr.z = z;
  tr.coins.forEach(c => (c.visible = true));
}
function resetTrails() {
  trails.forEach((tr, i) => resetTrail(tr, -(70 + i * 85 + rand(0, 25))));
}

/* ------------------------------------------------------------------ */
/*  Input                                                              */
/* ------------------------------------------------------------------ */
const keys = new Set();
const touch = { left: false, right: false, gas: false, brake: false, nitro: false };
const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'];

addEventListener('keydown', e => {
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);

  if (e.code === 'KeyR') return start();
  if (e.code === 'KeyP') return togglePause();
  if (e.code === 'KeyM') return toggleMute();
  if ((e.code === 'Enter' || e.code === 'Space') && state !== 'playing') {
    if (state === 'paused') togglePause();
    else if (state !== 'crashed' || performance.now() - crashedAt > 500) start();
  }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); if (state === 'playing') togglePause(); });

document.querySelectorAll('#touch button').forEach(b => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    touch[k] = true;
    if (state === 'ready' || state === 'crashed') start();
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
    b.addEventListener(ev, () => (touch[k] = false))
  );
});

el.btn.addEventListener('click', () => {
  el.btn.blur();
  if (state === 'paused') togglePause();
  else if (state !== 'playing') start();
});

const down = (...codes) => codes.some(c => keys.has(c));

/* ------------------------------------------------------------------ */
/*  Audio                                                              */
/* ------------------------------------------------------------------ */
let audio = null;
let muted = false;

function initAudio() {
  if (audio) return audio.ctx.resume();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start();
  audio = { ctx, osc, gain, filter };
}

function updateAudio() {
  if (!audio) return;
  const r = speed / CFG.boostSpeed;
  const t = audio.ctx.currentTime;
  audio.osc.frequency.setTargetAtTime(50 + r * 190 + (boosting ? 30 : 0), t, 0.06);
  audio.filter.frequency.setTargetAtTime(350 + r * 1000, t, 0.06);
  const on = state === 'playing' && !muted;
  audio.gain.gain.setTargetAtTime(on ? 0.05 + r * 0.05 : 0, t, 0.08);
}

function beep(freq, dur = 0.12, vol = 0.12) {
  if (!audio || muted) return;
  const { ctx } = audio;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + dur);
}

function crashSound() {
  if (!audio || muted) return;
  const { ctx } = audio;
  const len = ctx.sampleRate * 0.4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = 0.35;
  src.buffer = buf;
  src.connect(g).connect(ctx.destination);
  src.start();
}

const toggleMute = () => { muted = !muted; };

/* ------------------------------------------------------------------ */
/*  Game state                                                         */
/* ------------------------------------------------------------------ */
let state = 'ready'; // ready | playing | paused | crashed
let speed = 0;
let steer = 0;
let distance = 0;
let spin = 0;
let shake = 0;
let crashedAt = 0;
let coinCount = 0;
let nitro = 100;
let boosting = false;
let shownKmh = 0;
let best = 0;
const BEST_KEY = 'street-racing-best-score';
try { best = +localStorage.getItem(BEST_KEY) || 0; } catch { /* ignore */ }

const getScore = () => Math.floor(distance / 10) + coinCount * 50;

function showMessage(title, sub, label) {
  el.title.textContent = title;
  el.sub.innerHTML = sub;
  el.btn.textContent = label;
  el.msg.classList.add('show');
}
const hideMessage = () => el.msg.classList.remove('show');

function start() {
  initAudio();
  speed = 0; steer = 0; distance = 0; spin = 0; shake = 0;
  coinCount = 0; nitro = 100; boosting = false;
  car.position.set(0, 0, 0);
  car.rotation.set(0, 0, 0);
  opponent.group.position.set(0, 0, -30);
opponent.group.visible = false;
opponentState = null;
  traffic.forEach(t => t.group.position.set(0, 0, -999));
  traffic.forEach(t => placeTraffic(t, true));
  resetTrails();
  state = 'playing';
  hideMessage();
}

function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    showMessage('Paused', 'Press <b>P</b> to continue', 'Resume');
  } else if (state === 'paused') {
    state = 'playing';
    hideMessage();
  }
}

function crash() {
  state = 'crashed';
  crashedAt = performance.now();
  boosting = false;
  spin = (Math.random() < 0.5 ? -1 : 1) * 5;
  shake = 1;
  crashSound();
  const score = getScore();
  let sub = `Score <b>${score}</b><br>Coins <b>${coinCount}</b> &nbsp; Distance <b>${Math.floor(distance)} m</b>`;
  if (score > best) {
    best = score;
    try { localStorage.setItem(BEST_KEY, best); } catch { /* ignore */ }
    sub += '<br>New best score!';
  }
  showMessage('Game Over', sub, 'Restart');
}

/* ------------------------------------------------------------------ */
/*  Update                                                             */
/* ------------------------------------------------------------------ */
function update(dt) {
  const crashed = state === 'crashed';

  const gas = !crashed && (down('KeyW', 'ArrowUp') || touch.gas);
  const brake = crashed || down('KeyS', 'ArrowDown', 'Space') || touch.brake;
  const dir = crashed ? 0 :
    (down('KeyD', 'ArrowRight') || touch.right ? 1 : 0) -
    (down('KeyA', 'ArrowLeft') || touch.left ? 1 : 0);

  // Nitro
  const wantNitro = !crashed && (down('ShiftLeft', 'ShiftRight', 'KeyE') || touch.nitro);
  if (wantNitro && nitro > 0 && (boosting || nitro >= 8)) {
    boosting = true;
    nitro = Math.max(0, nitro - CFG.nitroDrain * dt);
  } else {
    boosting = false;
    if (!crashed) nitro = Math.min(100, nitro + CFG.nitroRegen * dt);
  }

  // Speed
  if (boosting) speed += CFG.accel * 2.2 * dt;
  else if (gas) speed += CFG.accel * (1 - (Math.min(speed, CFG.maxSpeed) / CFG.maxSpeed) * 0.65) * dt;
  else speed -= CFG.drag * dt;
  if (brake) speed -= (crashed ? 32 : CFG.brake) * dt;
  const top = boosting ? CFG.boostSpeed : CFG.maxSpeed;
  if (speed > top) speed = Math.max(top, speed - 20 * dt);
  speed = clamp(speed, 0, CFG.boostSpeed);

  // Steering
  steer += (dir - steer) * Math.min(1, dt * 8);
  const grip = clamp(speed / 10, 0, 1);
  const lat = CFG.lateral * (1 - 0.35 * (speed / CFG.boostSpeed));
  const limit = CFG.roadWidth / 2 - 1.1;
  car.position.x = clamp(car.position.x + steer * grip * lat * dt, -limit, limit);

  if (crashed) {
    car.rotation.y += spin * dt;
    spin *= 0.96;
  } else {
    car.rotation.y = -steer * 0.16 * grip;
    car.rotation.z = steer * 0.035 * grip;
  }

  player.tailMat.emissiveIntensity = brake ? 2.2 : 0.3;
  player.wheels.forEach(w => (w.rotation.x -= (speed * dt) / 0.38));
  player.flames.forEach(f => {
    f.visible = boosting;
    if (boosting) f.scale.set(1, 1, rand(1.6, 2.8));
  });
  if (boosting) shake = Math.max(shake, 0.12);

  // World scroll
  const move = speed * dt;
  distance += move;

  for (const d of dashes) {
    d.position.z += move;
    if (d.position.z > 20) d.position.z -= dashSpan;
  }
  for (const t of trees) {
    t.position.z += move;
    if (t.position.z > 20) {
      t.position.z -= treeSpan;
      t.position.x = t.userData.side * rand(10, 21);
      t.geometry = pickTree();
      t.rotation.y = rand(0, 6.28);
      t.scale.setScalar(rand(0.9, 1.4));
    }
  }
  for (const b of bushes) {
    b.position.z += move;
    if (b.position.z > 20) {
      b.position.z -= bushSpan;
      b.position.x = b.userData.side * rand(7.5, 9.5);
      b.geometry = pickBush();
      b.rotation.y = rand(0, 6.28);
      b.scale.setScalar(rand(0.8, 1.3));
    }
  }

  // Coins
  for (const tr of trails) {
    tr.z += move;
    tr.coins.forEach((c, j) => {
      c.position.set(tr.lane, 1.1, tr.z - j * CFG.coinGap);
      c.rotation.y += dt * 3.5;
      if (state === 'playing' && c.visible &&
          Math.abs(c.position.x - car.position.x) < 1.4 &&
          Math.abs(c.position.z - car.position.z) < 2.4) {
        c.visible = false;
        coinCount++;
        nitro = Math.min(100, nitro + 12);
        beep(880 + (coinCount % 5) * 80);
      }
    });
    if (tr.z - (CFG.coinsPerTrail - 1) * CFG.coinGap > 12) resetTrail(tr, -rand(240, 360));
  }

  // Traffic + collision
  for (const t of traffic) {
    const p = t.group.position;
    p.z += (speed - t.speed) * dt;
    t.wheels.forEach(w => (w.rotation.x -= (t.speed * dt) / 0.38));
    if (p.z > 20 || p.z < -420) placeTraffic(t);

    if (state === 'playing' &&
        Math.abs(p.x - car.position.x) < 1.7 &&
        Math.abs(p.z - car.position.z) < 4.5) {
      crash();
    }
  }

  // Update the opponent car from network data
if (multiplayerActive && opponentState) {
  opponent.group.visible = true;

  const targetX = opponentState.x ?? 0;
  const targetZ = -(opponentState.d - distance);

  opponent.group.position.x +=
    (targetX - opponent.group.position.x) * 0.15;

  opponent.group.position.z +=
    (targetZ - opponent.group.position.z) * 0.15;
} else {
  opponent.group.visible = false;
}

  sun.position.set(car.position.x - 10, 20, 10);
  sun.target.position.set(car.position.x, 0, 0);
}

function updateCamera(dt) {
  const r = speed / CFG.boostSpeed;
  const tx = car.position.x * 0.55;
  camera.position.x += (tx - camera.position.x) * Math.min(1, dt * 4);
  camera.position.y = 4.8 + r * 0.4;
  camera.position.z = 11.5 + r * 1.4;

  if (shake > 0.01) {
    camera.position.x += rand(-1, 1) * shake * 0.4;
    camera.position.y += rand(-1, 1) * shake * 0.3;
    shake *= 0.9;
  }

  const fov = 62 + r * 16 + (boosting ? 10 : 0);
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
  camera.lookAt(car.position.x * 0.6, 1, -8);
}

function updateHud(dt) {
  const kmh = speed * 3.6;
  shownKmh += (kmh - shownKmh) * Math.min(1, dt * 10);
  el.needle.setAttribute('transform', `rotate(${-135 + (clamp(shownKmh, 0, 360) / 360) * 270} 100 100)`);
  el.gNum.textContent = Math.round(kmh);
  el.score.textContent = getScore();
  el.coins.textContent = coinCount;
  el.dist.textContent = Math.floor(distance);
  el.best.textContent = best;
  el.nitroFill.style.width = `${nitro}%`;
  el.nitro.classList.toggle('active', boosting);
}

/* ------------------------------------------------------------------ */
/*  Main loop                                                          */
/* ------------------------------------------------------------------ */
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state === 'playing' || state === 'crashed') update(dt);
  // Multiplayer: send our car state
if (multiplayerActive && state === 'playing') {
  net.sendState({
    x: car.position.x,
    d: distance,
    s: speed,
    y: 0,
    b: boosting,
    w: false
  });
}
  updateCamera(dt);
  updateHud(dt);
  updateAudio();
  renderer.render(scene, camera);
}

resetTrails();
traffic.forEach(t => placeTraffic(t, true));
showMessage(
  'Street Racing',
  'Dodge the traffic and collect coins<br>Hold <b>Shift</b> for nitro',
  'Start'
);
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});