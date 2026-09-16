(function () {
  let map, routeLine, markers = [];
  let walker = null;
  let walking = false;
  let cancelled = false;

  function init() {
    map = L.map("map").setView([PARK_ANCHOR.lat, PARK_ANCHOR.lng], 17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    draw();
  }

  function draw() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    if (routeLine) map.removeLayer(routeLine);

    const latlngs = JOURNEY.map(s => [s.lat, s.lng]);
    routeLine = L.polyline(latlngs, { color: "#1f6f54", weight: 5 }).addTo(map);

    JOURNEY.forEach((stage, idx) => {
      const score = confidenceScore(stage);
      const flagged = flaggedForProfile(stage);
      const color = flagged ? "#a8461e" : (score >= 75 ? "#1f6f54" : score >= 45 ? "#c68a00" : "#a8461e");
      const marker = L.circleMarker([stage.lat, stage.lng], {
        radius: 10,
        color,
        fillColor: color,
        fillOpacity: 0.9
      }).addTo(map);
      marker.bindPopup(
        `<strong>${stage.stage}. ${stage.title}</strong><br>${stage.description}` +
        (flagged ? `<br><em style="color:#a8461e">May not suit your selected profile</em>` : "")
      );
      markers.push(marker);
    });
  }

  function flaggedForProfile(stage) {
    const p = AppState.profile;
    if (p.has("mobility") && !stage.stepFree) return true;
    if (p.has("heat") && stage.shade === "low") return true;
    if (p.has("quiet") && stage.title.toLowerCase().includes("play")) return true;
    return false;
  }

  function ensureWalker() {
    if (walker) return walker;
    const icon = L.divIcon({ className: "walker-dot", iconSize: [22, 22], html: "" });
    walker = L.marker([JOURNEY[0].lat, JOURNEY[0].lng], { icon, zIndexOffset: 1000 });
    return walker;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function sleep(ms) {
    return new Promise((resolve) => {
      const start = performance.now();
      function check() {
        if (cancelled || performance.now() - start >= ms) return resolve();
        requestAnimationFrame(check);
      }
      check();
    });
  }

  function animateSegment(from, to, durationMs) {
    return new Promise((resolve) => {
      const start = performance.now();
      function frame(now) {
        if (cancelled) return resolve();
        const t = Math.min((now - start) / durationMs, 1);
        walker.setLatLng([lerp(from.lat, to.lat, t), lerp(from.lng, to.lng, t)]);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  function highlightStage(idx) {
    AppState.currentStageIndex = idx;
    renderStageList();
    const items = document.querySelectorAll("#stageList .stage-item");
    items[idx]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function announceStage(stage, isFirst) {
    highlightStage(stage.stage - 1);
    map.flyTo([stage.lat, stage.lng], 18, { duration: 1 });
    walker.bindTooltip(`${stage.stage}. ${stage.title}`, { permanent: true, direction: "top", offset: [0, -10] }).openTooltip();
    if (!isFirst) { Sensory.earcon("stage"); if (AppState.settings.haptics) Sensory.vibrate([60, 30, 60]); }
    speak(stage.cue);
    await sleep(2600);
  }

  async function startWalkthrough() {
    if (walking) { stopWalkthrough(); return; }
    if (!map) init();
    cancelled = false;
    walking = true;
    const btn = document.getElementById("mapWalkBtn");
    btn.textContent = "⏹ Stop walkthrough";
    ensureWalker().addTo(map);

    for (let i = 0; i < JOURNEY.length; i++) {
      if (cancelled) break;
      const stage = JOURNEY[i];
      if (i === 0) {
        walker.setLatLng([stage.lat, stage.lng]);
      } else {
        const prev = JOURNEY[i - 1];
        await animateSegment(prev, stage, 2200);
      }
      if (cancelled) break;
      await announceStage(stage, i === 0);
    }

    if (!cancelled) {
      speak("That's the full walkthrough, from parking to the park.");
      Sensory.earcon("arrive");
    }
    stopWalkthrough();
  }

  function stopWalkthrough() {
    cancelled = true;
    walking = false;
    const btn = document.getElementById("mapWalkBtn");
    if (btn) btn.textContent = "▶ Play walkthrough";
    if (walker) walker.closeTooltip();
  }

  window.ClearPathMap = {
    refresh() {
      if (!map) init();
      else draw();
      renderStageList();
    },
    startWalkthrough,
    stopWalkthrough
  };
})();
