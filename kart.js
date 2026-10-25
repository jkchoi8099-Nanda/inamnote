// 이남 카트: 이동읍 → 남사읍 → 이동저수지 한 바퀴(실제 버스 노선 길 모양, data/kart_track.js)를 달리는 3D 카트 게임.
// 2026-10-21. 그림은 three.js(jsDelivr), 물리·상대 카트·아이템·소리는 이 파일 하나. 경주로 원본은 scripts/build_kart.py.
// 시험용 주소: kart.html?auto (내 카트도 자동으로 달림), ?laps=1, ?go (시작 화면 건너뜀), ?touch (휴대폰 버튼)
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";

const TR = window.KART_TRACK;
const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TOUCH = matchMedia("(pointer: coarse)").matches || Q.has("touch");
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const store = {
  get(k, d) { try { const v = localStorage.getItem("inamkart." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("inamkart." + k, JSON.stringify(v)); } catch { /* 사생활 보호 창 등 */ } },
};
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = mulberry32(20261021); // 풍경은 매번 같은 자리에
// 표지판 글자를 Pretendard로 그리려고 글꼴을 잠깐(최대 1.5초) 기다린다
await Promise.race([document.fonts?.load('800 80px "Pretendard Variable"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});

/* ───────── 경주로 ───────── */
const HALF = 7; // 도로 반폭(m)
const N = TR.points.length;
const PX = new Float32Array(N), PZ = new Float32Array(N), TX = new Float32Array(N), TZ = new Float32Array(N);
const NX = new Float32Array(N), NZ = new Float32Array(N), K = new Float32Array(N), S = new Float32Array(N + 1);
for (let i = 0; i < N; i++) { PX[i] = TR.points[i][0]; PZ[i] = TR.points[i][1]; }
let L = 0;
for (let i = 0; i < N; i++) { const j = (i + 1) % N; S[i] = L; L += Math.hypot(PX[j] - PX[i], PZ[j] - PZ[i]); }
S[N] = L;
const STEP = L / N;
for (let i = 0; i < N; i++) {
  const a = (i - 1 + N) % N, b = (i + 1) % N;
  const tx = PX[b] - PX[a], tz = PZ[b] - PZ[a], l = Math.hypot(tx, tz) || 1;
  TX[i] = tx / l; TZ[i] = tz / l; NX[i] = -TZ[i]; NZ[i] = TX[i]; // N = 진행 방향 오른쪽
}
for (let i = 0; i < N; i++) { // 굽음(+면 오른쪽으로 굽음), 1/반지름
  const a = (i - 2 + N) % N, b = (i + 2) % N;
  K[i] = (TX[a] * TZ[b] - TZ[a] * TX[b]) / (4 * STEP);
}
const idxOf = (s) => (Math.floor((((s % L) + L) % L) / STEP)) % N;
const wrapS = (s) => ((s % L) + L) % L;
const wrapDiff = (a) => ((((a + L / 2) % L) + L) % L) - L / 2;
function sample(s, o = {}) {
  s = wrapS(s);
  const f = s / STEP, i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
  o.x = PX[i] + (PX[j] - PX[i]) * t; o.z = PZ[i] + (PZ[j] - PZ[i]) * t;
  let tx = TX[i] + (TX[j] - TX[i]) * t, tz = TZ[i] + (TZ[j] - TZ[i]) * t;
  const l = Math.hypot(tx, tz) || 1; o.tx = tx / l; o.tz = tz / l; o.nx = -o.tz; o.nz = o.tx; o.i = i;
  return o;
}

// 가까운 길 찾기용 격자
const CELL = 16, grid = new Map();
const gkey = (cx, cz) => (cx + 2048) * 4096 + (cz + 2048);
for (let i = 0; i < N; i++) {
  const k = gkey(Math.floor(PX[i] / CELL), Math.floor(PZ[i] / CELL));
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
}
function nearest(x, z, skip = -1, skipW = 0, rad = 3) { // → 가장 가까운 길 가운데선까지 거리
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let best = 1e12;
  for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
    const arr = grid.get(gkey(cx + dx, cz + dz));
    if (!arr) continue;
    for (const i of arr) {
      if (skip >= 0) { let di = Math.abs(i - skip); di = Math.min(di, N - di); if (di <= skipW) continue; }
      const d = (PX[i] - x) ** 2 + (PZ[i] - z) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}
// 울타리 거리: 기본 HALF+15, 옆에 다른 길이 가까우면 두 길 사이 가운데에
const WALL = [new Float32Array(N), new Float32Array(N)]; // 0 왼쪽, 1 오른쪽
for (let i = 0; i < N; i++) for (let sd = 0; sd < 2; sd++) {
  const sg = sd ? 1 : -1;
  let w = HALF + 15;
  for (let d = HALF + 2; d <= HALF + 15; d += 1) {
    if (nearest(PX[i] + NX[i] * d * sg, PZ[i] + NZ[i] * d * sg, i, 14) < d) { w = d - 1.5; break; }
  }
  WALL[sd][i] = Math.max(HALF + 1, w);
}

/* ───────── 렌더러·장면 ───────── */
const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
let pixelRatio = Math.min(devicePixelRatio || 1, TOUCH ? 1.75 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const scene = new THREE.Scene();
const HORIZON = new THREE.Color("#D3EDF7");
scene.background = HORIZON;
scene.fog = new THREE.Fog(HORIZON, 260, 1100);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 5000);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(3500, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color("#4FA6EA") }, mid: { value: HORIZON } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 mid; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(mid, top, pow(h, 0.7)), 1.0);\n#include <colorspace_fragment>\n}",
  }),
);
scene.add(sky);

const hemi = new THREE.HemisphereLight("#E4F4FF", "#6E8B4A", 1.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#FFF2DA", 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(TOUCH ? 1024 : 2048, TOUCH ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun, sun.target);

/* ───────── 그림 도구 ───────── */
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function speckle(g, w, h, n, colors, size = 2) {
  for (let k = 0; k < n; k++) { g.fillStyle = colors[(R() * colors.length) | 0]; g.fillRect(R() * w, R() * h, size * (0.5 + R()), size * (0.5 + R())); }
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
const FONT = '"Pretendard Variable", Pretendard, system-ui, "Malgun Gothic", sans-serif';
function fitText(g, text, maxW, size, weight = 800) {
  let s = size;
  do { g.font = `${weight} ${s}px ${FONT}`; s -= 2; } while (g.measureText(text).width > maxW && s > 10);
}
// 리본: 길 가운데선에서 a~b(오른쪽 +) 만큼 띠. i0~i1 점 구간(i1은 N을 넘어도 됨)
function ribbon(a, b, y, vLen, i0 = 0, i1 = N) {
  const cnt = i1 - i0 + 1;
  const pos = new Float32Array(cnt * 6), uv = new Float32Array(cnt * 4), nor = new Float32Array(cnt * 6), index = [];
  for (let k = 0; k < cnt; k++) {
    const ii = (i0 + k) % N, v = ((i0 + k) * STEP) / vLen;
    pos.set([PX[ii] + NX[ii] * a, y, PZ[ii] + NZ[ii] * a, PX[ii] + NX[ii] * b, y, PZ[ii] + NZ[ii] * b], k * 6);
    uv.set([0, v, 1, v], k * 4);
    nor.set([0, 1, 0, 0, 1, 0], k * 6);
    if (k < cnt - 1) { const o = k * 2; index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setIndex(index);
  return g;
}
// 바닥에 눕힌 사각형(가운데 x,z, 진행 방향 t, 길이 len, 폭 wid)
function groundQuad(x, z, tx, tz, len, wid, y) {
  const nx = -tz, nz = tx, hl = len / 2, hw = wid / 2;
  const p = [[-hl, -hw], [-hl, hw], [hl, -hw], [hl, hw]].map(([a, b]) => [x + tx * a + nx * b, y, z + tz * a + nz * b]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(p.flat()), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  return g;
}
const faceTo = (obj, dx, dz) => { obj.rotation.y = Math.atan2(dx, dz); }; // 물체의 +z가 (dx,dz)를 보게

/* ───────── 땅·길 ───────── */
const grassTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#7DBF5F"; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 1800, ["#74B657", "#86C866", "#6FAE52", "#8CCB6B"], 3);
});
grassTex.repeat.set(6000 / 26, 6000 / 26);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ map: grassTex }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const roadTex = canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = "#5A6069"; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 2600, ["#535962", "#626872", "#5E646D", "#4F555E"], 2);
  g.fillStyle = "#F3F4F5"; g.fillRect(5, 0, 4, h); g.fillRect(w - 9, 0, 4, h);
  g.fillStyle = "#F2C230"; g.fillRect(w / 2 - 5, 0, 3, h); g.fillRect(w / 2 + 2, 0, 3, h); // 노란 중앙선(겹선)
});
const road = new THREE.Mesh(ribbon(-HALF, HALF, 0.06, 8), new THREE.MeshLambertMaterial({ map: roadTex }));
road.receiveShadow = true;
scene.add(road);
const shoulder = new THREE.Mesh(ribbon(-HALF - 1.8, HALF + 1.8, 0.03, 8), new THREE.MeshLambertMaterial({ color: "#D8CCA8" }));
shoulder.receiveShadow = true;
scene.add(shoulder);

// 굽이 안쪽 빨강·하양 연석
const curbTex = canvasTex(16, 64, (g, w, h) => { g.fillStyle = "#F4F4F4"; g.fillRect(0, 0, w, h); g.fillStyle = "#E5484D"; g.fillRect(0, 0, w, h / 2); });
const curbMat = new THREE.MeshLambertMaterial({ map: curbTex });
for (let i = 0; i < N;) {
  if (Math.abs(K[i]) < 1 / 48) { i++; continue; }
  const sg = Math.sign(K[i]);
  let j = i;
  while (j < N + 2 && Math.abs(K[j % N]) >= 1 / 48 && Math.sign(K[j % N]) === sg) j++;
  const a = sg > 0 ? HALF - 0.4 : -HALF - 1.3, b = sg > 0 ? HALF + 1.3 : -HALF + 0.4;
  const m = new THREE.Mesh(ribbon(a, b, 0.075, 2.4, Math.max(0, i - 2), j + 2), curbMat);
  m.receiveShadow = true;
  scene.add(m);
  i = j + 1;
}

// 출발선
{
  const t = sample(0);
  const chk = canvasTex(256, 32, (g, w, h) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? "#191F28" : "#FFFFFF"; g.fillRect(x * 16, y * 16, 16, 16); } }, false);
  const m = new THREE.Mesh(groundQuad(t.x, t.z, t.tx, t.tz, 2.2, HALF * 2, 0.085), new THREE.MeshLambertMaterial({ map: chk }));
  scene.add(m);
}

