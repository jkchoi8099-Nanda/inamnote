// 이동저수지 낚시: 실제 저수지 모양(OSM)과 위성영상에서 확인한 좌대 자리(data/fishing_lake.js)에서 찌를 보고 챔질하는 게임.
// 2026-10-21. 입질 운·잘 무는 고기는 날짜로 정하고, 날씨(data/today.json)·시각은 실제 값을 쓴다. 지도 원본은 scripts/build_fishing.py.
// 시험용 주소: fishing.html?spot=willow (바로 그 자리), ?hour=20 (시각 바꿔 보기), ?free (미끼 제한 없음)
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";

const LK = window.FISH_LAKE;
const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const store = {
  get(k, d) { try { const v = localStorage.getItem("inamfish." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("inamfish." + k, JSON.stringify(v)); } catch { /* 사생활 보호 창 등 */ } },
};
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = mulberry32(20261021); // 풍경은 매번 같은 자리에
const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
await Promise.race([document.fonts?.load('800 80px "Pretendard Variable"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});

/* ───────── 물고기·자리 ───────── */
// len: 몸 높이/길이, k: 무게(g)=k×길이(cm)³, power: 힘(챔질 뒤 감기 난이도), bite: 찌 신호(rise 찌올림 · sink 끌고 들어감 · jitter 깔짝대다 쏙)
const FISH = {
  minnow: { name: "피라미", min: 8, max: 15, k: 0.010, power: 1, bite: "jitter", small: true, len: 0.24, back: "#6E8C8A", belly: "#EEF1F2", fin: "#E58C8C", bars: "#E9A3A3",
    note: "수컷은 알 낳을 때가 되면 몸이 붉고 푸르게 화려해져요." },
  bluegill: { name: "블루길", min: 10, max: 22, k: 0.030, power: 1, bite: "jitter", small: true, day: true, alien: true, len: 0.5, back: "#4F6B4E", belly: "#E8B04B", fin: "#5B6E52", bars: "#3E5540", flap: true,
    note: "생태계교란 생물로 지정된 외래종이에요. 놓아주지 않고 가져가요." },
  crucian: { name: "붕어", min: 15, max: 42, k: 0.022, power: 2, bite: "rise", len: 0.44, back: "#5E5A2E", belly: "#D8C27A", fin: "#6B6436", scales: true,
    note: "한 자(30.3cm)를 넘으면 '월척', 40cm를 넘으면 '4짜'라고 불러요." },
  gibel: { name: "떡붕어", min: 20, max: 45, k: 0.020, power: 2, bite: "rise", len: 0.42, back: "#6F7A72", belly: "#E6E8E2", fin: "#7E857E", scales: true,
    note: "일본에서 들어온 붕어예요. 토종 붕어보다 은빛이 돌고 몸이 높아요." },
  bagrid: { name: "동자개", min: 15, max: 30, k: 0.009, power: 2, bite: "sink", night: true, len: 0.24, back: "#8A6A2E", belly: "#F1D27A", fin: "#7A5A2A", whisk: 4, blotch: "#4E3B17", flat: true,
    note: "흔히 '빠가사리'라고 불러요. 잡으면 빠각빠각 소리를 내요." },
  bass: { name: "배스", min: 20, max: 55, k: 0.013, power: 3, bite: "sink", day: true, alien: true, len: 0.3, back: "#4B6A3A", belly: "#E7E9D8", fin: "#5A7445", stripe: "#2F4425", mouth: true,
    note: "생태계교란 생물로 지정된 외래종이에요. 놓아주지 않고 가져가요." },
  catfish: { name: "메기", min: 30, max: 80, k: 0.007, power: 3, bite: "sink", night: true, big: true, len: 0.22, back: "#3F4237", belly: "#C9C4B0", fin: "#45473D", whisk: 2, flat: true, smooth: true,
    note: "비늘이 없고 수염이 길어요. 밤에 먹이를 찾아 돌아다녀요." },
  carp: { name: "잉어", min: 35, max: 90, k: 0.014, power: 4, bite: "sink", big: true, len: 0.34, back: "#5C5530", belly: "#E2C98A", fin: "#8A6A3A", scales: true, barb: true,
    note: "입가에 수염이 두 쌍 있어요. 힘이 세서 오래 버텨요." },
  israeli: { name: "향어", min: 40, max: 70, k: 0.017, power: 4, bite: "rise", big: true, len: 0.37, back: "#5F6650", belly: "#DCD7BE", fin: "#7A6F55", mirror: true, barb: true,
    note: "'이스라엘잉어'라고도 해요. 비늘이 몇 줄만 크게 나 있어요." },
  snakehead: { name: "가물치", min: 45, max: 90, k: 0.008, power: 5, bite: "sink", big: true, len: 0.19, back: "#3A3F2C", belly: "#B9B58F", fin: "#3F432F", blotch: "#1F2418", long: true,
    note: "공기로도 숨을 쉴 수 있는 힘센 고기예요. 감기가 가장 어려워요." },
  boot: { name: "헌 장화", min: 26, max: 30, k: 0.025, power: 1, bite: "sink", junk: true,
    note: "누가 버린 장화예요. 쓰레기는 꼭 가져가요!" },
  golden: { name: "황금 잉어", min: 60, max: 100, k: 0.014, power: 6, bite: "sink", legend: true, len: 0.34, back: "#E0A21B", belly: "#FFE27A", fin: "#F2B33D", scales: true, barb: true,
    note: "이동저수지의 전설… 은 게임 속 이야기예요. 오늘 운이 정말 좋네요!" },
};
const DEX = ["crucian", "gibel", "carp", "israeli", "catfish", "bagrid", "snakehead", "bass", "bluegill", "minnow", "golden", "boot"];
// 자리마다 잘 나오는 고기(가중치)와 성격. 이름·성격은 게임용
const SPOT_CFG = {
  willow: { trait: "붕어 월척 자리 · 버드나무 걸림 주의", snag: true, roofs: ["#4C78A8", "#3F6FB5", "#C8553D"], huts: { n: 26, r: 190 },
    w: { crucian: 34, gibel: 12, bluegill: 12, minnow: 6, bagrid: 8, bass: 8, catfish: 6, carp: 6, israeli: 2, snakehead: 4, boot: 2 } },
  bank: { trait: "붕어·잉어가 고르게 나와요", roofs: ["#4C78A8", "#5B8DC9"], huts: { n: 12, row: true },
    w: { crucian: 24, gibel: 14, carp: 14, israeli: 10, bluegill: 10, minnow: 8, bagrid: 6, catfish: 6, bass: 6, snakehead: 2 } },
  port: { trait: "입질이 잦은 초보 자리 · 잔챙이가 많아요", fast: true, roofs: ["#F1F3F5"], huts: { n: 8, r: 90 },
    w: { bluegill: 26, minnow: 22, crucian: 16, gibel: 8, bass: 10, bagrid: 6, carp: 4, catfish: 2, boot: 6 } },
  shade: { trait: "메기·동자개 · 밤에 강해요", roofs: ["#4C78A8", "#3F6FB5"], huts: { n: 10, row: true },
    w: { catfish: 18, bagrid: 20, crucian: 18, gibel: 8, carp: 10, israeli: 6, bluegill: 8, snakehead: 4, minnow: 6, boot: 2 } },
  sunset: { trait: "잉어·향어 대물 · 해 질 녘에 좋아요", dusk: true, roofs: ["#E8743B", "#F08A4B"], huts: { n: 9, row: true },
    w: { carp: 22, israeli: 16, crucian: 18, gibel: 12, catfish: 8, bass: 8, bluegill: 8, snakehead: 4, minnow: 4 } },
  reed: { trait: "가물치·배스 · 낮에 강해요 · 걸림 주의", snag: true, roofs: ["#4C78A8", "#5B8DC9"], huts: { n: 10, r: 140 },
    w: { snakehead: 14, bass: 22, crucian: 18, bluegill: 14, minnow: 8, catfish: 6, bagrid: 6, carp: 6, gibel: 6 } },
};

/* ───────── 오늘의 운·시각·날씨 ───────── */
const NOW = new Date();
const pad = (n) => String(n).padStart(2, "0");
const DATE_KEY = `${NOW.getFullYear()}-${pad(NOW.getMonth() + 1)}-${pad(NOW.getDate())}`;
const dayRng = mulberry32(NOW.getFullYear() * 10000 + (NOW.getMonth() + 1) * 100 + NOW.getDate());
const STARS = (() => { const x = dayRng(); return x < 0.1 ? 1 : x < 0.3 ? 2 : x < 0.65 ? 3 : x < 0.9 ? 4 : 5; })();
const DAY_FISH = pick(["crucian", "gibel", "carp", "israeli", "catfish", "bagrid", "snakehead", "bass", "bluegill", "minnow"], dayRng);
let HOUR = Q.has("hour") ? +Q.get("hour") : NOW.getHours() + NOW.getMinutes() / 60;
const phaseOf = (h) => (h < 5 || h >= 19.5 ? "night" : h < 7.5 ? "dawn" : h < 16.5 ? "day" : "dusk");
const PHASE_WORD = { night: "밤", dawn: "새벽", day: "낮", dusk: "해 질 녘" };
const WX = { ok: false, sky: "", temp: null, wind: 0, rain: false, word: "날씨 정보 없음" };
const FREE = Q.has("free");
let day = store.get("day", null);
if (!day || day.date !== DATE_KEY) day = { date: DATE_KEY, baits: 10, catches: [] };
let practice = false;
const dex = store.get("dex", {});

/* ───────── 저수지(m, x 동쪽·z 남쪽) ───────── */
const LAKE = LK.lake;
const NL = LAKE.length;
function inside(x, z) {
  let c = false;
  for (let i = 0, j = NL - 1; i < NL; j = i++) {
    const [xi, zi] = LAKE[i], [xj, zj] = LAKE[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function edgeDist(x, z) {
  let best = 1e12;
  for (let i = 0; i < NL; i++) {
    const [ax, az] = LAKE[i], [bx, bz] = LAKE[(i + 1) % NL];
    const dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    best = Math.min(best, (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2);
  }
  return Math.sqrt(best);
}
const bb = { x0: Math.min(...LAKE.map((p) => p[0])), x1: Math.max(...LAKE.map((p) => p[0])), z0: Math.min(...LAKE.map((p) => p[1])), z1: Math.max(...LAKE.map((p) => p[1])) };

/* ───────── 렌더러·장면 ───────── */
const TOUCH = matchMedia("(pointer: coarse)").matches;
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
const FONT = '"Pretendard Variable", Pretendard, system-ui, "Malgun Gothic", sans-serif';
const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, TOUCH ? 1.75 : 2));
renderer.setSize(innerWidth, innerHeight, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.3, 9000);
scene.add(camera);
const fog = new THREE.Fog("#D3EDF7", 600, 3600);
scene.fog = fog;

// 하늘(시각에 따라 색이 바뀜)
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() } },
  vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: "uniform vec3 top; uniform vec3 mid; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.8, 0.0, 1.0); gl_FragColor = vec4(mix(mid, top, pow(h, 0.65)), 1.0);\n#include <colorspace_fragment>\n}",
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 16), skyMat);
scene.add(sky);
const hemi = new THREE.HemisphereLight("#E4F4FF", "#5E7A45", 1.5);
const sun = new THREE.DirectionalLight("#FFF2DA", 2.4);
scene.add(hemi, sun, sun.target);

function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const glowTex = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,.6)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: "#FFF4D6", fog: false, depthWrite: false, transparent: true }));
sunSprite.scale.setScalar(520);
scene.add(sunSprite);
const stars = (() => {
  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, e = Math.asin(0.08 + R() * 0.92), r = 5000;
    pos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: "#FFFFFF", size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
  scene.add(p);
  return p;
})();

// 물: 잔물결 법선 지도 + 하늘 반사(환경 지도)
const waterNormal = (() => {
  const S = 256, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d"), img = g.createImageData(S, S);
  const wr = mulberry32(7), waves = [];
  for (let k = 0; k < 36; k++) { let fx = Math.round((wr() - 0.5) * 30), fy = Math.round((wr() - 0.5) * 30); if (!fx && !fy) fx = 3; waves.push([fx, fy, 1 / Math.hypot(fx, fy) ** 0.9, wr() * 7]); }
  const hgt = (x, y) => { let v = 0; for (const [fx, fy, a, p] of waves) v += a * Math.sin(((fx * x + fy * y) / S) * Math.PI * 2 + p); return v * 3; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
    const nx = -dx * 2.2, ny = -dy * 2.2, nz = 1, l = Math.hypot(nx, ny, nz), i = (y * S + x) * 4;
    img.data[i] = ((nx / l) * 0.5 + 0.5) * 255; img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255; img.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1600, 1600); t.anisotropy = 8;
  return t;
})();
const waterMat = new THREE.MeshStandardMaterial({ color: "#2E6B74", roughness: 0.2, metalness: 0.12, envMapIntensity: 0.75, normalMap: waterNormal, normalScale: new THREE.Vector2(0.3, 0.3) });
const water = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), waterMat);
water.rotation.x = -Math.PI / 2;
scene.add(water);

