(function () {
  let stream = null;
  let watchId = null;
  let currentPos = null;
  let currentHeading = null;
  let mode = "idle"; // idle | live | demo
  let demoT = 0; // 0..1 progress across the whole route
  let lastAnnouncedStage = -1;
  let tickHandle = null;
  let manualHeading = null;

  const video = document.getElementById("arVideo");
  const arrow = document.getElementById("arArrow");
  const status = document.getElementById("arStatus");
  const distanceEl = document.getElementById("arDistance");
  const banner = document.getElementById("arBanner");
  const badge = document.getElementById("arModeBadge");
  const progress = document.getElementById("arProgress");
  const startBtn = document.getElementById("arStart");
  const demoBtn = document.getElementById("arDemo");
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

  function lerp(a, b, t) { return a + (b - a) * t; }

  function currentTarget() {
    return JOURNEY[Math.min(AppState.currentStageIndex, JOURNEY.length - 1)];
  }

  function renderProgress() {
    progress.innerHTML = "";
    JOURNEY.forEach((_, idx) => {
      const dot = document.createElement("span");
      dot.className = "dot" + (idx < AppState.currentStageIndex ? " done" : idx === AppState.currentStageIndex ? " active" : "");
      progress.appendChild(dot);
    });
  }

  function setBadge(text, cls) {
    badge.textContent = text;
    badge.className = "mode-badge" + (cls ? " " + cls : "");
  }

  function demoPosition() {
    // Walk a straight line from just before stage 0 through all stages, looping.
    const startPos = { lat: JOURNEY[0].lat - 0.0004, lng: JOURNEY[0].lng - 0.00035 };
    const points = [startPos, ...JOURNEY.map(s => ({ lat: s.lat, lng: s.lng }))];
    const segCount = points.length - 1;
    const scaled = demoT * segCount;
    const segIdx = Math.min(Math.floor(scaled), segCount - 1);
    const segT = scaled - segIdx;
    const a = points[segIdx], b = points[segIdx + 1];
    return { lat: lerp(a.lat, b.lat, segT), lng: lerp(a.lng, b.lng, segT) };
  }

  function update() {
    const target = currentTarget();
    let pos, heading;

    if (mode === "demo") {
      pos = demoPosition();
      heading = bearingTo(pos, { lat: target.lat, lng: target.lng });
    } else if (mode === "live") {
      pos = currentPos || { lat: JOURNEY[0].lat - 0.0006, lng: JOURNEY[0].lng - 0.0005 };
      heading = manualHeading != null ? manualHeading : (currentHeading ?? 0);
    } else {
      return;
    }

    const bearing = bearingTo(pos, { lat: target.lat, lng: target.lng });
    const dist = Math.round(distanceMeters(pos, { lat: target.lat, lng: target.lng }));
    const relative = ((bearing - heading) + 360) % 360;

    arrow.style.transform = `rotate(${relative}deg)`;
    distanceEl.textContent = `${dist} m ahead`;
    banner.textContent = `Stage ${target.stage}/${JOURNEY.length}: ${target.title} — ${target.cue}`;

    if (mode === "demo") {
      status.textContent = `Auto-demo · heading ${Math.round(heading)}°`;
    } else {
      status.textContent = currentPos ? `GPS locked · heading ${Math.round(heading)}°` : "Waiting for GPS — use manual heading below";
    }

    if (AppState.settings.beacon) Sensory.beaconSetDistance(dist);

    if (dist < 15 && lastAnnouncedStage !== AppState.currentStageIndex) {
      lastAnnouncedStage = AppState.currentStageIndex;
      speak(target.cue);
      if (AppState.settings.haptics) Sensory.vibrate([70, 40, 70]);
      if (AppState.currentStageIndex < JOURNEY.length - 1) {
        Sensory.earcon("stage");
        AppState.currentStageIndex++;
        renderStageList();
        renderProgress();
      } else {
        Sensory.earcon("arrive");
        if (AppState.settings.haptics) Sensory.vibrate([100, 60, 100, 60, 180]);
        if (mode === "demo") {
          setTimeout(() => { speak("Demo complete. You've arrived at the park."); stopDemo(); }, 300);
        }
      }
    }
  }

  function loop() {
    update();
    if (mode !== "idle") tickHandle = requestAnimationFrame(loop);
  }

  function onOrientation(e) {
    let heading = e.webkitCompassHeading;
    if (heading === undefined) heading = e.alpha != null ? (360 - e.alpha) % 360 : null;
    if (heading != null) currentHeading = heading;
  }

  async function startLive() {
    stopDemo(true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      video.srcObject = stream;
    } catch (err) {
      status.textContent = "Camera unavailable — try the auto-demo instead.";
    }

    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
      try { await DeviceOrientationEvent.requestPermission(); } catch (_) {}
    }
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (p) => { currentPos = { lat: p.coords.latitude, lng: p.coords.longitude }; },
        () => {},
        { enableHighAccuracy: true, maximumAge: 2000 }
      );
    }

    mode = "live";
    setBadge("Live", "live");
    startBtn.disabled = true;
    stopBtn.disabled = false;
    demoBtn.disabled = true;
    renderProgress();
    speak(`Starting navigation. ${currentTarget().cue}`);
    loop();
  }

  function startDemo() {
    stopLive(true);
    AppState.currentStageIndex = 0;
    lastAnnouncedStage = -1;
    demoT = 0;
    mode = "demo";
    setBadge("Auto-demo", "demo");
    startBtn.disabled = true;
    demoBtn.disabled = true;
    stopBtn.disabled = false;
    renderStageList();
    renderProgress();
    speak("Running the auto-demo walkthrough.");

    const durationMs = 16000;
    const t0 = performance.now();
    function step(now) {
      if (mode !== "demo") return;
      demoT = Math.min((now - t0) / durationMs, 1);
      update();
      if (demoT < 1) tickHandle = requestAnimationFrame(step);
    }
    tickHandle = requestAnimationFrame(step);
  }

  function stopLive(silent) {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    window.removeEventListener("deviceorientationabsolute", onOrientation, true);
    window.removeEventListener("deviceorientation", onOrientation, true);
    if (mode === "live") mode = "idle";
    if (!silent) resetUI();
  }

  function stopDemo(silent) {
    if (mode === "demo") mode = "idle";
    if (!silent) resetUI();
  }

  function resetUI() {
    cancelAnimationFrame(tickHandle);
    Sensory.beaconStop();
    mode = "idle";
    setBadge("Idle");
    startBtn.disabled = false;
    demoBtn.disabled = false;
    stopBtn.disabled = true;
    status.textContent = "Camera not started";
    distanceEl.textContent = "—";
    banner.textContent = "Start the camera or run the demo to begin navigation.";
    arrow.style.transform = "rotate(0deg)";
  }

  simSlider.addEventListener("input", (e) => {
    manualHeading = Number(e.target.value);
    if (mode === "live") update();
  });

  startBtn.addEventListener("click", startLive);
  demoBtn.addEventListener("click", startDemo);
  stopBtn.addEventListener("click", () => { stopLive(); stopDemo(); resetUI(); });

  renderProgress();
  window.ClearPathAR = { startLive, startDemo, stop: () => { stopLive(); stopDemo(); resetUI(); } };
})();
