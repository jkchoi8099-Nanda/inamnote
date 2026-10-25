/* 휴대폰 지도·목록 나누기 — map.html·bus.html이 같이 쓴다.
   사용자 10-15 "폰으로 지도를 보면 지도 아래에 공간이 너무 작아서 스크롤하기도 힘들고 어떤 가게가 있는지 잘 보이지 않아".
   네이버·카카오 지도의 아래 목록판처럼: 지도와 목록 사이 손잡이를 위아래로 끌면 지도 높이가 바뀌고,
   놓으면 세 칸(지도 크게 / 반반 / 목록 크게) 중 가까운 곳에 멈춘다. 손잡이를 톡 누르면 반반 ↔ 목록 크게.
   넓은 화면(900px 이상)은 목록이 옆에 있어서 손잡이가 숨는다(style.css .grip).
   지도 높이는 .body의 --map-h(px). 네이버 지도 크기 맞추기는 각 페이지의 ResizeObserver가 한다.
   addSheet(.body, 손잡이) → { snap("big"|"half"|"list"), mode() } */
window.addSheet = (body, grip) => {
  const SNAP = { big: .64, half: .42, list: .2 };  // 지도 높이 = .body 높이 × 이 값
  const MIN_MAP = 96, MIN_LIST = 110;
  const wide = matchMedia("(min-width: 900px)");
  let mode = "half";
  const clamp = h => Math.max(MIN_MAP, Math.min(body.clientHeight - MIN_LIST, h));
  const set = h => body.style.setProperty("--map-h", Math.round(clamp(h)) + "px");
  const snap = m => {
    mode = m; grip.dataset.mode = m;
    grip.setAttribute("aria-label", m === "list" ? "지도 크게 보기" : "목록 크게 보기");
    if (!wide.matches) set(body.clientHeight * SNAP[m]);
  };
  let y0 = 0, h0 = 0, moved = false, on = false;
  grip.addEventListener("pointerdown", e => {
    on = true; moved = false; y0 = e.clientY; h0 = body.firstElementChild.getBoundingClientRect().height;
    grip.setPointerCapture(e.pointerId); body.classList.add("dragging");
  });
  grip.addEventListener("pointermove", e => {
    if (!on) return;
    if (Math.abs(e.clientY - y0) > 6) moved = true;
    if (moved) set(h0 + e.clientY - y0);
  });
  const end = () => {
    if (!on) return;
    on = false; body.classList.remove("dragging");
    if (!moved) return;  // 톡 누름은 아래 click에서 — pointerup에서 바로 칸을 바꾸면 뒤따르는 click이 그 자리로 올라온 가게를 눌렀다(10-15)
    const r = body.firstElementChild.getBoundingClientRect().height / body.clientHeight;
    snap(Object.keys(SNAP).reduce((a, b) => Math.abs(SNAP[b] - r) < Math.abs(SNAP[a] - r) ? b : a));
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  grip.addEventListener("click", () => { if (!moved) snap(mode === "list" ? "half" : "list"); });
  // 키보드: 위·아래 화살표로 한 칸씩
  grip.addEventListener("keydown", e => {
    const order = ["list", "half", "big"], i = order.indexOf(mode);
    if (e.key === "ArrowDown" && i < 2) { snap(order[i + 1]); e.preventDefault(); }
    if (e.key === "ArrowUp" && i > 0) { snap(order[i - 1]); e.preventDefault(); }
  });
  // 화면 크기나 위쪽 버튼 줄 높이가 바뀌면 같은 칸으로 다시 맞춘다(--map-h만 바꿔서는 .body 높이가 안 변하니 되풀이되지 않는다)
  let bh = 0;
  new ResizeObserver(() => { if (!on && body.clientHeight !== bh) { bh = body.clientHeight; snap(mode); } }).observe(body);
  snap(mode);
  return { snap, mode: () => mode };
};