// 땅: 저수지 모양으로 구멍 낸 판
{
  const sh = new THREE.Shape();
  const E = 7000;
  sh.moveTo(-E, -E); sh.lineTo(E, -E); sh.lineTo(E, E); sh.lineTo(-E, E); sh.lineTo(-E, -E);
  const hole = new THREE.Path();
  LAKE.forEach(([x, z], i) => (i ? hole.lineTo(x, -z) : hole.moveTo(x, -z)));
  sh.holes.push(hole);
  const grass = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#6E9A4E"; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 2200; k++) { g.fillStyle = ["#668F48", "#78A556", "#618A44", "#7FA95A"][(R() * 4) | 0]; g.fillRect(R() * w, R() * h, 3, 3); }
  }, true);
  grass.repeat.set(0.05, 0.05);
  const land = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshLambertMaterial({ map: grass }));
  land.rotation.x = -Math.PI / 2; land.position.y = 0.35;
  scene.add(land);
  // 물가 비탈(땅 → 물 밑)
  const pos = [], idx = [];
  for (let i = 0; i <= NL; i++) {
    const [x, z] = LAKE[i % NL], [px, pz] = LAKE[(i - 1 + NL) % NL], [nx2, nz2] = LAKE[(i + 1) % NL];
    let tx = nx2 - px, tz = nz2 - pz; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    let ox = -tz, oz = tx; // 바깥(땅) 쪽이 되게
    if (inside(x + ox * 2, z + oz * 2)) { ox = -ox; oz = -oz; }
    pos.push(x + ox * 3, 0.33, z + oz * 3, x - ox * 9, -0.8, z - oz * 9);
    if (i < NL) { const o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: "#9C8A62", side: THREE.DoubleSide })));
}

/* ───────── 풍경: 산·나무·버드나무·좌대 ───────── */
const dummy = new THREE.Object3D();
const tmpC = new THREE.Color();
function instanced(geo, mat, list, setup) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  list.forEach((it, k) => { dummy.position.set(0, 0, 0); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); setup(it, dummy); dummy.updateMatrix(); m.setMatrixAt(k, dummy.matrix); if (it.c) m.setColorAt(k, tmpC.set(it.c)); });
  m.count = list.length;
  scene.add(m);
  return m;
}
// 산: 저수지를 둘러싼 숲 언덕(물에 들어오지 않게)
{
  const hills = [];
  for (let t = 0; t < 2600 && hills.length < 150; t++) {
    const x = bb.x0 - 1500 + R() * (bb.x1 - bb.x0 + 3000), z = bb.z0 - 1500 + R() * (bb.z1 - bb.z0 + 3000);
    if (inside(x, z)) continue;
    const r = 70 + R() * 200, d = edgeDist(x, z);
    if (d < r * 0.75 + 20) continue;
    hills.push({ x, z, r, h: Math.min(r * 0.55, 25 + R() * 90) * (d > 900 ? 1.3 : 1) });
  }
  const geo = new THREE.IcosahedronGeometry(1, 2), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setY(i, 0);
  const g2 = geo.index ? geo.toNonIndexed() : geo, p2 = g2.attributes.position, cols = [];
  const low = new THREE.Color("#3F6E3C"), high = new THREE.Color("#6C9A52"), fall = new THREE.Color("#B98E44"), c = new THREE.Color();
  for (let i = 0; i < p2.count; i += 3) {
    const y = (p2.getY(i) + p2.getY(i + 1) + p2.getY(i + 2)) / 3;
    c.copy(low).lerp(high, clamp(y * 0.9 + (R() - 0.5) * 0.2, 0, 1)); if (R() < 0.18) c.lerp(fall, 0.5);
    for (let j = 0; j < 3; j++) cols.push(c.r, c.g, c.b);
  }
  g2.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3)); g2.computeVertexNormals();
  instanced(g2, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), hills, (o, d) => { d.position.set(o.x, 0.2, o.z); d.rotation.y = o.x; d.scale.set(o.r, o.h, o.r * 0.9); });
}
// 물가 숲
{
  const trees = [];
  for (let t = 0; t < 26000 && trees.length < 3200; t++) {
    const x = bb.x0 - 300 + R() * (bb.x1 - bb.x0 + 600), z = bb.z0 - 300 + R() * (bb.z1 - bb.z0 + 600);
    if (inside(x, z)) continue;
    const d = edgeDist(x, z);
    if (d < 5 || d > 160 || R() > 1.15 - d / 160) continue;
    const pine = R() < 0.45;
    trees.push({ x, z, s: 0.8 + R() * 0.9, pine, c: pine ? pick(["#2F5E36", "#386B3E", "#2A5531"], R) : pick(["#E0A33A", "#D27637", "#5E8F45", "#7AA650", "#C9973F", "#4F7F3F"], R) });
  }
  const pines = trees.filter((t) => t.pine), rounds = trees.filter((t) => !t.pine);
  instanced(new THREE.ConeGeometry(2.6, 8, 7).translate(0, 5, 0), new THREE.MeshLambertMaterial({ flatShading: true }), pines, (o, d) => { d.position.set(o.x, 0.3, o.z); d.scale.setScalar(o.s); d.rotation.y = o.z; });
  instanced(new THREE.IcosahedronGeometry(3, 0), new THREE.MeshLambertMaterial({ flatShading: true }), rounds, (o, d) => { d.position.set(o.x, 4.2 * o.s, o.z); d.scale.set(o.s, o.s * 1.1, o.s); d.rotation.set(o.x, o.z, 0); });
}
// 물에 잠긴 버드나무(버드나무 자리) + 물가 버드나무
const willows = [];
function addWillow(x, z, s) { if (inside(x, z)) willows.push({ x, z, s, c: pick(["#9BBF57", "#A9C25E", "#8FB24F", "#C2BE58"], R) }); }
for (const sp of LK.spots) {
  const away = (x, z, rad = 70, ang = 0.32) => { // 찌 둘레는 비워 둔다
    const dx = x - sp.x, dz = z - sp.z, d = Math.hypot(dx, dz);
    let da = Math.atan2(dz, dx) - sp.face; da = Math.atan2(Math.sin(da), Math.cos(da));
    return d > 14 && !(d < rad && Math.abs(da) < ang);
  };
  if (sp.willow) {
    for (let k = 0, t = 0; k < 16 && t < 600; t++) {
      const a = R() * Math.PI * 2, r = 30 + R() * 190, cx = sp.x + Math.cos(a) * r, cz = sp.z + Math.sin(a) * r;
      if (!inside(cx, cz) || !away(cx, cz, 90, 0.4)) continue;
      const n = 3 + ((R() * 7) | 0);
      for (let j = 0; j < n; j++) { const x = cx + (R() - 0.5) * 22, z = cz + (R() - 0.5) * 22; if (away(x, z, 90, 0.4)) addWillow(x, z, 0.8 + R() * 0.6); }
      k++;
    }
  }
  for (let k = 0, t = 0; k < (sp.willow ? 40 : 14) && t < 900; t++) { // 물가 쪽
    const a = R() * Math.PI * 2, r = 20 + R() * 260, x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r;
    if (!inside(x, z) || edgeDist(x, z) > 9 || !away(x, z)) continue;
    addWillow(x, z, 0.8 + R() * 0.5); k++;
  }
}
instanced(new THREE.CylinderGeometry(0.25, 0.4, 3.6, 6).translate(0, 1.2, 0), new THREE.MeshLambertMaterial({ color: "#6B5A3E" }), willows.map(({ c, ...o }) => o), (o, d) => { d.position.set(o.x, 0, o.z); d.scale.setScalar(o.s); });
instanced(new THREE.IcosahedronGeometry(3.2, 1), new THREE.MeshLambertMaterial({ flatShading: true }), willows, (o, d) => { d.position.set(o.x, 4.1 * o.s, o.z); d.scale.set(o.s * 1.15, o.s * 0.85, o.s * 1.15); d.rotation.set(o.x, o.z, 0); });

// 좌대(물 위 낚시집): 위성영상에서 본 무리 모양대로 — 무리(r) 또는 물가 한 줄(row)
const roofGeo = (() => {
  const v = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5];
  const f = [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(f.flatMap((i) => v.slice(i * 3, i * 3 + 3))), 3));
  g.computeVertexNormals();
  return g;
})();
const huts = [];
for (const sp of LK.spots) {
  const cfg = SPOT_CFG[sp.id], H = cfg.huts, mine = [];
  for (let t = 0; t < 3000 && mine.length < H.n; t++) {
    const a = R() * Math.PI * 2, r = 14 + R() * (H.row ? 240 : H.r), x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r;
    if (!inside(x, z)) continue;
    const e = edgeDist(x, z);
    if (H.row ? e < 10 || e > 34 : e < 9) continue;
    let da = Math.atan2(z - sp.z, x - sp.x) - sp.face; da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.hypot(x - sp.x, z - sp.z) < 80 && Math.abs(da) < 0.35) continue;
    if (mine.some((h) => Math.hypot(h.x - x, h.z - z) < 13)) continue;
    mine.push({ x, z, a: R() * 3, roof: pick(cfg.roofs, R), white: sp.id === "port" });
  }
  huts.push(...mine);
}
instanced(new THREE.BoxGeometry(4.2, 0.5, 3.6), new THREE.MeshLambertMaterial({ color: "#A9875E" }), huts, (o, d) => { d.position.set(o.x, 0.2, o.z); d.rotation.y = o.a; });
instanced(new THREE.BoxGeometry(2.8, 2, 2.4).translate(0, 1, 0), new THREE.MeshLambertMaterial(), huts.map((o) => ({ ...o, c: o.white ? "#FFFFFF" : "#EEF0EC" })), (o, d) => { d.position.set(o.x, 0.45, o.z); d.rotation.y = o.a; });
instanced(roofGeo, new THREE.MeshLambertMaterial({ flatShading: true }), huts.map((o) => ({ ...o, c: o.roof })), (o, d) => { d.position.set(o.x, 2.45, o.z); d.rotation.y = o.a; d.scale.set(3.3, 1.1, 2.9); });

