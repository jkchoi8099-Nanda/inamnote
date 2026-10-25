/* 방문 측정(GoatCounter, 2026-10-25): 쿠키·개인 식별자 없이 쪽별 방문 수만 센다. 대시보드 https://inamnote.goatcounter.com
   운영자 미리보기(Tailscale *.ts.net·이 PC·파일로 열기)는 세지 않는다. 모든 쪽 <head>에 이 파일 한 줄. */
(function () {
  var h = location.hostname;
  if (location.protocol === 'file:' || /(^|\.)ts\.net$|^localhost$|^127\.|^192\.168\./.test(h)) return;
  window.goatcounter = { endpoint: 'https://inamnote.goatcounter.com/count' };
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  document.head.appendChild(s);
})();