/* ───────── 이동저수지 ───────── */
const LAKE = { x: TR.lake[0], z: TR.lake[1], r: [] };
{
  const n = 72;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    let r = 8;
    for (let rr = 8; rr < 230; rr += 3) { if (nearest(LAKE.x + dx * rr, LAKE.z + dz * rr) < HALF + 20) break; r = rr; }
    LAKE.r.push(r);
  }
  for (let pass = 0; pass < 3; pass++) LAKE.r = LAKE.r.map((_, k, A) => Math.min(A[k], (A[(k + n - 1) % n] + A[k] * 2 + A[(k + 1) % n]) / 4));
  LAKE.r = LAKE.r.map((r, k) => r * (0.9 + 0.08 * Math.sin(k * 0.9) + 0.04 * Math.sin(k * 2.3)));
  const shape = (grow) => {
    const sh = new THREE.Shape();
    LAKE.r.forEach((r, k) => { const a = (k / n) * Math.PI * 2, x = LAKE.x + Math.cos(a) * (r + grow), z = LAKE.z + Math.sin(a) * (r + grow); k ? sh.lineTo(x, -z) : sh.moveTo(x, -z); });
    return new THREE.ShapeGeometry(sh, 2);
  };
  const sand = new THREE.Mesh(shape(5), new THREE.MeshLambertMaterial({ color: "#D9CCA3" }));
  const water = new THREE.Mesh(shape(0), new THREE.MeshStandardMaterial({ color: "#3FA2D3", roughness: 0.18, metalness: 0.05 }));
  sand.rotation.x = water.rotation.x = -Math.PI / 2;
  sand.position.y = 0.02; water.position.y = 0.05;
  sand.receiveShadow = water.receiveShadow = true;
  scene.add(sand, water);
}
function lakeR(x, z) {
  const a = Math.atan2(z - LAKE.z, x - LAKE.x), n = LAKE.r.length;
  const f = (((a / (Math.PI * 2)) * n) % n + n) % n, i = Math.floor(f) % n, t = f - Math.floor(f);
  return LAKE.r[i] * (1 - t) + LAKE.r[(i + 1) % n] * t;
}
const inLake = (x, z, m = 0) => Math.hypot(x - LAKE.x, z - LAKE.z) < lakeR(x, z) + m;

/* ───────── 풍경(나무·논·비닐하우스·집·산·구름) ───────── */
const bb = { x0: Math.min(...PX), x1: Math.max(...PX), z0: Math.min(...PZ), z1: Math.max(...PZ) };
const mid = { x: (bb.x0 + bb.x1) / 2, z: (bb.z0 + bb.z1) / 2 };
const taken = []; // 집·하우스 자리(겹침 방지)
const freeSpot = (x, z, r) => taken.every((t) => Math.hypot(t[0] - x, t[1] - z) > t[2] + r);
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

function instanced(geo, mat, list, setup, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  list.forEach((it, k) => { setup(it, dummy); dummy.updateMatrix(); m.setMatrixAt(k, dummy.matrix); if (it.c) m.setColorAt(k, tmpColor.set(it.c)); });
  m.count = list.length;
  m.castShadow = shadow; m.receiveShadow = true;
  scene.add(m);
  return m;
}

// 집: 랜드마크(마을) 둘레에. 출발점(송전)·남사에는 더 많이
const houses = [];
const ROOFS = ["#2F8F83", "#D9653B", "#4C78A8", "#8A8F98", "#B5523B", "#3F7F5F"];
const WALLS = ["#F6F2EA", "#ECE6DA", "#FFFFFF", "#E9EEF0"];
for (const [s, name] of [[8, "송전"], ...TR.landmarks]) {
  const many = name === "송전" || name.includes("남사") ? 22 : 9;
  for (let k = 0, tries = 0; k < many && tries < 200; tries++) {
    const t = sample(s + (R() - 0.5) * 140), side = R() < 0.5 ? -1 : 1, off = HALF + 12 + R() * 60;
    const x = t.x + t.nx * off * side, z = t.z + t.nz * off * side;
    const w = 6 + R() * 5, d = 6 + R() * 4, h = 3 + R() * 1.6;
    if (nearest(x, z) < HALF + 8 + Math.max(w, d) / 2 || inLake(x, z, 12) || !freeSpot(x, z, Math.max(w, d) * 0.75)) continue;
    taken.push([x, z, Math.max(w, d) * 0.75]);
    houses.push({ x, z, w, d, h, a: Math.atan2(t.tx, t.tz) + (R() < 0.3 ? Math.PI / 2 : 0) + (R() - 0.5) * 0.3, wall: WALLS[(R() * 4) | 0], roof: ROOFS[(R() * ROOFS.length) | 0] });
    k++;
  }
}
const roofGeo = (() => { // 세모 지붕(가로 1, 높이 1, 깊이 1, 용마루는 z 방향)
  const v = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5];
  const f = [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(f.flatMap((i) => v.slice(i * 3, i * 3 + 3))), 3));
  g.computeVertexNormals();
  return g;
})();
instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial(), houses.map((o) => ({ ...o, c: o.wall })), (o, d) => {
  d.position.set(o.x, 0, o.z); d.rotation.set(0, o.a, 0); d.scale.set(o.w, o.h, o.d);
});
instanced(roofGeo, new THREE.MeshLambertMaterial({ flatShading: true }), houses.map((o) => ({ ...o, c: o.roof })), (o, d) => {
  d.position.set(o.x, o.h, o.z); d.rotation.set(0, o.a, 0); d.scale.set(o.w * 1.12, 1.6 + o.w * 0.12, o.d * 1.1);
});

// 비닐하우스(남사 화훼단지 느낌): 무리마다 나란히
const tunnels = [];
for (let gI = 0, tries = 0; gI < 14 && tries < 400; tries++) {
  const t = sample(R() * L), side = R() < 0.5 ? -1 : 1, off = HALF + 30 + R() * 90;
  const cx = t.x + t.nx * off * side, cz = t.z + t.nz * off * side, a = Math.atan2(t.nx, t.nz) + (R() - 0.5) * 0.4;
  const cnt = 4 + ((R() * 5) | 0), len = 26 + R() * 10;
  const list = [];
  for (let k = 0; k < cnt; k++) {
    const o = (k - (cnt - 1) / 2) * 7.5, x = cx + Math.cos(a) * o, z = cz - Math.sin(a) * o;
    const ex = Math.sin(a) * len / 2, ez = Math.cos(a) * len / 2;
    if ([[x, z], [x + ex, z + ez], [x - ex, z - ez]].some(([px, pz]) => nearest(px, pz) < HALF + 7 || inLake(px, pz, 8))) continue;
    list.push({ x, z, a, len });
  }
  if (list.length < 3 || !freeSpot(cx, cz, len * 0.7)) continue;
  taken.push([cx, cz, len * 0.7]);
  tunnels.push(...list);
  gI++;
}
instanced(
  new THREE.CylinderGeometry(3, 3, 1, 14, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: "#EEF4F0", transparent: true, opacity: 0.88 }),
  tunnels, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.set(0, o.a, 0); d.scale.set(1, 1, o.len); },
);

// 논(10월이라 누렇게 익은 벼·벤 논·푸른 논)
const paddies = [];
for (let tries = 0; tries < 900 && paddies.length < 260; tries++) {
  const x = bb.x0 - 200 + R() * (bb.x1 - bb.x0 + 400), z = bb.z0 - 200 + R() * (bb.z1 - bb.z0 + 400);
  const w = 16 + R() * 18, d = 24 + R() * 26, a = R() * Math.PI;
  const c = Math.cos(a), s = Math.sin(a);
  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]].map(([u, v]) => [x + u * c + v * s, z - u * s + v * c]);
  if (corners.some(([px, pz]) => nearest(px, pz) < HALF + 4 || inLake(px, pz, 6))) continue;
  paddies.push({ x, z, w, d, a, y: 0.012 + paddies.length * 0.00006, c: ["#E6BE4B", "#DDB143", "#EFCB62", "#9FCB57", "#CDB47D", "#D8B651"][(R() * 6) | 0] });
}
instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial(), paddies, (o, d) => {
  d.position.set(o.x, o.y, o.z); d.rotation.set(0, o.a, 0); d.scale.set(o.w, 1, o.d);
}, false);

// 나무: 무리 지어. 길가에는 노란 은행나무
const trees = [];
const density = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.013 - 0.7) + 0.25 * Math.sin(x * 0.037 + z * 0.029);
for (let tries = 0; tries < 6000 && trees.length < 1100; tries++) {
  const x = bb.x0 - 260 + R() * (bb.x1 - bb.x0 + 520), z = bb.z0 - 260 + R() * (bb.z1 - bb.z0 + 520);
  const dn = nearest(x, z);
  if (dn < HALF + 6 || inLake(x, z, 7) || !freeSpot(x, z, 3)) continue;
  const roadside = dn < HALF + 11;
  if (!roadside && R() > density(x, z) * 0.9) continue;
  if (roadside && R() > 0.35) continue;
  const kind = roadside ? "ginkgo" : R() < 0.35 ? "pine" : "round";
  trees.push({ x, z, kind, s: 0.8 + R() * 0.6, c: kind === "ginkgo" ? "#F5C33B" : kind === "pine" ? ["#3B7A49", "#2F6B3E", "#46874F"][(R() * 3) | 0] : ["#F0B23C", "#E8823A", "#D9573B", "#7DB956", "#5E9F4C", "#E9A23B"][(R() * 6) | 0] });
}
instanced(new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6).translate(0, 1.1, 0), new THREE.MeshLambertMaterial({ color: "#7A5338" }), trees.map(({ c, ...o }) => o), (o, d) => {
  d.position.set(o.x, 0, o.z); d.rotation.set(0, 0, 0); d.scale.setScalar(o.s);
});
const roundT = trees.filter((t) => t.kind !== "pine"), pineT = trees.filter((t) => t.kind === "pine");
instanced(new THREE.IcosahedronGeometry(1.9, 0), new THREE.MeshLambertMaterial({ flatShading: true }), roundT, (o, d) => {
  d.position.set(o.x, 3.2 * o.s, o.z); d.rotation.set(o.x, o.z, 0); d.scale.set(o.s, o.s * 1.15, o.s);
});
instanced(new THREE.ConeGeometry(1.9, 5.2, 7).translate(0, 2.6, 0), new THREE.MeshLambertMaterial({ flatShading: true }), pineT, (o, d) => {
  d.position.set(o.x, 1.4 * o.s, o.z); d.rotation.set(0, o.x, 0); d.scale.setScalar(o.s);
});