/* ───────── 내 좌대·낚싯대·찌 ───────── */
const deck = new THREE.Group();
{
  const wood = new THREE.MeshLambertMaterial({ color: "#B58D5E" }), dark = new THREE.MeshLambertMaterial({ color: "#8C6A44" });
  for (let k = 0; k < 9; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 3.4), k % 2 ? wood : dark); p.position.set(-1.5 + k * 0.36, 0.45, 0.1); deck.add(p); }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 0.12), dark); rail.position.set(0, 0.52, 1.8); deck.add(rail);
}
scene.add(deck);
// 낚싯대: 6마디 사슬(휘어짐은 마디마다 같은 각도로)
const rod = new THREE.Group();
const rodSegs = [];
{
  const mat = new THREE.MeshStandardMaterial({ color: "#1F2A24", roughness: 0.35, metalness: 0.3 });
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.55, 10).translate(0, 0.27, 0), new THREE.MeshLambertMaterial({ color: "#8A5A3A" }));
  rod.add(grip);
  let parent = rod, len = 0.55;
  for (let k = 0; k < 6; k++) {
    const r0 = 0.028 - k * 0.0042, seg = new THREE.Group();
    seg.position.y = len; parent.add(seg);
    const L = 0.9 - k * 0.04;
    seg.add(new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.004, r0 - 0.004), r0, L, 8).translate(0, L / 2, 0), mat));
    rodSegs.push(seg); parent = seg; len = L;
  }
  const tip = new THREE.Object3D(); tip.position.y = len; parent.add(tip); rod.userData.tip = tip;
  rod.position.set(0.42, -0.95, -0.55); // 카메라 기준: 오른쪽 아래에서 앞으로
  camera.add(rod);
}
const lineGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 16 }, () => new THREE.Vector3()));
const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: "#F4F6F8", transparent: true, opacity: 0.75 }));
line.frustumCulled = false;
scene.add(line);
// 찌: 잘 보이게 실제보다 크게(약 2배). 밤에는 끝에 케미(빛나는 막대)
const FLOAT_S = 2.2;
const floatG = new THREE.Group();
const chemMat = new THREE.MeshBasicMaterial({ color: "#7CFFB0" });
const chemGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: "#7CFFB0", transparent: true, depthWrite: false, opacity: 0.9 }));
{
  const bandTex = canvasTex(8, 64, (g, w, h) => { const cs = ["#FF3B30", "#FFD43B", "#191F28", "#FF3B30", "#FFD43B", "#2FC67A", "#FF3B30", "#FFD43B"]; cs.forEach((c, k) => { g.fillStyle = c; g.fillRect(0, (k * h) / cs.length, w, h / cs.length); }); });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshLambertMaterial({ color: "#F1E9D6" })); body.scale.set(1, 4, 1); body.position.y = -0.12;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.42, 8).translate(0, 0.21, 0), new THREE.MeshLambertMaterial({ map: bandTex, emissive: "#331100", emissiveIntensity: 0.4 }));
  top.position.y = 0.05;
  const chem = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.08, 8), chemMat); chem.position.y = 0.5;
  chemGlow.position.y = 0.5; chemGlow.scale.setScalar(0.35);
  floatG.add(body, top, chem, chemGlow);
  floatG.scale.setScalar(FLOAT_S);
  floatG.visible = false;
}
scene.add(floatG);
// 물결 고리
const rings = [];
const ringGeo = new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2);
function ripple(x, z, size = 1, life = 1.2) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: 0.6, depthWrite: false }));
  m.position.set(x, 0.03, z); scene.add(m); rings.push({ m, t: 0, life, size });
}
// 물보라
const SPL = 260, splPos = new Float32Array(SPL * 3).fill(-999), splVel = new Float32Array(SPL * 3), splLife = new Float32Array(SPL);
const splGeo = new THREE.BufferGeometry(); splGeo.setAttribute("position", new THREE.BufferAttribute(splPos, 3));
const splash = new THREE.Points(splGeo, new THREE.PointsMaterial({ map: glowTex, color: "#FFFFFF", size: 0.32, transparent: true, depthWrite: false, opacity: 0.85 }));
splash.frustumCulled = false; scene.add(splash);
let splHead = 0;
function burst(x, z, n = 24, power = 3) {
  for (let k = 0; k < n; k++) {
    const i = splHead; splHead = (splHead + 1) % SPL;
    const a = Math.random() * Math.PI * 2, s = Math.random() * power * 0.6;
    splPos.set([x, 0.05, z], i * 3); splVel.set([Math.cos(a) * s, power * (0.6 + Math.random() * 0.8), Math.sin(a) * s], i * 3); splLife[i] = 0.6 + Math.random() * 0.5;
  }
}
// 비(실제 날씨가 비일 때)
const rain = (() => {
  const n = 1400, pos = new Float32Array(n * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: "#DDE6EE", size: 0.08, transparent: true, opacity: 0.6, depthWrite: false }));
  p.visible = false; p.frustumCulled = false; scene.add(p);
  return { p, pos, n };
})();

/* ───────── 시각에 따른 하늘·빛 ───────── */
// [시, 하늘 위, 지평선, 해(달) 세기, 하늘빛 세기, 물빛]
const KEYS = [
  [0, "#0A1430", "#1B2747", 0.35, 0.3, "#0E1E2C"], [4.5, "#141F45", "#2E3A5E", 0.35, 0.32, "#132535"],
  [6, "#6A86C2", "#F3C6A2", 1.1, 0.9, "#4F6E7C"], [8, "#57A2E6", "#CFE9F6", 2.1, 1.35, "#2E6B74"],
  [12, "#4FA6EA", "#D3EDF7", 2.5, 1.55, "#2E6B74"], [16, "#5A9FE0", "#DCEBF0", 2.2, 1.4, "#2F6670"],
  [18, "#4E62A6", "#F2A160", 1.3, 0.95, "#4A5A68"], [19.5, "#26305E", "#7E5466", 0.55, 0.5, "#1F2D3E"],
  [20.5, "#0F1838", "#22304F", 0.35, 0.3, "#0E1E2C"], [24, "#0A1430", "#1B2747", 0.35, 0.3, "#0E1E2C"],
];
let night = false;
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
function applyTime(h) {
  let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const A = KEYS[i], B = KEYS[i + 1], t = clamp((h - A[0]) / (B[0] - A[0]), 0, 1);
  const col = (k) => new THREE.Color(A[k]).lerp(new THREE.Color(B[k]), t);
  skyMat.uniforms.top.value.copy(col(1)); skyMat.uniforms.mid.value.copy(col(2));
  fog.color.copy(col(2)); scene.background = fog.color;
  sun.intensity = lerp(A[3], B[3], t); hemi.intensity = lerp(A[4], B[4], t);
  waterMat.color.copy(col(5));
  night = phaseOf(h) === "night";
  // 해: 6시 동쪽 → 12시 남쪽 높이 → 18시 서쪽. 밤엔 달(차가운 빛, 반대편)
  const dayT = clamp((h - 6) / 12, 0, 1), el = Math.sin(dayT * Math.PI) * 0.95 + 0.04, az = Math.PI * (1 - dayT); // x 동쪽, z 남쪽
  const dir = night ? new THREE.Vector3(-0.4, 0.7, 0.6).normalize() : new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * 0.6 + 0.4).normalize();
  sun.position.copy(dir).multiplyScalar(1000); sun.color.set(night ? "#AFC4FF" : h < 8 || h > 16.5 ? "#FFC58A" : "#FFF2DA");
  sunSprite.position.copy(dir).multiplyScalar(4800); sunSprite.material.color.set(night ? "#E8EEFF" : h > 16.5 || h < 7.5 ? "#FFB070" : "#FFF4D6");
  sunSprite.scale.setScalar(night ? 220 : 520);
  stars.visible = night; stars.material.opacity = night ? 0.85 : 0;
  chemMat.color.set(night ? "#9CFFC4" : "#5FD48E"); chemGlow.visible = night;
  hemi.color.set(night ? "#5A6FA0" : "#E4F4FF"); hemi.groundColor.set(night ? "#1E2A22" : "#5E7A45");
  fog.near = night ? 200 : 600; fog.far = night ? 2000 : 3600;
  envRT?.dispose(); envRT = pmrem.fromScene(envScene, 0.02); waterMat.envMap = envRT.texture; waterMat.needsUpdate = true;
}
applyTime(HOUR);

/* ───────── 소리(WebAudio로 직접 만듦) ───────── */
const AC = window.AudioContext || window.webkitAudioContext;
let ac = null, master = null, sfx = null, amb = null, music = null, muted = store.get("mute", false), noiseBuf = null;
function audioInit() {
  if (ac || !AC) { if (ac?.state === "suspended") ac.resume(); return; }
  try {
    ac = new AC();
    master = ac.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ac.destination);
    sfx = ac.createGain(); sfx.gain.value = 0.4; sfx.connect(master);
    amb = ac.createGain(); amb.gain.value = 0; amb.connect(master);
    // 물결 소리: 낮은 잡음이 천천히 숨 쉬듯
    const src = noise(true), lp = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
    lp.type = "lowpass"; lp.frequency.value = 420; g.gain.value = 0.07; lfo.frequency.value = 0.13; lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(g.gain); src.connect(lp); lp.connect(g); g.connect(amb); src.start(); lfo.start();
    MUSIC.init();
  } catch { ac = null; }
}
function noise(loop = false) {
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = loop; return s;
}
function tone(f, dur, type = "sine", vol = 0.12, slide = 0, delay = 0, out = sfx) {
  if (!ac) return;
  const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.03);
}
function hiss(dur, f0, f1, vol, type = "bandpass", out = sfx, delay = 0) {
  if (!ac) return;
  const t = ac.currentTime + delay, s = noise(), f = ac.createBiquadFilter(), g = ac.createGain();
  f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.02);
}
const SFX = {
  swish: () => hiss(0.35, 500, 2800, 0.25),
  plop: () => { tone(520, 0.12, "sine", 0.2, -380); hiss(0.18, 1200, 400, 0.12); },
  nibble: () => tone(900, 0.05, "sine", 0.05, -200),
  bite: () => { tone(740, 0.08, "sine", 0.08, 120); },
  hook: () => { hiss(0.25, 3000, 900, 0.25, "highpass"); tone(220, 0.2, "triangle", 0.12, 80); },
  reel: () => { for (let k = 0; k < 4; k++) tone(2200 + k * 90, 0.025, "square", 0.025, 0, k * 0.03); },
  good: () => tone(1046, 0.09, "triangle", 0.12),
  great: () => { tone(1046, 0.08, "triangle", 0.12); tone(1568, 0.12, "triangle", 0.1, 0, 0.06); },
  miss: () => tone(160, 0.22, "sawtooth", 0.07, -60),
  snap: () => { hiss(0.12, 6000, 3000, 0.4, "highpass"); tone(300, 0.5, "triangle", 0.1, -200, 0.05); },
  catch: () => { hiss(0.5, 1500, 300, 0.3); [659, 784, 988, 1318].forEach((f, k) => tone(f, 0.3, "triangle", 0.12, 0, 0.12 + k * 0.1)); },
  oops: () => tone(330, 0.25, "triangle", 0.1, -120),
};
// 새소리(낮)·풀벌레(밤): 가끔
let ambT = 2;
function ambience(dt) {
  if (!ac || state === "title") return;
  if ((ambT -= dt) > 0) return;
  ambT = 2.5 + Math.random() * 5;
  if (night) { for (let k = 0; k < 6; k++) tone(4300 + Math.random() * 300, 0.04, "sine", 0.012, 0, k * 0.07, amb); }
  else { const f = 2400 + Math.random() * 1600; tone(f, 0.09, "sine", 0.02, 700, 0, amb); tone(f * 1.1, 0.12, "sine", 0.018, -500, 0.12, amb); }
}
// 잔잔한 배경 음악: 72BPM 로파이(Fmaj7–Em7–Dm7–Cmaj7), 아주 작게
const MUSIC = (() => {
  const mf = (m) => 440 * 2 ** ((m - 69) / 12);
  const CH = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
  const BASS = [41, 40, 38, 36];
  let bus = null, timer = 0, next = 0, i = 0;
  const bpm = 72;
  function voice(f, t, dur, vol, type = "sine", cut = 1600, att = 0.02) {
    const o = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
    o.type = type; o.frequency.value = f; lp.type = "lowpass"; lp.frequency.value = cut;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
  function play(i, t) {
    const bar = Math.floor(i / 8) % 4, s = i % 8, beat = 60 / bpm;
    if (s === 0) { CH[bar].forEach((n, k) => voice(mf(n + 12), t + k * 0.02, beat * 3.6, 0.018, "triangle", 1400, 0.03)); voice(mf(BASS[bar]), t, beat * 1.8, 0.05, "sine", 400); }
    if (s === 4) voice(mf(BASS[bar] + 7), t, beat * 1.4, 0.035, "sine", 400);
    if (s === 0 || s === 5) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.3); }
    if (s === 2 || s === 6) { const n = noise(), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = "bandpass"; f.frequency.value = 2200; g.gain.setValueAtTime(0.025, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08); n.connect(f); f.connect(g); g.connect(bus); n.start(t, Math.random()); n.stop(t + 0.1); }
    if (s % 2 === 1 && Math.random() < 0.6) voice(mf(CH[bar][(Math.random() * 4) | 0] + 24), t, beat * 0.9, 0.008, "sine", 2400, 0.01);
  }
  return {
    init() { bus = ac.createGain(); bus.gain.value = 0; bus.connect(master); },
    start() {
      if (!ac || timer) return;
      next = ac.currentTime + 0.1;
      timer = setInterval(() => { const sp = 60 / bpm / 2; if (next < ac.currentTime - 0.2) next = ac.currentTime + 0.05; while (next < ac.currentTime + 0.2) { play(i, next); next += sp; i++; } }, 40);
      bus.gain.setTargetAtTime(1.2, ac.currentTime, 0.8);
    },
    stop() { clearInterval(timer); timer = 0; if (bus) bus.gain.setTargetAtTime(0, ac.currentTime, 0.2); },
    duck(on) { if (bus && timer) bus.gain.setTargetAtTime(on ? 0.3 : 1.2, ac.currentTime, 0.15); }, // 축하 소리 동안 음악을 낮춘다
  };
})();
function setMute(m) {
  muted = m; store.set("mute", m);
  $("mute").textContent = m ? "🔇" : "🔊"; $("mute").setAttribute("aria-label", m ? "소리 켜기" : "소리 끄기");
  if (master) master.gain.value = m ? 0 : 1;
}

