/* 정류소 도착 예정(2026-10-18): "이 정류소에 ○번이 4분 뒤 · 3정거장 전". 첫 화면 '내 주변'과 bus.html 정류소 창이 같이 쓴다.
   1) 먼저 도착 예정(/api/arrive?station=, 경기도_버스도착정보 — 사용자가 10-18 신청, 같은 날 됨). 정류소 하나에 1건이라 한도도 덜 쓴다.
   2) 그게 안 되면(중계 없음·한도·오류) 버스 위치(/api/bus, 노선마다 '몇 번째 정류소')로 정류소 수만 센다 — 몇 분 뒤인지는 모른다. */
window.Arrive = (() => {
  const ARR = "/api/arrive", POS = "/api/bus";
  const MAX = 14;  // 위치로 셀 때 한 번에 묻는 노선 수. 용인터미널 쪽 정류소는 노선이 27개라 자주 오는 것부터(중계 하루 한도 아끼기)
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // bus.html과 같은 규칙: 노선 정류소 목록은 기점 → 회차(turn) → 기점 한 줄. 그 순번에서 가는 쪽 종점
  const oneWay = r => !r.turn || r.turn >= r.stops_total;
  const dest = (r, seq) => oneWay(r) ? r.to : seq < r.turn ? (r.turn_name || r.to) : r.from;
  const ttak = r => r.no.includes("똑버스");
  const short = n => { const t = String(n || "").replace(/\(.*?\)/g, "").split(".")[0].trim(); return t.length > 9 ? t.slice(0, 8) + "…" : t; };
  // 빈자리를 주는 노선 종류(경기도 routeTypeCd): 직행좌석·좌석·광역급행·경기순환·농어촌 좌석·시외 좌석. 일반 버스는 늘 0이 온다
  const SEATED = new Set([11, 12, 14, 16, 21, 22, 41, 42]);
  const getJson = async url => (await fetch(url, { cache: "no-store" })).json();

  // 이 정류소(들)를 지나는 노선과 순번. 한 노선이 같은 정류소에 갈 때·올 때 두 번 서면 둘 다
  function passes(B, ids) {
    const want = new Set(ids.map(String)), out = [];
    for (const r of B.routes) r.stops.forEach((s, i) => { if (s && want.has(String(s))) out.push({ r, seq: i + 1 }); });
    return out;
  }
  // 그 순번에 가장 먼저 닿을 버스: 순번이 같거나 앞인 버스 중 가장 가까운 것.
  // 같은 순번은 '도착(1)'일 때만 — 출발(2)·교차로 통과(0)는 이미 지나갔다. TAGO는 상태가 없어(st 없음) 그 정류소에 있는 것으로 본다
  function first(buses, seq) {
    let best = null;
    for (const b of buses || []) {
      const n = seq - b.seq;
      if (n < 0 || (n === 0 && b.st != null && b.st !== 1)) continue;
      if (!best || n < best.n) best = { n, b };
    }
    return best;
  }
  const when = n => n == null ? "" : n === 0 ? "도착" : n + "정거장 전";
  // 노선·방면이 같으면(맞은편 정류소를 같이 볼 때) 먼저 오는 쪽 하나
  const keep = (map, row, k) => { const was = map.get(k); if (!was || (row.n != null && (was.n == null || (row.m ?? row.n) < (was.m ?? was.n)))) map.set(k, row); };
  const sortRows = rows => rows.sort((a, b) => (a.m ?? (a.n == null ? 1e9 : a.n * 2)) - (b.m ?? (b.n == null ? 1e9 : b.n * 2)) || a.no.localeCompare(b.no, "ko"));

  // 1) 도착 예정: 정류소마다 1건
  async function byArrival(B, ids, here) {
    const got = await Promise.all(ids.map(id => getJson(`${ARR}?station=${id}`).catch(() => null)));
    if (got.some(d => !d || d.error)) return null;  // 하나라도 못 받으면 위치로 센다(정류소 한쪽만 보이면 헷갈린다)
    const best = new Map();
    for (const d of got) for (const a of d.list) {
      if (/똑버스/.test(a.no)) continue;
      const no = a.no.replace("용인", "");
      keep(best, { no, dest: a.dest, end: here.has(short(a.dest)), n: a.n1, m: a.m1, next: a.m2,
        b: a.n1 == null ? null : { crowd: a.crowd1, low: a.low1, seat: SEATED.has(a.type_cd) ? a.seat1 : null } }, no + "|" + a.dest);
    }
    return { rows: sortRows([...best.values()]), mode: "arrive", src: got[0] ? got[0].src : "", stale: got.some(d => d.stale), skipped: [] };
  }
  // 2) 버스 위치로 세기: 노선마다 1건
  async function byPosition(B, ids, here) {
    const live = passes(B, ids).filter(p => !ttak(p.r));
    const gap = id => B.routes.find(x => x.id === id).gap || 99;
    const all = [...new Set(live.map(p => p.r.id))].sort((a, b) => gap(a) - gap(b)), ask = all.slice(0, MAX);
    const got = new Map();
    let err = "", src = "", stale = false;
    await Promise.all(ask.map(async id => {
      try { const d = await getJson(`${POS}?route=${id}`); if (d.error) err = d.error; else { got.set(id, d); src = d.src || src; stale = stale || !!d.stale; } }
      catch (e) { err = "버스 위치를 받아 오지 못했어요."; }
    }));
    const best = new Map();
    for (const p of live) {
      if (!got.has(p.r.id)) continue;
      const f = first(got.get(p.r.id).buses, p.seq), to = dest(p.r, p.seq);
      keep(best, { no: p.r.no.replace("용인", ""), dest: to, end: here.has(short(to)), n: f ? f.n : null,
        b: f && { crowd: f.b.crowd, low: f.b.low, seat: /좌석/.test(p.r.type) ? f.b.seat : null } }, p.r.id + "|" + to);
    }
    return { rows: sortRows([...best.values()]), mode: "pos", src, stale, err: got.size ? "" : err,
      skipped: all.slice(MAX).map(id => B.routes.find(x => x.id === id).no.replace("용인", "")) };
  }

  async function check(B, ids) {
    // 방면이 이 정류소 자신이면(송전터미널에서 '송전터미널 방면') 여기서 회차·종점이다
    const here = new Set(ids.map(id => short((B.stations[id] || [])[2])));
    const res = (await byArrival(B, ids, here)) || (await byPosition(B, ids, here));
    return { ...res, ttak: passes(B, ids).some(p => ttak(p.r)), at: new Date() };
  }

  function html(res) {
    if (res.err && !res.rows.length) return `<p class="ar-err">${esc(res.err)}${location.protocol === "file:" ? "" : " 실시간 버스 정보는 아직 PC 미리보기에서만 받아요."}</p>`;
    const hm = res.at.toTimeString().slice(0, 5);
    // 오는 버스가 있는 줄만 펼치고, 어느 방면으로도 안 오는 노선은 번호만 한 줄로 접는다(정류소에 노선이 많으면 '없음'이 목록을 덮었다)
    const coming = res.rows.filter(x => x.n != null);
    const idle = [...new Set(res.rows.filter(x => x.n == null && !coming.some(c => c.no === x.no)).map(x => x.no))];
    const li = coming.map(x => {
      const extra = [x.next != null ? `다음 ${x.next}분` : "", x.b && x.b.crowd >= 3 ? "혼잡" : "", x.b && x.b.low === 1 ? "저상" : "",
        x.b && x.b.seat > 0 ? `빈자리 ${x.b.seat}` : ""].filter(Boolean).join(" · ");
      const big = x.m != null ? (x.m <= 1 ? "곧 도착" : `${x.m}분`) : when(x.n);
      const sub = x.m != null && x.n ? `<small>${x.n}정거장 전</small>` : "";
      return `<li class="${(x.m != null ? x.m <= 3 : x.n <= 2) ? "soon" : ""}"><b class="ar-no">${esc(x.no)}</b>` +
        `<span class="ar-to">${x.end ? "여기서 회차·종점" : esc(short(x.dest)) + " 방면"}${extra ? `<small>${esc(extra)}</small>` : ""}</span>` +
        `<em>${esc(big)}${sub}</em></li>`;
    }).join("");
    const none = !res.rows.length ? "이 정류소를 지나는 노선 정보가 없어요." : !coming.length ? "지금 이 정류소로 오는 버스가 없어요." : "";
    return `<ul class="arv">${li}${none ? `<li class="none"><span class="ar-to">${none}</span></li>` : ""}</ul>` +
      (idle.length ? `<p class="ar-idle">${coming.length ? "<b>지금 안 오는 노선</b> " : ""}${esc(idle.join(" · "))}</p>` : "") +
      `<p class="ar-note">${res.skipped.length ? `노선이 많아 자주 오는 ${MAX}개만 봤어요(${esc(res.skipped.join(", "))} 빠짐). ` : ""}` +
      `${res.ttak ? "똑버스는 부르면 오는 버스라 여기 안 나와요. " : ""}` +
      (res.mode === "arrive" ? "도착 시간은 경기도 버스정보 예측이라 길 사정에 따라 달라요. " : "정류소 수만 세요(지금은 몇 분 뒤인지 못 받았어요). ") +
      `${esc(res.src || "경기도 버스정보")} · ${hm}${res.stale ? " · 조금 전 정보" : ""}</p>`;
  }

  return { check, html, first, when, dest, passes };
})();
