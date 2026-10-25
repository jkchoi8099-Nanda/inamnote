/* 내 위치 — 네이버 지도를 쓰는 페이지(map.html·bus.html)가 같이 쓴다.
   사용자 10-15 "운전하면서 지도 열어보니까 지도마다 내위치가 필요하겠더라".
   - 처음 누를 때만 위치 권한을 묻는다. 잡히면 파란 점과 정확도 원.
   - 누른 뒤에는 지도가 나를 따라간다(운전·걷기). 손으로 지도를 끌면 따라가기를 멈추고, 다시 누르면 다시 따라간다.
   - 버튼 모양: 꺼짐(흰색) / 따라가는 중(초록 채움) / 점만 보이고 안 따라감(흰색 + 초록 글자 '◉').
   addLocate(map, 버튼, { zoom, onFix(lat, lng), onMsg(문구) }) */
window.addLocate = (map, btn, { zoom = 15, onFix, onMsg } = {}) => {
  const N = naver.maps;
  let dot = null, ring = null, here = null, follow = false, watching = false;
  const say = m => onMsg && onMsg(m);
  const paint = () => {
    btn.setAttribute("aria-pressed", String(follow));
    btn.textContent = follow ? "◎ 따라가는 중" : here ? "◉ 내 위치" : "◎ 내 위치";
  };
  // 손으로 지도를 끌면 그만 따라간다(지도를 둘러보는 중이다)
  N.Event.addListener(map, "dragstart", () => { if (follow) { follow = false; paint(); } });
  // 목록에서 가게·버스를 눌러 지도가 그쪽으로 옮겨 가도 그만 따라간다(안 그러면 다음 위치가 올 때 내 쪽으로 끌려 온다)
  N.Event.addListener(map, "idle", () => {
    if (!follow || !here) return;
    const pr = map.getProjection(), a = pr.fromCoordToOffset(map.getCenter()), b = pr.fromCoordToOffset(here);
    if (Math.hypot(a.x - b.x, a.y - b.y) > 60) { follow = false; paint(); }
  });
  btn.addEventListener("click", () => {
    if (here) {
      follow = true; paint();
      map.setCenter(here); if (map.getZoom() < zoom) map.setZoom(zoom);
      return;
    }
    if (watching) return;
    if (!navigator.geolocation) { say("이 브라우저는 위치를 지원하지 않아요."); return; }
    watching = true; follow = true; paint(); say("위치를 찾는 중…");
    const id = navigator.geolocation.watchPosition(pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      const first = !here;
      here = new N.LatLng(lat, lng);
      if (!dot) {
        ring = new N.Circle({ map, center: here, radius: accuracy, fillColor: "#2F6FDE", fillOpacity: .08, strokeColor: "#2F6FDE", strokeWeight: 1, clickable: false });
        dot = new N.Marker({ map, position: here, zIndex: 1000, clickable: false, icon: { content: '<div class="me"></div>', anchor: new N.Point(9, 9) } });
      } else { dot.setPosition(here); ring.setCenter(here); ring.setRadius(accuracy); }
      if (first) { map.setCenter(here); if (map.getZoom() < zoom) map.setZoom(zoom); say(""); }
      else if (follow) map.panTo(here);
      paint();
      onFix && onFix(lat, lng);
    }, err => {
      if (here && err.code !== 1) return;  // 한 번 잡힌 뒤 잠깐 못 받은 것(터널 등)은 점을 그대로 두고 계속 기다린다
      navigator.geolocation.clearWatch(id);
      watching = false; follow = false; paint();
      say(err.code === 1 ? "위치 권한이 꺼져 있어요. 휴대폰 설정에서 브라우저의 위치 접근을 허용해 주세요."
                         : "위치를 찾지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  });
  paint();
};