/* ───────── 물고기 그림(카드·도감) ───────── */
function drawFish(g, id, W, H, dark = false) {
  const f = FISH[id];
  g.clearRect(0, 0, W, H);
  g.save();
  const cx = W * 0.47, cy = H * 0.52;
  if (f.junk) { // 장화
    g.translate(cx, cy); g.fillStyle = dark ? "#C9CED4" : "#3D4A3F";
    g.beginPath(); g.moveTo(-W * 0.12, -H * 0.36); g.lineTo(W * 0.06, -H * 0.36); g.lineTo(W * 0.06, H * 0.12); g.quadraticCurveTo(W * 0.24, H * 0.14, W * 0.26, H * 0.3); g.lineTo(-W * 0.12, H * 0.3); g.closePath(); g.fill();
    if (!dark) { g.fillStyle = "#2B342C"; g.fillRect(-W * 0.12, H * 0.24, W * 0.38, H * 0.06); g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(-W * 0.09, -H * 0.33, W * 0.04, H * 0.5); }
    g.restore(); return;
  }
  const L = W * (f.long ? 0.78 : 0.68), Hh = L * f.len;
  g.translate(cx, cy);
  const body = new Path2D();
  body.moveTo(-L / 2, 0);
  body.bezierCurveTo(-L * 0.42, -Hh * (f.flat ? 0.55 : 0.75), L * 0.18, -Hh * 0.68, L * 0.42, -Hh * 0.12);
  body.lineTo(L * 0.42, Hh * 0.12);
  body.bezierCurveTo(L * 0.18, Hh * 0.62, -L * 0.42, Hh * (f.flat ? 0.6 : 0.62), -L / 2, 0);
  // 꼬리
  const tail = new Path2D();
  tail.moveTo(L * 0.38, 0); tail.lineTo(L * 0.6, -Hh * (f.long ? 0.35 : 0.55)); tail.quadraticCurveTo(L * 0.53, 0, L * 0.6, Hh * (f.long ? 0.35 : 0.55)); tail.closePath();
  // 등지느러미
  const dors = new Path2D();
  if (f.long) { dors.moveTo(-L * 0.2, -Hh * 0.5); dors.lineTo(L * 0.4, -Hh * 0.3); dors.lineTo(L * 0.4, -Hh * 0.12); dors.lineTo(-L * 0.2, -Hh * 0.42); }
  else { dors.moveTo(-L * 0.12, -Hh * 0.6); dors.quadraticCurveTo(L * 0.02, -Hh * 1.05, L * 0.2, -Hh * 0.48); dors.closePath(); }
  const fin = dark ? "#C9CED4" : f.fin;
  g.fillStyle = fin; g.fill(tail); g.fill(dors);
  // 배지느러미·가슴지느러미
  g.beginPath(); g.moveTo(-L * 0.05, Hh * 0.45); g.lineTo(L * 0.06, Hh * 0.82); g.lineTo(L * 0.12, Hh * 0.42); g.fill();
  if (dark) { g.fillStyle = "#C9CED4"; g.fill(body); g.restore(); return; }
  const gr = g.createLinearGradient(0, -Hh * 0.6, 0, Hh * 0.6);
  gr.addColorStop(0, f.back); gr.addColorStop(0.55, f.belly); gr.addColorStop(1, f.belly);
  g.fillStyle = gr; g.fill(body);
  g.save(); g.clip(body);
  if (f.scales) { g.strokeStyle = "rgba(0,0,0,.12)"; g.lineWidth = 1.4; const s = L * 0.055; for (let x = -L * 0.3; x < L * 0.42; x += s) for (let y = -Hh * 0.6; y < Hh * 0.6; y += s * 0.8) { g.beginPath(); g.arc(x + ((y / s) % 2 ? s / 2 : 0), y, s * 0.55, -0.9, 0.9); g.stroke(); } }
  if (f.mirror) { g.fillStyle = "rgba(255,255,255,.22)"; for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(-L * 0.15 + k * L * 0.09, -Hh * 0.3, L * 0.045, Hh * 0.12, 0, 0, 7); g.fill(); } }
  if (f.bars) { g.fillStyle = f.bars; g.globalAlpha = 0.35; for (let k = 0; k < 7; k++) g.fillRect(-L * 0.25 + k * L * 0.09, -Hh, L * 0.03, Hh * 2); g.globalAlpha = 1; }
  if (f.stripe) { g.fillStyle = f.stripe; g.globalAlpha = 0.7; g.beginPath(); for (let k = 0; k < 9; k++) g.ellipse(-L * 0.3 + k * L * 0.08, -Hh * 0.02 + Math.sin(k) * Hh * 0.04, L * 0.045, Hh * 0.07, 0, 0, 7); g.fill(); g.globalAlpha = 1; }
  if (f.blotch) { g.fillStyle = f.blotch; g.globalAlpha = 0.55; const rr = mulberry32(id.length * 99); for (let k = 0; k < 14; k++) { g.beginPath(); g.ellipse(-L * 0.4 + rr() * L * 0.8, -Hh * 0.45 + rr() * Hh * 0.6, L * 0.05, Hh * 0.12, rr(), 0, 7); g.fill(); } g.globalAlpha = 1; }
  if (f.legend) { g.fillStyle = "rgba(255,255,255,.35)"; g.beginPath(); g.ellipse(-L * 0.05, -Hh * 0.28, L * 0.32, Hh * 0.1, -0.08, 0, 7); g.fill(); }
  g.restore();
  // 아가미·눈·수염
  g.strokeStyle = "rgba(0,0,0,.22)"; g.lineWidth = 2; g.beginPath(); g.arc(-L * 0.3, 0, Hh * 0.42, -1, 1); g.stroke();
  if (f.flap) { g.fillStyle = "#1E2A3A"; g.beginPath(); g.ellipse(-L * 0.27, -Hh * 0.05, L * 0.03, Hh * 0.08, 0, 0, 7); g.fill(); }
  g.fillStyle = "#FFFFFF"; g.beginPath(); g.arc(-L * 0.4, -Hh * 0.12, Hh * 0.11, 0, 7); g.fill();
  g.fillStyle = "#14181E"; g.beginPath(); g.arc(-L * 0.405, -Hh * 0.12, Hh * 0.065, 0, 7); g.fill();
  if (f.mouth) { g.strokeStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.moveTo(-L / 2, Hh * 0.02); g.lineTo(-L * 0.38, Hh * 0.08); g.stroke(); }
  if (f.whisk || f.barb) {
    g.strokeStyle = f.whisk ? "#2A2A22" : "rgba(60,40,20,.7)"; g.lineWidth = f.whisk ? 2.2 : 1.6;
    const n = f.whisk || 2, long = f.whisk === 2 ? 0.32 : f.whisk ? 0.16 : 0.07;
    for (let k = 0; k < n; k++) { g.beginPath(); g.moveTo(-L * 0.48, Hh * 0.04); g.quadraticCurveTo(-L * (0.55 + long * 0.3), Hh * (0.1 + k * 0.12), -L * (0.5 + long), Hh * (0.25 + k * 0.2) * (k % 2 ? 1 : -0.4)); g.stroke(); }
  }
  g.restore();
}

/* ───────── 게임 상태 ───────── */
let state = "title", phase = "ready", spot = LK.spots.find((s) => s.id === Q.get("spot")) || LK.spots[0];
let pt = 0;                 // 이번 단계 시각
let cast = null;            // { pow, x, z, fish, cm, bite, wait, nibbles[], start }
let fight = null;           // { need, hits, miss, allow, speed, zoneC, zoneW, perfect }
let floatY = 0, rodBend = 0, rodSwing = 0, sway = 0;
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), camBaseQ = new THREE.Quaternion(), rollQ = new THREE.Quaternion(), ZAX = new THREE.Vector3(0, 0, 1);

function setSpot(sp) {
  spot = sp;
  const fx = Math.cos(sp.face), fz = Math.sin(sp.face);
  fwd.set(fx, 0, fz); right.set(-fz, 0, fx); // 화면 오른쪽
  deck.position.set(sp.x, 0, sp.z); deck.rotation.y = Math.atan2(fx, fz);
  // 세로 화면은 위아래로 넓게 보이므로 좌대 앞쪽에 앉아 덜 내려다본다(바닥이 화면을 덮지 않게)
  const portrait = innerWidth < innerHeight, back = portrait ? -1.0 : 0.6;
  camera.position.set(sp.x - fx * back, 1.75, sp.z - fz * back);
  camera.lookAt(sp.x + fx * 30, portrait ? -0.2 : -1.6, sp.z + fz * 30);
  camBaseQ.copy(camera.quaternion);
  $("spot-name").textContent = sp.name;
}
function aspectFov() { const a = innerWidth / innerHeight; return a >= 1 ? 52 : clamp((2 * Math.atan(Math.tan((60 * Math.PI) / 360) / a) * 180) / Math.PI, 52, 74); }

/* ── 고기 고르기 ── */
function weights(sp, pow) {
  const cfg = SPOT_CFG[sp.id], ph = phaseOf(HOUR), out = [];
  for (const [id, w0] of Object.entries(cfg.w)) {
    const f = FISH[id]; let w = w0;
    if (ph === "night") { if (f.night) w *= 2.2; if (f.day) w *= 0.45; } else if (f.day) w *= 1.25;
    if (id === DAY_FISH) w *= 2;
    if (pow < 0.38 && f.small) w *= 1.5;
    if (pow > 0.72) { if (f.big) w *= 1.5; if (f.small) w *= 0.6; }
    out.push([id, w]);
  }
  return out;
}
function rollFish(pow) {
  if (Math.random() < 0.003 * (0.5 + 0.25 * STARS)) return "golden";
  const ws = weights(spot, pow), tot = ws.reduce((a, b) => a + b[1], 0);
  let x = Math.random() * tot;
  for (const [id, w] of ws) if ((x -= w) <= 0) return id;
  return ws[0][0];
}
function rollSize(id, pow) {
  const f = FISH[id], ph = phaseOf(HOUR);
  // 지수가 클수록 작은 고기가 많다. 별 셋이면 붕어 월척 약 17%, 4짜 약 2.5%(축하 단계가 너무 흔하지 않게, 10-21)
  let ex = 3.45 - 0.15 * STARS - (ph === "dawn" || ph === "dusk" ? 0.15 : 0) - (pow > 0.72 ? 0.1 : 0) - (SPOT_CFG[spot.id].dusk && ph === "dusk" ? 0.12 : 0);
  ex = Math.max(1.6, ex);
  return Math.round((f.min + (f.max - f.min) * Math.pow(Math.random(), ex)) * 10) / 10;
}

/* ── 단계 ── */
const act = $("act"), statusEl = $("status"), gauge = $("gauge"), zoneEl = $("zone"), needleEl = $("needle"), hitsEl = $("hits");
function setPhase(p) {
  phase = p; pt = 0;
  gauge.hidden = !(p === "aim" || p === "fight");
  gauge.classList.toggle("power", p === "aim");
  hitsEl.hidden = p !== "fight";
  $("inset").hidden = p !== "wait";
  act.className = "act" + (p === "wait" ? " hot" : p === "fight" ? " reel" : "");
  act.disabled = p === "flying" || p === "result";
  if (p === "ready") {
    const left = practice || FREE ? "연습" : `미끼 ${day.baits}개`;
    act.textContent = "던지기"; status(day.baits > 0 || practice || FREE ? "버튼을 누르면 던질 힘을 정해요" : "오늘 미끼를 다 썼어요", `${spot.name} · ${left}`);
    floatG.visible = false;
  }
  if (p === "aim") { act.textContent = "여기서 던지기!"; status("가까이는 잔챙이, 멀리는 대물이 잘 물어요", ""); zoneEl.style.display = "none"; $("marks").innerHTML = "<span>가까이</span><span>멀리</span>"; }
  if (p === "flying" || p === "result") { act.textContent = "…"; status(""); }
  if (p === "wait") { act.textContent = "챔질!"; status("찌를 보세요", cast.fish && FISH[cast.fish].bite === "rise" ? "" : ""); }
  if (p === "fight") { act.textContent = "감기!"; zoneEl.style.display = ""; $("marks").innerHTML = ""; status("초록 칸에 바늘이 올 때 감아요", ""); drawHits(); }
}
function status(a, b = "") { statusEl.innerHTML = ""; statusEl.append(a); if (b) { const s = document.createElement("small"); s.textContent = b; statusEl.append(s); } }
let toastT = 0;
function toast(text, warn = false, dur = 1.6) { const el = $("toast"); el.textContent = text; el.classList.toggle("warn", warn); el.classList.add("on"); toastT = dur; }
function updateCounts() {
  $("bait").textContent = practice || FREE ? "∞" : day.baits;
  $("bait-label").textContent = practice ? "연습" : "남은 미끼";
  $("count").textContent = practice ? practiceCount : day.catches.length;
}
let practiceCount = 0;

