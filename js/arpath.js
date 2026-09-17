// arpath.js — the route painted on the ground in the camera view.
//
// The arrow tells you which way to turn. It does not tell you where the
// path goes, and at a fork that is the question that actually matters.
// This projects the real routed polyline onto the ground plane in the live
// camera image, as a coloured ribbon you can follow with your eyes — the
// same idea as Live View, but colour-graded by how accessible each stretch
// actually is rather than by nothing at all.
//
//   green   this stretch scored well: step-free, shaded, even surface
//   yellow  passable but with a caveat — uneven paving, little shade
//   red     the profile you selected says this stretch may not suit you
//
// Geometry. For a route vertex at ground distance d and compass bearing b,
// with the phone held at height h and pointed at heading/pitch:
//
//   horizontal   relative bearing (b − heading) mapped through the camera's
//                horizontal field of view
//   vertical     the point sits below the horizon by atan(h / d), and the
//                phone's own pitch shifts the horizon up or down the frame
//
// Both are pinhole approximations with an assumed FOV, so this is honest
// guidance, not survey-grade AR. It is deliberately conservative: anything
// behind you, too far away, or resting on a stale GPS fix is not drawn at
// all, because a path line painted on the floor is trusted completely and
// a wrong one walks somebody into a flowerbed.
(function () {
  const svg = document.getElementById("arPathOverlay");
  const hint = document.getElementById("arPathHint");
  if (!svg) return;

  // Assumed rear-camera horizontal FOV. Real phones range ~60-70°.
  const HFOV_DEG = 66;
  // Phone held at chest/eye height while walking.
  const CAMERA_HEIGHT_M = 1.45;
  // Beyond this the ribbon is a pixel wide and tells you nothing.
  const MAX_DRAW_M = 90;
  // Wider than the frame edge — no point projecting what can't be seen.
  const MAX_REL_BEARING = 75;
  // Painted corridor width on the ground.
  const PATH_WIDTH_M = 1.1;
  // Re-plan only after real movement, to stay polite to the routing server.
  const REPLAN_AFTER_M = 20;

  let shape = [];           // [{lat, lng, colour}]
  let running = false;
  let pitchDeg = 0;         // + = phone tilted down toward the ground
  let lastRouteFrom = null;
  let planning = false;

  const NS = "http://www.w3.org/2000/svg";
  const toRad = d => d * Math.PI / 180;

  /* ── Colour a stretch by the accessibility of the stage it leads to ── */
  function colourFor(stage) {
    if (!stage) return "#facc15";
    const p = AppState.profile;
    const blocked =
      (p.has("mobility") && !stage.stepFree) ||
      (p.has("heat") && stage.shade === "low") ||
      (p.has("quiet") && /play|playground/i.test(stage.title + " " + stage.description));
    if (blocked) return "#ef4444";
    const score = confidenceScore(stage);
    if (score >= 75) return "#22c55e";
    if (score >= 45) return "#facc15";
    return "#ef4444";
  }

  /* ── Build the ground polyline from a routing result ───────────── */
  function setShape(points, targetStage) {
    const colour = colourFor(targetStage);
    shape = points.map(p => ({ lat: p[0], lng: p[1], colour }));
  }

  async function plan(fix) {
    if (planning) return;
    const target = JOURNEY[Math.min(AppState.currentStageIndex, JOURNEY.length - 1)];
    planning = true;
    try {
      const profile = AppState.profile.has("mobility") ? "wheelchair" : "foot";
      const result = await ClearPathRouting.routeFromLive(fix, target, { profile });
      setShape(result.shape, target);
      lastRouteFrom = { lat: fix.lat, lng: fix.lng };
      // A straight-line fallback is not a path on the ground and must never
      // be painted as though it were one.
      if (result.degraded) {
        shape = [];
        setHint("Routing unavailable — no path line drawn. Follow the arrow instead.");
      } else {
        setHint(null);
      }
    } catch (e) {
      console.warn("[arpath] planning failed", e);
      shape = [];
      setHint("Couldn't plan a path from here.");
    } finally {
      planning = false;
    }
  }

  function setHint(text) {
    if (!hint) return;
    hint.textContent = text || "";
    hint.hidden = !text;
  }

  /* ── Projection ─────────────────────────────────────────────────── */
  function project(point, fix, heading, W, H) {
    const d = Geo.distanceMeters(fix, point);
    if (d < 1.5 || d > MAX_DRAW_M) return null;

    let rel = Geo.bearingTo(fix, point) - heading;
    rel = ((rel + 540) % 360) - 180;              // normalise to −180..180
    if (Math.abs(rel) > MAX_REL_BEARING) return null;

    const hfov = toRad(HFOV_DEG);
    const vfov = hfov * (H / W);

    // Horizontal: tangent of the relative bearing across half the frame.
    const x = W / 2 + (W / 2) * (Math.tan(toRad(rel)) / Math.tan(hfov / 2));

    // Vertical: depression below the optical axis, plus the phone's pitch.
    const depression = Math.atan(CAMERA_HEIGHT_M / d) + toRad(pitchDeg);
    const t = Math.tan(depression) / Math.tan(vfov / 2);
    if (t > 3) return null;                        // far below the frame
    const y = H / 2 + (H / 2) * t;

    // On-screen half-width of a PATH_WIDTH_M corridor at this distance.
    const halfAngle = Math.atan((PATH_WIDTH_M / 2) / d);
    const halfPx = (W / 2) * (Math.tan(halfAngle) / Math.tan(hfov / 2));

    return { x, y, halfPx, d };
  }

  function clear() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function render() {
    if (!running) return;
    requestAnimationFrame(render);

    const fix = Geo.fix;
    const rect = svg.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    if (!W || !H) return;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    // Every precondition for drawing a trustworthy line.
    if (!fix || !Geo.isUsable(fix)) { clear(); setHint("Waiting for a GPS fix good enough to draw the path."); return; }
    const heading = window.ClearPathHeading && window.ClearPathHeading() ;
    if (heading == null) { clear(); setHint("No compass — turn on the manual heading slider to aim the path."); return; }
    if (!shape.length) { clear(); return; }

    // Re-plan once the visitor has genuinely moved on.
    if (!lastRouteFrom || Geo.distanceMeters(fix, lastRouteFrom) > REPLAN_AFTER_M) plan(fix);

    const pts = [];
    for (const p of shape) {
      const proj = project(p, fix, heading, W, H);
      if (proj) pts.push({ ...proj, colour: p.colour });
    }

    clear();
    if (pts.length < 2) { setHint(null); return; }
    setHint(null);

    // Draw far-to-near so nearer ribbon segments overlap the further ones,
    // which is what gives the flat polygon strip its sense of depth.
    pts.sort((a, b) => b.d - a.d);

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const poly = document.createElementNS(NS, "polygon");
      poly.setAttribute("points", [
        `${a.x - a.halfPx},${a.y}`,
        `${a.x + a.halfPx},${a.y}`,
        `${b.x + b.halfPx},${b.y}`,
        `${b.x - b.halfPx},${b.y}`
      ].join(" "));
      poly.setAttribute("fill", a.colour);
      // Fade with distance so the near path reads as solid ground paint and
      // the far path as a hint, rather than a flat sticker over everything.
      poly.setAttribute("fill-opacity", String(Math.max(0.18, 0.72 - a.d / MAX_DRAW_M * 0.5)));
      poly.setAttribute("stroke", a.colour);
      poly.setAttribute("stroke-opacity", "0.9");
      poly.setAttribute("stroke-width", "1.5");
      svg.appendChild(poly);
    }

    // Chevrons every few metres, pointing the way along the ribbon.
    for (let i = pts.length - 1; i > 0; i--) {
      const a = pts[i], b = pts[i - 1];
      if (a.d < 4 || a.d > 45) continue;
      if (Math.round(a.d) % 6 !== 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const size = Math.max(8, a.halfPx * 0.8);
      const chev = document.createElementNS(NS, "polyline");
      chev.setAttribute("points", [
        `${a.x - uy * size - ux * size},${a.y + ux * size - uy * size}`,
        `${a.x + ux * size},${a.y + uy * size}`,
        `${a.x + uy * size - ux * size},${a.y - ux * size - uy * size}`
      ].join(" "));
      chev.setAttribute("fill", "none");
      chev.setAttribute("stroke", "#ffffff");
      chev.setAttribute("stroke-opacity", "0.85");
      chev.setAttribute("stroke-width", "3");
      chev.setAttribute("stroke-linecap", "round");
      chev.setAttribute("stroke-linejoin", "round");
      svg.appendChild(chev);
    }
  }

  function onOrientation(e) {
    // beta is front-back tilt: 90 = upright, 0 = flat on its back. Held to
    // walk with, a phone sits around 60-75, i.e. tilted a little downward.
    if (e.beta != null) pitchDeg = Math.max(-40, Math.min(40, 90 - e.beta));
  }

  function start() {
    if (running) return;
    running = true;
    svg.hidden = false;
    window.addEventListener("deviceorientation", onOrientation, true);
    const fix = Geo.fix;
    if (fix && Geo.isUsable(fix)) plan(fix);
    requestAnimationFrame(render);
  }

  function stop() {
    running = false;
    svg.hidden = true;
    window.removeEventListener("deviceorientation", onOrientation, true);
    clear();
    setHint(null);
    shape = [];
    lastRouteFrom = null;
  }

  // Called when the visitor advances a stage, so the ribbon re-aims at the
  // new target immediately instead of waiting for the movement threshold.
  function retarget() {
    lastRouteFrom = null;
    const fix = Geo.fix;
    if (running && fix && Geo.isUsable(fix)) plan(fix);
  }

  window.ClearPathARPath = { start, stop, retarget, get isRunning() { return running; } };
})();