// 산: 둘레를 감싸고, 고리 안쪽 빈 땅에도 낮은 언덕
const hills = [];
for (let k = 0; k < 26; k++) {
  const a = (k / 26) * Math.PI * 2 + R() * 0.2;
  const rx = (bb.x1 - bb.x0) / 2 + 260 + R() * 260, rz = (bb.z1 - bb.z0) / 2 + 240 + R() * 240;
  hills.push({ x: mid.x + Math.cos(a) * rx, z: mid.z + Math.sin(a) * rz, r: 140 + R() * 160, h: 60 + R() * 110 });
}
for (let tries = 0; tries < 300 && hills.length < 34; tries++) {
  const x = bb.x0 + R() * (bb.x1 - bb.x0), z = bb.z0 + R() * (bb.z1 - bb.z0), r = 30 + R() * 45;
  if (nearest(x, z, -1, 0, Math.ceil((r + 25) / CELL)) < r + 25 || inLake(x, z, r + 10) || !freeSpot(x, z, r)) continue;
  taken.push([x, z, r]);
  hills.push({ x, z, r, h: 14 + R() * 18 });
}
{
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const cols = [];
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { if (pos.getY(i) < 0) pos.setY(i, 0); }
  geo.computeVertexNormals();
  const g2 = geo.index ? geo.toNonIndexed() : geo;
  const p2 = g2.attributes.position;
  const low = new THREE.Color("#4C8A4A"), high = new THREE.Color("#79B262"), fall = new THREE.Color("#C39A46"), c = new THREE.Color();
  for (let i = 0; i < p2.count; i += 3) {
    const y = (p2.getY(i) + p2.getY(i + 1) + p2.getY(i + 2)) / 3; // 0(밑)~1(꼭대기)
    c.copy(low).lerp(high, clamp(y * 0.9 + (R() - 0.5) * 0.18, 0, 1));
    if (R() < 0.14) c.lerp(fall, 0.45);
    for (let j = 0; j < 3; j++) cols.push(c.r, c.g, c.b);
  }
  g2.setAttribute("color", new THREE.BufferAttribute(new Float32Array(cols), 3));
  instanced(g2, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), hills, (o, d) => {
    d.position.set(o.x, -0.5, o.z); d.rotation.set(0, o.x * 0.1, 0); d.scale.set(o.r, o.h, o.r * (0.8 + 0.3 * Math.sin(o.z)));
  }, false);
}

// 저수지 좌대(낚시 집)
{
  const rafts = [];
  for (let k = 0; k < 7; k++) {
    const a = R() * Math.PI * 2, r = lakeR(LAKE.x + Math.cos(a), LAKE.z + Math.sin(a)) * (0.45 + R() * 0.35);
    rafts.push({ x: LAKE.x + Math.cos(a) * r, z: LAKE.z + Math.sin(a) * r, a: R() * 3 });
  }
  instanced(new THREE.BoxGeometry(7, 0.5, 5), new THREE.MeshLambertMaterial({ color: "#A77B52" }), rafts, (o, d) => { d.position.set(o.x, 0.3, o.z); d.rotation.set(0, o.a, 0); d.scale.setScalar(1); });
  instanced(new THREE.BoxGeometry(3.4, 2.2, 3).translate(0, 1.1, 0), new THREE.MeshLambertMaterial({ color: "#F4F1EA" }), rafts, (o, d) => { d.position.set(o.x, 0.55, o.z); d.rotation.set(0, o.a, 0); d.scale.setScalar(1); });
  instanced(roofGeo, new THREE.MeshLambertMaterial({ color: "#2F8F83", flatShading: true }), rafts, (o, d) => { d.position.set(o.x, 2.75, o.z); d.rotation.set(0, o.a, 0); d.scale.set(4, 1.2, 3.6); });
}

// 이동 쪽 공사장 크레인(산단 공사 분위기, 위치는 장식)
for (let k = 0, tries = 0; k < 3 && tries < 200; tries++) {
  const x = PX[0] + 60 + R() * 260, z = PZ[0] - 220 + R() * 160;
  if (nearest(x, z, -1, 0, 4) < 45 || !freeSpot(x, z, 20)) continue;
  taken.push([x, z, 20]);
  const g = new THREE.Group(), yel = new THREE.MeshLambertMaterial({ color: "#F2B705" }), h = 42 + R() * 14;
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 1.6), yel); mast.position.y = h / 2;
  const jib = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 36), yel); jib.position.set(0, h + 0.8, 10);
  const cj = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 12), yel); cj.position.set(0, h + 0.8, -8);
  const w = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 3), new THREE.MeshLambertMaterial({ color: "#8A8F98" })); w.position.set(0, h - 0.6, -12);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2, 2.2), new THREE.MeshLambertMaterial({ color: "#F4F4F4" })); cab.position.set(0, h - 1.2, 1.8);
  g.add(mast, jib, cj, w, cab);
  g.traverse((o) => { o.castShadow = true; });
  g.position.set(x, 0, z); g.rotation.y = R() * Math.PI * 2;
  scene.add(g);
}

// 구름
{
  const mat = new THREE.MeshLambertMaterial({ color: "#FFFFFF", emissive: "#FFFFFF", emissiveIntensity: 0.35, fog: false, flatShading: true });
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const puffs = [];
  for (let k = 0; k < 16; k++) {
    const a = R() * Math.PI * 2, r = 500 + R() * 1300, x = mid.x + Math.cos(a) * r, z = mid.z + Math.sin(a) * r, y = 170 + R() * 160;
    for (let j = 0; j < 4; j++) puffs.push({ x: x + (j - 1.5) * 30 + R() * 10, y: y + R() * 10, z: z + R() * 20, s: 22 + R() * 22 });
  }
  instanced(geo, mat, puffs, (o, d) => { d.position.set(o.x, o.y, o.z); d.rotation.set(0, 0, 0); d.scale.set(o.s * 1.4, o.s * 0.7, o.s); }, false);
}

// 울타리(가드레일): 기둥 + 가로대
{
  const posts = [], quads = [];
  for (let sd = 0; sd < 2; sd++) {
    const sg = sd ? 1 : -1;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, wi = WALL[sd][i], wj = WALL[sd][j];
      const ax = PX[i] + NX[i] * wi * sg, az = PZ[i] + NZ[i] * wi * sg, bx = PX[j] + NX[j] * wj * sg, bz = PZ[j] + NZ[j] * wj * sg;
      if (i % 2 === 0) posts.push({ x: ax, z: az });
      if (Math.abs(wi - wj) < 2.5) for (const [y0, y1] of [[0.55, 0.85]]) quads.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
    }
  }
  instanced(new THREE.BoxGeometry(0.2, 1.05, 0.2).translate(0, 0.52, 0), new THREE.MeshLambertMaterial({ color: "#9AA3AD" }), posts, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.set(0, 0, 0); d.scale.setScalar(1); }, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(quads), 3));
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: "#E3E7EA", side: THREE.DoubleSide })));
}

/* ───────── 표지판·출발 문 ───────── */
function signTex(text) {
  return canvasTex(512, 150, (g, w, h) => {
    g.fillStyle = "#0E7A4F"; roundRect(g, 0, 0, w, h, 22); g.fill();
    g.strokeStyle = "#FFFFFF"; g.lineWidth = 6; roundRect(g, 10, 10, w - 20, h - 20, 14); g.stroke();
    g.fillStyle = "#FFFFFF"; g.textAlign = "center"; g.textBaseline = "middle";
    fitText(g, text, w - 70, 86); g.fillText(text, w / 2, h / 2 + 4);
  }, false);
}
function addSign(s, text) {
  const t = sample(s);
  const side = WALL[1][t.i] > HALF + 6 ? 1 : -1, off = Math.min(HALF + 4.2, WALL[side > 0 ? 1 : 0][t.i] - 1.2);
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 2.5), new THREE.MeshLambertMaterial({ map: signTex(text) }));
  board.position.y = 4.1;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 2.5), new THREE.MeshLambertMaterial({ color: "#7E8791" }));
  back.position.set(0, 4.1, -0.05); back.rotation.y = Math.PI;
  const postM = new THREE.MeshLambertMaterial({ color: "#8A9199" });
  for (const px of [-3, 3]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.2, 8), postM); p.position.set(px, 2.6, -0.1); g.add(p); }
  g.add(board, back);
  g.traverse((o) => { o.castShadow = true; });
  g.position.set(t.x + t.nx * off * side, 0, t.z + t.nz * off * side);
  faceTo(g, -t.tx, -t.tz);
  scene.add(g);
}
for (const [s, name] of TR.landmarks) addSign(s - 6, name);
{
  const t = sample(0), ang = Math.atan2(-t.tx, -t.tz);
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: "#F4F6F8" }), green = new THREE.MeshLambertMaterial({ color: "#0E8A5A" });
  for (const sg of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.1, 7.2, 1.1), sg < 0 ? green : white);
    p.position.set(sg * (HALF + 1.6), 3.6, 0); g.add(p);
  }
  const ban = (txt) => canvasTex(1024, 128, (c, w, h) => {
    c.fillStyle = "#191F28"; c.fillRect(0, 0, w, h);
    for (let x = 0; x < 6; x++) for (let y = 0; y < 4; y++) { c.fillStyle = (x + y) % 2 ? "#191F28" : "#FFFFFF"; c.fillRect(x * 32, y * 32, 32, 32); c.fillRect(w - 192 + x * 32, y * 32, 32, 32); }
    c.fillStyle = "#2FC67A"; c.fillRect(192, h - 10, w - 384, 10);
    c.fillStyle = "#FFFFFF"; c.textAlign = "center"; c.textBaseline = "middle"; fitText(c, txt, w - 440, 70); c.fillText(txt, w / 2, h / 2 - 2);
  }, false);
  const bw = HALF * 2 + 4.4;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(bw, bw / 8), new THREE.MeshLambertMaterial({ map: ban("이남 카트 · 이동읍 출발") }));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(bw, bw / 8), new THREE.MeshLambertMaterial({ map: ban("이동·남사 한 바퀴") }));
  front.position.y = back.position.y = 6.6; back.rotation.y = Math.PI; front.position.z = 0.02; back.position.z = -0.02;
  g.add(front, back);
  g.traverse((o) => { o.castShadow = true; });
  g.position.set(t.x, 0, t.z); g.rotation.y = ang;
  scene.add(g);
}

