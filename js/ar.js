(function () {
  let stream = null;
  let watchId = null;
  let currentPos = null;
  let currentHeading = null;
  let simMode = false;
  let simHeading = 0;
  let lastAnnouncedStage = -1;

  const video = document.getElementById("arVideo");
  const arrow = document.getElementById("arArrow");
  const status = document.getElementById("arStatus");
  const banner = document.getElementById("arBanner");
  const startBtn = document.getElementById("arStart");
  const stopBtn = document.getElementById("arStop");
  const simSlider = document.getElementById("simBearing");

  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }

  function bearingTo(from, to) {
    const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
    const x = Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
      Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function distanceMeters(from, to) {
    const R = 6371000;
    const dLat = toRad(to.lat - from.lat);
    const dLng = toRad(to.lng - from.lng);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function nextIncompleteStage() {
    return JOURNEY[Math.min(AppState.currentStageIndex, JOURNEY.length - 1)];
  }

  function update() {
    const target = nextIncompleteStage();
    const pos = currentPos || { lat: PARK_ANCHOR.lat - 0.0009, lng: PARK_ANCHOR.lng - 0.0007 };
    const heading = simMode ? simHeading : (currentHeading ?? 0);

    const bearing = bearingTo(pos, { lat: target.lat, lng: target.lng });
    const dist = Math.round(distanceMeters(pos, { lat: target.lat, lng: target.lng }));
    const relative = ((bearing - heading) + 360) % 360;

    arrow.style.transform = `rotate(${relative}deg)`;
    banner.textContent = `Stage ${target.stage}/${JOURNEY.length}: ${target.title} — about ${dist}m ahead. ${target.cue}`;
    status.textContent = simMode
      ? `Simulated heading ${Math.round(heading)}°`
      : (currentPos ? `GPS locked · heading ${Math.round(heading)}°` : "Waiting for GPS...");

    if (dist < 15 && lastAnnouncedStage !== AppState.currentStageIndex) {
      lastAnnouncedStage = AppState.currentStageIndex;
      speak(target.cue);
      if (AppState.currentStageIndex < JOURNEY.length - 1) {
        AppState.currentStageIndex++;
      }
      renderStageList();
    }
  }

  function onOrientation(e) {
    let heading = e.webkitCompassHeading;
    if (heading === undefined) {
      heading = e.alpha != null ? (360 - e.alpha) % 360 : null;
    }
    if (heading != null) currentHeading = heading;
  }

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      video.srcObject = stream;
    } catch (err) {
      status.textContent = "Camera unavailable (" + err.message + ") — showing simulator only.";
      simMode = true;
    }

    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
      try { await DeviceOrientationEvent.requestPermission(); } catch (_) {}
    }
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (p) => { currentPos = { lat: p.coords.latitude, lng: p.coords.longitude }; },
        () => { simMode = true; },
        { enableHighAccuracy: true, maximumAge: 2000 }
      );
    } else {
      simMode = true;
    }

    startBtn.disabled = true;
    stopBtn.disabled = false;
    speak(`Starting navigation. ${nextIncompleteStage().cue}`);
    tick();
  }

  let tickHandle;
  function tick() {
    update();
    tickHandle = requestAnimationFrame(tick);
  }

  function stop() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (watchId) navigator.geolocation.clearWatch(watchId);
    window.removeEventListener("deviceorientationabsolute", onOrientation, true);
    window.removeEventListener("deviceorientation", onOrientation, true);
    cancelAnimationFrame(tickHandle);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    status.textContent = "Camera not started";
    banner.textContent = "Start the camera to begin navigation.";
  }

  simSlider.addEventListener("input", (e) => {
    simMode = true;
    simHeading = Number(e.target.value);
    update();
  });

  startBtn.addEventListener("click", start);
  stopBtn.addEventListener("click", stop);

  window.ClearPathAR = { start, stop };
})();
