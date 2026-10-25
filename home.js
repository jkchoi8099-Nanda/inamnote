/* 이남노트 첫 화면(2026-10-14 사용자 "처음엔 소개 모션그래픽, 닫으면 여러 카테고리 문, 들어가면 가지로 퍼지게, 문은 더 생길 수도".
   같은 날 "디자인이 올드틱" → 토스·당근 계열로 다시 만들었다).
   1) 소개 영상(#intro): 처음 온 브라우저에서 한 번. 10-21부터 H영상(실제 화면 18초, img/intro-h.mp4)을 튼다(아래 '소개 영상').
      10-15 3판(코드로 그린 지도 애니메이션)은 git d314bcf까지 있었다.
   2) 큰 문 = 벤토 타일. 타일 안에 실제 숫자·최신 소식이 보인다. **문을 더하려면 DOORS에 한 칸**(size·theme·emoji만 정하면 된다).
   3) 문을 누르면 그 타일이 화면 머리로 펼쳐지고(View Transitions, 없는 브라우저는 그냥 바뀜) 가지 목록이 나온다.
      목록 줄을 누르면 그 아래로 가지(칩)가 퍼지고, 칩에 또 가지가 있으면 한 줄 더 퍼진다. 주소는 #문id, 뒤로 가기는 문 목록.
   숫자는 data/places.js(지도와 같은 데이터)와 data/notices.js(공식 소식)에서 센다. 0인 가지는 숨긴다.
   아이콘: Microsoft Fluent Emoji 3D(MIT, img/emoji/LICENSE.txt). */
