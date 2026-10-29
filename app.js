/* 이남노트: data/*.json을 읽어 화면을 채운다. 외부 라이브러리 없음. */
(function () {
  'use strict';
  var DAYS = '일월화수목금토';

  function kstNow() {
    var n = new Date();
    return new Date(n.getTime() + (n.getTimezoneOffset() + 540) * 60000);
  }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function load(path) {
    return fetch(path, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }
  function hm(iso) {
    if (!iso) return '';
    var m = /T(\d{2}):(\d{2})/.exec(iso);
    return m ? m[1] + ':' + m[2] : '';
  }
  function ageHours(iso) {
    if (!iso) return 999;
    var t = Date.parse(iso);
    return isNaN(t) ? 999 : (Date.now() - t) / 3600000;
  }
  function dotDate(s) { return String(s || '').replace(/-/g, '.'); }

  var BADGE = { ok: ['b-ok', '1차 출처 확인'], news: ['b-news', '보도 기준'], warn: ['b-warn', '원문 재확인 전'] };
  var TYPE = { gov: ['t-gov', '공식'], news: ['t-news', '보도'], site: ['t-site', '공사'], shop: ['t-shop', '새 가게'], road: ['t-road', '길'] };

  /* 사이트 설정: 갱신 쉬는 중, 문의처, 최종 갱신일 */
  load('data/site.json').then(function (s) {
    var last = Date.parse(s.last_reviewed + 'T00:00:00+09:00');
    var days = (Date.now() - last) / 86400000;
    var d = $('dormant');
    if (d && days > (s.dormant_after_days || 14)) {
      d.querySelector('span').textContent = '이번 주는 갱신을 쉬고 있습니다. 마지막 확인 ' + dotDate(s.last_reviewed) + ' · 날짜를 꼭 확인하세요.';
      d.hidden = false;
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-last-reviewed]'), function (el) { el.textContent = dotDate(s.last_reviewed); });
    var c = s.contact || {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-contact]'), function (el) {
      if (c.kakao_channel_url) {
        el.innerHTML = '<a href="' + esc(c.kakao_channel_url) + '" rel="noopener" target="_blank">카카오톡 채널 ' + esc(c.kakao_search_id || '이남노트') + '</a> 1:1 채팅';
      }
    });
  }).catch(function () {});

  /* 오늘 한 줄(첫 화면). today.json은 자동 수집(scripts/update_today.py) 결과다 */
  var EXAMPLE = false;
  function srcLine(t, S) {
    if (EXAMPLE) return '<span class="src">예시 자료 · 자동 수집을 연결하면 실제 값으로 바뀝니다</span>';
    var w = S.weather, stale = !w || !w.ok || ageHours(w.at) > 3;
    return '<span class="src' + (stale ? ' stale' : '') + '">' + (stale ? '오래된 자료 · ' : '자동 · ') +
      '기상청 · 에어코리아 실시간(확정 전) · ' + (w && w.at ? dotDate(w.at.slice(5, 10)) + ' ' + hm(w.at) : '') + '</span>';
  }

  /* 지난 방문 뒤 새로 올라온 공식 소식(2026-10-18). 다시 들어온 사람이 "뭐가 새로 생겼나"를 한눈에 보게 한다.
     localStorage inam_seen = 지난번에 본 우리 동네 글 주소 목록, sessionStorage inam_new = 이번 방문에서 '새 글'로 칠 주소.
     처음 온 브라우저는 새 글 0(전부 새 글로 치지 않는다). 같은 방문 안에서는 새로고침해도 표시가 남는다.
     notices.html도 같은 저장값으로 '새 글' 표시를 한다(그쪽 newSet과 같은 규칙). 저장이 막힌 브라우저는 표시 없이 지나간다 */
  var TOWN = ((window.NOTICES && window.NOTICES.items) || []).filter(function (x) { return x.scope !== 'city'; });  // 용인시 전체 글은 빼고 우리 동네 글만
  var NEW = (function () {
    try {
      var ses = sessionStorage.getItem('inam_new');
      if (ses) return JSON.parse(ses);
      var all = TOWN.map(function (x) { return x.url; }), seen = localStorage.getItem('inam_seen'), fresh = [];
      if (seen) { var had = {}; JSON.parse(seen).forEach(function (u) { had[u] = 1; }); fresh = all.filter(function (u) { return !had[u]; }); }
      if (all.length) { sessionStorage.setItem('inam_new', JSON.stringify(fresh)); localStorage.setItem('inam_seen', JSON.stringify(all)); }
      return fresh;
    } catch (e) { return []; }
  })();

  /* '오늘' 상자 아래 소식 한 줄: 새 글이 있으면 "새 소식 N건 · 지난번 뒤", 없으면 가장 최근 글 */
  function newestNotice() {
    if (!TOWN.length) return '';
    var isNew = {}; NEW.forEach(function (u) { isNew[u] = 1; });
    var pool = NEW.length ? TOWN.filter(function (x) { return isNew[x.url]; }) : TOWN;
    var x = pool.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
    return '<a class="new' + (NEW.length ? ' fresh' : '') + '" href="notices.html"><span class="k">' + (NEW.length ? '새 소식 ' + NEW.length + '건' : '최근 소식') + '</span><span>' +
      (NEW.length ? '<span class="since">지난번 뒤</span> ' : '<span class="num">' + esc(dotDate(x.date.slice(5))) + '</span> ') +
      esc(x.title.replace(/^\[(신규|변경|폐지)\]\s*/, '')) + '</span></a>';
  }

  // 첫 화면 약국 목록은 2026-10-20에 뺐다(사용자 "약국 정보가 나와 있는데 이건 필요 없어. 대신 여기에 커뮤니티").
  // '지금 여는 곳·가장 먼저 여는 곳' 계산(openNow·nextOpen)은 커밋 6e75fd4의 app.js에 있다. 약국은 장소 찾기 검색으로 찾는다.
  var row = $('today-row');
  if (row) {
    var k = kstNow();
    var stampText = (k.getMonth() + 1) + '월 ' + k.getDate() + '일 (' + DAYS[k.getDay()] + ')';
    load('data/today.json').then(function (t) {
      var S = t.sources || {};
      EXAMPLE = !!t.example;
      var w = S.weather && S.weather.data, a = S.air && S.air.data;

      if (row) {
        // 날씨 전광판(10-16 사용자 "온도부터 미세먼지까지 움직이게 — 클릭이 되나? 하고 눌러보게"). 누르면 weather.html.
        // 같은 내용을 두 번 이어 붙여 -50%까지 흘리면 끊김 없이 돈다. 움직임 줄이기 설정이면 멈춘다(style.css .ticker).
        // 약국 칸은 이 줄에서 뺐다(사용자 10-16 "지금 연 약국 없음 지우고")
        var tk = [];
        if (w) {
          tk.push('<b>' + esc(Math.round(parseFloat(w.temp))) + '°</b> ' + esc(w.sky));
          if (w.tmn != null && w.tmx != null) tk.push('최저 ' + esc(Math.round(w.tmn)) + '° · 최고 ' + esc(Math.round(w.tmx)) + '°');
          if (w.pop_at) tk.push(esc(w.pop_at) + ' 비 ' + esc(w.pop_max) + '%');
        }
        if (a) {
          // 미세먼지 등급이 비면(측정소 점검 등) 초미세먼지 등급을 쓴다. 에어코리아 값은 고치지 않고 그대로 보인다
          var g = a.pm10_grade ? ['미세먼지', a.pm10_grade] : a.pm25_grade ? ['초미세먼지', a.pm25_grade] : null;
          if (g) tk.push('<span class="' + (/나쁨/.test(g[1]) ? 'tone-bad' : 'tone-ok') + '">' + g[0] + ' ' + esc(g[1]) + '</span>');
        }
        tk.push('10일 예보 보기 ›');
        var seg = tk.join('<i class="tk-dot">·</i>');
        row.innerHTML = '<b>' + stampText + '</b><a class="ticker" href="weather.html" aria-label="날씨 자세히 보기">' +
          '<span class="tk-track"><span class="tk-seg">' + seg + '</span><span class="tk-seg" aria-hidden="true">' + seg + '</span></span></a>';
        var s1 = row.querySelector('.tk-seg');
        if (s1) row.querySelector('.tk-track').style.animationDuration = Math.max(8, s1.offsetWidth / 45) + 's';  // 초당 약 45px
        var box = $('today-line');
        box.insertAdjacentHTML('beforeend', newestNotice() + srcLine(t, S));
        var al = S.alerts && S.alerts.data && S.alerts.data.items;
        // 10-18부터 항목에 특보 이름이 들어 있다("강풍 예비특보 · 시각 · 용인 구역"). 옛 형식이면 머리말을 붙인다
        if (al && al.length && $('alert')) {
          $('alert').textContent = (/특보|주의보|경보/.test(al[0]) ? '' : '기상특보 · ') + al[0] + (al.length > 1 ? ' 외 ' + (al.length - 1) + '건' : '');
          $('alert').hidden = false;
        }
      }
    }).catch(function () {
      row.innerHTML = '<b>' + stampText + '</b><span>오늘 정보를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</span>';
      $('today-line').insertAdjacentHTML('beforeend', newestNotice());
    });
  }

  /* 새로 나온 소식(첫 화면 #feed). 2026-10-20 사용자 "이남 소식에 포함된 모든 뉴스 및 혜택들 중에서 어떤 정보든 좋으니 가장 최근 순으로 …
     헤더를 만들어야겠지. 용인시 혜택인지 보상인지 청약인지" → 공식 소식 전부(용인시 전체 글 포함)·기사(feed.json)·혜택(data/benefits_recent.js)·
     용인 사장님 지원사업(data/programs.js)을 날짜 하나로 줄 세우고, 줄마다 머리에 무슨 소식인지 꼬리표를 단다.
     혜택·지원사업은 원본에 게시일이 없어 접수 시작일을 날짜로 친다 → 아직 접수 전이거나 접수가 끝난 것은 뺀다(나온 날을 지어내지 않는다).
     같은 날이면 우리 동네 글(보상·청약·고시·읍·LH) → 혜택·지원사업 → 기사 → 용인시 전체 글 순. 공식 글을 누르면 소식 화면 읽기 창(notices.html#r=키). */
  var NTAG = function (x) {
    var s = x.src;
    return s === '토지이음 고시' || x.cat === 'gosi' ? ['공식 고시', 't-gov'] : s === 'LH 보상공고' || x.cat === 'comp' ? ['보상', 't-site'] : s === 'LH 청약·임대' ? ['청약·임대', 't-shop'] :
      /^LH/.test(s) ? ['LH 소식', 't-gov'] : /읍 소식$/.test(s) ? [s, 't-gov'] : ['용인시 소식', 't-news'];
  };
  var AREA_TAG = { yongin: '용인시 혜택', gg: '경기도 혜택', nation: '전국 혜택' };
  // notices.html key()와 같은 계산(원문 주소로 만든 짧은 키)
  var nkey = function (u) { var h = 5381; for (var i = 0; i < u.length; i++) h = (h * 33 + u.charCodeAt(i)) >>> 0; return h.toString(36); };
  var clean = function (t) { return String(t).replace(/^\[(신규|변경|폐지)\]\s*/, ''); };
  // 혜택 하나 → 혜택 화면 읽기 창(#b=서비스ID, 2026-10-23). 뒤에 깔린 목록은 그 혜택 이름으로 찾은 채로
  var benHref = function (x) { return 'benefits.html?area=' + x.area + '&q=' + encodeURIComponent(x.name) + (x.id ? '#b=' + x.id : ''); };

  function feedRows(articles) {
    var today = kstNow().toISOString().slice(0, 10);
    var isNew = {}; NEW.forEach(function (u) { isNew[u] = 1; });
    var open = function (x) { return x.start && x.start <= today && (!x.end || x.end >= today); };
    // 날짜가 빈 항목이 하나만 있어도 칸 전체가 멈췄다(10-26 레이더 공고 end=null) → 빈 값은 빈 글자로
    var md = function (d) { return d ? dotDate(String(d).slice(5)) : ''; };
    var rows = [];
    ((window.NOTICES && window.NOTICES.items) || []).forEach(function (x) {
      var tg = NTAG(x);
      rows.push({ date: x.date, rank: x.scope === 'city' ? 3 : 0, tag: tg[0], cls: tg[1], href: 'notices.html#r=' + nkey(x.url), title: clean(x.title),
        meta: (isNew[x.url] ? '<span class="badge b-new">새 글</span>' : '') + '<span class="badge b-ok">공식 원문</span>' + esc(x.org || x.src) });
    });
    ((window.BENEFITS_RECENT && window.BENEFITS_RECENT.items) || []).filter(open).forEach(function (x) {
      rows.push({ date: x.start, rank: 1, tag: AREA_TAG[x.area] || '혜택', cls: 't-ben', title: x.name,
        href: benHref(x), meta: '접수 ' + md(x.start) + (x.end ? '~' + md(x.end) : '') });
    });
    // 지원사업은 start~end가 접수 기간, 교육·행사는 start가 행사일·end가 신청 마감(build_programs.py)
    ((window.PROGRAMS && window.PROGRAMS.items) || []).filter(open).forEach(function (x) {
      var edu = x.kind !== '지원사업';
      rows.push({ date: x.start, rank: 1, tag: edu ? '사장님 교육' : '사장님 지원', cls: 't-ben', title: x.name, href: 'benefits.html#biz-sec',
        meta: (edu ? '교육 ' + md(x.start) + (x.end ? ' · 신청 ' + md(x.end) + '까지' : '')
          : '접수 ' + md(x.start) + (x.end ? '~' + md(x.end) : ' · 상시 접수')) + ' · ' + esc(x.org) });
    });
    articles.forEach(function (i) {
      var t = TYPE[i.type] || TYPE.news, b = BADGE[i.badge] || BADGE.warn;
      rows.push({ date: i.date, rank: 2, tag: t[1], cls: t[0], title: i.title, href: i.url, ext: true,
        meta: '<span class="badge ' + b[0] + '">' + b[1] + '</span>' + esc(i.source) });
    });
    return rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : a.rank - b.rank; });
  }
  function drawFeed(el, rows, n) {
    el.innerHTML = rows.slice(0, n).map(function (r) {
      return '<li><span class="fh"><span class="t ' + r.cls + '">' + esc(r.tag) + '</span><span class="num">' + esc(dotDate(r.date.slice(5))) + '</span></span>' +
        '<b><a class="ft" href="' + esc(r.href) + '"' + (r.ext ? ' rel="noopener" target="_blank"' : '') + '>' + esc(r.title) + '</a></b>' +
        '<span class="s">' + r.meta + '</span></li>';
    }).join('') || '<li><span class="fh"><span class="t t-news">안내</span></span><b>아직 모은 소식이 없어요.</b></li>';
    var more = $('feed-more');
    if (more) {
      more.hidden = rows.length <= n;
      more.textContent = '더 보기 (' + (rows.length - n) + '건 더)';
      more.onclick = function () { drawFeed(el, rows, n + 8); };
    }
  }

  /* 지금 접수 중인 혜택(첫 화면 #open-ben, 2026-10-23). 용인·경기·전국·대상 구분 없이 benefits_recent.js에서
     오늘 접수 중인 것만(혜택 화면 '지금 접수 중'과 같은 기준: 마감일이 있고 오늘이 기간 안) 마감 가까운 순. */
  var openEl = $('open-ben');
  if (openEl) {
    var B = window.BENEFITS_RECENT, today = kstNow().toISOString().slice(0, 10);
    var left = function (d) { return Math.round((Date.parse(d) - Date.parse(today)) / 86400000); };
    var openRows = ((B && B.items) || []).filter(function (x) { return x.end && x.end >= today && (!x.start || x.start <= today); })
      .sort(function (a, b) { return a.end < b.end ? -1 : a.end > b.end ? 1 : 0; });
    var drawOpen = function (n) {
      openEl.innerHTML = openRows.slice(0, n).map(function (x) {
        var l = left(x.end);
        return '<li><span class="fh"><span class="t t-ben">' + esc(AREA_TAG[x.area] || '혜택') + '</span><span class="num">~' + esc(dotDate(x.end.slice(5))) + '</span></span>' +
          '<b><a class="ft" href="' + esc(benHref(x)) + '">' + esc(x.name) + '</a></b>' +
          '<span class="s">' + (l <= 14 ? '<span class="badge b-warn">' + (l ? '마감 ' + l + '일 남음' : '오늘 마감') + '</span>' : '<span class="badge b-ok">접수 중</span>') +
          esc(x.kind || '') + '</span></li>';
      }).join('') || '<li><span class="fh"><span class="t t-ben">혜택</span></span><b>' +
        (B ? '오늘 접수 중인 혜택이 없어요. 상시 신청 혜택은 혜택 화면에서 찾아 보세요.' : '혜택 목록을 불러오지 못했어요.') + '</b></li>';
      var more = $('open-more');
      more.hidden = openRows.length <= n;
      more.textContent = '더 보기 (' + (openRows.length - n) + '건 더)';
      more.onclick = function () { drawOpen(n + 6); };
    };
    drawOpen(parseInt(openEl.getAttribute('data-limit') || '6', 10));
    if (B && B.updated_at && $('open-src')) $('open-src').textContent = '정부24 원본 ' + dotDate(B.updated_at.slice(5, 10)) + ' 받음';
  }

  /* 언제든 신청할 수 있는 혜택(첫 화면 #always-ben, 2026-10-25). benefits_recent.js의 always = 마감일 없는 '상시신청'(많이 찾는 순).
     지역 칩으로 나눠 보여 주고, 처음엔 용인시. '전체에서 찾기'는 고른 지역으로 혜택 화면 '상시 신청' 거르기를 켠 채 연다. */
  var alwaysEl = $('always-ben');
  if (alwaysEl) {
    var AL = (window.BENEFITS_RECENT && window.BENEFITS_RECENT.always) || [];
    var AREAS = [['yongin', '용인시'], ['gg', '경기도'], ['nation', '전국']].filter(function (a) {
      return AL.some(function (x) { return x.area === a[0]; });
    });
    var alArea = AREAS.length ? AREAS[0][0] : 'yongin';
    var drawAlways = function (n) {
      var rows = AL.filter(function (x) { return x.area === alArea; });
      $('always-areas').innerHTML = AREAS.map(function (a) {
        return '<button class="chip" type="button" data-area="' + a[0] + '" aria-pressed="' + (a[0] === alArea) + '">' + a[1] +
          '<span class="n">' + AL.filter(function (x) { return x.area === a[0]; }).length + '</span></button>';
      }).join('');
      alwaysEl.innerHTML = rows.slice(0, n).map(function (x) {
        return '<li><span class="fh"><span class="t t-ben">' + esc(AREA_TAG[x.area] || '혜택') + '</span></span>' +
          '<b><a class="ft" href="' + esc(benHref(x)) + '">' + esc(x.name) + '</a></b>' +
          '<span class="s"><span class="badge b-ok">상시 신청</span>' + esc(x.kind || '') + '</span></li>';
      }).join('') || '<li><span class="fh"><span class="t t-ben">혜택</span></span><b>' +
        (window.BENEFITS_RECENT ? '상시 신청 혜택이 없어요.' : '혜택 목록을 불러오지 못했어요.') + '</b></li>';
      var more = $('always-more');
      more.hidden = rows.length <= n;
      more.textContent = '더 보기 (' + (rows.length - n) + '건 더)';
      more.onclick = function () { drawAlways(n + 5); };
      $('always-all').href = 'benefits.html?area=' + alArea + '&always=1#list-sec';
    };
    var alLimit = parseInt(alwaysEl.getAttribute('data-limit') || '5', 10);
    $('always-areas').addEventListener('click', function (e) {
      var b = e.target.closest('[data-area]');
      if (b) { alArea = b.getAttribute('data-area'); drawAlways(alLimit); }
    });
    drawAlways(alLimit);
  }

  var feedEl = $('feed'), cardsEl = $('news-cards');
  if (feedEl || cardsEl) {
    load('data/feed.json').then(function (f) {
      var items = (f.items || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });  // 같은 날은 feed.json 순서(위가 먼저)
      if (feedEl) drawFeed(feedEl, feedRows(items), parseInt(feedEl.getAttribute('data-limit') || '8', 10));
      if (cardsEl) {
        cardsEl.innerHTML = items.map(function (i) {
          var b = BADGE[i.badge] || BADGE.warn;
          return '<li class="card"><span class="date">' + esc(i.date_label || dotDate(i.date)) + '</span><h3>' + esc(i.title) + '</h3><p>' + esc(i.body) + '</p>' +
            '<div class="meta"><span class="badge ' + b[0] + '">' + b[1] + '</span><span class="src">출처: <a href="' + esc(i.url) + '" rel="noopener" target="_blank">' + esc(i.source) + '</a></span></div></li>';
        }).join('');
      }
    }).catch(function () {
      // 기사(feed.json)를 못 받아도 공식 소식·혜택은 이미 이 화면에 있다 → 그것만으로 그린다
      if (feedEl) drawFeed(feedEl, feedRows([]), parseInt(feedEl.getAttribute('data-limit') || '8', 10));
    });
  }
})();