function press() {
  audioInit();
  if (ac && state === "fish") { MUSIC.start(); amb.gain.setTargetAtTime(1, ac.currentTime, 0.6); }
  if (state !== "fish") return;
  if (phase === "ready") {
    if (!practice && !FREE && day.baits <= 0) { showSummary(); return; }
    setPhase("aim");
  } else if (phase === "aim") startCast();
  else if (phase === "wait") strike();
  else if (phase === "fight") reel();
}
function startCast() {
  const pow = aimPos();
  if (!practice && !FREE) { day.baits--; saveDay(); }
  const dist = 7 + pow * 15, side = (Math.random() - 0.5) * 3;
  const tx = spot.x + fwd.x * dist + right.x * side, tz = spot.z + fwd.z * dist + right.z * side;
  const id = rollFish(pow), f = FISH[id];
  const ph = phaseOf(HOUR);
  let wait = 3 + Math.random() * 6;
  wait *= 1.25 - 0.08 * STARS;
  if (ph === "dawn" || ph === "dusk") wait *= 0.8;
  if (ph === "day" && HOUR > 11 && HOUR < 15) wait *= 1.1;
  if (WX.rain) wait *= 0.8; else if (/흐림|구름/.test(WX.sky)) wait *= 0.9;
  if (WX.wind >= 6) wait *= 1.1;
  if (WX.temp != null && WX.temp < 5) wait *= 1.3;
  if (pow > 0.72) wait *= 1.2;
  if (SPOT_CFG[spot.id].fast) wait *= 0.7;
  const nib = [];
  if (Math.random() < (f.bite === "jitter" ? 0.4 : 0.6)) { let t = 0.8 + Math.random() * (wait - 1.6); for (let k = 0; k < 1 + ((Math.random() * 3) | 0) && t < wait - 0.6; k++) { nib.push(t); t += 0.25 + Math.random() * 0.5; } }
  cast = { pow, x: tx, z: tz, fish: id, cm: rollSize(id, pow), wait, nib, from: rod.userData.tip.getWorldPosition(new THREE.Vector3()) };
  rodSwing = 1;
  SFX.swish();
  updateCounts();
  setPhase("flying");
}
// 찌 신호: 시각 t(입질 시작부터) → 찌 높이 변화와 '지금 챔질하면?' 판정
function biteState(t) {
  const f = FISH[cast.fish];
  if (f.bite === "rise") { const T = cast.riseT; if (t < T) return { y: 0.42 * (t / T) * (1 - 0.3 * Math.sin(t * 9) * 0.1), ok: t > T * 0.55, perfect: Math.abs(t - T) < 0.18 }; if (t < T + 0.4) return { y: 0.42, ok: true, perfect: t - T < 0.18 }; if (t < T + 0.7) return { y: 0.42 - (t - T - 0.4) * 2.6, ok: false, gone: false }; return { y: -0.4, ok: false, gone: true }; }
  if (f.bite === "sink") { if (t < 0.22) return { y: -2.4 * t, ok: t > 0.08, perfect: false }; if (t < 1.0) return { y: -0.55 - Math.sin(t * 7) * 0.04, ok: true, perfect: t < 0.5 }; if (t < 1.25) return { y: -0.55 + (t - 1) * 2.2, ok: false }; return { y: 0, ok: false, gone: true }; }
  // jitter: 깔짝깔짝(0.9초) → 쏙(0.55초)
  if (t < 0.9) return { y: Math.sin(t * 38) * 0.06, ok: false, early: true };
  if (t < 1.45) return { y: -0.5, ok: true, perfect: t < 1.2 };
  return { y: 0, ok: false, gone: true };
}
function strike() {
  const t = pt - cast.wait;
  if (t < 0) {
    const nibbling = cast.nib.some((n) => pt >= n && pt < n + 0.35);
    if (nibbling) { lose("헛챔질! 미끼만 뺏겼어요", "깔짝거릴 땐 참아요. 찌가 확실히 움직일 때!"); return; }
    toast("아직이에요", false, 0.8); return;
  }
  const b = biteState(t);
  if (b.early) { lose("헛챔질! 미끼만 뺏겼어요", "깔짝거릴 땐 참아요. 쏙 들어갈 때 챔질!"); return; }
  if (!b.ok) { lose("늦었어요, 놓쳤어요", "찌가 멈칫할 때 바로 눌러요"); return; }
  const f = FISH[cast.fish], ratio = (cast.cm - f.min) / (f.max - f.min), p = Math.min(6, f.power + (ratio > 0.75 ? 1 : 0));
  fight = { need: 2 + Math.ceil(p * 0.8), hits: 0, miss: 0, allow: SPOT_CFG[spot.id].snag ? 2 : 3, speed: 0.5 + 0.11 * p, zoneW: clamp(0.33 - 0.035 * p + (b.perfect ? 0.05 : 0), 0.12, 0.36), zoneC: 0.5, phase: Math.random() * 6, t: 0, perfect: b.perfect, fx: cast.x, fz: cast.z };
  SFX.hook(); burst(cast.x, cast.z, 30, 3.5); navigator.vibrate?.(40);
  toast(b.perfect ? "딱 좋은 챔질!" : "걸었다!", false, 1);
  setPhase("fight");
}
function aimPos() { const x = (pt * 0.95) % 2; return x < 1 ? x : 2 - x; }
function needlePos() { return 0.5 + 0.48 * Math.sin(fight.t * fight.speed * Math.PI * 2 + fight.phase); }
function drawHits() {
  hitsEl.innerHTML = "";
  for (let k = 0; k < fight.need; k++) { const i = document.createElement("i"); if (k < fight.hits) i.className = "on"; hitsEl.append(i); }
  for (let k = 0; k < fight.miss; k++) { const i = document.createElement("i"); i.className = "miss"; hitsEl.append(i); }
}
function reel() {
  const x = needlePos(), d = Math.abs(x - fight.zoneC);
  if (d <= fight.zoneW / 2) {
    const great = d <= fight.zoneW / 8;
    fight.hits = Math.min(fight.need, fight.hits + (great ? 2 : 1));
    (great ? SFX.great : SFX.good)(); SFX.reel();
    fight.zoneC = clamp(0.2 + Math.random() * 0.6, fight.zoneW / 2 + 0.02, 1 - fight.zoneW / 2 - 0.02); // 고기가 방향을 바꾼다
    rodBend = Math.min(1, rodBend + 0.15);
    burst(fight.fx, fight.fz, 10, 2.2);
    if (fight.hits >= fight.need) { landed(); return; }
  } else {
    fight.miss++; SFX.miss(); rodBend = 1; navigator.vibrate?.(20);
    fight.hits = Math.max(0, fight.hits - 1);
    if (fight.miss >= fight.allow) {
      const f = FISH[cast.fish], big = (cast.cm - f.min) / (f.max - f.min) > 0.6 || f.big;
      SFX.snap();
      lose("줄이 끊어졌어요!", big ? "얼핏 보니 꽤 큰 놈이었는데…" : SPOT_CFG[spot.id].snag ? "버드나무에 걸렸나 봐요" : "다음엔 초록 칸에서 감아요");
      return;
    }
  }
  drawHits();
}
function lose(title, hint) {
  floatG.visible = false; cast = null; fight = null;
  toast(title, true, 1.8); SFX.oops();
  setPhase("result");
  setTimeout(() => { if (state === "fish") { setPhase("ready"); status(hint, `${spot.name} · ${practice || FREE ? "연습" : `미끼 ${day.baits}개`}`); } }, 1400);
}
function landed() {
  const id = cast.fish, f = FISH[id], cm = cast.cm, kg = (f.k * cm ** 3) / 1000, tier = tierOf(id, cm);
  const from = screenOf(fight.fx, 0.3, fight.fz);
  if (!tier) SFX.catch();
  burst(fight.fx, fight.fz, tier ? 80 : 50, tier ? 6 : 4.5);
  const badges = [];
  const prevBest = dex[id]?.best || 0, isNew = !dex[id];
  const todayBest = Math.max(0, ...day.catches.map((c) => c.cm));
  if (tier) badges.push([tierLabel(id, tier), "gold"]);
  if (isNew) badges.push(["도감에 새로!", "new"]);
  else if (cm > prevBest) badges.push(["내 최고 기록", "new"]);
  if (!practice && !f.junk && cm > todayBest && day.catches.length) badges.push(["오늘 최고", "new"]);
  if (f.alien) badges.push(["외래종", "warn"]);
  if (practice) badges.push(["연습", ""]);
  if (!practice) {
    day.catches.push({ id, cm, kg: Math.round(kg * 100) / 100, spot: spot.name, at: `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}` });
    saveDay();
    dex[id] = { best: Math.max(prevBest, cm), n: (dex[id]?.n || 0) + 1 };
    store.set("dex", dex);
  } else practiceCount++;
  updateCounts();
  const left = practice || FREE ? 1 : day.baits;
  fillCard(id, cm, kg, badges, (f.junk ? "쓰레기통에 넣기" : f.alien ? "통에 담고 다시 던지기" : "살려 보내고 다시 던지기") + (left <= 0 ? " → 오늘 조과" : ""));
  cast = null; fight = null; floatG.visible = false;
  setPhase("result");
  if (tier) celebrate(tier, id, cm, from);
  else setTimeout(() => { $("catch").hidden = false; }, 650);
}
const sizeHTML = (id, cm, kg) => `${cm.toFixed(1)}<small>cm${FISH[id].junk ? "" : ` · ${kg >= 1 ? kg.toFixed(2) + "kg" : Math.round(kg * 1000) + "g"}`}</small>`;
function fillCard(id, cm, kg, badges, releaseText) {
  celReset();
  const art = $("fish-art"); drawFish(art.getContext("2d"), id, art.width, art.height);
  $("c-name").textContent = FISH[id].name;
  $("c-size").innerHTML = sizeHTML(id, cm, kg);
  $("c-badges").innerHTML = badges.map(([t, c]) => `<span class="badge ${c}">${t}</span>`).join("");
  $("c-text").textContent = FISH[id].note;
  $("release").textContent = releaseText;
}
$("release").addEventListener("click", () => {
  $("catch").hidden = true;
  const wasGold = cel?.level === 3;
  cel = null; celPush = 0; celReset(); MUSIC.duck(false);
  if (wasGold) applyTime(HOUR); // 금빛으로 물든 하늘·물을 되돌린다
  if (!practice && !FREE && day.baits <= 0) showSummary(); else setPhase("ready");
});
$("catch").addEventListener("pointerdown", (e) => { // 축하 중 화면을 누르면 끝 장면으로 건너뛴다
  if (cel && !cel.done && !e.target.closest("#release")) cel.t = cel.T.end;
});

/* ───────── 월척·대물·전설 축하 ─────────
   능이 학습 15번 원칙: 장면을 끊지 않는다(물에서 뛰어오른 고기가 그대로 카드 그림이 된다), 0.5초 박자마다 한 가지,
   모든 움직임은 celSeek(t) 하나로 정한다(아무 시각이나 멈춰 볼 수 있게: 주소 ?celebrate=1|2|3&t=초). */