(() => {
  const P = window.PLACES, N = window.NOTICES, S = window.PlaceSearch, I = window.INTRO;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const places = P && S ? P.places.map(p => ({ ...p, door: S.doorOf(p) })) : [];
  const notices = (N && N.items) || [];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = n => Number(n).toLocaleString("ko-KR");
  const emo = (name, cls = "emo") => `<img class="${cls}" src="img/emoji/${name}.webp" alt="" width="128" height="128" decoding="async">`;
  const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  // 세는 방법: 지도 문(door) · 지도 검색어(q) · 공식 소식 출처(src, notices.html TABS와 같은 기준). 데이터를 못 받으면 null(숫자 없이 보인다)
  const cnt = f => () => places.length ? places.filter(f).length : null;
  // 검색어로 셀 때는 지도와 같은 기준 — 업종이 맞는 곳만(이름에만 든 곳은 지도에서 따로 접어 둔다, places-search.js split)
  const found = w => { const ids = new Set(S ? S.split(places, w).main.map(p => p.id) : []); return p => ids.has(p.id); };
  const SRC = {
    comp: x => x.src === "LH 보상공고", gosi: x => x.src === "토지이음 고시", home: x => x.src === "LH 청약·임대",
    lh: x => x.src.startsWith("LH") && !["LH 보상공고", "LH 청약·임대"].includes(x.src), eup: x => x.src.endsWith("읍 소식"),
    city: x => ["용인시 보도자료", "용인시 공지", "처인구 소식"].includes(x.src),
  };
  const m = (label, door, desc) => ({ label, desc, href: `map.html?door=${door}`, n: cnt(p => p.door === door) });
  const q = (label, word, desc) => ({ label, desc, href: `map.html?q=${encodeURIComponent(word)}`, n: cnt(found(word)) });
  const sub = (label, door, s, f) => ({ label, href: `map.html?door=${door}&sub=${encodeURIComponent(s)}`, n: f ? cnt(f) : null });
  const t = (label, tab, desc) => ({ label, desc, href: `notices.html?tab=${tab}`, n: () => N ? notices.filter(SRC[tab]).length : null, unit: "건" });
  const go = (label, href, desc) => ({ label, desc, href });
  const latest = notices.find(x => x.scope !== "city");  // 타일에는 우리 동네 글만(용인시 전체 글은 '용인시 소식'에)
  // 지난 방문 뒤 새 글 수(app.js가 이 스크립트보다 먼저 sessionStorage inam_new에 적는다, 2026-10-18)
  const newN = (() => { try { return JSON.parse(sessionStorage.getItem("inam_new") || "[]").length; } catch (e) { return 0; } })();

  // 큰 문. size: wide(두 칸)·half(한 칸)·bar(긴 띠) / theme: green·white·warm·dark / tile(): 타일 안에 보일 실제 내용
  const DOORS = [
    // 장소 찾기 + 내 주변(2026-10-20 사용자 "장소 찾기와 내주변은 거의 비슷한 역할 아닐까? 합쳐도 될거 같아") → 내 주변은 이 문 안 첫 줄.
    // 위치 권한은 그 줄을 눌렀을 때만 묻는다. 예전 주소 #near는 이 문을 열고 그 줄을 펼친다(route)
    { id: "place", pre: "이남", label: "장소 찾기", desc: "식당·약국·학교·빨래방, 내 주변 500m 정류소·가게까지", emoji: "pin", size: "wide", theme: "green", search: true,
      tile: () => `<span class="fake-q">${emo("search", "fq-i")}가게 이름, 약국, 미용실…</span>` +
        (places.length ? `<span class="chips"><span>가게·시설 ${fmt(places.length)}곳</span><span>식당 ${places.filter(p => p.door === "food").length}</span><span>약국 ${places.filter(found("약국")).length}</span></span>` : ""),
      kids: [
        { label: "내 주변 500m", emoji: "map", desc: "가까운 정류소(버스 몇 분 뒤)·가게", near: true },
        { label: "먹기", emoji: "food", desc: "식당·카페·편의점", kids: [
          { ...m("식당", "food"), kids: [sub("한식", "food", "한식"), sub("고기", "food", "고기"), sub("중식", "food", "중식"),
            sub("치킨·호프", "food", "치킨·호프"), sub("분식", "food", "분식"), sub("양식·일식·뷔페", "food", "양식·일식·뷔페"), go("식당 전체", "map.html?door=food")] },
          m("카페·간식", "cafe"), m("편의점", "store")] },
        { ...m("자기", "stay", "모텔·숙소"), emoji: "bed" },
        { label: "생활", emoji: "basket", desc: "약국·병원·빨래방·미용실·부동산", noSum: true, note: "빨래방은 공공데이터에 2곳뿐이에요. 빠진 곳은 동네 확인 후 더합니다.", kids: [
          q("약국", "약국"), q("병원·의원", "병원"), m("빨래방", "coin"), m("세탁소", "laundry"), q("미용실", "미용실"),
          m("부동산", "realty"), q("마트", "마트"), m("골프장", "golf")] },
        // 마트 전단 가격 비교(10-21 시범, 사용자 "적당한 곳에 일단 넣어줘 … 위치를 잡을 때 참고") — 자리는 나중에 바뀔 수 있다
        { ...go("마트 전단 가격 비교", "mart.html", "으뜸·엔마트·정동 전단, 같은 물건끼리(시범)"), emoji: "money" },
        { label: "학교", emoji: "school", desc: "초·중·고", kids: ["초등학교", "중학교", "고등학교"].map(s => sub(s, "school", s, p => p.door === "school" && p.type === s)) },
        { ...go("지도 전체 보기", "map.html", "내 위치 근처부터"), emoji: "map" },
      ] },
    { id: "news", pre: "이남", label: "소식", desc: "보상·공식 고시·청약·혜택, 공사 어디까지 왔나", emoji: "paper", size: "wide", theme: "white",
      badge: () => newN,
      // 10-16부터 공식 소식은 이남노트 안 읽기 창에서 본문까지 본다(옛 문구 "제목과 원문 링크만"은 10-18 고침)
      note: "공식 소식은 여기서 본문까지 읽을 수 있어요. 신청·기한은 원문에서 한 번 더 확인하세요.",
      tile: () => latest ? `<span class="hl"><span class="hl-tag">${esc(latest.src)} · ${esc(latest.date.slice(5).replace("-", "."))}</span>${esc(latest.title)}</span>` : "",
      kids: [
        { label: "보상·이주", emoji: "money", desc: "LH 보상 공고, 자주 묻는 질문", kids: [t("보상 공고(LH)", "comp"), go("보상·이주 궁금한 점", "news.html#faq-comp"), go("땅·집 거래 허가", "news.html#faq-land")] },
        { label: "공식 발표", emoji: "loud", desc: "토지이음 고시·LH·읍 소식·용인시", kids: [t("공식 고시", "gosi"), t("LH 소식", "lh"), t("읍 소식", "eup"), t("용인시 소식", "city"), go("공식 소식 전체", "notices.html")] },
        { ...t("청약·임대", "home", "LH 공고"), emoji: "house" },
        // 혜택 목록(data/benefits.js, 약 280KB)은 첫 화면에서 안 불러온다 → 숫자 없이 둔다
        { label: "혜택·생활 제도", emoji: "gift", desc: "용인·경기 지원금, 사장님 지원사업, 생활 제도", kids: [
          go("용인시 혜택", "benefits.html?area=yongin"), go("경기도 혜택", "benefits.html?area=gg"),
          go("전국 · 많이 찾는", "benefits.html?area=nation"), go("사장님·창업 지원사업", "benefits.html#biz-sec"),
          go("생활 제도", "benefits.html#tips-sec")] },
        { label: "공사 어디까지", emoji: "crane", desc: "확정된 것과 아직 계획인 것", kids: [go("공사 시계", "news.html#clock"), go("바뀐 일정 기록", "news.html#changes"), go("전체 일정", "news.html#timeline")] },
        { ...go("최근 소식", "news.html#news", "원문을 확인한 기사·발표"), emoji: "sparkles" },
      ] },
    { id: "bus", pre: "이남", label: "버스 현황", desc: "지금 어디쯤 오나", emoji: "bus", size: "half", theme: "warm",
      note: "위치는 정류소 단위로 25초마다 새로 받아요.",
      tile: () => I ? `<span class="big">${I.routes}<small>개 노선</small></span>` : "",
      kids: [
        { ...go("내 주변 정류소", "#near", "타려는 버스가 몇 분 뒤 오는지"), emoji: "pin" },
        { ...go("동네 버스", "bus.html?g=town", "동네 정류소를 많이 지나는 버스·마을버스"), emoji: "stop" },
        { ...go("서울·광역", "bus.html?g=far", "직행좌석·광역 — 빈자리도 보여요"), emoji: "oncoming" },
        { ...go("가장자리 노선", "bus.html?g=edge", "동네를 조금 지나가는 노선"), emoji: "road" },
        { ...go("똑버스", "bus.html?g=ttak", "부르면 오는 버스(똑타 앱)"), emoji: "phone" },
      ] },
    // 커뮤니티는 버스 현황 옆 반칸(10-20 내 주변 문이 장소 찾기로 들어가며 빈 자리). 첫 화면 아래 #talk-sec 방 카드는 10-23 '지금 접수 중인 혜택'(#open-sec)으로 바뀌어 방은 이 문 안에만 있다
    { id: "talk", pre: "이남", label: "커뮤니티", desc: "제보하고 같이 고쳐요", emoji: "talk", size: "half", theme: "white",
      note: "게시판은 아직 열지 않았어요. 먼저 제보와 카카오톡 채널로 이야기를 나눠요.",
      tile: () => `<span class="big sm">제보하기 →</span>`,
      kids: [
        { ...go("제보·문의", "about.html#contact", "틀린 곳, 빠진 소식을 알려 주세요"), emoji: "postbox" },
        { ...go("카카오톡 채널", "about.html#contact", "일요일 저녁 한 주 브리핑(준비 중)"), emoji: "talk" },
        { ...go("정정 기록", "news.html#corrections", "고친 내용과 날짜"), emoji: "pencil" },
        { ...go("이남 카트", "kart.html", "이동·남사 실제 길로 달리는 미니 게임"), emoji: "kart-car" },
        { ...go("이동저수지 낚시", "fishing.html", "실제 좌대 자리에서 오늘의 입질 운 시험"), emoji: "fish-rod" },
      ] },
    { id: "about", pre: "이남노트", label: "소개", desc: "이동 + 남사 + 노트. 동네 주민이 출처를 확인해 정리합니다", emoji: "book", size: "bar", theme: "dark",
      tile: () => `<span class="play">▶ 소개 영상</span>`,
      kids: [
        { label: "소개 영상 다시 보기", emoji: "clapper", desc: "18초", action: "intro" },
        { ...go("이남노트는", "about.html", "누가, 왜 만드나"), emoji: "book" },
        { ...go("지키는 것", "about.html#rules", "원문 확인·계획은 계획이라고"), emoji: "check" },
        { ...go("확인 표시 읽는 법", "about.html#badges"), emoji: "sparkles" },
        { ...go("운영자 이해관계", "about.html#disclosure"), emoji: "seedling" },
        { ...go("자동 정보 출처", "about.html#data"), emoji: "chart" },
      ] },
  ];

  // 숫자: 제 숫자(n)가 있으면 그것, 없으면 아래 가지 합. noSum은 아래 가지가 검색어로 세는 것이라 서로 겹칠 수 있어 합을 안 보인다
  const num = i => i.n ? i.n() : i.noSum ? null : i.kids ? i.kids.reduce((s, k) => { const v = num(k); return v == null ? s : (s ?? 0) + v; }, null) : null;
  const unitOf = i => i.unit || (i.kids && i.kids.map(unitOf).find(Boolean)) || "";
  const alive = i => i.action || num(i) !== 0;
  const countHtml = it => { const n = num(it); return n != null ? `<span class="n">${fmt(n)}${unitOf(it) || "곳"}</span>` : ""; };
  const find = path => path.split("-").map(Number).reduce((o, k, j) => j === 0 ? DOORS[k] : o.kids[k], null);

  // ── 내 주변(2026-10-18, 제안 ②③): 지금 위치 500m 안 정류소와 가게. 정류소를 누르면 오는 버스가 몇 분 뒤·몇 정거장 전인지(arrive.js).
  // 위치는 이 화면에서 거리 계산에만 쓰고 어디에도 보내거나 저장하지 않는다. 동네 밖이거나 위치를 못 받으면 기준점을 고르게 한다.
  // 버스 자료(data/bus.js, 약 540KB — 10-20 모든 노선을 종점까지 담아 늘었다)는 이 문을 열 때만 받는다. 거리는 직선 거리다.
  const KX = 88800, KY = 111000, NEAR = 500;
  const far = (a, b) => Math.hypot((a[0] - b[0]) * KY, (a[1] - b[1]) * KX);
  const mtxt = m => m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`;
  const BASES = [["송전터미널", 37.14097, 127.19755, "이동읍"], ["한숲시티", 37.1561, 127.17657, "남사읍"]];  // 버스 정류소 좌표
  const AREA = [37.07, 37.24, 127.09, 127.28];  // 이동·남사 둘레(bus.js area보다 조금 넓게)
  const loadScript = src => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  const needBus = () => Promise.all([window.BUS ? 0 : loadScript("data/bus.js"), window.Arrive ? 0 : loadScript("arrive.js")]);
  // 지도 문 이름(map.html DOORS와 같은 말)과 검색으로 세는 생활 업종
  const DOOR_NAME = { food: "식당", cafe: "카페·간식", store: "편의점", stay: "숙소", laundry: "세탁소", coin: "빨래방", golf: "골프장", school: "학교", realty: "부동산" };
  const NEAR_Q = ["약국", "병원", "미용실", "마트"];
  let nearTimer = 0;

  function renderNear(box) {
    clearTimeout(nearTimer);
    box.innerHTML = `<div class="nr-card nr-wait"><b>내 위치를 찾는 중…</b><small>위치는 거리 계산에만 쓰고 저장하지 않아요.</small></div>`;
    const ask = msg => box.isConnected && pickBase(box, msg);
    if (!navigator.geolocation) return ask("이 브라우저는 위치를 알려 주지 않아요.");
    navigator.geolocation.getCurrentPosition(p => {
      if (!box.isConnected) return;
      const pt = [p.coords.latitude, p.coords.longitude];
      const inside = pt[0] > AREA[0] && pt[0] < AREA[1] && pt[1] > AREA[2] && pt[1] < AREA[3];
      inside ? drawNear(box, pt, "내 위치", p.coords.accuracy) : ask("지금 이동·남사 밖에 계셔서 동네 기준점으로 보여 드릴게요.");
    }, e => ask(e.code === 1 ? "위치 권한이 꺼져 있어요. 기준점을 고르거나, 브라우저 설정에서 위치를 허용해 주세요." : "위치를 찾지 못했어요. 기준점을 골라 주세요."),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }
  function pickBase(box, msg) {
    box.innerHTML = `<div class="nr-card"><b>${esc(msg)}</b><div class="nr-bases">${BASES.map((b, i) =>
      `<button class="chip2" type="button" data-base="${i}">${esc(b[3])} · ${esc(b[0])}</button>`).join("")}<button class="chip2 ghost" type="button" data-again>내 위치 다시 찾기</button></div></div>`;
    box.onclick = e => {
      const b = e.target.closest("[data-base]");
      if (b) { const x = BASES[+b.dataset.base]; drawNear(box, [x[1], x[2]], `${x[0]} 정류소 기준`); }
      else if (e.target.closest("[data-again]")) renderNear(box);
    };
  }

  async function drawNear(box, pt, label, acc) {
    try { await needBus(); } catch (e) { box.innerHTML = `<div class="nr-card"><b>버스 자료를 불러오지 못했어요.</b></div>`; return; }
    if (!box.isConnected) return;
    const B = window.BUS;
    // 정류소: 이름이 같고 200m 안이면(길 건너 맞은편) 한 줄로 묶는다 — 방면은 도착 목록에 나온다
    const st = Object.entries(B.stations).map(([id, s]) => ({ id, nm: s[2].replace(/\((중|경유)\)$/, ""), d: far(pt, s) })).sort((a, b) => a.d - b.d);
    const groups = [];
    for (const s of st.slice(0, 60)) {
      const g = groups.find(x => x.nm === s.nm && s.d - x.d < 200);
      if (g) g.ids.push(s.id); else groups.push({ nm: s.nm, d: s.d, ids: [s.id] });
    }
    let stops = groups.filter(g => g.d <= NEAR).slice(0, 4);
    const noneNear = !stops.length;
    if (noneNear) stops = groups.slice(0, 2);
    const routesOf = g => [...new Set(window.Arrive.passes(B, g.ids).map(p => p.r.no.replace("용인", "")))];
    // 가게: 500m 안. 문별·생활 업종별 수와 가까운 곳 5곳
    const around = places.filter(p => p.lat && far(pt, [p.lat, p.lng]) <= NEAR).map(p => ({ ...p, dist: far(pt, [p.lat, p.lng]) })).sort((a, b) => a.dist - b.dist);
    const chips = [
      ...Object.keys(DOOR_NAME).map(k => [DOOR_NAME[k], `map.html?door=${k}`, around.filter(p => p.door === k).length]),
      ...NEAR_Q.map(w => [w, `map.html?q=${encodeURIComponent(w)}`, S ? S.split(around, w).main.length : 0]),
    ].filter(c => c[2]).sort((a, b) => b[2] - a[2]);
    box.innerHTML =
      `<div class="nr-top"><span><b>${esc(label)}</b>에서 ${NEAR}m${acc > 150 ? ` <small class="warn">· 위치 오차 약 ${mtxt(acc)}</small>` : ""}</span>` +
      `<button class="nr-re" type="button" data-again>다시 찾기</button></div>` +
      `<h3 class="nr-h">가까운 정류소${noneNear ? ` <small>500m 안에 없어 가장 가까운 곳</small>` : ""}</h3>` +
      `<div class="nr-stops">${stops.map((g, i) => { const rs = routesOf(g); return `<div class="ri-box">
        <button class="row-btn" type="button" aria-expanded="false" aria-controls="ar-${i}" data-stop="${i}">${emo("stop", "ri")}
        <span class="t"><b>${esc(g.nm)}</b><small>${mtxt(g.d)} · ${rs.length ? esc(rs.slice(0, 6).join(" · ")) + (rs.length > 6 ? ` 외 ${rs.length - 6}` : "") : "지나는 노선 정보 없음"}</small></span>
        <span class="n">언제 오나?</span>${CHEV}</button><div class="nr-ar" id="ar-${i}" hidden></div></div>`; }).join("")}</div>` +
      `<h3 class="nr-h">500m 안 가게 <small>${fmt(around.length)}곳</small></h3>` +
      (around.length ? `<div class="nr-chips">${chips.slice(0, 9).map(c => `<a class="chip2" href="${esc(c[1])}">${esc(c[0])}<span class="n">${c[2]}</span></a>`).join("")}</div>` +
        `<ul class="nr-list">${around.slice(0, 5).map(p => `<li><a href="map.html?q=${encodeURIComponent(p.name)}"><b>${esc(p.name)}</b><small>${esc(p.menu_kind || p.type || p.kind)}</small><span>${mtxt(p.dist)}</span></a></li>`).join("")}</ul>`
        : `<p class="nr-empty">500m 안에 지도에 올린 가게가 없어요. <a href="map.html">지도에서 넓게 보기 →</a></p>`) +
      `<p class="room-note">거리는 직선 거리예요. 버스 도착 시간은 경기도 버스정보 예측이에요.</p>`;
    box.onclick = e => {
      if (e.target.closest("[data-again]")) { renderNear(box); return; }
      const b = e.target.closest("[data-stop]"); if (!b) return;
      const open = b.getAttribute("aria-expanded") === "true";
      box.querySelectorAll("[data-stop][aria-expanded='true']").forEach(x => { x.setAttribute("aria-expanded", "false"); document.getElementById(x.getAttribute("aria-controls")).hidden = true; });
      clearTimeout(nearTimer);
      if (open) return;
      b.setAttribute("aria-expanded", "true");
      arrivals(document.getElementById(b.getAttribute("aria-controls")), stops[+b.dataset.stop].ids, 0);
    };
  }
  // 펼친 정류소만 30초마다 4번 새로 받는다(중계 하루 한도 아끼기). 그다음은 '새로 보기'를 눌러야 한다
  async function arrivals(el, ids, round) {
    el.hidden = false;
    if (!round) el.innerHTML = `<p class="ar-note">오는 버스를 세는 중…</p>`;
    const res = await window.Arrive.check(window.BUS, ids);
    if (el.hidden || !el.isConnected) return;
    const more = round < 3 && !res.err;
    el.innerHTML = window.Arrive.html(res);
    if (more) nearTimer = setTimeout(() => { if (el.hidden) return; document.hidden ? addRe(el, ids) : arrivals(el, ids, round + 1); }, 30000);
    else addRe(el, ids);
  }
  function addRe(el, ids) {
    el.insertAdjacentHTML("beforeend", `<button class="chip2 ar-re" type="button">새로 보기</button>`);
    el.querySelector(".ar-re").addEventListener("click", ev => { ev.stopPropagation(); arrivals(el, ids, 0); });
  }

  const hall = document.getElementById("hall"), doorsEl = document.getElementById("doors"), room = document.getElementById("branch");

  // ── 큰 문(타일) ──
  doorsEl.innerHTML = DOORS.map((d, i) =>
    `<a class="door s-${d.size || "half"} th-${d.theme || "white"}" href="#${d.id}" data-door="${d.id}" style="--i:${i}">
      ${d.badge && d.badge() ? `<span class="new-n">새 글 ${d.badge()}</span>` : ""}<span class="k">${esc(d.pre)}</span><h2>${esc(d.label)}</h2><span class="d">${esc(d.desc)}</span>
      <span class="live">${d.tile ? d.tile() : ""}</span>${emo(d.emoji)}</a>`).join("");

  // 문 ↔ 문 안 전환: 누른 타일과 문 안 머리에 같은 이름을 줘서 브라우저가 이어 붙여 움직이게 한다
  let cur = null, pushed = false;
  function swap(fn, fromEl, toSel) {
    if (!document.startViewTransition || reduce || document.hidden) { fn(); return; }
    if (fromEl) fromEl.style.viewTransitionName = "door";
    const tr = document.startViewTransition(() => {
      if (fromEl) fromEl.style.viewTransitionName = "";
      fn();
      const to = toSel && document.querySelector(toSel);
      if (to) to.style.viewTransitionName = "door";
    });
    tr.ready.catch(() => {});  // 화면이 숨겨지면 전환만 건너뛴다(내용은 바뀐다)
    tr.finished.finally(() => document.querySelectorAll(".door, .room-head").forEach(e => { e.style.viewTransitionName = ""; }));
  }
  doorsEl.addEventListener("click", e => {
    const a = e.target.closest(".door"); if (!a) return;
    e.preventDefault();
    history.pushState(null, "", "#" + a.dataset.door); pushed = true;
    swap(route, a, ".room-head");
  });
  window.addEventListener("popstate", () => {
    const from = cur;
    swap(route, document.querySelector(".room-head"), from ? `.door[data-door="${from}"]` : null);
  });

  // ── 문 안 ──
  function rowHtml(it, path) {
    const id = path.join("-"), icon = it.emoji ? emo(it.emoji, "ri") : `<span class="ri ri-dot"></span>`;
    const body = `${icon}<span class="t"><b>${esc(it.label)}</b>${it.desc ? `<small>${esc(it.desc)}</small>` : ""}</span>${countHtml(it)}${CHEV}`;
    if (it.kids) return `<div class="ri-box"><button class="row-btn" type="button" aria-expanded="false" aria-controls="sp-${id}" data-path="${id}">${body}</button><div class="spread" id="sp-${id}" hidden></div></div>`;
    if (it.near) return `<div class="ri-box"><button class="row-btn" type="button" aria-expanded="false" aria-controls="sp-${id}" data-path="${id}">${body}</button><div class="near" id="sp-${id}" aria-live="polite" hidden></div></div>`;
    if (it.action) return `<div class="ri-box"><button class="row-btn" type="button" data-action="${it.action}">${body}</button></div>`;
    return `<div class="ri-box"><a class="row-btn" href="${esc(it.href)}">${body}</a></div>`;
  }
  function chipsHtml(items, path, note) {
    return items.filter(alive).map((it, i) => {
      const id = [...path, items.indexOf(it)].join("-");
      return it.kids
        ? `<button class="chip2" type="button" style="--i:${i}" aria-expanded="false" aria-controls="sp-${id}" data-path="${id}">${esc(it.label)}${countHtml(it)}<span class="plus">+</span></button>`
        : `<a class="chip2" style="--i:${i}" href="${esc(it.href)}">${esc(it.label)}${countHtml(it)}</a>`;
    }).join("") + items.filter(it => it.kids).map(it => `<div class="spread deeper" id="sp-${[...path, items.indexOf(it)].join("-")}" hidden></div>`).join("") +
      (note ? `<p class="sp-note">${esc(note)}</p>` : "");
  }

  function openDoor(d) {
    const di = DOORS.indexOf(d);
    room.innerHTML =
      `<div class="room-top"><button class="back" type="button" id="back" aria-label="문 목록으로"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button><span>문 목록</span></div>
       <header class="room-head th-${d.theme || "white"}"><span class="k">${esc(d.pre)}</span><h1 tabindex="-1">${esc(d.label)}</h1><p>${esc(d.desc)}</p>${emo(d.emoji)}</header>` +
      (d.search ? `<form class="find" action="map.html" method="get" role="search">
        <input id="home-q" name="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="가게 이름, 약국, 미용실…" aria-label="이동·남사에서 찾기">
        <button class="btn btn-dark" type="submit">찾기</button></form><p class="find-hint" id="find-hint" aria-live="polite"></p>` : "") +
      `<div class="rows">${d.kids.filter(alive).map(it => rowHtml(it, [di, d.kids.indexOf(it)])).join("")}</div>` +
      (d.note ? `<p class="room-note">${esc(d.note)}</p>` : "");
    hall.hidden = true; room.hidden = false;
    document.getElementById("back").addEventListener("click", () => pushed ? history.back() : (history.pushState(null, "", location.pathname + location.search), swap(route, document.querySelector(".room-head"), `.door[data-door="${d.id}"]`)));
    if (d.search) bindSearch();
    window.scrollTo(0, 0);
    room.querySelector("h1").focus({ preventScroll: true });
  }

  room.addEventListener("click", e => {
    const b = e.target.closest("button[data-path], button[data-action]"); if (!b) return;
    if (b.dataset.action === "intro") { showIntro(); return; }
    const box = document.getElementById(b.getAttribute("aria-controls")), was = b.getAttribute("aria-expanded") === "true";
    // 같은 줄의 다른 가지는 접는다(한 번에 한 가지씩)
    const scope = b.classList.contains("row-btn") ? room.querySelectorAll(".row-btn[aria-expanded='true']") : b.parentElement.querySelectorAll(":scope > .chip2[aria-expanded='true']");
    for (const s of scope) { s.setAttribute("aria-expanded", "false"); document.getElementById(s.getAttribute("aria-controls")).hidden = true; }
    if (was) return;
    const it = find(b.dataset.path);
    box.hidden = false; b.setAttribute("aria-expanded", "true");
    if (it.near) { renderNear(box); return; }  // 내 주변: 이때 처음 위치를 묻는다
    box.innerHTML = chipsHtml(it.kids, b.dataset.path.split("-").map(Number), it.note);
  });

  function route() {
    const h = location.hash.slice(1), d = DOORS.find(x => x.id === (h === "near" ? "place" : h));  // #near(10-18~10-20 내 주변 문) → 장소 찾기 안 내 주변
    if (d) {
      cur = d.id; openDoor(d);
      if (h === "near") { const nb = [...room.querySelectorAll(".rows button[data-path]")].find(b => find(b.dataset.path).near); if (nb) nb.click(); }
      return;
    }
    cur = null; room.hidden = true; room.innerHTML = ""; hall.hidden = false;
  }
  function enter() { doorsEl.classList.remove("enter"); void doorsEl.offsetWidth; doorsEl.classList.add("enter"); }
  route(); enter();

  // 검색 미리보기(장소 찾기 문 안): 치는 동안 몇 곳이 나오는지 알려 준다. 찾기(엔터)는 지도로 간다
  function bindSearch() {
    const input = document.getElementById("home-q"), hint = document.getElementById("find-hint");
    if (!places.length) return;
    let timer;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const v = input.value.trim();
        if (!v) { hint.textContent = ""; return; }
        const r = S.split(places, v).main;
        const href = `map.html?q=${encodeURIComponent(v)}`;
        hint.innerHTML = r.length
          ? `‘${esc(v)}’ <b>${r.length}곳</b> · ${r.slice(0, 3).map(p => esc(p.name)).join(", ")}${r.length > 3 ? " 등" : ""} <a href="${href}">지도에서 보기 →</a>`
          : `‘${esc(v)}’은(는) 아직 없어요. 다른 말로 찾아보세요(예: 병원 → 의원).`;
      }, 200);
    });
  }

  // ── 소개 영상: 처음 한 번만. ?intro로 다시 볼 수 있고, 소개 문에도 '다시 보기'가 있다. 문 주소(#bus 등)로 들어오면 띄우지 않는다 ──
  // 2026-10-21부터 H영상(홍보용 18초, 영상/inam_H_screens18.html)을 그대로 튼다. 사용자 "아까 만든 H영상으로 바꾸고".
  // 3판(코드로 그리는 지도 애니메이션, data/intro.js)은 git d314bcf까지 이 자리에 있었다. intro.js는 버스 타일 숫자(I.routes)에 아직 쓴다.
  // 파일: img/intro-h.mp4(720×1280, 1.4MB, 소리 있음) · img/intro-h-end.jpg(끝 장면). 브라우저는 소리 있는 자동 재생을 막아서 소리 끄고 시작하고 '소리 켜기'를 둔다.
  // 움직임 줄이기 설정이면 재생하지 않고 끝 장면만. ?intro&t=5 → 그 초에 멈춘 화면(점검용).
  const SEEN = "inam_intro_seen";
  const intro = document.getElementById("intro"), tpl = document.getElementById("intro-tpl");
  const params = new URLSearchParams(location.search), FREEZE = parseFloat(params.get("t"));
  let seen = false, raf = 0;
  try { seen = !!localStorage.getItem(SEEN); } catch (e) { seen = true; }
  if (params.has("intro") || (!seen && !location.hash)) showIntro();

  function showIntro() {
    intro.innerHTML = ""; intro.appendChild(tpl.content.cloneNode(true));
    intro.hidden = false; intro.className = "intro";
    document.documentElement.classList.add("intro-on");
    const v = intro.querySelector("video"), bar = intro.querySelector(".intro-bar b").style;
    const snd = intro.querySelector(".intro-sound");
    let open = true;
    const close = () => {
      if (!open) return; open = false;
      try { localStorage.setItem(SEEN, new Date().toISOString().slice(0, 10)); } catch (e) {}
      cancelAnimationFrame(raf); document.removeEventListener("keydown", onKey); v.pause();
      intro.classList.add("bye");
      setTimeout(() => { intro.hidden = true; intro.innerHTML = ""; document.documentElement.classList.remove("intro-on"); if (!cur) enter(); }, reduce ? 0 : 450);
    };
    const onKey = e => { if (e.key === "Escape") close(); };
    const done = () => { intro.classList.add("ended"); bar.transform = "scaleX(1)"; };
    for (const b of intro.querySelectorAll("[data-close]")) b.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    snd.addEventListener("click", () => { v.muted = !v.muted; snd.textContent = v.muted ? "소리 켜기" : "소리 끄기"; if (v.paused && !v.ended) v.play().catch(() => {}); });
    v.addEventListener("ended", done);
    if (Number.isFinite(FREEZE) || reduce) {  // 멈춘 화면
      if (reduce && !Number.isFinite(FREEZE)) { v.removeAttribute("autoplay"); v.preload = "none"; v.poster = "img/intro-h-end.jpg"; done(); }
      else v.addEventListener("loadedmetadata", () => { v.pause(); v.currentTime = FREEZE; bar.transform = `scaleX(${FREEZE / v.duration})`; if (FREEZE >= v.duration - .5) done(); }, { once: true });
    } else {
      v.play().catch(() => done());  // 자동 재생이 막히면 끝 장면과 들어가기만
      const loop = () => { if (v.duration) bar.transform = `scaleX(${v.currentTime / v.duration})`; if (open && !v.ended) raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }
    intro.focus({ preventScroll: true });
  }
})();
