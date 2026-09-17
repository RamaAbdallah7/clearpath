// geo.js — the GPS core.
//
// The first version of ClearPath called watchPosition directly inside ar.js
// and auto-advanced a stage the moment the raw distance dropped under 15 m.
// Outdoors that is not safe: a phone routinely reports a 40 m fix with 40 m
// of error, so a single bad sample would announce "you have arrived" while
// the visitor is still on the road. For someone who cannot see the gate and
// is trusting the voice, a false arrival is worse than no guidance at all.
//
// So this module owns every position fix and applies, in order:
//   1. accuracy gating   — ignore fixes too vague to act on
//   2. staleness         — a fix that stopped updating is not a fix
//   3. geofencing        — enter/exit radii scaled by the reported accuracy,
//                          with hysteresis and a dwell requirement so the
//                          boundary cannot flap
//
// Everything else in the app reads position through here.
(function () {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;

  function distanceMeters(from, to) {
    const dLat = toRad(to.lat - from.lat);
    const dLng = toRad(to.lng - from.lng);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bearingTo(from, to) {
    const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
    const x = Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
      Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // ── Tuning ──────────────────────────────────────────────────────────
  // A fix worse than this is reported to the UI but never used to advance
  // a stage. 50 m is roughly "phone GPS under tree cover", which is exactly
  // the situation inside a shaded park.
  const MAX_USABLE_ACCURACY = 50;
  // Older than this and we stop claiming we know where the visitor is.
  const STALE_AFTER_MS = 15000;
  // Leaving a fence needs to be this much further out than entering it.
  // Without the gap, standing exactly on the boundary would fire
  // enter/exit/enter/exit forever.
  const EXIT_HYSTERESIS = 1.4;
  // Consecutive in-fence fixes required before an arrival is announced.
  const DWELL_FIXES = 2;

  let watchId = null;
  let lastFix = null;
  let bestAccuracySeen = Infinity;
  const fixListeners = [];
  const enterListeners = [];
  const exitListeners = [];

  // fenceState[stageId] = { inside: bool, streak: n }
  const fenceState = Object.create(null);

  function emit(list, ...args) {
    for (const fn of list) { try { fn(...args); } catch (e) { console.warn("[geo] listener failed", e); } }
  }

  // The radius we actually test against. A vague fix gets a generously
  // widened fence (you probably ARE there, we just can't prove it tightly),
  // but never tighter than the stage's own footprint.
  function effectiveRadius(stage, accuracy) {
    const base = stage.radius || 20;
    return Math.max(base, Math.min(accuracy * 0.75, base * 3));
  }

  function evaluateFences(fix) {
    if (!isUsable(fix)) return;
    for (const stage of JOURNEY) {
      const d = distanceMeters(fix, stage);
      const enterR = effectiveRadius(stage, fix.accuracy);
      const exitR = enterR * EXIT_HYSTERESIS;
      const st = fenceState[stage.id] || (fenceState[stage.id] = { inside: false, streak: 0 });

      if (!st.inside) {
        if (d <= enterR) {
          st.streak++;
          if (st.streak >= DWELL_FIXES) {
            st.inside = true;
            st.streak = 0;
            emit(enterListeners, stage, { distance: d, accuracy: fix.accuracy, radius: enterR });
          }
        } else {
          st.streak = 0;
        }
      } else if (d > exitR) {
        st.inside = false;
        st.streak = 0;
        emit(exitListeners, stage, { distance: d, accuracy: fix.accuracy, radius: exitR });
      }
    }
  }

  function isUsable(fix) {
    return !!fix && fix.accuracy <= MAX_USABLE_ACCURACY && !isStale(fix);
  }

  function isStale(fix) {
    return !fix || (Date.now() - fix.timestamp) > STALE_AFTER_MS;
  }

  function onPosition(p) {
    const fix = {
      lat: p.coords.latitude,
      lng: p.coords.longitude,
      accuracy: p.coords.accuracy ?? 9999,
      // Only trust a GPS-derived heading while actually moving; standing
      // still, the course figure is noise.
      heading: (p.coords.speed > 0.6 && p.coords.heading != null) ? p.coords.heading : null,
      speed: p.coords.speed ?? null,
      timestamp: p.timestamp || Date.now()
    };
    lastFix = fix;
    bestAccuracySeen = Math.min(bestAccuracySeen, fix.accuracy);
    evaluateFences(fix);
    emit(fixListeners, fix);
  }

  function onError(err) {
    emit(fixListeners, null, err);
  }

  function start() {
    if (watchId != null || !navigator.geolocation) return false;
    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 20000
    });
    return true;
  }

  function stop() {
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    for (const k of Object.keys(fenceState)) delete fenceState[k];
  }

  // Plain-language quality label — this is what gets read aloud, so it has
  // to be honest rather than reassuring.
  function quality(fix = lastFix) {
    if (!fix) return { level: "none", text: "Waiting for GPS" };
    if (isStale(fix)) return { level: "stale", text: "GPS signal lost" };
    if (fix.accuracy <= 10) return { level: "good", text: `GPS good (±${Math.round(fix.accuracy)} m)` };
    if (fix.accuracy <= MAX_USABLE_ACCURACY) return { level: "fair", text: `GPS fair (±${Math.round(fix.accuracy)} m)` };
    return { level: "poor", text: `GPS too weak to guide (±${Math.round(fix.accuracy)} m)` };
  }

  window.Geo = {
    start, stop,
    distanceMeters, bearingTo,
    quality, isUsable, isStale,
    get fix() { return lastFix; },
    get isRunning() { return watchId != null; },
    insideFence: (stageId) => !!(fenceState[stageId] && fenceState[stageId].inside),
    onFix: fn => fixListeners.push(fn),
    onEnter: fn => enterListeners.push(fn),
    onExit: fn => exitListeners.push(fn),
    MAX_USABLE_ACCURACY
  };
})();
