(function () {
  let map, routeLine, straightLine, markers = [], placeMarkers = [], liveMarker = null, liveAccuracy = null;
  let walker = null;
  let walking = false;
  let cancelled = false;
  let routeLoaded = false;
  let liveRouteLine = null;
  let fittedBounds = null;

  function init() {
    map = L.map("map").setView([PARK_ANCHOR.lat, PARK_ANCHOR.lng], 17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    draw();
    loadRoute();
    loadPlaces();
    describeAnchor();
  }

  /* ── Stage markers ───────────────────────────────────────────────── */
  function draw() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    // A dashed straight line between stages, drawn UNDER the real route.
    // It is deliberately visible: the gap between the two is the whole
    // point — the direct line is what a naive app would tell you to walk,
    // and the real route is what the paths actually allow.
    if (straightLine) map.removeLayer(straightLine);
    straightLine = L.polyline(JOURNEY.map(s => [s.lat, s.lng]), {
      color: "#94a3b8", weight: 2, dashArray: "5,7", opacity: 0.8
    }).addTo(map);

    JOURNEY.forEach((stage) => {
      const score = confidenceScore(stage);
      const flagged = flaggedForProfile(stage);
      const color = flagged ? "#a8461e" : (score >= 75 ? "#1f6f54" : score >= 45 ? "#c68a00" : "#a8461e");
      const marker = L.circleMarker([stage.lat, stage.lng], {
        radius: 10, color, fillColor: color, fillOpacity: 0.9
      }).addTo(map);

      const breakdown = confidenceBreakdown(stage)
        .map(b => `${b.label} ${b.earned}/${b.max}`).join(" · ");

      marker.bindPopup(
        `<strong>${stage.stage}. ${stage.title}</strong><br>${stage.description}` +
        `<br><small style="color:#64748b">OSM: ${stage.osm}</small>` +
        `<br><small>Confidence ${score}% — ${breakdown}</small>` +
        (flagged ? `<br><em style="color:#a8461e">May not suit your selected profile</em>` : "")
      );
      markers.push(marker);
    });
  }

  /* ── Real pedestrian route ───────────────────────────────────────── */
  async function loadRoute() {
    const summary = document.getElementById("routeSummary");
    const provider = document.getElementById("routeProvider");
    try {
      const profile = AppState.profile.has("mobility") ? "wheelchair" : "foot";
      const result = await ClearPathRouting.routeJourney({ profile });

      if (routeLine) map.removeLayer(routeLine);
      routeLine = L.polyline(result.shape, {
        color: result.degraded ? "#a8461e" : "#1f6f54",
        weight: 6,
        opacity: 0.95,
        dashArray: result.degraded ? "10,8" : null
      }).addTo(map);
      routeLine.bringToBack();
      fittedBounds = routeLine.getBounds();
      fitRoute();
      routeLoaded = true;

      document.getElementById("routeDistance").textContent = result.distance + " m";
      document.getElementById("routeDuration").textContent = Math.round(result.duration / 60) + " min";
      provider.textContent = result.degraded
        ? "⚠ straight-line estimate — routing engine unreachable"
        : "routed on mapped footpaths · " + result.provider;
      provider.className = "route-provider" + (result.degraded ? " degraded" : "");
      summary.hidden = false;
    } catch (e) {
      console.warn("[map] route failed", e);
      provider.textContent = "Routing unavailable";
      summary.hidden = false;
    }
  }

  /* ── Nearby accessible facilities ────────────────────────────────── */
  async function loadPlaces() {
    const list = document.getElementById("placesList");
    list.innerHTML = `<li class="places-empty">Loading nearby features…</li>`;
    try {
      const places = await ClearPathPlaces.nearby();
      placeMarkers.forEach(m => map.removeLayer(m));
      placeMarkers = [];

      if (!places.length) {
        list.innerHTML = `<li class="places-empty">No mapped features found nearby.</li>`;
        return;
      }

      list.innerHTML = "";
      places.slice(0, 12).forEach(p => {
        const li = document.createElement("li");
        li.className = "place-item wc-" + (p.wheelchair || "unknown");
        li.innerHTML =
          `<span class="place-icon" aria-hidden="true">${p.icon}</span>` +
          `<span class="place-body"><strong>${p.label}</strong>` +
          `<span class="place-note">${p.note}</span></span>` +
          `<span class="place-dist">${p.distance} m</span>`;
        list.appendChild(li);

        const m = L.circleMarker([p.lat, p.lng], {
          radius: 6,
          color: p.wheelchair === "yes" ? "#1f6f54" : p.wheelchair === "no" ? "#a8461e" : "#64748b",
          fillOpacity: 0.85, weight: 2
        }).addTo(map);
        m.bindPopup(`<strong>${p.icon} ${p.label}</strong><br>${p.note}<br><small>${p.distance} m from the GIS anchor</small>`);
        placeMarkers.push(m);
      });
    } catch (e) {
      console.warn("[map] places failed", e);
      list.innerHTML = `<li class="places-empty">Couldn't reach OpenStreetMap just now — the five stages above still work offline.</li>`;
    }
  }

  async function describeAnchor() {
    const el = document.getElementById("mapWhere");
    const place = await ClearPathPlaces.describeLocation(PARK_ANCHOR.lat, PARK_ANCHOR.lng);
    el.textContent = place
      ? `Anchor ${PARK_ANCHOR.lat}, ${PARK_ANCHOR.lng} — ${place.short} (${place.full})`
      : `Anchor ${PARK_ANCHOR.lat}, ${PARK_ANCHOR.lng}`;
  }

  /* ── Route from the visitor's real position ──────────────────────── */
  function showLiveFix(fix) {
    const ll = [fix.lat, fix.lng];
    if (!liveMarker) {
      liveMarker = L.circleMarker(ll, { radius: 8, color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 1, weight: 3 }).addTo(map);
      // The accuracy circle is not decoration: it shows the visitor how
      // much the app actually knows, which is the difference between
      // "you're at the gate" and "you're somewhere near the gate".
      liveAccuracy = L.circle(ll, { radius: fix.accuracy, color: "#3b82f6", fillOpacity: 0.08, weight: 1 }).addTo(map);
    } else {
      liveMarker.setLatLng(ll);
      liveAccuracy.setLatLng(ll).setRadius(fix.accuracy);
    }
    liveMarker.bindTooltip(`You are here (±${Math.round(fix.accuracy)} m)`, { direction: "top", offset: [0, -8] });
  }

  async function locateMe() {
    const btn = document.getElementById("mapLocateBtn");
    btn.disabled = true;
    btn.textContent = "📍 Locating…";
    announce("Finding your position.");

    if (!Geo.isRunning && !Geo.start()) {
      toast("Geolocation isn't available in this browser");
      btn.disabled = false; btn.textContent = "📍 Route from where I am";
      return;
    }

    // Wait for the first fix good enough to route from, rather than routing
    // from whatever noise arrives first.
    const fix = await new Promise(resolve => {
      const timeout = setTimeout(() => resolve(Geo.fix), 15000);
      Geo.onFix(f => {
        if (f && Geo.isUsable(f)) { clearTimeout(timeout); resolve(f); }
      });
    });

    btn.disabled = false;
    btn.textContent = "📍 Route from where I am";

    if (!fix) {
      toast("Couldn't get a position — check location permission");
      return;
    }
    showLiveFix(fix);

    if (!Geo.isUsable(fix)) {
      toast(`Position too vague to route from (±${Math.round(fix.accuracy)} m)`);
      speak("I can see roughly where you are, but not accurately enough to guide you yet.");
      return;
    }

    const target = JOURNEY[AppState.currentStageIndex] || JOURNEY[0];
    try {
      const profile = AppState.profile.has("mobility") ? "wheelchair" : "foot";
      const result = await ClearPathRouting.routeFromLive(fix, target, { profile });
      if (liveRouteLine) map.removeLayer(liveRouteLine);
      liveRouteLine = L.polyline(result.shape, { color: "#3b82f6", weight: 5, opacity: 0.9, dashArray: "2,8" }).addTo(map);
      map.fitBounds(liveRouteLine.getBounds(), { padding: [40, 40] });

      const first = result.legs[0] && result.legs[0].maneuvers[0];
      const line = `${result.distance} metres to ${target.title}, about ${Math.round(result.duration / 60)} minutes. ` +
        (first && first.spoken ? first.spoken : "");
      speak(line);
      toast(`${result.distance} m to ${target.title}`);
    } catch (e) {
      console.warn("[map] live route failed", e);
      const d = Math.round(Geo.distanceMeters(fix, target));
      speak(`You are about ${d} metres from ${target.title}, but I couldn't reach the routing service to plan a path.`);
    }
  }

  // Leaflet measures its container when the map is created. This screen is
  // display:none until the Map tab is opened, so without this the map is
  // built at the wrong size and every fitBounds is computed against a stale
  // viewport — which put the routed line off-screen entirely.
  function fitRoute() {
    if (!map) return;
    map.invalidateSize({ animate: false });
    if (fittedBounds && fittedBounds.isValid()) {
      map.fitBounds(fittedBounds, { padding: [30, 30], animate: false });
    }
  }

  function flaggedForProfile(stage) {
    const p = AppState.profile;
    if (p.has("mobility") && !stage.stepFree) return true;
    if (p.has("heat") && stage.shade === "low") return true;
    if (p.has("quiet") && /play|playground/i.test(stage.title + " " + stage.description)) return true;
    return false;
  }

  /* ── Walkthrough animation ───────────────────────────────────────── */
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

  // Walk the real routed shape between two stages where we have one, so the
  // dot follows the paths instead of gliding over flowerbeds.
  function shapeBetween(fromIdx, toIdx) {
    if (!routeLine) return null;
    const pts = routeLine.getLatLngs();
    if (!pts || pts.length < 2) return null;
    const nearest = (stage) => {
      let best = 0, bestD = Infinity;
      pts.forEach((p, i) => {
        const d = Geo.distanceMeters({ lat: p.lat, lng: p.lng }, stage);
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    };
    const a = nearest(JOURNEY[fromIdx]), b = nearest(JOURNEY[toIdx]);
    if (b <= a) return null;
    return pts.slice(a, b + 1);
  }

  function animateAlong(points, durationMs) {
    return new Promise((resolve) => {
      const start = performance.now();
      function frame(now) {
        if (cancelled) return resolve();
        const t = Math.min((now - start) / durationMs, 1);
        const pos = t * (points.length - 1);
        const i = Math.floor(pos);
        const f = pos - i;
        const p0 = points[i], p1 = points[Math.min(i + 1, points.length - 1)];
        walker.setLatLng([lerp(p0.lat, p1.lat, f), lerp(p0.lng, p1.lng, f)]);
        if (t < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  function animateSegment(from, to, durationMs) {
    return animateAlong([{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }], durationMs);
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
    await ClearPathAI.speakStage(stage);
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
        const shape = routeLoaded ? shapeBetween(i - 1, i) : null;
        if (shape && shape.length > 1) await animateAlong(shape, 3000);
        else await animateSegment(JOURNEY[i - 1], stage, 2200);
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

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("mapLocateBtn").addEventListener("click", locateMe);
    document.getElementById("placesRefresh").addEventListener("click", () => {
      ClearPathPlaces.clearCache();
      loadPlaces();
    });
  });

  window.ClearPathMap = {
    refresh() {
      if (!map) {
        init();
      } else {
        draw();
        loadRoute();
        // Re-measure on every visit: the container may have changed size
        // while the screen was hidden (rotation, text scaling, contrast).
        fitRoute();
      }
      renderStageList();
    },
    startWalkthrough,
    stopWalkthrough,
    showLiveFix: (fix) => { if (map) showLiveFix(fix); },
    // Exposed for debugging and for the console commands in the README.
    get map() { return map; },
    get routeBounds() { return fittedBounds; }
  };
})();