// 어종별 [1단 기준 cm, 이름, 2단 기준 cm, 이름]. 붕어류는 낚시꾼 말 그대로 월척(한 자 30.3cm)·4짜(40cm), 배스는 50cm 넘으면 '런커'
const CELEB = {
  crucian: [30.3, "월척", 40, "4짜"], gibel: [30.3, "월척", 40, "4짜"],
  carp: [65, "대물", 80, "80급 대물"], israeli: [55, "대물", 65, "초대물"], catfish: [60, "대물", 75, "초대물"],
  snakehead: [70, "대물", 85, "초대물"], bass: [40, "4짜 배스", 50, "런커"], bagrid: [25, "대물", 28, "초대물"],
  bluegill: [18, "대물", 21, "초대물"], minnow: [13, "대물", 14.5, "초대물"],
};
const tierOf = (id, cm) => (FISH[id].legend ? 3 : !CELEB[id] ? 0 : cm >= CELEB[id][2] ? 2 : cm >= CELEB[id][0] ? 1 : 0);
const tierLabel = (id, tier) => (tier === 3 ? "전설!" : `${CELEB[id][tier === 2 ? 3 : 1]}!`);
// 박자표(초, 0.5초가 한 박). leap 뛰어오름 · fly 카드 자리로 · panel 카드 펼침 · ruler 자 · stamp 도장 · name 이름 · rest 나머지 · shine 광택
const CEL_T = {
  1: { leap: [0, 0.5], fly: [0.5, 1.0], panel: [0.5, 1.0], ruler: [1.0, 1.75], stamp: 1.75, shine: [[2.0, 2.5]], name: [2.0, 2.5], rest: [2.5, 3.0], end: 3.0, push: 0.06 },
  2: { leap: [0, 1.0], fly: [1.0, 1.5], panel: [1.0, 1.5], ruler: [1.5, 2.5], stamp: 2.5, shine: [[2.75, 3.25]], name: [3.0, 3.5], rest: [3.5, 4.0], end: 4.0, push: 0.08 },
  3: { leap: [0, 0.75], fly: [1.25, 1.75], panel: [1.25, 1.25], fill: [0.75, 1.25], shrink: [1.25, 1.75], rays: [1.75, 2.25], ruler: [1.75, 2.75], stamp: 2.75,
    shine: [[3.0, 3.5], [4.5, 5.0]], name: [3.5, 4.0], rest: [4.0, 4.5], end: 5.0, push: 0.09 },
};
let cel = null, celPush = 0;
const easeOut = (u) => 1 - (1 - clamp(u, 0, 1)) ** 3;
const easeInOut = (u) => { u = clamp(u, 0, 1); return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2; };
const span = (t, [a, b]) => (b > a ? clamp((t - a) / (b - a), 0, 1) : t >= a ? 1 : 0);
function screenOf(x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return [innerWidth / 2, innerHeight * 0.62];
  return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
}
const CE = {}; // 축하에 쓰는 요소
for (const k of ["catch", "c-card", "c-panel", "c-rays", "c-art", "fish-art", "c-shine", "c-stamp", "c-ruler", "c-name", "c-size", "c-badges", "c-text", "release", "gold-fill"]) CE[k] = $(k);
function celReset() {
  for (const k of ["fish-art", "c-panel", "c-rays", "c-shine", "c-stamp", "c-size", "c-badges", "c-text", "release"]) CE[k].removeAttribute("style");
  CE["c-stamp"].hidden = true; CE["c-ruler"].hidden = true; CE["gold-fill"].hidden = true;
  CE["c-card"].classList.remove("gold"); CE.catch.classList.remove("celebrating"); CE.catch.style.visibility = "";
  CE["c-name"].textContent = CE["c-name"].textContent; // 글자 조각(span)을 풀어 둔다
}
function celebrate(level, id, cm, from) {
  const f = FISH[id], T = CEL_T[level], kg = (f.k * cm ** 3) / 1000;
  const scr = CE.catch;
  // 마지막 배치를 먼저 잡아 두고(안 보이게) 거기서 거꾸로 계산한다
  CE["c-ruler"].hidden = false;
  CE["c-card"].classList.toggle("gold", level === 3);
  scr.hidden = false; scr.style.visibility = "hidden"; scr.classList.add("celebrating"); scr.scrollTop = 0;
  const A = CE["fish-art"].getBoundingClientRect(), C = CE["c-card"].getBoundingClientRect();
  const Ac = [A.left + A.width / 2, A.top + A.height / 2];
  const apex = [lerp(from[0], Ac[0], 0.5), clamp(Math.min(from[1], Ac[1]) - innerHeight * 0.14, 70, innerHeight - 70)];
  const c1 = CELEB[id], marks = level === 3 ? [[100, "1m"]] : [[c1[0], id === "crucian" || id === "gibel" ? "한 자" : c1[1]], [c1[2], c1[3]]];
  const rmax = Math.ceil((Math.max(cm, ...marks.map((m) => m[0])) * 1.08) / 10) * 10;
  const [r0, r1] = T.ruler;
  cel = {
    level, id, cm, kg, T, t: 0, done: false, A, C, Ac, from, apex, marks, rmax,
    ctrl: [(from[0] + apex[0]) / 2, apex[1] - innerHeight * 0.08],
    sApex: level === 3 ? 0.55 : 0.62, sHold: 0.85,
    Rmax: Math.hypot(Math.max(apex[0], innerWidth - apex[0]), Math.max(apex[1], innerHeight - apex[1])),
    tcross: level === 2 ? r0 + (1 - Math.cbrt(1 - c1[0] / cm)) * (r1 - r0) : -1,
    finalStamp: tierLabel(id, level), firstStamp: level === 2 ? `${c1[1]}!` : "",
    name: [...f.name],
    base: level === 3 ? { top: skyMat.uniforms.top.value.clone(), mid: skyMat.uniforms.mid.value.clone(), water: waterMat.color.clone(), sun: sunSprite.material.color.clone() } : null,
  };
  CE["c-name"].innerHTML = cel.name.map((ch) => `<span>${ch === " " ? "&nbsp;" : ch}</span>`).join("");
  const url = CE["fish-art"].toDataURL();
  CE["c-shine"].style.webkitMaskImage = CE["c-shine"].style.maskImage = `url(${url})`;
  CE["c-rays"].style.top = `${Ac[1] - C.top - 450}px`;
  celSeek(0);
  scr.style.visibility = "";
  celebSound(level, cel);
  navigator.vibrate?.(level === 1 ? [30, 40, 60] : level === 2 ? [40, 60, 40, 60, 160] : [60, 40, 60, 40, 60, 40, 240]);
  if (REDUCE) cel.t = T.end; // 움직임 줄이기 설정이면 끝 장면만
}
function celSeek(t) {
  const c = cel, T = c.T, L = c.level;
  // 고기: 물에서 뛰어올라(leap) → (전설은 공중에서 잠깐 멈춤) → 카드 그림 자리로(fly)
  let x, y, s, r;
  const [l0, l1] = T.leap, [f0, f1] = T.fly;
  if (t < l1) {
    const u = easeOut((t - l0) / (l1 - l0)), v = 1 - u;
    x = v * v * c.from[0] + 2 * v * u * c.ctrl[0] + u * u * c.apex[0]; y = v * v * c.from[1] + 2 * v * u * c.ctrl[1] + u * u * c.apex[1];
    s = lerp(0.2, c.sApex, u); r = lerp(-0.9, -0.2, u);
  } else if (t < f0) {
    const u = (t - l1) / (f0 - l1);
    x = c.apex[0]; y = c.apex[1] - Math.sin(u * Math.PI) * 6; s = lerp(c.sApex, c.sHold, easeInOut(u)); r = lerp(-0.2, 0, easeInOut(u));
  } else if (t < f1) {
    const u = easeInOut((t - f0) / (f1 - f0)), s0 = L === 3 ? c.sHold : c.sApex;
    x = lerp(c.apex[0], c.Ac[0], u); y = lerp(c.apex[1], c.Ac[1], u); s = lerp(s0, 1, u); r = lerp(L === 3 ? 0 : -0.2, 0, u);
  } else { x = c.Ac[0]; y = c.Ac[1] + (L === 3 ? Math.sin((t - f1) * 3) * 3 : 0); s = 1; r = 0; }
  CE["fish-art"].style.transform = `translate(${x - c.Ac[0]}px, ${y - c.Ac[1]}px) rotate(${r}rad) scale(${s})`;
  // 카드 바탕: 고기 둘레의 작은 상자에서 카드 크기로 펼쳐진다
  const P = CE["c-panel"].style;
  if (t < T.panel[0]) P.opacity = 0;
  else {
    const u = easeInOut(span(t, T.panel)), w0 = c.A.width * c.sApex, h0 = c.A.height * c.sApex;
    const cx0 = c.apex[0] - c.C.left, cy0 = c.apex[1] - c.C.top;
    P.opacity = 1;
    P.left = `${lerp(cx0 - w0 / 2, 0, u)}px`; P.top = `${lerp(cy0 - h0 / 2, 0, u)}px`;
    P.width = `${lerp(w0, c.C.width, u)}px`; P.height = `${lerp(h0, c.C.height, u)}px`; P.borderRadius = `${lerp(40, 28, u)}px`;
  }
  // 전설: 금빛이 고기에서 화면 전체로 번졌다가 카드 크기로 줄어든다(같은 색이라 금색 카드로 이어진다)
  if (L === 3) {
    const g = CE["gold-fill"];
    if (t < T.fill[0] || t >= T.shrink[1]) g.hidden = true;
    else {
      g.hidden = false;
      if (t < T.fill[1]) g.style.clipPath = `circle(${easeInOut(span(t, T.fill)) * c.Rmax}px at ${c.apex[0]}px ${c.apex[1]}px)`;
      else { const u = easeInOut(span(t, T.shrink)); g.style.clipPath = `inset(${c.C.top * u}px ${(innerWidth - c.C.right) * u}px ${(innerHeight - c.C.bottom) * u}px ${c.C.left * u}px round ${28 * u}px)`; }
    }
    CE["c-rays"].style.opacity = 0.9 * easeOut(span(t, T.rays));
    CE["c-rays"].style.transform = `rotate(${Math.max(0, t - T.rays[0]) * 14}deg)`;
    // 저수지 하늘·물도 금빛으로
    const k = easeInOut(span(t, T.fill)) * 0.55, GOLD = new THREE.Color("#F6C453"), DEEP = new THREE.Color("#E0A21B");
    skyMat.uniforms.top.value.copy(c.base.top).lerp(DEEP, k); skyMat.uniforms.mid.value.copy(c.base.mid).lerp(GOLD, k);
    fog.color.copy(skyMat.uniforms.mid.value); waterMat.color.copy(c.base.water).lerp(DEEP, k * 0.8); sunSprite.material.color.copy(c.base.sun).lerp(GOLD, k);
  }
  // 자: 0에서 길이만큼 늘어나고, 기준 눈금을 지나면 불이 켜진다. 숫자도 같이 올라간다
  const ru = span(t, T.ruler), v = c.cm * easeOut(ru);
  CE["c-ruler"].style.opacity = t < T.ruler[0] ? 0 : 1;
  drawRuler(v);
  CE["c-size"].style.opacity = t < T.ruler[0] ? 0 : 1;
  CE["c-size"].innerHTML = ru < 1 ? `${v.toFixed(1)}<small>cm</small>` : sizeHTML(c.id, c.cm, c.kg);
  // 도장: (2단은 1단 기준을 지날 때 작게 한 번) → 자가 다 늘어나면 쾅
  const st = CE["c-stamp"];
  st.hidden = false;
  const slam = (s0, from) => { const sc = s0 < 0.12 ? lerp(from, 0.97, s0 / 0.12) : s0 < 0.25 ? lerp(0.97, 1, (s0 - 0.12) / 0.13) : 1; st.style.opacity = clamp(s0 / 0.05, 0, 1); st.style.transform = `rotate(-10deg) scale(${sc})`; };
  if (t >= T.stamp) { st.textContent = c.finalStamp; st.classList.toggle("gold", L >= 2); slam(t - T.stamp, L === 1 ? 1.7 : 2.1); }
  else if (L === 2 && t >= c.tcross) { st.textContent = c.firstStamp; st.classList.remove("gold"); slam(t - c.tcross, 1.35); }
  else st.style.opacity = 0;
  // 광택: 고기 모양 안에서만 빛줄기가 왼쪽에서 오른쪽으로 지나간다
  const sw = T.shine.find(([a, b]) => t >= a && t < b);
  CE["c-shine"].style.opacity = sw ? 1 : 0;
  if (sw) CE["c-shine"].style.backgroundPosition = `${(1 - span(t, sw)) * 100}% 0`;
  // 이름: 글자마다 아래에서 올라온다
  [...CE["c-name"].children].forEach((el, i) => { el.style.transform = `translateY(${(1 - easeOut((t - T.name[0] - i * 0.06) / 0.25)) * 110}%)`; });
  // 나머지(배지·설명·버튼)
  ["c-badges", "c-text", "release"].forEach((k, i) => {
    const u = easeOut((t - T.rest[0] - i * 0.08) / 0.3), el = CE[k].style;
    el.opacity = u; el.transform = `translateY(${(1 - u) * 14}px)`; el.pointerEvents = u > 0.5 ? "" : "none";
  });
  // 3D 카메라는 한 번만 밀고 들어간다(되돌리지 않음, 버튼을 누르면 원래대로)
  celPush = T.push * easeInOut(t / Math.min(T.end, T.fly[1] + 0.5));
}
function drawRuler(v) {
  const c = cel, el = CE["c-ruler"], g = el.getContext("2d"), W = el.width, H = el.height, gold = c.level === 3;
  g.clearRect(0, 0, W, H);
  const pad = 30, X = (m) => pad + (m / c.rmax) * (W - pad * 2), base = 70; // 휴대폰에서 카드 폭이 약 320px라 글자를 크게
  g.fillStyle = gold ? "rgba(90,67,16,.45)" : "#C9CED4";
  const stepM = c.rmax > 60 ? 5 : 1;
  for (let m = 0; m <= c.rmax + 1e-6; m += stepM) { const big = Math.round(m) % 10 === 0; g.fillRect(X(m) - 1.5, base - (big ? 18 : 9), 3, big ? 18 : 9); }
  g.fillStyle = gold ? "#5A4310" : "#6B7684"; g.font = `700 26px ${FONT}`; g.textAlign = "center";
  for (let m = 0; m <= c.rmax; m += c.rmax > 60 ? 20 : 10) g.fillText(String(m), X(m), base + 32);
  g.fillStyle = gold ? "rgba(255,255,255,.55)" : "#E9ECEF"; g.beginPath(); g.roundRect(pad, base - 6, W - pad * 2, 12, 6); g.fill();
  g.fillStyle = gold ? "#B7791F" : "#0E8A5A"; g.beginPath(); g.roundRect(pad, base - 6, Math.max(12, X(v) - pad), 12, 6); g.fill();
  const close = c.marks.length > 1 && X(c.marks[1][0]) - X(c.marks[0][0]) < 150; // 기준이 붙어 있으면 이름을 양옆으로 벌린다
  c.marks.forEach(([th, label], k) => {
    if (th > c.rmax) return;
    const on = v >= th, x = X(th);
    g.fillStyle = on ? (gold ? "#8A5A00" : "#FF6B35") : gold ? "rgba(90,67,16,.5)" : "#ADB5BD";
    g.fillRect(x - 2, base - 36, 4, 42);
    g.font = `${on ? 900 : 700} 28px ${FONT}`;
    g.textAlign = close ? (k ? "left" : "right") : "center";
    g.fillText(label, x + (close ? (k ? 6 : -6) : 0), base - 42);
  });
  g.textAlign = "center";
}
function celebSound(L, c) {
  if (!ac) return;
  MUSIC.duck(true);
  hiss(L === 2 ? 0.9 : 0.5, 300, 2600, 0.22);              // 뛰어오름
  hiss(0.6, 1600, 300, 0.25);                               // 물보라
  const [r0, r1] = c.T.ruler;
  for (let m = 10; m <= c.cm; m += 10) tone(1300 + m * 6, 0.04, "sine", 0.05, 0, r0 + (1 - Math.cbrt(1 - m / c.cm)) * (r1 - r0)); // 자 눈금
  if (L === 2) tone(1318, 0.3, "triangle", 0.12, 0, c.tcross);
  const st = c.T.stamp;
  tone(95, 0.35, "sine", 0.35, -50, st); hiss(0.12, 900, 200, 0.2, "lowpass", sfx, st); // 쾅
  (L === 1 ? [523, 659, 784] : [523, 659, 784, 1046]).forEach((f, k) => tone(f, L === 1 ? 0.7 : 1.2, "triangle", 0.09, 0, st + 0.02 + k * 0.03));
  if (L >= 2) { hiss(1.0, 8000, 5000, 0.08, "highpass", sfx, st); [1046, 1318, 1568, 2093].forEach((f, k) => tone(f, 0.25, "triangle", 0.07, 0, st + 0.3 + k * 0.09)); }
  if (L === 3) { // 금빛이 번질 때 맑은 종소리, 다 덮었을 때 낮은 징
    const penta = [1046, 1175, 1318, 1568, 1760, 2093, 2349, 2637];
    for (let k = 0; k < 14; k++) tone(penta[(k * 5) % 8], 0.5, "sine", 0.05, 0, 0.75 + k * 0.07);
    tone(98, 2.8, "sine", 0.22, 0, 1.25); tone(196, 2.4, "sine", 0.1, 0, 1.25); tone(294, 2.0, "sine", 0.05, 0, 1.25);
  }
  for (const [a] of c.T.shine) hiss(0.45, 4000, 9000, L === 3 ? 0.1 : 0.07, "highpass", sfx, a); // 광택 '샤악'
  setTimeout(() => { if (cel === c) MUSIC.duck(false); }, c.T.end * 1000 + 800);
}
// 시험용: ?celebrate=1|2|3(&t=초면 그 시각에 멈춤) — 기록은 남기지 않는다
function celebrateDemo(level, freezeT) {
  const id = level === 3 ? "golden" : level === 2 ? "crucian" : "bass", cm = level === 3 ? 88.4 : level === 2 ? 41.2 : 43.6, kg = (FISH[id].k * cm ** 3) / 1000;
  state = "fish"; show(null); setPhase("result");
  fillCard(id, cm, kg, [[tierLabel(id, level), "gold"], ["시험", ""]], "살려 보내고 다시 던지기");
  celebrate(level, id, cm, [innerWidth / 2, innerHeight * 0.6]);
  if (freezeT != null) { cel.freeze = freezeT; cel.t = freezeT; }
}