/* ───────── 아이템 상자·가속 발판 ───────── */
const boxTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#2FC67A"); gr.addColorStop(0.5, "#FFD43B"); gr.addColorStop(1, "#FF6B35");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(255,255,255,.95)"; g.lineWidth = 10; roundRect(g, 7, 7, w - 14, h - 14, 16); g.stroke();
  g.fillStyle = "#FFFFFF"; g.font = `900 80px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("?", w / 2, h / 2 + 4);
}, false);
const boxMat = new THREE.MeshStandardMaterial({ map: boxTex, emissive: "#FFFFFF", emissiveMap: boxTex, emissiveIntensity: 0.35, transparent: true, opacity: 0.9, roughness: 0.3 });
const boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
const itemBoxes = [];
for (const f of [0.1, 0.36, 0.6, 0.84]) {
  // 그 둘레에서 가장 곧은 자리
  let bestS = f * L, bestK = 1e9;
  for (let s = f * L - 60; s <= f * L + 60; s += 4) { const k = Math.abs(K[idxOf(s)]); if (k < bestK) { bestK = k; bestS = s; } }
  const t = sample(bestS);
  for (const d of [-4.5, -1.5, 1.5, 4.5]) {
    const m = new THREE.Mesh(boxGeo, boxMat);
    m.castShadow = true;
    m.position.set(t.x + t.nx * d, 1.3, t.z + t.nz * d);
    scene.add(m);
    itemBoxes.push({ m, x: m.position.x, z: m.position.z, s: wrapS(bestS), d, off: 0, phase: R() * 6 });
  }
}
const padTex = canvasTex(64, 128, (g, w, h) => {
  g.fillStyle = "#FF6B35"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#FFD43B";
  for (let k = 0; k < 2; k++) { const y = k * 64; g.beginPath(); g.moveTo(8, y + 52); g.lineTo(32, y + 18); g.lineTo(56, y + 52); g.lineTo(46, y + 58); g.lineTo(32, y + 38); g.lineTo(18, y + 58); g.closePath(); g.fill(); }
});
const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.95 });
const pads = [];
for (let s = 140; s < L - 80 && pads.length < 5; s += 8) {
  let ok = true;
  for (let a = -16; a <= 44 && ok; a += 4) if (Math.abs(K[idxOf(s + a)]) > 1 / 110) ok = false;
  if (!ok || itemBoxes.some((b) => Math.abs(wrapDiff(b.s - s)) < 50) || pads.some((p) => Math.abs(wrapDiff(p.s - s)) < 280)) continue;
  const t = sample(s), d = [0, -3.4, 3.4][pads.length % 3];
  const m = new THREE.Mesh(groundQuad(t.x + t.nx * d, t.z + t.nz * d, t.tx, t.tz, 7, 3.6, 0.09), padMat);
  scene.add(m);
  pads.push({ s, d });
}

/* ───────── 카트 ───────── */
const RIVALS = [
  { name: "송전 번개", color: "#FF6B35", accent: "#FFE3D6", helmet: "#FFFFFF", skill: 0.97 },
  { name: "남곡 질주", color: "#FFC83D", accent: "#3D3D3D", helmet: "#FF6B35", skill: 0.955 },
  { name: "어비 물살", color: "#1FB5A8", accent: "#E8FFFB", helmet: "#FFD43B", skill: 0.94 },
  { name: "창리 바람", color: "#8B5CF6", accent: "#EDE7FF", helmet: "#FFFFFF", skill: 0.925 },
  { name: "봉무 불꽃", color: "#E5484D", accent: "#FFE1E1", helmet: "#191F28", skill: 0.91 },
];
const ME = { name: "나", color: "#0E8A5A", accent: "#FFFFFF", helmet: "#FFD43B", skill: 1 };
function makeKart(def, tag) {
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const M = (c, r = 0.5, m = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const main = M(def.color, 0.4, 0.15), acc = M(def.accent, 0.5), dark = M("#23272E", 0.8), metal = M("#B9C0C8", 0.3, 0.6);
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); body.add(m); return m; };
  box(1.6, 0.32, 2.5, main, 0, 0.42, 0);
  box(1.2, 0.34, 0.9, main, 0, 0.5, 1.45);
  box(1.0, 0.36, 0.7, acc, 0, 0.72, 0.85).rotation.x = -0.25;
  box(0.32, 0.36, 1.3, acc, -0.92, 0.48, -0.05);
  box(0.32, 0.36, 1.3, acc, 0.92, 0.48, -0.05);
  box(1.7, 0.1, 0.42, main, 0, 1.25, -1.28);
  box(0.12, 0.6, 0.12, dark, -0.55, 0.95, -1.25);
  box(0.12, 0.6, 0.12, dark, 0.55, 0.95, -1.25);
  box(0.92, 0.62, 0.5, dark, 0, 0.82, -0.55);
  box(0.95, 0.42, 0.6, dark, 0, 0.72, -1.05);
  const flame = new THREE.Group();
  for (const x of [-0.26, 0.26]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.4, 10).rotateX(Math.PI / 2), metal); ex.position.set(x, 0.78, -1.42); body.add(ex);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.5), new THREE.MeshBasicMaterial({ color: "#FFB23F", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    f.position.set(x, 0.78, -1.6); flame.add(f);
  }
  flame.visible = false; body.add(flame);
  // 운전수
  const suit = M(def.color, 0.7), helm = M(def.helmet, 0.35, 0.1);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.35, 4, 10), suit); torso.position.set(0, 1.28, -0.45); body.add(torso);
  const head = new THREE.Group(); head.position.set(0, 1.92, -0.4); body.add(head);
  const hm = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), helm); head.add(hm);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.405, 16, 8, Math.PI / 2 - 0.9, 1.8, 1.1, 0.75), M("#1C2430", 0.15, 0.4)); head.add(visor);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 6, 24), M(def.color, 0.4)); stripe.rotation.y = Math.PI / 2; head.add(stripe);
  for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 3, 6), suit); arm.position.set(sx * 0.32, 1.22, -0.05); arm.rotation.set(1.1, 0, -sx * 0.25); body.add(arm); }
  const wheelSt = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 6, 16), dark); wheelSt.position.set(0, 1.1, 0.3); wheelSt.rotation.x = -0.9; body.add(wheelSt);
  // 바퀴
  const wheels = [], front = [];
  const tire = new THREE.CylinderGeometry(0.42, 0.42, 0.4, 16).rotateZ(Math.PI / 2), hubG = new THREE.CylinderGeometry(0.2, 0.2, 0.42, 10).rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.98, 0.95], [0.98, 0.95], [-1.0, -0.95], [1.0, -0.95]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.42, z);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(tire, dark), new THREE.Mesh(hubG, metal));
    pivot.add(spin); g.add(pivot);
    wheels.push(spin);
    if (z > 0) front.push(pivot);
  }
  g.traverse((o) => { if (o.isMesh && o.material.blending !== THREE.AdditiveBlending) o.castShadow = true; });
  if (tag) {
    const t = canvasTex(256, 64, (c, w, h) => {
      c.fillStyle = "rgba(25,31,40,.78)"; roundRect(c, 4, 6, w - 8, h - 12, 26); c.fill();
      c.fillStyle = def.color; c.beginPath(); c.arc(32, h / 2, 9, 0, 7); c.fill();
      c.fillStyle = "#fff"; c.textBaseline = "middle"; fitText(c, def.name, w - 70, 30); c.fillText(def.name, 50, h / 2 + 1);
    }, false);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
    sp.scale.set(2.6, 0.65, 1); sp.position.y = 3; g.add(sp);
  }
  scene.add(g);
  return { g, body, wheels, front, flame, head, tag: g.children.find((o) => o.isSprite) };
}

/* ───────── 알갱이(불꽃·흙먼지) ───────── */
const dotTex = canvasTex(64, 64, (g, w) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.45, "rgba(255,255,255,.8)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, w, w); }, false);
function particleSystem(max, additive, size) {
  const pos = new Float32Array(max * 3).fill(-9999), col = new Float32Array(max * 3), vel = new Float32Array(max * 3), life = new Float32Array(max), life0 = new Float32Array(max), base = new Float32Array(max * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  pts.frustumCulled = false;
  scene.add(pts);
  let head = 0;
  const c = new THREE.Color();
  return {
    emit(x, y, z, vx, vy, vz, color, t) {
      const i = head; head = (head + 1) % max;
      pos.set([x, y, z], i * 3); vel.set([vx, vy, vz], i * 3); c.set(color); base.set([c.r, c.g, c.b], i * 3); col.set([c.r, c.g, c.b], i * 3); life[i] = life0[i] = t;
    },
    update(dt, grav) {
      for (let i = 0; i < max; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) { pos[i * 3 + 1] = -9999; continue; }
        vel[i * 3 + 1] -= grav * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (additive) { const f = life[i] / life0[i]; col[i * 3] = base[i * 3] * f; col[i * 3 + 1] = base[i * 3 + 1] * f; col[i * 3 + 2] = base[i * 3 + 2] * f; }
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
}
const sparks = particleSystem(700, true, 0.45);
const dust = particleSystem(400, false, 0.9);

/* ───────── 소리(WebAudio로 직접 만듦) ───────── */
const AC = window.AudioContext || window.webkitAudioContext;
let ac = null, master = null, sfx = null, eng = null, muted = store.get("mute", false);
function audioInit() {
  if (ac || !AC) return;
  try {
    ac = new AC();
    master = ac.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ac.destination);
    sfx = ac.createGain(); sfx.gain.value = 0.32; sfx.connect(master); // 효과음은 배경 음악보다 작게
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
    o1.type = "sawtooth"; o2.type = "square"; lp.type = "lowpass"; lp.frequency.value = 600; g.gain.value = 0;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master); o1.start(); o2.start();
    eng = { o1, o2, g, lp };
  } catch { ac = null; }
}
function tone(f, dur, type = "square", vol = 0.12, slide = 0, delay = 0) {
  if (!ac) return;
  const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(sfx); o.start(t); o.stop(t + dur + 0.02);
}
let noiseBuf = null;
function noise() {
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const src = ac.createBufferSource(); src.buffer = noiseBuf;
  return src;
}
function whoosh(dur = 0.5, f0 = 400, f1 = 2400, vol = 0.25) {
  if (!ac) return;
  const t = ac.currentTime, src = noise(), bp = ac.createBiquadFilter(), g = ac.createGain();
  bp.type = "bandpass"; bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp); bp.connect(g); g.connect(sfx); src.start(t); src.stop(t + dur);
}
const SFX = {
  count: () => tone(523, 0.18, "square", 0.12),
  go: () => tone(1046, 0.5, "square", 0.14),
  pickup: () => { tone(660, 0.08, "square", 0.08); tone(990, 0.1, "square", 0.08, 0, 0.07); tone(1320, 0.12, "square", 0.08, 0, 0.14); },
  tick: () => tone(1500, 0.03, "square", 0.03),
  boost: () => whoosh(0.55, 300, 2600, 0.3),
  hit: () => { whoosh(0.35, 900, 120, 0.35); tone(420, 0.4, "sawtooth", 0.1, -300); },
  bump: () => whoosh(0.15, 200, 90, 0.25),
  throw: () => whoosh(0.25, 600, 1800, 0.18),
  lap: () => { tone(784, 0.12, "triangle", 0.15); tone(1046, 0.25, "triangle", 0.15, 0, 0.12); },
  finish: () => [523, 659, 784, 1046, 1318].forEach((f, k) => tone(f, 0.35, "triangle", 0.16, 0, k * 0.11)),
};
/* 배경 음악: 124BPM 밝은 하우스풍 8마디 반복(곡도 직접 씀: F–G–Em–Am–F–G–C–C). 엔진 소리보다 앞에, 거슬리지 않게 작게.
   두 번째 돌 때부터 멜로디가 들어오고, 마지막 바퀴엔 136BPM으로 빨라진다. */
const MUSIC = (() => {
  const mf = (m) => 440 * 2 ** ((m - 69) / 12);
  const BASS = [41, 43, 40, 45, 41, 43, 36, 36];
  const STAB = [[65, 69, 72], [67, 71, 74], [64, 67, 71], [64, 69, 72], [65, 69, 72], [67, 71, 74], [64, 67, 72], [64, 67, 72]];
  const PAD = [[53, 57, 60], [55, 59, 62], [52, 55, 59], [57, 60, 64], [53, 57, 60], [55, 59, 62], [48, 52, 55], [48, 52, 55]];
  const MEL = [ // 8분음표 8칸씩, 0은 쉼
    [69, 0, 72, 0, 69, 67, 65, 0], [67, 0, 71, 0, 74, 0, 72, 71], [71, 0, 67, 0, 64, 0, 67, 0], [69, 0, 0, 72, 71, 69, 67, 0],
    [69, 0, 72, 0, 77, 0, 76, 74], [74, 0, 71, 0, 67, 0, 74, 0], [72, 0, 76, 0, 79, 0, 76, 72], [72, 0, 0, 0, 0, 0, 0, 0],
  ];
  let bus = null, echo = null, timer = 0, next = 0, i = 0, bpm = 124;
  function init() {
    bus = ac.createGain(); bus.gain.value = 0; bus.connect(master);
    const d = ac.createDelay(1), fb = ac.createGain(), wet = ac.createGain();
    d.delayTime.value = 0.36; fb.gain.value = 0.28; wet.gain.value = 0.22;
    d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(bus);
    echo = d;
  }
  function env(g, t, vol, dur, att = 0.005) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function note(type, f, t, dur, vol, cut, att, toEcho) {
    const o = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); lp.type = "lowpass"; lp.frequency.value = cut;
    env(g, t, vol, dur, att);
    o.connect(lp); lp.connect(g); g.connect(bus); if (toEcho) g.connect(echo);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function kick(t) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    env(g, t, 0.32, 0.26, 0.002); o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.3);
  }
  function hiss(t, hp, vol, dur) {
    const src = noise(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = "highpass"; f.frequency.value = hp; env(g, t, vol, dur, 0.002);
    src.connect(f); f.connect(g); g.connect(bus); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  const snare = (t, v = 1) => { hiss(t, 1500, 0.06 * v, 0.13); note("triangle", 185, t, 0.07, 0.035 * v, 2000, 0.002); };
  function play(i, t) {
    const loop = Math.floor(i / 128), bar = Math.floor(i / 16) % 8, s = i % 16, full = loop % 2 === 1 || bpm > 130;
    const beat = 60 / bpm;
    if (s % 4 === 0) kick(t);
    if (s === 4 || s === 12) snare(t);
    if (bar === 7 && s >= 13) snare(t, 0.35 + (s - 13) * 0.2); // 8마디 끝 채우기
    if (s % 4 === 2) hiss(t, 8000, 0.02, 0.04);
    else if (full && s % 2 === 1) hiss(t, 9000, 0.009, 0.03);
    if (s % 4 === 2) note("sawtooth", mf(BASS[bar]), t, beat * 0.45, 0.07, 420, 0.004);
    if (s === 15) note("sawtooth", mf(BASS[bar] + 12), t, beat * 0.2, 0.045, 520, 0.004);
    if (s === 2 || s === 10 || (full && s === 14)) for (const n of STAB[bar]) note("triangle", mf(n), t, 0.16, 0.016, 2400, 0.004);
    if (s === 0) for (const n of PAD[bar]) note("sine", mf(n), t, beat * 3.8, 0.012, 1200, 0.25);
    if (full && s % 2 === 0) { const n = MEL[bar][s / 2]; if (n) note("triangle", mf(n), t, beat * 0.55, 0.035, 3000, 0.006, true); }
  }
  function tick() {
    const sp = 60 / bpm / 4;
    if (next < ac.currentTime - 0.2) next = ac.currentTime + 0.05; // 탭을 다녀오면 다시 맞춤
    while (next < ac.currentTime + 0.15) { play(i, next); next += sp; i++; }
  }
  return {
    start(reset) {
      if (!ac) return;
      if (!bus) init();
      if (reset) { i = 0; bpm = 124; }
      next = ac.currentTime + 0.05;
      clearInterval(timer); timer = setInterval(tick, 25);
      bus.gain.cancelScheduledValues(ac.currentTime); bus.gain.setTargetAtTime(0.7, ac.currentTime, 0.03);
    },
    stop(fade = 0.25) { clearInterval(timer); timer = 0; if (bus) bus.gain.setTargetAtTime(0, ac.currentTime, fade / 3); },
    faster() { bpm = 136; },
  };
})();
function setMute(m) {
  muted = m; store.set("mute", m);
  $("mute").textContent = m ? "🔇" : "🔊"; $("mute").setAttribute("aria-label", m ? "소리 켜기" : "소리 끄기");
  if (master) master.gain.value = m ? 0 : 1;
}

/* ───────── 경주 상태 ───────── */
const LEVEL_MULT = [0.82, 0.93, 1.0];
const ITEMS = {
  turbo: { name: "터보", img: "img/emoji/kart-turbo.webp" },
  cone: { name: "공사 콘", img: "img/emoji/kart-cone.webp" },
  box: { name: "택배 상자", img: "img/emoji/kart-box.webp" },
};
const opts = { laps: +(Q.get("laps") || store.get("laps", 2)), level: store.get("level", 1) };
let state = "title", raceT = 0, countT = 0, finishT = 0, titleT = 0, lastLap = 1, autoMe = Q.has("auto");
const racers = [];
const player = newRacer(ME, true);
RIVALS.forEach((d) => racers.push(newRacer(d, false)));
racers.push(player);
function newRacer(def, isMe) {
  return { def, isMe, mesh: makeKart(def, !isMe), x: 0, z: 0, y: 0, vy: 0, h: 0, vx: 0, vz: 0, v: 0, s: 0, d: 0, ti: 0, prevS: 0, prog: 0,
    drift: false, driftDir: 0, charge: 0, boost: 0, spin: 0, spinA: 0, invul: 0, item: null, rolling: 0, itemT: 0, lane: 0, laneT: 0,
    finished: false, time: 0, steer: 0, off: false, wrongT: 0, bodyYaw: 0, lean: 0 };
}
function placeOnGrid() {
  racers.forEach((k, n) => {
    const row = Math.floor(n / 2), col = n % 2;
    const back = 9 + row * 7.5, s = L - back, d = col ? 3.3 : -3.3;
    const t = sample(s);
    Object.assign(k, { x: t.x + t.nx * d, z: t.z + t.nz * d, y: 0, vy: 0, h: Math.atan2(t.tx, t.tz), vx: 0, vz: 0, v: 0, s, d, ti: t.i, prevS: s, prog: -back,
      drift: false, charge: 0, boost: 0, spin: 0, spinA: 0, invul: 0, item: null, rolling: 0, itemT: 0, lane: d, laneT: 1 + Math.random() * 2,
      finished: false, time: 0, steer: 0, off: false, wrongT: 0, bodyYaw: 0, lean: 0 });
  });
}
placeOnGrid();
let cones = [], shots = [];

/* ───────── 입력 ───────── */
const keys = new Set();
let itemPressed = false;
const KEYMAP = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowDown: "brake", KeyS: "brake",
  Space: "drift", ShiftLeft: "drift", ShiftRight: "drift", KeyX: "item", KeyZ: "item", KeyE: "item", ControlLeft: "item", ArrowUp: "up", KeyW: "up" };
addEventListener("keydown", (e) => {
  if (e.code === "Escape" || e.code === "KeyP") { if (state === "race" || state === "count") pause(true); else if (state === "paused") pause(false); return; }
  const k = KEYMAP[e.code];
  if (!k) return;
  if (state !== "title") e.preventDefault();
  if (k === "item" && !keys.has("item")) itemPressed = true;
  keys.add(k);
});
addEventListener("keyup", (e) => { const k = KEYMAP[e.code]; if (k) keys.delete(k); });
addEventListener("blur", () => keys.clear());
for (const b of document.querySelectorAll("#touch button")) {
  const k = b.dataset.k;
  const on = (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); keys.add(k); b.classList.add("on"); if (k === "item") itemPressed = true; audioInit(); };
  const offF = () => { keys.delete(k); b.classList.remove("on"); };
  b.addEventListener("pointerdown", on);
  b.addEventListener("pointerup", offF);
  b.addEventListener("pointercancel", offF);
  b.addEventListener("lostpointercapture", offF);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
}
let touchUI = TOUCH;
addEventListener("touchstart", () => { if (!touchUI) { touchUI = true; $("touch").hidden = false; $("hud").classList.add("t"); showHow(); } }, { passive: true });

/* ───────── 물리 ───────── */
function locate(k) {
  let best = 1e18, bi = k.ti;
  for (let o = -12; o <= 12; o++) {
    const i = (k.ti + o + N) % N, dx = k.x - PX[i], dz = k.z - PZ[i], d = dx * dx + dz * dz;
    if (d < best) { best = d; bi = i; }
  }
  k.ti = bi;
  const dx = k.x - PX[bi], dz = k.z - PZ[bi];
  k.s = wrapS(S[bi] + dx * TX[bi] + dz * TZ[bi]);
  k.d = dx * NX[bi] + dz * NZ[bi];
  k.prog += wrapDiff(k.s - k.prevS);
  k.prevS = k.s;
}
function autoSteer(k) { // 앞쪽 길을 보고 핸들(자동 운전·도착 뒤)
  const t = sample(k.s + 11 + Math.max(0, k.v) * 0.35);
  const ahead = K[idxOf(k.s + 20)];
  const lane = Math.sign(ahead) * Math.min(3.5, Math.abs(ahead) * 110); // 굽이 안쪽으로
  const want = Math.atan2(t.x + t.nx * lane - k.x, t.z + t.nz * lane - k.z);
  let diff = want - k.h; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return clamp(-diff * 2.6, -1, 1);
}
function updatePlayer(k, dt, ctl) {
  const fx = Math.sin(k.h), fz = Math.cos(k.h), rx = -fz, rz = fx;
  let vf = k.vx * fx + k.vz * fz, vr = k.vx * rx + k.vz * rz;
  const steerT = ctl.steer;
  k.steer += clamp(steerT - k.steer, -dt * 8, dt * 8);
  k.off = Math.abs(k.d) > HALF + 0.4;
  if (k.spin > 0) {
    k.spin -= dt; k.spinA += dt * 11; vf *= Math.exp(-2.6 * dt); vr *= Math.exp(-6 * dt);
    if (k.drift) { k.drift = false; k.charge = 0; }
  } else {
    const vmax = k.boost > 0 ? 40 : k.off ? 15 : 30;
    if (ctl.brake) vf = Math.max(-7, vf - (vf > 0 ? 34 : 8) * dt);
    else if (vf < vmax) vf = Math.min(vmax, vf + (k.boost > 0 ? 40 : vf < 14 ? 19 : 10.5) * dt);
    else vf -= (vf - vmax) * (k.off ? 3.2 : 1.4) * dt;
    // 드리프트 시작·끝
    if (ctl.drift && !k.drift && Math.abs(k.steer) > 0.3 && vf > 11 && k.y <= 0.01) {
      k.drift = true; k.driftDir = Math.sign(k.steer); k.charge = 0; k.vy = 4.2;
    }
    if (k.drift && (!ctl.drift || vf < 8)) {
      const lv = driftLevel(k);
      if (lv > 0 && vf >= 8 && !k.off) { k.boost = Math.max(k.boost, [0, 0.6, 1.05, 1.5][lv]); if (k.isMe) SFX.boost(); }
      k.drift = false; k.charge = 0;
    }
    const sp = clamp(Math.abs(vf) / 9, 0, 1) * Math.sign(vf || 1);
    let yaw;
    if (k.drift) {
      const into = k.steer * k.driftDir; // +면 굽는 쪽으로 핸들
      yaw = k.driftDir * (0.95 + (into > 0 ? 0.9 : 0.6) * into) * sp; // 안쪽 핸들 1.85, 가만히 0.95, 바깥 0.35
      k.charge += dt * (0.75 + 0.5 * Math.abs(k.steer)) * (k.off ? 0.3 : 1);
    } else yaw = k.steer * 1.95 * sp * (1 - 0.2 * clamp(vf / 30, 0, 1));
    k.h -= yaw * dt;
  }
  // 옆 미끄러짐: 드리프트 중엔 조금 덜 붙잡음(미끄러지는 모습은 차체 각도로 보여 주고, 실제 길은 핸들대로)
  vr *= Math.exp(-(k.drift ? 6.5 : 11) * dt);
  if (k.boost > 0) k.boost -= dt;
  const nfx = Math.sin(k.h), nfz = Math.cos(k.h);
  k.vx = nfx * vf + -nfz * vr; k.vz = nfz * vf + nfx * vr;
  k.x += k.vx * dt; k.z += k.vz * dt;
  k.vy -= 30 * dt; k.y = Math.max(0, k.y + k.vy * dt); if (k.y === 0) k.vy = 0;
  k.v = vf;
  locate(k);
  // 울타리
  for (const sd of [0, 1]) {
    const sg = sd ? 1 : -1, lim = WALL[sd][k.ti] - 0.9, over = k.d * sg - lim;
    if (over > 0) {
      const nx = NX[k.ti] * sg, nz = NZ[k.ti] * sg;
      k.x -= nx * over; k.z -= nz * over; k.d -= over * sg;
      const vn = k.vx * nx + k.vz * nz;
      if (vn > 0) { // 부딪힌 세기(벽 쪽 속도)만큼만 느려진다. 스치기만 하면 거의 그대로
        k.vx -= 1.4 * vn * nx; k.vz -= 1.4 * vn * nz;
        const keep = 1 - Math.min(0.4, vn * 0.025);
        k.vx *= keep; k.vz *= keep;
        if (k.isMe && vn > 5) { SFX.bump(); shake = Math.min(0.6, vn * 0.05); }
      }
    }
  }
  // 가속 발판
  for (const p of pads) if (Math.abs(wrapDiff(k.s - p.s)) < 3.6 && Math.abs(k.d - p.d) < 2.2 && k.boost < 0.8) { k.boost = 0.95; if (k.isMe) SFX.boost(); }
}
const driftLevel = (k) => (k.charge > 2.9 ? 3 : k.charge > 1.8 ? 2 : k.charge > 0.85 ? 1 : 0);
const DRIFT_COL = [null, "#6EE7B7", "#FFB23F", "#FF5DA2"];

function updateAI(k, dt) {
  if (k.spin > 0) { k.spin -= dt; k.spinA += dt * 11; k.v *= Math.exp(-3 * dt); }
  let vt = 30 * k.def.skill * LEVEL_MULT[opts.level];
  if (!k.finished && !player.finished) vt *= clamp(1 - (k.prog - player.prog) / 1100, 0.88, 1.08); // 너무 벌어지지 않게
  let kmax = 0;
  for (let a = 4; a <= 36; a += 4) kmax = Math.max(kmax, Math.abs(K[idxOf(k.s + a)]));
  vt = Math.min(vt, Math.sqrt(30 / Math.max(kmax, 1e-4)));
  if (k.boost > 0) { k.boost -= dt; vt = 38; }
  if (k.spin <= 0) k.v += clamp(vt - k.v, -14 * dt, (k.v < 12 ? 16 : 8) * dt);
  k.prog += k.v * dt;
  k.s = wrapS(k.prog);
  // 차선: 가끔 바꾸고, 굽이에선 안쪽으로
  if ((k.laneT -= dt) <= 0) { k.lane = (Math.random() * 2 - 1) * (HALF - 2.2); k.laneT = 2 + Math.random() * 4; }
  const ahead = K[idxOf(k.s + 18)];
  let target = k.lane + Math.sign(ahead) * Math.min(3, Math.abs(ahead) * 100);
  for (const c of cones) if (wrapDiff(c.s - k.s) > 0 && wrapDiff(c.s - k.s) < 26 && Math.abs(c.d - k.d) < 2.2 && Math.random() < 0.7) target = c.d + (c.d > 0 ? -3.5 : 3.5);
  target = clamp(target, -(HALF - 1.4), HALF - 1.4);
  k.d += clamp(target - k.d, -3.2 * dt, 3.2 * dt);
  const t = sample(k.s), ox = k.x, oz = k.z;
  k.x = t.x + t.nx * k.d; k.z = t.z + t.nz * k.d; k.ti = t.i;
  if (Math.hypot(k.x - ox, k.z - oz) > 0.001) {
    const want = Math.atan2(k.x - ox, k.z - oz);
    let diff = want - k.h; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    k.h += diff * Math.min(1, dt * 12);
  }
  k.steer = clamp(-(target - k.d) * 0.3, -1, 1);
  // 아이템 쓰기
  if (k.item && (k.itemT -= dt) <= 0) useItem(k);
}

function collide() {
  for (let a = 0; a < racers.length; a++) for (let b = a + 1; b < racers.length; b++) {
    const A = racers[a], B = racers[b];
    if (A.isMe || B.isMe) {
      const P = A.isMe ? A : B, O = A.isMe ? B : A;
      const dx = P.x - O.x, dz = P.z - O.z, d = Math.hypot(dx, dz);
      if (d < 2.3 && d > 0.001) {
        const nx = dx / d, nz = dz / d, over = 2.3 - d;
        P.x += nx * over * 0.7; P.z += nz * over * 0.7;
        O.d += (O.d - P.d > 0 ? 1 : -1) * over * 0.3;
        const vn = P.vx * nx + P.vz * nz;
        if (vn < 0) { P.vx -= 1.3 * vn * nx; P.vz -= 1.3 * vn * nz; }
        if (wrapDiff(O.s - P.s) > 0) { O.v = Math.min(O.v + 1.5, 34); } else O.v *= 0.97;
        if (Math.abs(vn) > 3) SFX.bump();
      }
    } else if (Math.abs(A.prog - B.prog) < 2.6 && Math.abs(A.d - B.d) < 1.9) {
      const push = (1.9 - Math.abs(A.d - B.d)) / 2, sg = A.d >= B.d ? 1 : -1;
      A.d += push * sg; B.d -= push * sg;
      if (A.prog < B.prog) A.v = Math.min(A.v, B.v); else B.v = Math.min(B.v, A.v);
    }
  }
}

/* ───────── 아이템 ───────── */
function rankOf(k) { return racers.filter((o) => o !== k && (o.finished ? !k.finished || o.time < k.time : !k.finished && o.prog > k.prog)).length + 1; }
function pickItem(k) {
  const r = rankOf(k);
  const w = r === 1 ? [0.1, 0.55, 0.35] : r <= 3 ? [0.3, 0.3, 0.4] : [0.55, 0.1, 0.35];
  const x = Math.random();
  return x < w[0] ? "turbo" : x < w[0] + w[1] ? "cone" : "box";
}
function giveItem(k) {
  if (k.item || k.rolling > 0) return;
  if (k.isMe) { k.rolling = 0.95; SFX.pickup(); }
  else { k.item = pickItem(k); k.itemT = 1 + Math.random() * 4; }
}
const coneGeo = new THREE.ConeGeometry(0.5, 1.15, 12).translate(0, 0.58, 0);
const coneMat = new THREE.MeshLambertMaterial({ map: canvasTex(16, 64, (g, w, h) => { g.fillStyle = "#FF6B1A"; g.fillRect(0, 0, w, h); g.fillStyle = "#FFFFFF"; g.fillRect(0, h * 0.3, w, h * 0.14); g.fillRect(0, h * 0.58, w, h * 0.12); }, false) });
const coneBase = new THREE.BoxGeometry(1.0, 0.12, 1.0).translate(0, 0.06, 0);
const shotTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = "#C89A63"; g.fillRect(0, 0, w, h); g.fillStyle = "#E7D2A8"; g.fillRect(w * 0.42, 0, w * 0.16, h); g.fillStyle = "#8A6239"; g.fillRect(6, 6, 18, 4); }, false);
const shotGeo = new THREE.BoxGeometry(1.1, 0.85, 1.1);
const shotMat = new THREE.MeshLambertMaterial({ map: shotTex });
function useItem(k) {
  const it = k.item;
  if (!it) return;
  k.item = null;
  const fx = Math.sin(k.h), fz = Math.cos(k.h);
  if (it === "turbo") { k.boost = Math.max(k.boost, 1.35); if (k.isMe) SFX.boost(); else k.v = Math.max(k.v, 30); }
  if (it === "cone") {
    const x = k.x - fx * 2.8, z = k.z - fz * 2.8;
    const g = new THREE.Group(); g.add(new THREE.Mesh(coneGeo, coneMat), new THREE.Mesh(coneBase, coneMat));
    g.traverse((o) => { o.castShadow = true; });
    g.position.set(x, 0.06, z); scene.add(g);
    const tmp = { x, z, ti: k.ti, prevS: k.s, prog: 0, s: 0, d: 0 }; locate(tmp);
    cones.push({ g, x, z, s: tmp.s, d: tmp.d, owner: k, t: 0, fly: 0 });
    if (cones.length > 14) { scene.remove(cones[0].g); cones.shift(); }
    if (k.isMe) SFX.throw();
  }
  if (it === "box") {
    const m = new THREE.Mesh(shotGeo, shotMat); m.castShadow = true; scene.add(m);
    const ahead = racers.filter((o) => o !== k && !o.finished && o.prog - k.prog > 2 && o.prog - k.prog < 170).sort((a, b) => a.prog - b.prog)[0];
    shots.push({ m, owner: k, prog: k.prog + 3, d: k.d, v: Math.max(52, Math.abs(k.v) + 24), target: ahead || null, t: 0, x: k.x, z: k.z });
    if (k.isMe) SFX.throw();
  }
}
function hitKart(k, by) {
  if (k.invul > 0 || k.spin > 0) return;
  k.spin = 1.15; k.invul = 2.2; k.boost = 0; k.drift = false; k.charge = 0;
  if (k.isMe) { SFX.hit(); shake = 0.7; toast("앗, 맞았어요!", true); }
  else if (by === player) { toast(`${k.def.name} 맞췄어요!`); tone(880, 0.12, "triangle", 0.12); }
  for (let n = 0; n < 22; n++) sparks.emit(k.x, 1.6, k.z, (Math.random() - 0.5) * 8, 4 + Math.random() * 5, (Math.random() - 0.5) * 8, "#FFD43B", 0.7);
}
function updateItems(dt) {
  for (const b of itemBoxes) {
    if (b.off > 0) { b.off -= dt; b.m.visible = b.off <= 0; if (b.off <= 0) b.m.scale.setScalar(0.01); }
    if (b.m.scale.x < 1) b.m.scale.setScalar(Math.min(1, b.m.scale.x + dt * 3));
    if (b.off > 0) continue;
    for (const k of racers) {
      if ((k.x - b.x) ** 2 + (k.z - b.z) ** 2 < 2.4 ** 2) {
        b.off = 2.6; b.m.visible = false; giveItem(k);
        for (let n = 0; n < 16; n++) sparks.emit(b.x, 1.3, b.z, (Math.random() - 0.5) * 9, Math.random() * 6, (Math.random() - 0.5) * 9, ["#2FC67A", "#FFD43B", "#FF6B35"][n % 3], 0.6);
        break;
      }
    }
  }
  for (const c of cones) {
    c.t += dt;
    if (c.fly > 0) { c.fly += dt; c.g.position.y += (6 - c.fly * 18) * dt; c.g.rotation.x += dt * 9; if (c.fly > 0.9) c.dead = true; continue; }
    for (const k of racers) {
      if (k === c.owner && c.t < 0.8) continue;
      if ((k.x - c.x) ** 2 + (k.z - c.z) ** 2 < 1.75 ** 2) { hitKart(k, c.owner); c.fly = 0.01; break; }
    }
  }
  cones = cones.filter((c) => { if (c.dead) scene.remove(c.g); return !c.dead; });
  for (const p of shots) {
    p.t += dt;
    p.prog += p.v * dt;
    if (p.target) p.d += clamp(p.target.d - p.d, -9 * dt, 9 * dt);
    const t = sample(p.prog);
    p.x = t.x + t.nx * p.d; p.z = t.z + t.nz * p.d;
    p.m.position.set(p.x, 0.75 + Math.abs(Math.sin(p.t * 9)) * 0.4, p.z);
    p.m.rotation.set(p.t * 7, p.t * 3, 0);
    for (const k of racers) {
      if (k === p.owner && p.t < 0.5) continue;
      if ((k.x - p.x) ** 2 + (k.z - p.z) ** 2 < 2.2 ** 2) { hitKart(k, p.owner); p.dead = true; break; }
    }
    if (p.t > 3.6) p.dead = true;
  }
  shots = shots.filter((p) => { if (p.dead) scene.remove(p.m); return !p.dead; });
}

/* ───────── 화면 글자(HUD) ───────── */
const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, "0")}`; };
let toastTimer = 0;
function toast(text, warn = false) {
  const el = $("toast");
  el.innerHTML = warn ? "" : "<i></i>";
  el.append(text);
  el.classList.toggle("warn", warn);
  el.classList.add("on");
  toastTimer = 1.8;
}
function countPop(text, go = false) {
  const el = $("count");
  el.textContent = text; el.classList.toggle("go", go);
  el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
}
let slotShown = "";
function updateSlot() {
  const k = player, slot = $("slot"), img = $("slot-img");
  let want = k.item || "";
  if (k.rolling > 0) want = "roll";
  if (want === slotShown && want !== "roll") return;
  slotShown = want;
  slot.classList.toggle("spin", want === "roll");
  slot.classList.toggle("has", !!k.item);
  if (want === "roll") { const keysI = Object.keys(ITEMS); const pick = keysI[Math.floor(performance.now() / 80) % 3]; if (img.dataset.k !== pick) { img.src = ITEMS[pick].img; img.dataset.k = pick; SFX.tick(); } $("slot-name").textContent = ""; }
  else if (k.item) { img.src = ITEMS[k.item].img; img.dataset.k = k.item; $("slot-name").textContent = ITEMS[k.item].name; }
  else { $("slot-name").textContent = ""; }
}

