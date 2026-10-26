/* 이남노트 오프라인 저장(service worker, 2026-10-26 홈 화면 앱). 결정 로그 2026-10-16 '앱으로 바꿀까', 공개 절차 3c.
   원칙: 언제나 인터넷에서 새로 받는다(network-first). 저장본은 인터넷이 끊겼을 때만 꺼낸다.
   → "고쳐줘 → 올려" 한 내용이 앱에서도 바로 보이고, 소식·혜택·날씨가 옛 값으로 남지 않는다.
   다른 사이트(네이버 지도·버스 중계·글꼴·GoatCounter), /api/(미리보기 서버 버스 중계), 영상(mp4, 구간 요청)은 건드리지 않는다.
   저장 방식을 바꾸면 VER를 올린다(옛 저장본은 activate에서 지운다). */
const VER = "v1";
const CACHE = "inamnote-" + VER;
// 처음 설치될 때 받아 두는 첫 화면 묶음. 대부분 방금 받은 것이라 브라우저 캐시에서 나온다
const SHELL = [
  "./", "style.css", "app.js", "home.js", "pwa.js", "count.js", "places-search.js", "favicon.svg", "install.html",
  "data/notices.js", "data/benefits_recent.js", "data/programs.js", "data/places.js", "data/intro.js",
  "data/today.json", "data/site.json", "data/feed.json", "img/icon/icon-192.png",
];

self.addEventListener("install", (e) => {
  // 하나가 없어도 나머지는 저장한다(addAll은 하나만 실패해도 전부 실패)
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("inamnote-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const OFFLINE = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>이남노트 · 연결 없음</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#F2F4F6;color:#191F28;font-family:system-ui,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;text-align:center;padding:24px">
<div><p style="font-size:20px;font-weight:800;margin:0">인터넷에 연결되어 있지 않아요</p>
<p style="color:#4E5968;margin:10px 0 22px">이 쪽은 아직 저장된 적이 없어요. 연결되면 다시 열어 주세요.</p>
<a href="./" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#191F28;color:#fff;font-weight:700;text-decoration:none">첫 화면으로</a></div>`;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.includes("/api/") || url.pathname.endsWith(".mp4")) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      // 주소 뒤 ?q=·?tab= 마다 따로 쌓이지 않게 쪽(html)은 물음표 앞까지만 열쇠로 쓴다
      if (res.ok && res.type === "basic") cache.put(req.mode === "navigate" ? url.origin + url.pathname : req, res.clone());
      return res;
    } catch (err) {
      if (req.mode !== "navigate") {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        throw err;
      }
      // 첫 화면은 "./"·"index.html" 두 주소로 들어온다(카트·낚시 '← 이남노트'는 index.html)
      const home = /\/(index\.html)?$/.test(url.pathname);
      const hit = (await cache.match(url.origin + url.pathname)) || (home && await cache.match("./"));
      return hit || new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
  })());
});