/* ───────── 화면 전환 ───────── */
function saveDay() { store.set("day", day); }
function show(id) { for (const s of ["title", "pick", "summary", "dexs", "catch"]) $(s).hidden = s !== id; $("hud").hidden = id !== null; }
function toTitle() {
  state = "title"; MUSIC.stop(); if (amb && ac) amb.gain.setTargetAtTime(0, ac.currentTime, 0.3);
  show("title"); paintTitle();
}
function paintTitle() {
  $("t-date").textContent = `${NOW.getMonth() + 1}월 ${NOW.getDate()}일 입질 운`;
  $("t-stars").innerHTML = "★".repeat(STARS) + `<em>${"★".repeat(5 - STARS)}</em>`;
  $("t-fish").textContent = `${FISH[DAY_FISH].name}`;
  $("t-now").textContent = `${PHASE_WORD[phaseOf(HOUR)]} ${pad(Math.floor(HOUR))}:${pad(Math.floor((HOUR % 1) * 60))} · ${WX.word}`;
  $("t-bait").textContent = FREE ? "제한 없음" : `${day.baits}개 / 10개${day.catches.length ? ` · ${day.catches.length}마리 잡음` : ""}`;
  const done = !FREE && day.baits <= 0;
  $("go").textContent = done ? "연습 낚시 하기" : "자리 고르기";
  $("open-sum").hidden = !day.catches.length && !done;
}
function openPick() { state = "pick"; show("pick"); setSpot(spot); paintSpots(); drawMap(); }
function startFishing(sp) {
  audioInit();
  practice = !FREE && day.baits <= 0;
  setSpot(sp);
  state = "fish"; show(null);
  updateCounts(); setPhase("ready");
  if (ac) { MUSIC.start(); amb.gain.setTargetAtTime(1, ac.currentTime, 0.6); }
}
function showSummary() {
  state = "summary"; show("summary");
  const cs = day.catches, real = cs.filter((c) => !FISH[c.id].junk);
  const best = real.slice().sort((a, b) => b.cm - a.cm)[0];
  $("s-title").textContent = cs.length ? `오늘 ${real.length}마리!` : "오늘은 꽝…";
  $("s-sub").textContent = `${NOW.getMonth() + 1}월 ${NOW.getDate()}일 · 입질 운 ${"★".repeat(STARS)}${"☆".repeat(5 - STARS)}` + (best ? ` · 최고 ${FISH[best.id].name} ${best.cm.toFixed(1)}cm` : "");
  $("s-table").innerHTML = cs.length ? cs.map((c) => { const tr = tierOf(c.id, c.cm); return `<tr><td>${c.at} · ${FISH[c.id].name}<br><small style="color:#6B7684">${c.spot}</small></td><td>${tr ? `<b style="color:#C2410C">${tierLabel(c.id, tr)}</b> ` : ""}${c.cm.toFixed(1)}cm</td></tr>`; }).join("") : `<tr><td>그래도 물멍은 했어요. 내일 다시 와요!</td><td></td></tr>`;
  $("practice").hidden = day.baits > 0 && !FREE;
}
function shareText() {
  const cs = day.catches, real = cs.filter((c) => !FISH[c.id].junk), best = real.slice().sort((a, b) => b.cm - a.cm)[0];
  let s = `🎣 이동저수지 낚시 · ${NOW.getMonth() + 1}월 ${NOW.getDate()}일 · 입질 운 ${"★".repeat(STARS)}${"☆".repeat(5 - STARS)}\n`;
  const tr = best ? tierOf(best.id, best.cm) : 0;
  s += best ? `${real.length}마리 · 최고 ${FISH[best.id].name} ${best.cm.toFixed(1)}cm${tr ? ` (${tierLabel(best.id, tr)})` : ""}` : "오늘은 꽝… 그래도 물멍";
  return s + `\n${location.origin}${location.pathname}`;
}
$("share").addEventListener("click", async () => {
  const text = shareText();
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch { return; }
  try { await navigator.clipboard.writeText(text); toast("복사했어요. 붙여 넣어 자랑하세요!"); $("share").textContent = "복사했어요 ✓"; } catch { prompt("복사해서 쓰세요", text); }
});
function openDex(from) {
  show("dexs"); $("dex-back").dataset.from = from;
  const got = DEX.filter((id) => dex[id]).length;
  $("dex-sub").textContent = `${DEX.length}종 중 ${got}종을 만났어요.`;
  const box = $("dex"); box.innerHTML = "";
  for (const id of DEX) {
    const d = document.createElement("div"), c = document.createElement("canvas"); c.width = 240; c.height = 120;
    const has = dex[id];
    if (!has) d.className = "no";
    drawFish(c.getContext("2d"), id, 240, 120, !has);
    d.append(c);
    const b = document.createElement("b"); b.textContent = has || id !== "golden" ? FISH[id].name : "???"; d.append(b);
    const s = document.createElement("span"); s.textContent = has ? `최고 ${has.best.toFixed(1)}cm · ${has.n}번` : "아직 못 만남"; d.append(s);
    box.append(d);
  }
}
$("go").addEventListener("click", () => { audioInit(); openPick(); });
$("open-dex").addEventListener("click", () => openDex("title"));
$("open-sum").addEventListener("click", showSummary);
$("dex-back").addEventListener("click", () => ($("dex-back").dataset.from === "summary" ? showSummary() : toTitle()));
$("pick-back").addEventListener("click", toTitle);
$("sit").addEventListener("click", () => startFishing(spot));
$("spot-btn").addEventListener("click", () => { if (phase === "ready" || phase === "result") { cast = null; fight = null; floatG.visible = false; state = "pick"; openPick(); } else toast("고기를 다 본 뒤에 옮겨요", false, 1); });
$("practice").addEventListener("click", () => { practice = true; openPick(); });
$("s-home").addEventListener("click", toTitle);
$("mute").addEventListener("click", () => { audioInit(); setMute(!muted); });
act.addEventListener("pointerdown", (e) => { e.preventDefault(); press(); });
canvas.addEventListener("pointerdown", () => { if (state === "fish" && phase !== "ready") press(); });
addEventListener("keydown", (e) => { if (e.code === "Space" || e.code === "Enter") { if (state === "fish") { e.preventDefault(); if (!e.repeat) press(); } } });
document.addEventListener("visibilitychange", () => { if (!ac) return; if (document.hidden) ac.suspend(); else ac.resume(); });