// 작은 지도: 실제 지도처럼 북쪽이 위
const MINI = (() => {
  const pad = 0.08, w = bb.x1 - bb.x0, h = bb.z1 - bb.z0;
  return (cw, ch) => { const sc = Math.min(cw * (1 - pad * 2) / w, ch * (1 - pad * 2) / h); const ox = (cw - w * sc) / 2, oy = (ch - h * sc) / 2; return (x, z) => [ox + (x - bb.x0) * sc, oy + (z - bb.z0) * sc]; };
})();
function drawTrack(ctx, cw, ch, lw) {
  const m = MINI(cw, ch);
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "#9FD3EE"; ctx.beginPath();
  LAKE.r.forEach((r, k) => { const a = (k / LAKE.r.length) * Math.PI * 2, [x, y] = m(LAKE.x + Math.cos(a) * r, LAKE.z + Math.sin(a) * r); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.fill();
  ctx.lineJoin = ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i <= N; i += 2) { const [x, y] = m(PX[i % N], PZ[i % N]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.closePath();
  ctx.strokeStyle = "#191F28"; ctx.lineWidth = lw + 3; ctx.stroke();
  ctx.strokeStyle = "#8B95A1"; ctx.lineWidth = lw; ctx.stroke();
  const t = sample(0), [sx, sy] = m(t.x, t.z);
  ctx.fillStyle = "#FF6B35"; ctx.beginPath(); ctx.arc(sx, sy, lw * 0.9, 0, 7); ctx.fill();
  return m;
}
const miniEl = $("mini"), miniCtx = miniEl.getContext("2d");
const miniBase = document.createElement("canvas"); miniBase.width = miniEl.width; miniBase.height = miniEl.height;
const miniMap = drawTrack(miniBase.getContext("2d"), miniBase.width, miniBase.height, 9);
function drawMini() {
  const c = miniCtx;
  c.clearRect(0, 0, miniEl.width, miniEl.height);
  c.drawImage(miniBase, 0, 0);
  for (const k of [...racers.filter((o) => !o.isMe), player]) {
    const [x, y] = miniMap(k.x, k.z), r = k.isMe ? 12 : 8;
    c.fillStyle = k.def.color; c.strokeStyle = "#FFFFFF"; c.lineWidth = 4;
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke();
    if (k.isMe) { c.fillStyle = "#FFFFFF"; c.beginPath(); c.moveTo(x + Math.sin(k.h) * 20, y + Math.cos(k.h) * 20); c.lineTo(x + Math.sin(k.h + 2.4) * 9, y + Math.cos(k.h + 2.4) * 9); c.lineTo(x + Math.sin(k.h - 2.4) * 9, y + Math.cos(k.h - 2.4) * 9); c.fill(); }
  }
}
{
  const c = $("mini-title");
  drawTrack(c.getContext("2d"), c.width, c.height, 7);
}

/* ───────── 화면 전환 ───────── */
function showHow() { $("how-key").hidden = touchUI; $("how-touch").hidden = !touchUI; }
function segInit(id, key) {
  const box = $(id);
  const paint = () => box.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.v === opts[key])));
  box.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; opts[key] = +b.dataset.v; store.set(key, opts[key]); paint(); showBest(); });
  paint();
}
function showBest() {
  const b = store.get(`best${opts.laps}`, null);
  $("best").textContent = b ? `내 최고 기록 (${opts.laps}바퀴) ${fmt(b)}` : "";
}
$("real-km").textContent = `${TR.real_km}km`;
$("game-km").textContent = `${(L / 1000).toFixed(1)}km`;
segInit("opt-laps", "laps");
segInit("opt-level", "level");
showHow(); showBest(); setMute(muted);

