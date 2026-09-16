(function () {
  let stream = null;
  let watchId = null;
  let currentPos = null;
  let currentHeading = null;
  let mode = "idle"; // idle | live | classroom | trip
  let lastAnnouncedStage = -1;
  let tickHandle = null;
  let manualHeading = null;
  let orientationSupported = false;
  let tripCancelled = true;

  const video = document.getElementById("arVideo");
  const arrow = document.getElementById("arArrow");
  const status = document.getElementById("arStatus");
  const distanceEl = document.getElementById("arDistance");
  const banner = document.getElementById("arBanner");
  const badge = document.getElementById("arModeBadge");
  const progress = document.getElementById("arProgress");
  const startBtn = document.getElementById("arStart");
  const tripBtn = document.getElementById("arDemo");
  const classroomBtn = document.getElementById("arClassroom");
  const classroomNextBtn = document.getElementById("arClassroomNext");
  const stopBtn = document.getElementById("arStop");
  const simSlider = document.getElementById("simBearing");
  const glassToggle = document.getElementById("glassHudToggle");
  const photoA = document.getElementById("arTripPhotoA");
  const photoB = document.getElementById("arTripPhotoB");

  // Simulated compass bearings for each stage, used only in Classroom Demo
  // mode where there's no real GPS to compute a real bearing from. Spread
  // around the full circle so a presenter turning around the room sees the
  // arrow sweep through a realistic range.
  const CLASSROOM_TARGET_BEARINGS = [35, 120, 205, 265, 330];

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

  function advanceStage(finalMessage) {
    speak(currentTarget().cue);
    if (AppState.settings.haptics) Sensory.vibrate([70, 40, 70]);
    if (AppState.currentStageIndex < JOURNEY.length - 1) {
      Sensory.earcon("stage");
      AppState.currentStageIndex++;
      renderStageList();
      renderProgress();
    } else {
      Sensory.earcon("arrive");
      if (AppState.settings.haptics) Sensory.vibrate([100, 60, 100, 60, 180]);
      if (finalMessage) setTimeout(finalMessage, 300);
    }
  }

  function update() {
    const target = currentTarget();
    let pos, heading, bearing, dist;

    if (mode === "live") {
      pos = currentPos || { lat: JOURNEY[0].lat - 0.0006, lng: JOURNEY[0].lng - 0.0005 };
      heading = manualHeading != null ? manualHeading : (currentHeading ?? 0);
      bearing = bearingTo(pos, { lat: target.lat, lng: target.lng });
      dist = Math.round(distanceMeters(pos, { lat: target.lat, lng: target.lng }));
    } else if (mode === "classroom") {
      heading = currentHeading != null ? currentHeading : (manualHeading ?? 0);
      bearing = CLASSROOM_TARGET_BEARINGS[AppState.currentStageIndex] ?? 0;
      dist = null;
    } else {
      return;
    }

    const relative = ((bearing - heading) + 360) % 360;
    arrow.style.transform = `rotate(${relative}deg)`;
    banner.textContent = `Stage ${target.stage}/${JOURNEY.length}: ${target.title} — ${target.cue}`;

    if (mode === "live") {
      distanceEl.textContent = `${dist} m ahead`;
      status.textContent = currentPos ? `GPS locked · heading ${Math.round(heading)}°` : "Waiting for GPS — use manual heading below";
      if (AppState.settings.beacon) Sensory.beaconSetDistance(dist);
      if (dist < 15 && lastAnnouncedStage !== AppState.currentStageIndex) {
        lastAnnouncedStage = AppState.currentStageIndex;
        advanceStage(null);
      }
    } else if (mode === "classroom") {
      const off = Math.round(Math.min(relative, 360 - relative));
      distanceEl.textContent = off < 15 ? "Facing it!" : `${off}° to turn`;
      status.textContent = orientationSupported
        ? `Classroom demo · real compass ${Math.round(heading)}°`
        : "No compass detected · drag manual heading below";
    }
  }

  function loop() {
    update();
    if (mode === "live" || mode === "classroom") tickHandle = requestAnimationFrame(loop);
  }

  function onOrientation(e) {
    let heading = e.webkitCompassHeading;
    if (heading === undefined) heading = e.alpha != null ? (360 - e.alpha) % 360 : null;
    if (heading != null) { currentHeading = heading; orientationSupported = true; }
  }

  async function requestOrientation() {
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
      try { await DeviceOrientationEvent.requestPermission(); } catch (_) {}
    }
    orientationSupported = false;
    currentHeading = null;
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);
  }

  async function startCamera(facingMode) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
      video.srcObject = stream;
      return true;
    } catch (err) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;
        return true;
      } catch (err2) {
        status.textContent = "Camera unavailable — try the Simulated Trip instead.";
        return false;
      }
    }
  }

  async function startLive() {
    stopAll(true);
    video.hidden = false;
    await startCamera("environment");
    await requestOrientation();

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (p) => { currentPos = { lat: p.coords.latitude, lng: p.coords.longitude }; },
        () => {},
        { enableHighAccuracy: true, maximumAge: 2000 }
      );
    }

    mode = "live";
    setBadge("Live", "live");
    setButtons({ start: true, classroom: true, trip: true, stop: false });
    renderProgress();
    speak(`Starting navigation. ${currentTarget().cue}`);
    loop();
  }

  async function startClassroom() {
    stopAll(true);
    AppState.currentStageIndex = 0;
    lastAnnouncedStage = -1;
    video.hidden = false;
    await startCamera("environment");
    await requestOrientation();

    mode = "classroom";
    setBadge("Classroom", "classroom");
    setButtons({ start: true, classroom: true, trip: true, stop: false });
    classroomNextBtn.hidden = false;
    renderStageList();
    renderProgress();
    speak("Classroom demo ready. Turn around slowly — the arrow tracks a simulated target using your real compass. Tap advance to move through the stages.");
    loop();
  }

  function tripSleep(ms) {
    return new Promise((resolve) => {
      const start = performance.now();
      function check() {
        if (tripCancelled || performance.now() - start >= ms) return resolve();
        requestAnimationFrame(check);
      }
      check();
    });
  }

  // Simulated Trip: a narrated cinematic sequence through the real site
  // photos (Ken Burns pan/zoom, crossfade), not a live arrow overlay.
  // Needs no camera/GPS/compass, so it always looks the same and always
  // works, indoors or out — the reliable "what it will look like" demo.
  async function startTrip() {
    stopAll(true);
    tripCancelled = false;
    AppState.currentStageIndex = 0;
    video.hidden = true;
    mode = "trip";
    setBadge("Simulated Trip", "demo");
    setButtons({ start: true, classroom: true, trip: true, stop: false });
    status.textContent = "Simulated Trip · narrated walkthrough";
    arrow.style.transform = "rotate(0deg)";
    renderStageList();
    renderProgress();
    speak("Here's what the trip from parking to Al Jahili Park looks like.");
    await tripSleep(1400);

    let useA = true;
    for (let i = 0; i < JOURNEY.length && !tripCancelled; i++) {
      const stage = JOURNEY[i];
      AppState.currentStageIndex = i;
      renderStageList();
      renderProgress();

      const showEl = useA ? photoA : photoB;
      const hideEl = useA ? photoB : photoA;
      useA = !useA;

      showEl.src = stage.photo;
      showEl.classList.remove("kb-a", "kb-b");
      void showEl.offsetWidth; // restart CSS animation
      showEl.classList.add(i % 2 === 0 ? "kb-a" : "kb-b");
      showEl.hidden = false;
      requestAnimationFrame(() => showEl.classList.add("visible"));
      hideEl.classList.remove("visible");

      distanceEl.textContent = `${stage.stage} of ${JOURNEY.length}`;
      banner.textContent = `Stage ${stage.stage}/${JOURNEY.length}: ${stage.title} — ${stage.cue}`;
      speak(stage.cue);
      if (i > 0) { Sensory.earcon("stage"); if (AppState.settings.haptics) Sensory.vibrate([60, 30, 60]); }

      await tripSleep(4200);
    }

    if (!tripCancelled) {
      Sensory.earcon("arrive");
      if (AppState.settings.haptics) Sensory.vibrate([100, 60, 100, 60, 180]);
      speak("That's the full trip — from parking, all the way to the park.");
      await tripSleep(2200);
    }
    stopAll();
  }

  function classroomAdvance() {
    if (mode !== "classroom") return;
    advanceStage(() => {
      speak("That's the full route. At the real park this arrow would now be pointing at the entrance.");
      stopAll();
    });
  }

  function stopSensors() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    window.removeEventListener("deviceorientationabsolute", onOrientation, true);
    window.removeEventListener("deviceorientation", onOrientation, true);
    Sensory.beaconStop();
  }

  function stopAll(silent) {
    stopSensors();
    cancelAnimationFrame(tickHandle);
    tripCancelled = true;
    mode = "idle";
    if (!silent) resetUI();
  }

  function setButtons({ start, classroom, trip, stop }) {
    startBtn.disabled = start;
    classroomBtn.disabled = classroom;
    tripBtn.disabled = trip;
    stopBtn.disabled = stop;
  }

  function resetUI() {
    setBadge("Idle");
    setButtons({ start: false, classroom: false, trip: false, stop: true });
    classroomNextBtn.hidden = true;
    video.hidden = false;
    photoA.hidden = true; photoA.classList.remove("visible");
    photoB.hidden = true; photoB.classList.remove("visible");
    status.textContent = "Camera not started";
    distanceEl.textContent = "—";
    banner.textContent = "Play the Simulated Trip, try Classroom demo, or go Live at the park.";
    arrow.style.transform = "rotate(0deg)";
  }

  simSlider.addEventListener("input", (e) => {
    manualHeading = Number(e.target.value);
    if (mode === "live" || mode === "classroom") update();
  });

  glassToggle.addEventListener("change", (e) => {
    document.getElementById("arWrap").classList.toggle("glass-hud", e.target.checked);
    Sensory.earcon("toggle");
  });

  startBtn.addEventListener("click", startLive);
  classroomBtn.addEventListener("click", startClassroom);
  tripBtn.addEventListener("click", startTrip);
  classroomNextBtn.addEventListener("click", classroomAdvance);
  stopBtn.addEventListener("click", () => stopAll());

  renderProgress();
  window.ClearPathAR = { startLive, startDemo: startTrip, startTrip, startClassroom, stop: () => stopAll() };
})();