/* ── 자리 고르기 지도(2D, 북쪽이 위) ── */
const mapEl = $("map"), mapCtx = mapEl.getContext("2d");
let mapXY = null;
function drawMap() {
  const g = mapCtx, W = mapEl.width, H = mapEl.height, pd = 40;
  const sc = Math.min((W - pd * 2) / (bb.x1 - bb.x0), (H - pd * 2) / (bb.z1 - bb.z0));
  const ox = (W - (bb.x1 - bb.x0) * sc) / 2, oz = (H - (bb.z1 - bb.z0) * sc) / 2;
  mapXY = (x, z) => [ox + (x - bb.x0) * sc, oz + (z - bb.z0) * sc];
  g.clearRect(0, 0, W, H);
  g.fillStyle = "#E3EEDF"; g.fillRect(0, 0, W, H);
  g.beginPath(); LAKE.forEach(([x, z], i) => { const [a, b] = mapXY(x, z); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath();
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#8ACBE6"); gr.addColorStop(1, "#5FB0D6");
  g.fillStyle = gr; g.fill(); g.strokeStyle = "#3D8DB5"; g.lineWidth = 3; g.stroke();
  // 좌대 무리
  g.fillStyle = "rgba(255,255,255,.85)";
  for (const h of huts) { const [a, b] = mapXY(h.x, h.z); g.fillRect(a - 2.5, b - 2.5, 5, 5); }
  // 자리
  LK.spots.forEach((sp, k) => {
    const [a, b] = mapXY(sp.x, sp.z), on = sp === spot;
    g.fillStyle = on ? "#FF6B35" : "#191F28"; g.strokeStyle = "#FFFFFF"; g.lineWidth = 4;
    g.beginPath(); g.arc(a, b, on ? 22 : 17, 0, 7); g.fill(); g.stroke();
    g.fillStyle = "#FFFFFF"; g.font = `900 ${on ? 22 : 18}px "Pretendard Variable", Pretendard, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(k + 1), a, b + 1);
    if (on) {
      g.font = `800 24px "Pretendard Variable", Pretendard, sans-serif`;
      const tw = g.measureText(sp.name).width + 24, lx = clamp(a, tw / 2 + 6, W - tw / 2 - 6), ly = b - 46;
      g.fillStyle = "#191F28"; g.beginPath(); g.roundRect(lx - tw / 2, ly - 18, tw, 36, 18); g.fill();
      g.fillStyle = "#FFFFFF"; g.fillText(sp.name, lx, ly + 1);
      // 바라보는 쪽
      g.strokeStyle = "#FF6B35"; g.lineWidth = 4; g.beginPath(); g.moveTo(a + Math.cos(sp.face) * 26, b + Math.sin(sp.face) * 26); g.lineTo(a + Math.cos(sp.face) * 58, b + Math.sin(sp.face) * 58); g.stroke();
    }
  });
  // 북쪽·축척
  g.fillStyle = "#191F28"; g.font = `800 20px "Pretendard Variable", Pretendard, sans-serif`; g.textAlign = "center"; g.fillText("북 ↑", W - 44, 34);
  const m500 = 500 * sc; g.fillRect(24, H - 30, m500, 5); g.textAlign = "left"; g.font = `700 17px "Pretendard Variable", Pretendard, sans-serif`; g.fillText("500m", 24, H - 44);
}
mapEl.addEventListener("click", (e) => {
  const r = mapEl.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * mapEl.width, y = ((e.clientY - r.top) / r.height) * mapEl.height;
  let best = null, bd = 60 * 60;
  for (const sp of LK.spots) { const [a, b] = mapXY(sp.x, sp.z), d = (a - x) ** 2 + (b - y) ** 2; if (d < bd) { bd = d; best = sp; } }
  if (best) { setSpot(best); paintSpots(); drawMap(); }
});
function paintSpots() {
  const box = $("spots"); box.innerHTML = "";
  LK.spots.forEach((sp, k) => {
    const b = document.createElement("button"); b.className = "spot"; b.setAttribute("aria-pressed", String(sp === spot));
    const top3 = Object.entries(SPOT_CFG[sp.id].w).filter(([id]) => !FISH[id].junk).sort((a, c) => c[1] - a[1]).slice(0, 3).map(([id]) => FISH[id].name).join("·");
    b.innerHTML = `<i>${k + 1}</i><div><b></b><span></span><em></em></div>`;
    b.querySelector("b").textContent = sp.name; b.querySelector("span").textContent = SPOT_CFG[sp.id].trait; b.querySelector("em").textContent = `잘 나와요: ${top3}`;
    b.addEventListener("click", () => { setSpot(sp); paintSpots(); drawMap(); });
    box.append(b);
  });
  $("sit").textContent = `${spot.name}에서 낚시하기`;
}

/* ───────── 찌 확대 창(작은 두 번째 화면) ───────── */
// 화면 한쪽(테두리 상자 안쪽)에 찌 가까이 본 그림을 한 번 더 그린다. 테두리 6px·모서리 20px이라 네모 모서리가 가려진다
const insetEl = $("inset");
const insetCam = new THREE.PerspectiveCamera(32, 1, 0.1, 3000);

/* ───────── 한 걸음 ───────── */
const tipW = new THREE.Vector3(), tmpV = new THREE.Vector3();
function step(dt, t) {
  pt += dt;
  ambience(dt);
  if (state !== "fish") return;
  if (phase === "aim") needleEl.style.left = `${aimPos() * 100}%`;
  if (phase === "flying") {
    const T = 0.75, k = Math.min(1, pt / T);
    floatG.visible = true;
    const from = cast.from;
    floatG.position.set(lerp(from.x, cast.x, k), lerp(from.y, 0, k) + Math.sin(k * Math.PI) * 4, lerp(from.z, cast.z, k));
    if (k >= 1) { SFX.plop(); ripple(cast.x, cast.z, 1.4); burst(cast.x, cast.z, 12, 1.6); setPhase("wait"); if (FISH[cast.fish].bite === "rise") cast.riseT = 0.9 + Math.random() * 0.7; }
  }
  if (phase === "wait") {
    let y = Math.sin(t * 1.7) * 0.02 + Math.sin(t * 3.1) * 0.01 * (1 + WX.wind / 4);
    for (const n of cast.nib) if (pt >= n && pt < n + 0.35) { y -= Math.sin(((pt - n) / 0.35) * Math.PI) * 0.09; if (pt - dt < n) { SFX.nibble(); ripple(cast.x, cast.z, 0.6, 0.7); } }
    const bt = pt - cast.wait;
    if (bt >= 0) {
      if (bt - dt < 0) { SFX.bite(); ripple(cast.x, cast.z, 1.0, 1); navigator.vibrate?.(25); }
      const b = biteState(bt);
      y += b.y;
      if (b.gone) lose("놓쳤어요… 찌가 제자리로 돌아왔어요", "찌가 올라오거나 쏙 들어갈 때 바로 눌러요");
    }
    floatY = lerp(floatY, y, Math.min(1, dt * 18));
    if (cast) floatG.position.set(cast.x, (floatY - 0.12) * FLOAT_S, cast.z);
  }
  if (phase === "fight") {
    fight.t += dt;
    needleEl.style.left = `${needlePos() * 100}%`;
    zoneEl.style.left = `${(fight.zoneC - fight.zoneW / 2) * 100}%`; zoneEl.style.width = `${fight.zoneW * 100}%`;
    // 고기가 이리저리 끈다
    fight.fx = lerp(fight.fx, cast.x + Math.sin(fight.t * 1.3) * 3 + right.x * (fight.zoneC - 0.5) * 8, dt * 2);
    fight.fz = lerp(fight.fz, cast.z + Math.cos(fight.t * 1.1) * 3 + right.z * (fight.zoneC - 0.5) * 8, dt * 2);
    if (Math.random() < dt * 4) burst(fight.fx, fight.fz, 3, 1.5);
    if (Math.random() < dt * 1.2) ripple(fight.fx, fight.fz, 0.8, 0.8);
    rodBend = lerp(rodBend, 0.55 + 0.25 * Math.sin(fight.t * 6), dt * 3);
  } else rodBend = lerp(rodBend, 0, dt * 4);
  rodSwing = Math.max(0, rodSwing - dt * 2.4);
  if (toastT > 0 && (toastT -= dt) <= 0) $("toast").classList.remove("on");
}

/* ───────── 그리기 ───────── */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const t = now / 1000;
  step(dt, t);
  if (cel && !cel.done) { // 축하 장면은 시각 t 하나로 정한다(?t=로 멈출 수 있음)
    cel.t = cel.freeze != null ? cel.freeze : cel.t + dt;
    celSeek(Math.min(cel.t, cel.T.end));
    if (cel.t >= cel.T.end && cel.freeze == null) { cel.done = true; CE.catch.classList.remove("celebrating"); }
  } else if (cel?.level === 3 && cel.freeze == null) { cel.t += dt; celSeek(cel.t); } // 전설 카드는 빛살이 계속 천천히 돈다
  // 물결: 바람이 세면 더 출렁
  const ws = 0.1 + Math.min(0.18, WX.wind * 0.02);
  waterNormal.offset.set(t * 0.004, t * 0.006); waterMat.normalScale.set(ws, ws);
  // 카메라: 좌대가 살짝 흔들림
  if (state === "fish" || state === "summary" || state === "pick") {
    sway = Math.sin(t * 0.8) * 0.012;
    camera.position.y = 1.75 + Math.sin(t * 1.1) * 0.03;
    camera.quaternion.copy(camBaseQ).multiply(rollQ.setFromAxisAngle(ZAX, sway));
  } else { // 처음 화면: 저수지 위를 천천히 돈다
    const a = t * 0.02, sp = LK.spots[0];
    camera.position.set(sp.x + Math.cos(a) * 60, 26, sp.z + Math.sin(a) * 60 + 200);
    camera.lookAt(sp.x + 300, 0, sp.z + 900);
  }
  const fov = aspectFov() * (1 - celPush); if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  // 낚싯대
  rod.rotation.set(-1.32 + rodSwing * Math.sin(rodSwing * Math.PI) * -0.9 + (phase === "fight" ? 0.22 : 0), 0.42, -0.1);
  rodSegs.forEach((s, k) => { s.rotation.x = -rodBend * 0.16 * (k / 5 + 0.3); });
  rod.visible = state === "fish";
  // 줄
  rod.userData.tip.getWorldPosition(tipW);
  const pts = lineGeo.attributes.position;
  const end = phase === "fight" && fight ? tmpV.set(fight.fx, 0, fight.fz) : floatG.visible ? tmpV.copy(floatG.position).add(new THREE.Vector3(0, 0.5 * FLOAT_S, 0)) : null;
  line.visible = !!end && state === "fish";
  if (end) {
    const sag = phase === "fight" ? 0.05 : 0.9;
    for (let i = 0; i < 16; i++) { const k = i / 15; pts.setXYZ(i, lerp(tipW.x, end.x, k), lerp(tipW.y, end.y, k) - Math.sin(k * Math.PI) * sag, lerp(tipW.z, end.z, k)); }
    pts.needsUpdate = true;
  }
  // 물결 고리·물보라
  for (const r of rings) { r.t += dt; const k = r.t / r.life; r.m.scale.setScalar(0.2 + k * 2.2 * r.size); r.m.material.opacity = 0.55 * (1 - k); }
  for (let i = rings.length - 1; i >= 0; i--) if (rings[i].t > rings[i].life) { scene.remove(rings[i].m); rings[i].m.material.dispose(); rings.splice(i, 1); }
  for (let i = 0; i < SPL; i++) {
    if (splLife[i] <= 0) continue;
    splLife[i] -= dt; splVel[i * 3 + 1] -= 9.8 * dt;
    splPos[i * 3] += splVel[i * 3] * dt; splPos[i * 3 + 1] += splVel[i * 3 + 1] * dt; splPos[i * 3 + 2] += splVel[i * 3 + 2] * dt;
    if (splLife[i] <= 0 || splPos[i * 3 + 1] < 0) { splLife[i] = 0; splPos[i * 3 + 1] = -999; }
  }
  splGeo.attributes.position.needsUpdate = true;
  // 비
  if (rain.p.visible) {
    for (let i = 0; i < rain.n; i++) {
      let y = rain.pos[i * 3 + 1] - dt * 14;
      if (y < 0) { rain.pos[i * 3] = camera.position.x + (Math.random() - 0.5) * 60; rain.pos[i * 3 + 2] = camera.position.z + (Math.random() - 0.5) * 60; y = 12 + Math.random() * 8; if (Math.random() < 0.02) ripple(rain.pos[i * 3], rain.pos[i * 3 + 2], 0.3, 0.6); }
      rain.pos[i * 3 + 1] = y;
    }
    rain.p.geometry.attributes.position.needsUpdate = true;
  }
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
  if (phase === "wait" && !insetEl.hidden && state === "fish") {
    const p = floatG.position;
    insetCam.position.set(p.x - fwd.x * 3.2, 0.95, p.z - fwd.z * 3.2);
    insetCam.lookAt(p.x, 0.6, p.z);
    const r = insetEl.getBoundingClientRect(), b = 6, w = r.width - b * 2, h = r.height - b * 2;
    insetCam.aspect = w / h; insetCam.updateProjectionMatrix();
    renderer.setScissorTest(true);
    renderer.setViewport(r.left + b, innerHeight - r.bottom + b, w, h); renderer.setScissor(r.left + b, innerHeight - r.bottom + b, w, h);
    renderer.render(scene, insetCam);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
  }
}
addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (state !== "title") setSpot(spot); });

/* ───────── 날씨(이남노트 '오늘'과 같은 자료) ───────── */
fetch("data/today.json", { cache: "no-store" }).then((r) => r.json()).then((j) => {
  const w = j?.sources?.weather;
  if (!w?.ok || j.example) return;
  const d = w.data;
  WX.ok = true; WX.sky = d.sky || ""; WX.temp = d.temp != null ? +d.temp : null; WX.wind = +(d.now?.wsd || 0);
  WX.rain = ["1", "2", "4", "5", "6"].includes(String(d.now?.pty || "0"));
  WX.word = `${WX.rain ? "비" : WX.sky || "맑음"}${WX.temp != null ? ` ${Math.round(WX.temp)}°` : ""}${WX.wind >= 4 ? ` · 바람 ${WX.wind}m/s` : ""}`;
  rain.p.visible = WX.rain;
  if (state === "title") paintTitle();
}).catch(() => {});

setMute(muted);
setSpot(spot);
paintTitle();
requestAnimationFrame(frame);
if (Q.has("spot")) startFishing(spot);
if (Q.has("celebrate")) celebrateDemo(clamp(+Q.get("celebrate") || 1, 1, 3), Q.has("t") ? +Q.get("t") : null);
// 시험용(콘솔): __fish.state 등
window.__fish = { get state() { return state; }, get phase() { return phase; }, get cast() { return cast; }, get fight() { return fight; }, get pt() { return pt; }, press, day, dex, FISH, weights, rollSize, step: (s) => { for (let k = 0; k < s * 60; k++) step(1 / 60, performance.now() / 1000); }, applyTime, setSpot,
  audio: () => ({ ac, master, sfx, amb, MUSIC, SFX }), get cel() { return cel; }, freeze(t) { if (cel) cel.freeze = t; } };