function startRace() {
  audioInit();
  if (ac && ac.state === "suspended") ac.resume();
  MUSIC.stop(0.1);
  for (const c of cones) scene.remove(c.g);
  for (const p of shots) scene.remove(p.m);
  cones = []; shots = [];
  itemBoxes.forEach((b) => { b.off = 0; b.m.visible = true; b.m.scale.setScalar(1); });
  placeOnGrid();
  $("title").hidden = true; $("result").hidden = true; $("paused").hidden = true;
  $("hud").hidden = false; $("touch").hidden = !touchUI; $("hud").classList.toggle("t", touchUI);
  state = "count"; countT = 0; raceT = 0; lastLap = 1; finishT = 0; slotShown = "x";
  $("lap").textContent = `1/${opts.laps}`; $("time").textContent = fmt(0);
  camInit = false;
}
function toTitle() {
  state = "title"; placeOnGrid(); MUSIC.stop();
  $("hud").hidden = true; $("result").hidden = true; $("paused").hidden = true; $("title").hidden = false;
  showBest();
}
function pause(on) {
  if (on && (state === "race" || state === "count")) { pausedFrom = state; state = "paused"; $("paused").hidden = false; keys.clear(); MUSIC.stop(); }
  else if (!on && state === "paused") { state = pausedFrom; $("paused").hidden = true; if (state === "race") MUSIC.start(false); }
}
let pausedFrom = "race";
$("go").addEventListener("click", startRace);
$("again").addEventListener("click", startRace);
$("restart").addEventListener("click", startRace);
$("home").addEventListener("click", toTitle);
$("quit").addEventListener("click", toTitle);
$("resume").addEventListener("click", () => pause(false));
$("pause").addEventListener("click", () => pause(true));
$("mute").addEventListener("click", () => { audioInit(); setMute(!muted); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { pause(true); if (ac) ac.suspend(); } else if (ac) ac.resume(); });

