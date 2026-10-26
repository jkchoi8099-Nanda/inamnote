/* 홈 화면 앱(PWA, 2026-10-26). 결정 로그 2026-10-16 '앱으로 바꿀까', 공개 절차 3c. 모든 쪽 <head>에 이 파일 한 줄.
   1) 오프라인 저장(sw.js)을 등록한다.
   2) 첫 화면 '홈 화면에 두기' 줄(#app-strip): 이미 앱으로 열었으면 숨긴다. 안드로이드 Chrome처럼 바로 설치 창을 띄울 수 있으면 누를 때 띄우고,
      아니면 install.html(브라우저마다 방법 안내)로 간다. 배너·팝업은 쓰지 않는다(06_Design 절대 규칙).
   3) install.html이 쓰는 환경 판별·설치 창을 window.InamApp으로 내준다. */
(function () {
  var ua = navigator.userAgent;
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var env = {
    standalone: standalone,
    ios: ios,
    android: /Android/.test(ua),
    kakao: /KAKAOTALK/i.test(ua),
    // 카카오톡 말고도 앱 안 브라우저(네이버·인스타그램·페이스북·밴드·라인)는 홈 화면 추가가 안 된다
    inapp: /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|BAND\/|Line\//i.test(ua),
    samsung: /SamsungBrowser/.test(ua),
    iosChrome: ios && /CriOS|FxiOS|EdgiOS/.test(ua)
  };
  var deferred = null;
  var listeners = [];
  function changed() { listeners.forEach(function (f) { f(); }); }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();  // 브라우저가 알아서 띄우는 띠 대신, 사람이 '홈 화면에 두기'를 누를 때 띄운다
    deferred = e;
    changed();
  });
  window.addEventListener('appinstalled', function () {
    deferred = null;
    env.installed = true;
    changed();
  });

  window.InamApp = {
    env: env,
    canPrompt: function () { return !!deferred; },
    prompt: function () {
      if (!deferred) return Promise.resolve('unavailable');
      var e = deferred;
      deferred = null;
      e.prompt();
      return e.userChoice.then(function (c) { if (c.outcome === 'accepted') env.installed = true; changed(); return c.outcome; });
    },
    onChange: function (f) { listeners.push(f); }
  };

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  function strip() {
    var el = document.getElementById('app-strip');
    if (!el) return;
    var small = el.querySelector('small');
    function paint() {
      el.hidden = env.standalone;
      if (env.installed) small.textContent = '홈 화면에 이남노트를 두었어요. 다음부터 아이콘으로 여세요.';
    }
    el.addEventListener('click', function (e) {
      if (!deferred) return;  // 바로 띄울 수 없으면 install.html로 그냥 간다
      e.preventDefault();
      window.InamApp.prompt();
    });
    window.InamApp.onChange(paint);
    paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', strip); else strip();
})();
