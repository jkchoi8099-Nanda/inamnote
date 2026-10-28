/* 이남노트: 메뉴로 찾기 — 네이버 블로그 검색 결과 칸(2026-10-29). 지도(map.html) 목록 밑에 따로 붙는다.
   사용자 10-29 "상호도 모르는데 어떻게 검색을 할거야? 계란말이를 검색하면 뜨도록" → 이남노트 자료(업종·가게 메뉴)에 없는 음식은
   '이동읍 계란말이'처럼 동네 이름을 붙여 네이버 블로그 검색 API에 묻고, 받은 결과를 **그대로** 보여 준다.
   검색 API 약관(네이버 개발자센터 서비스별 조건 2, 2026-07-31 시행, 10-29 원문 확인)을 지키려고:
   - 결과를 고치거나 거르거나 순서를 바꾸지 않는다. 이남노트 가게 목록과 섞지 않고 따로 '네이버 블로그 검색 결과' 칸에 둔다(2.2).
   - 출처(네이버 검색 결과)와 원문 링크를 단다(2.1·2.2). 저장하지 않는다 — 이 화면 안에서 마지막 결과 하나만 들고 있다가 새 검색이면 버린다(2.3·2.4).
   - 결과를 AI에 넣지 않는다(2.3). 이 칸이 있는 쪽에 광고를 달지 않는다(2.3) — 광고를 받게 되면 이 칸부터 다시 본다.
   묻는 곳: 공개 사이트는 Cloudflare 중계(relay/ /api/blog), 미리보기는 PC 미리보기 서버의 같은 주소(scripts/serve_preview.py). */
window.BlogSearch = (() => {
  const PREVIEW = location.protocol === "file:" || /(^|\.)ts\.net$|^localhost$|^127\.|^192\.168\./.test(location.hostname);
  const API = (PREVIEW ? "" : "https://inamnote-bus.jkchoi8099.workers.dev") + "/api/blog";
  const TOWNS = ["이동읍", "송전", "남사읍", "한숲시티"];  // 블로그 글에 실제로 많이 쓰는 동네 이름(중계 쪽 허용 목록과 같게)
  const AUTO = 3;  // 이남노트 목록이 이 수 이하면 바로 묻는다. 그보다 많으면 버튼을 눌러야 묻는다(하루 한도 아끼기)
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // 네이버는 검색어를 <b>로 감싸고 글자를 &amp; 꼴로 준다 → 태그만 떼고 글자로 되돌린 뒤 다시 이스케이프(내용은 바꾸지 않는다)
  const plain = s => { const t = document.createElement("textarea"); t.innerHTML = String(s || "").replace(/<[^>]+>/g, ""); return esc(t.value); };
  const day = d => /^\d{8}$/.test(d || "") ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : "";
  let town = TOWNS[0], last = null, asked = "";  // last: 마지막 결과 하나 { key, res } — 새 검색이면 버린다

  function render(el, q, res) {
    const query = `${town} ${q}`;
    const more = "https://search.naver.com/search.naver?ssc=tab.blog.all&query=" + encodeURIComponent(query);
    let body;
    if (!res) body = `<button class="chip blog-go" type="button">‘${esc(query)}’ 블로그 후기 보기</button>`;
    else if (res.loading) body = `<p class="blog-msg">네이버 블로그에서 찾는 중…</p>`;
    else if (res.error) body = `<p class="blog-msg">${esc(res.error)}</p>`;
    else if (!res.items.length) body = `<p class="blog-msg">‘${esc(query)}’ 블로그 글이 없어요.</p>`;
    else body = `<ol class="blog-list">${res.items.map(x => `<li><a href="${esc(x.link)}" target="_blank" rel="noopener">
        <b>${plain(x.title)}</b><span>${plain(x.description)}</span><small>${plain(x.bloggername)}${day(x.postdate) ? " · " + day(x.postdate) : ""}</small></a></li>`).join("")}</ol>
      <a class="blog-more" href="${more}" target="_blank" rel="noopener">네이버에서 더 보기</a>`;
    el.innerHTML = `<h3>네이버 블로그 검색 결과</h3>
      <p class="blog-why">이남노트 목록에 없는 메뉴도 동네 이름을 붙여 찾아봐요. 블로그 글이라 지금과 다를 수 있어요.</p>
      <div class="blog-towns" role="group" aria-label="동네">${TOWNS.map(t => `<button class="chip${t === town ? " on" : ""}" type="button" data-town="${esc(t)}" aria-pressed="${t === town}">${esc(t)}</button>`).join("")}</div>
      ${body}<p class="blog-src">검색 결과 제공: NAVER</p>`;
  }

  async function ask(el, q) {
    const key = town + " " + q;
    if (last && last.key === key) return render(el, q, last.res);
    asked = key;
    render(el, q, { loading: true });
    let res;
    try {
      const r = await fetch(`${API}?town=${encodeURIComponent(town)}&q=${encodeURIComponent(q)}`);
      res = await r.json();
      if (!Array.isArray(res.items)) res = { error: res.error || "블로그 검색을 받아 오지 못했어요." };
    } catch (e) {
      res = { error: "블로그 검색을 받아 오지 못했어요." };
    }
    if (asked !== key) return;  // 그사이 검색어가 바뀌었다
    last = { key, res };
    render(el, q, res);
  }

  // map.html render()가 부른다. q: 검색어, n: 이남노트 목록 수
  function update(el, q, n) {
    q = (q || "").trim();
    if (q.length < 2 || q.length > 20) { el.hidden = true; el.innerHTML = ""; asked = ""; return; }
    el.hidden = false;
    if (el.dataset.q === q && el.dataset.town === town) return;  // 같은 검색어로 다시 그릴 때(더 보기·지도 이동)는 그대로 둔다
    el.dataset.q = q; el.dataset.town = town;
    if (last && last.key !== town + " " + q) last = null;
    n <= AUTO ? ask(el, q) : render(el, q, null);
  }

  function bind(el) {
    el.addEventListener("click", e => {
      const t = e.target.closest("[data-town]"), go = e.target.closest(".blog-go"), q = el.dataset.q;
      if (t) { town = t.dataset.town; el.dataset.town = town; last = null; ask(el, q); }
      else if (go) ask(el, q);
    });
  }
  return { update, bind };
})();