function showResult() {
  state = "done";
  const order = [...racers].sort((a, b) => (a.finished && b.finished ? a.time - b.time : a.finished ? -1 : b.finished ? 1 : b.prog - a.prog));
  const avg = 30 * 0.93 * LEVEL_MULT[opts.level];
  const rows = order.map((k, n) => {
    const t = k.finished ? k.time : raceT + Math.max(0, opts.laps * L - k.prog) / avg;
    return `<tr class="${k.isMe ? "me" : ""}"><td>${n + 1}</td><td><span class="dot" style="background:${k.def.color}"></span>${k.def.name}</td><td>${fmt(t)}</td></tr>`;
  });
  const rank = order.indexOf(player) + 1;
  const prev = store.get(`best${opts.laps}`, null), isBest = !prev || player.time < prev;
  if (isBest) store.set(`best${opts.laps}`, player.time);
  $("res-title").textContent = rank === 1 ? "1위! 이남 최고 질주" : `${rank}위로 도착`;
  $("res-sub").innerHTML = `${opts.laps}바퀴 ${fmt(player.time)}${isBest ? ' · <span class="nb">새 최고 기록!</span>' : ""}`;
  $("res-img").src = rank <= 3 ? "img/emoji/kart-trophy.webp" : "img/emoji/kart-flag.webp";
  $("res-table").innerHTML = rows.join("");
  $("result").hidden = false;
  $("hud").hidden = true;
}

