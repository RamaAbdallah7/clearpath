(function () {
  let stream = null;
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

  // Bearing and distance now live in geo.js, so the map, the AR arrow and
  // the geofence engine all measure with exactly the same maths.
  const bearingTo = (from, to) => Geo.bearingTo(from, to);
  const distanceMeters = (from, to) => Geo.distanceMeters(from, to);

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
    const stage = currentTarget();
    const fix = Geo.fix;
    // Hand the cue writer everything we actually know right now, so a
    // personalised cue can mention the real distance and the real GPS
    // quality instead of being a generic rewrite of the written line.
    ClearPathAI.speakStage(stage, {
      distance: fix && Geo.isUsable(fix) ? Math.round(distanceMeters(fix, stage)) : null,
      gpsQuality: Geo.quality().text
    });
    if (AppState.settings.haptics) Sensory.vibrate([70, 40, 70]);
    if (AppState.currentStageIndex < JOURNEY.length - 1) {
      Sensory.earcon("stage");
      AppState.currentStageIndex++;
      renderStageList();
      renderProgress();
      if (window.ClearPathARPath) ClearPathARPath.retarget();
    } else {
      Sensory.earcon("arrive");
      if (AppState.settings.haptics) Sensory.vibrate([100, 60, 100, 60, 180]);
      if (finalMessage) setTimeout(finalMessage, 300);
    }
  }

  /* ── GPS honesty panel ──
     Says out loud how much the app actually knows. A visitor who cannot see
     the gate is trusting this voice completely, so "GPS too weak to guide"
     has to be sayable. */
  function renderGpsPanel() {
    const q = Geo.quality();
    const dot = document.getElementById("gpsDot");
    const label = document.getElementById("gpsQuality");
    const detail = document.getElementById("gpsDetail");
    if (!dot) return;
    dot.dataset.level = q.level;
    label.textContent = q.text;

    const fix = Geo.fix;
    if (!fix) {
      detail.textContent = "Live mode uses real satellite positioning. Stages only advance on a fix accurate enough to trust.";
    } else if (q.level === "poor" || q.level === "stale") {
      detail.textContent = `Holding position at stage ${currentTarget().stage}. I won't announce an arrival on a fix this vague — use the manual heading slider, or ask someone nearby.`;
    } else {
      const d = Math.round(distanceMeters(fix, currentTarget()));
      detail.textContent = `${d} m to ${currentTarget().title}. Arrival announces inside ${Math.round(currentTarget().radius)} m.`;
    }
  }

  function update() {
    const target = currentTarget();
    let pos, heading, bearing, dist;

    if (mode === "live") {
      // No invented fallback position. The old code substituted a point ~80 m
      // south-west of stage 1 whenever GPS was missing, which produced a
      // confident arrow and a specific distance out of nothing at all — the
      // single most dangerous thing this screen could do to someone who
      // can't see the gate and is trusting it.
      pos = currentPos;
      heading = manualHeading != null ? manualHeading : (currentHeading ?? 0);
      bearing = pos ? bearingTo(pos, { lat: target.lat, lng: target.lng }) : null;
      dist = pos ? Math.round(distanceMeters(pos, { lat: target.lat, lng: target.lng })) : null;
    } else if (mode === "classroom") {
      heading = currentHeading != null ? currentHeading : (manualHeading ?? 0);
      bearing = CLASSROOM_TARGET_BEARINGS[AppState.currentStageIndex] ?? 0;
      dist = null;
    } else {
      return;
    }

    // With no bearing there is nothing honest to point at, so the arrow is
    // hidden rather than left pointing somewhere arbitrary.
    const relative = bearing != null ? ((bearing - heading) + 360) % 360 : null;
    arrow.style.opacity = relative == null ? "0.25" : "1";
    if (relative != null) arrow.style.transform = `rotate(${relative}deg)`;
    banner.textContent = `Stage ${target.stage}/${JOURNEY.length}: ${target.title} — ${target.cue}`;

    if (mode === "live") {
      const q = Geo.quality();
      distanceEl.textContent = dist != null ? `${dist} m ahead` : "distance unknown";
      status.textContent = currentPos
        ? `${q.text} · heading ${Math.round(heading)}°`
        : "Waiting for GPS — use manual heading below";
      // The beacon translates distance into chime rate. Feeding it a
      // distance derived from an untrustworthy fix would make it lie in a
      // channel the visitor can't sanity-check, so it only runs on a fix
      // we'd act on.
      if (AppState.settings.beacon && Geo.isUsable(Geo.fix)) Sensory.beaconSetDistance(dist);
      // Stage advancement is NOT decided here any more — geo.js fires
      // onEnter once a fence is genuinely satisfied. See startLive().
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

  // Wired once, not per-start, so repeated Live sessions don't stack
  // duplicate listeners and announce every arrival twice.
  let geoWired = false;
  function wireGeo() {
    if (geoWired) return;
    geoWired = true;

    Geo.onFix((fix) => {
      if (fix) { currentPos = { lat: fix.lat, lng: fix.lng }; if (fix.heading != null) currentHeading = fix.heading; }
      renderGpsPanel();
      if (window.ClearPathMap) ClearPathMap.showLiveFix(fix || Geo.fix);
    });

    // The geofence has already applied accuracy gating, hysteresis and a
    // dwell requirement by the time this fires, so an arrival here is one
    // we're willing to say out loud.
    Geo.onEnter((stage) => {
      if (mode !== "live") return;
      if (stage.stage - 1 !== AppState.currentStageIndex) return;
      if (lastAnnouncedStage === AppState.currentStageIndex) return;
      lastAnnouncedStage = AppState.currentStageIndex;
      advanceStage(() => {
        speak("That's the full route. You've arrived.");
        stopAll();
      });
    });
  }

  async function startLive() {
    stopAll(true);
    video.hidden = false;
    await startCamera("environment");
    await requestOrientation();

    wireGeo();
    if (!Geo.start() && !Geo.isRunning) {
      status.textContent = "Geolocation unavailable — try the Simulated Trip or Classroom demo.";
    }

    mode = "live";
    lastAnnouncedStage = -1;
    setBadge("Live", "live");
    setButtons({ start: true, classroom: true, trip: true, stop: false });
    renderProgress();
    renderGpsPanel();
    ClearPathAI.speakStage(currentTarget(), { gpsQuality: Geo.quality().text });
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
    Geo.stop();
    if (window.ClearPathVision && ClearPathVision.isRunning) ClearPathVision.stop();
    if (window.ClearPathARPath && ClearPathARPath.isRunning) ClearPathARPath.stop();
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

  /* ── Obstacle detection ─────────────────────────────────────────────
     Opt-in, because it downloads a model and runs it on every frame. It
     only makes sense over a live camera, so the toggle says so rather than
     silently doing nothing during the Simulated Trip. */
  const visionToggle = document.getElementById("visionToggle");
  const visionControls = document.getElementById("visionControls");
  const visionStatus = document.getElementById("visionStatus");
  const visionThreshold = document.getElementById("visionThreshold");
  const visionThresholdVal = document.getElementById("visionThresholdVal");
  const visionCanvas = document.getElementById("arVisionCanvas");
  const obstacleLog = document.getElementById("obstacleLog");
  const obstacleLogList = document.getElementById("obstacleLogList");

  function setVisionStatus(text, kind) {
    visionStatus.textContent = text;
    visionStatus.dataset.kind = kind || "idle";
  }

  visionToggle.addEventListener("change", async (e) => {
    const on = e.target.checked;
    visionControls.hidden = !on;
    if (!on) {
      if (window.ClearPathVision) ClearPathVision.stop();
      visionCanvas.hidden = true;
      return;
    }
    if (!window.ClearPathVision) {
      setVisionStatus("Detector still loading — try again in a moment", "error");
      return;
    }
    if (mode !== "live" && mode !== "classroom") {
      setVisionStatus("Start Live or Classroom first — this needs the camera", "error");
      speak("Obstacle alerts need the camera. Start Live or the Classroom demo first.");
      return;
    }
    visionCanvas.hidden = false;
    obstacleLog.hidden = false;
    ClearPathVision.setThreshold(visionThreshold.value);
    await ClearPathVision.start(video, visionCanvas, setVisionStatus);
  });

  /* ── Ground path line ──
     Needs a live camera AND a trustworthy GPS fix AND a heading. If any of
     the three is missing, arpath.js draws nothing and says why, rather
     than painting a line somebody would follow into a flowerbed. */
  const pathToggle = document.getElementById("pathToggle");
  const pathLegend = document.getElementById("arPathLegend");
  pathToggle.addEventListener("change", (e) => {
    const on = e.target.checked;
    pathLegend.hidden = !on;
    if (!on) { ClearPathARPath.stop(); return; }
    if (mode !== "live") {
      speak("The path line needs Live mode, so it can see where you really are.");
      toast("Start Live (GPS) first");
      e.target.checked = false;
      pathLegend.hidden = true;
      return;
    }
    ClearPathARPath.start();
  });

  visionThreshold.addEventListener("input", (e) => {
    visionThresholdVal.textContent = Number(e.target.value).toFixed(2);
    if (window.ClearPathVision) ClearPathVision.setThreshold(e.target.value);
  });

  // A running visual record of what was announced. Deaf and hard-of-hearing
  // visitors get the same alerts the speech channel carries — the workshop
  // deck is explicit that an audio-only alert is itself a barrier.
  window.addEventListener("clearpath:obstacle", (e) => {
    const li = document.createElement("li");
    li.className = "obstacle-" + e.detail.meaning.sev;
    li.innerHTML = `<span class="obstacle-time">${new Date().toLocaleTimeString()}</span> ${e.detail.text}`;
    obstacleLogList.prepend(li);
    while (obstacleLogList.children.length > 8) obstacleLogList.lastChild.remove();
  });

  renderProgress();
  // arpath.js needs whatever heading we actually have: the real compass if
  // the device has one, otherwise the manual slider. Returns null rather
  // than 0 when we have neither, so the path overlay can refuse to draw
  // instead of confidently painting a line pointing due north.
  window.ClearPathHeading = function () {
    if (orientationSupported && currentHeading != null) return currentHeading;
    if (manualHeading != null) return manualHeading;
    return null;
  };

  window.ClearPathAR = {
    startLive, startDemo: startTrip, startTrip, startClassroom,
    stop: () => stopAll(),
    get mode() { return mode; }
  };
})();