/* ───────── 한 걸음 ───────── */
let shake = 0;
function step(dt) {
  if (state === "title") { titleT += dt; return; }
  if (state === "paused") return;
  if (state === "count") {
    const before = countT; countT += dt;
    for (const [at, txt] of [[0.001, "3"], [1, "2"], [2, "1"]]) if (before < at && countT >= at) { countPop(txt); SFX.count(); }
    if (countT >= 3) { state = "race"; countPop("출발!", true); SFX.go(); MUSIC.start(true); }
    return;
  }
  if (state === "race") raceT += dt;
  // 내 카트
  const me = player;
  let ctl;
  if (autoMe || state !== "race") ctl = { steer: autoSteer(me), drift: false, brake: false };
  else ctl = { steer: (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0), drift: keys.has("drift"), brake: keys.has("brake") };
  updatePlayer(me, dt, ctl);
  if (me.rolling > 0) { me.rolling -= dt; if (me.rolling <= 0) me.item = pickItem(me); }
  if (itemPressed) { itemPressed = false; if (state === "race" && me.item && me.rolling <= 0) useItem(me); }
  if (autoMe && me.item && Math.random() < dt * 0.5) useItem(me);
  for (const k of racers) { if (!k.isMe) updateAI(k, dt); if (k.invul > 0) k.invul -= dt; }
  collide();
  updateItems(dt);
  // 바퀴·도착
  for (const k of racers) {
    if (!k.finished && k.prog >= opts.laps * L) {
      k.finished = true; k.time = raceT;
      if (k.isMe) { state = "finish"; finishT = 0; countPop("도착!", true); MUSIC.stop(0.6); SFX.finish(); }
    }
  }
  if (state === "race") {
    const lap = clamp(Math.floor(me.prog / L) + 1, 1, opts.laps);
    if (lap > lastLap) { lastLap = lap; toast(lap === opts.laps ? "마지막 바퀴!" : `${lap}바퀴째`); SFX.lap(); if (lap === opts.laps) MUSIC.faster(); }
    // 지나는 동네 이름
    const s0 = wrapS(me.prog - me.v * dt - 0.01), s1 = me.s;
    if (me.prog > 0 && me.v > 0) for (const [s, name] of TR.landmarks) if (wrapDiff(s - s0) > 0 && wrapDiff(s - s1) <= 0) toast(name);
    // 거꾸로
    const fwd = Math.sin(me.h) * TX[me.ti] + Math.cos(me.h) * TZ[me.ti];
    me.wrongT = fwd < -0.4 && Math.abs(me.v) > 3 ? me.wrongT + dt : 0;
    if (me.wrongT > 1.3) { toast("거꾸로 가고 있어요", true); me.wrongT = -2; }
  }
  if (state === "finish") { finishT += dt; if (finishT > 3) showResult(); }
  // 알갱이
  for (const k of racers) {
    const fx = Math.sin(k.h), fz = Math.cos(k.h);
    if (k.drift) {
      const lv = driftLevel(k);
      for (const sg of [-1, 1]) {
        const x = k.x - fx * 1.1 + -fz * 0.9 * sg, z = k.z - fz * 1.1 + fx * 0.9 * sg;
        if (lv) sparks.emit(x, 0.3, z, (Math.random() - 0.5) * 3 - fx * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3 - fz * 3, DRIFT_COL[lv], 0.32);
        else if (Math.random() < 0.3) dust.emit(x, 0.3, z, -fx * 2, 0.6, -fz * 2, "#E9EEF2", 0.4);
      }
    }
    if (k.boost > 0 && Math.random() < 0.8) sparks.emit(k.x - fx * 1.9, 0.8, k.z - fz * 1.9, -fx * 6 + (Math.random() - 0.5) * 2, Math.random() * 1.5, -fz * 6 + (Math.random() - 0.5) * 2, "#FFB23F", 0.25);
    if (k.isMe && k.off && Math.abs(k.v) > 6 && Math.random() < 0.6) dust.emit(k.x - fx * 1.3, 0.3, k.z - fz * 1.3, (Math.random() - 0.5) * 2, 1.5 + Math.random(), (Math.random() - 0.5) * 2, "#B99B6B", 0.6);
  }
  sparks.update(dt, 9);
  dust.update(dt, 1.5);
}

/* ───────── 그리기 ───────── */
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camDir = new THREE.Vector3();
let camH = 0, camInit = false, frames = 0, slowFrames = 0;
function updateKartMeshes(dt) {
  for (const k of racers) {
    const m = k.mesh;
    m.g.position.set(k.x, k.y, k.z);
    m.g.rotation.y = k.h;
    const yawT = k.drift ? -k.driftDir * 0.42 : 0;
    k.bodyYaw += (yawT - k.bodyYaw) * Math.min(1, dt * 10);
    m.body.rotation.y = k.bodyYaw + (k.spin > 0 ? k.spinA : 0);
    k.lean += (-k.steer * 0.07 * clamp(Math.abs(k.v) / 20, 0, 1) - k.lean) * Math.min(1, dt * 8);
    m.body.rotation.z = k.lean;
    m.body.position.y = Math.sin(performance.now() * 0.025 + k.def.skill * 50) * 0.02 * clamp(Math.abs(k.v) / 10, 0, 1);
    for (const f of m.front) f.rotation.y = -k.steer * 0.45;
    for (const w of m.wheels) w.rotation.x += (k.v * dt) / 0.42;
    m.flame.visible = k.boost > 0;
    if (k.boost > 0) m.flame.scale.set(1, 1, 0.8 + Math.random() * 0.7);
    m.head.rotation.y = -k.steer * 0.25;
    if (m.tag) m.tag.visible = camera.position.distanceToSquared(m.g.position) > 81; // 바로 옆 카트 이름표는 가림
  }
}
function vfov(aspect) { // 세로 화면에서도 옆이 너무 좁지 않게
  const h = 72;
  return aspect >= 1 ? 62 : clamp((2 * Math.atan(Math.tan((h * Math.PI) / 360) / aspect) * 180) / Math.PI, 62, 86);
}
function updateCamera(dt) {
  const aspect = innerWidth / innerHeight, portrait = aspect < 1;
  if (state === "title") {
    const s = titleT * 15, t = sample(s), a = sample(s + 50);
    camera.position.set(t.x - t.nx * 14, 20, t.z - t.nz * 14);
    camera.lookAt(a.x, 0, a.z);
    camera.fov = vfov(aspect); camera.updateProjectionMatrix();
    return;
  }
  const k = player;
  if (state === "finish" || state === "done") { // 도착 뒤: 앞쪽 비스듬히 돌아가며 내 카트를 보여 줌
    const a = k.h + 0.5 + Math.min(1, finishT / 2.2) * 1.9, dist = portrait ? 8 : 6.5;
    camPos.lerp(new THREE.Vector3(k.x + Math.sin(a) * dist, 2.3, k.z + Math.cos(a) * dist), 1 - Math.exp(-dt * 6));
    camera.position.copy(camPos);
    camera.lookAt(k.x, 1, k.z);
    camera.fov += (vfov(aspect) - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
    return;
  }
  if (!camInit) { camH = k.h; camInit = true; camPos.set(k.x - Math.sin(k.h) * 8, 4, k.z - Math.cos(k.h) * 8); camLook.set(k.x, 1, k.z); }
  let target = k.h + (k.spin > 0 ? 0 : k.bodyYaw * 0.35);
  let dh = target - camH; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  camH += dh * Math.min(1, dt * (k.spin > 0 ? 1.5 : 5));
  const back = portrait ? 8.8 : 7.4, up = portrait ? 4.1 : 3.2;
  const want = new THREE.Vector3(k.x - Math.sin(camH) * back, up + k.y * 0.5, k.z - Math.cos(camH) * back);
  camPos.lerp(want, 1 - Math.exp(-dt * 12));
  camLook.lerp(new THREE.Vector3(k.x + Math.sin(camH) * 6, 1.3, k.z + Math.cos(camH) * 6), 1 - Math.exp(-dt * 14));
  camera.position.copy(camPos);
  if (shake > 0 && !REDUCE) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
  shake = Math.max(0, shake - dt * 1.8);
  camera.lookAt(camLook);
  const fovT = vfov(aspect) + clamp(k.v, 0, 40) * 0.22 + (k.boost > 0 ? 7 : 0);
  camera.fov += (fovT - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
}
function updateHUD(dt) {
  if (state === "title" || state === "done") return;
  const me = player;
  $("time").textContent = fmt(raceT);
  $("lap").textContent = `${clamp(Math.floor(me.prog / L) + 1, 1, opts.laps)}/${opts.laps}`;
  const r = rankOf(me), rk = $("rank");
  if (rk.dataset.r !== String(r)) { rk.dataset.r = r; rk.firstChild.textContent = r; rk.className = `rank r${r}`; }
  $("speed").firstChild.textContent = Math.max(0, Math.round(me.v * 3.6));
  updateSlot();
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) $("toast").classList.remove("on");
  if ((frames & 1) === 0) drawMini();
}
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let rem = dt;
  while (rem > 1e-6) { const h = Math.min(rem, 1 / 60); step(h); rem -= h; }
  const tnow = now / 1000;
  for (const b of itemBoxes) { b.m.rotation.set(tnow * 0.9 + b.phase, tnow * 1.3 + b.phase, 0); b.m.position.y = 1.3 + Math.sin(tnow * 2.4 + b.phase) * 0.18; }
  padTex.offset.y = -tnow * 1.6;
  updateKartMeshes(dt);
  updateCamera(dt);
  sky.position.copy(camera.position);
  camera.getWorldDirection(camDir); // 그림자 범위는 카메라 앞쪽 땅에
  const fx = camera.position.x + camDir.x * 30, fz = camera.position.z + camDir.z * 30;
  sun.position.set(fx + 60, 140, fz + 30);
  sun.target.position.set(fx, 0, fz);
  if (eng && ac) {
    const on = (state === "race" || state === "finish" || state === "count") && !muted;
    const f = 52 + Math.abs(player.v) * 4.4 + (player.boost > 0 ? 40 : 0);
    eng.o1.frequency.setTargetAtTime(f, ac.currentTime, 0.05);
    eng.o2.frequency.setTargetAtTime(f * 0.502, ac.currentTime, 0.05);
    eng.lp.frequency.setTargetAtTime(260 + Math.abs(player.v) * 18, ac.currentTime, 0.1);
    eng.g.gain.setTargetAtTime(on ? 0.012 : 0, ac.currentTime, 0.1); // 배기음은 배경 음악 밑에 깔리게
  }
  updateHUD(dt);
  renderer.render(scene, camera);
  // 느린 기기면 해상도를 낮춘다
  frames++;
  if (state === "race") { if (dt > 1 / 38) slowFrames++; if (frames % 180 === 0) { if (slowFrames > 90 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.5); renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight, false); } slowFrames = 0; } }
}
addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
requestAnimationFrame(frame);
if (Q.has("go")) startRace();

// 시험용(브라우저 콘솔): 한 걸음씩 돌리기 __kart.run(초), 자동 운전 __kart.setAuto(true)
window.__kart = { get state() { return state; }, player, racers, L, opts, startRace, toTitle, setAuto(v) { autoMe = v; }, get raceT() { return raceT; }, scene, renderer,
  run(sec) { for (let t = 0; t < sec; t += 1 / 60) step(1 / 60); }, steerHint: () => autoSteer(player), curveAhead: (a = 20) => K[idxOf(player.s + a)], get cones() { return cones.length; }, get shots() { return shots.length; },
  audio: () => ({ ac, master, sfx, eng, MUSIC, SFX }) };
