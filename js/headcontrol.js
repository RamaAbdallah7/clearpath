// Hands-free virtual cursor: moves a real on-screen pointer and clicks
// whatever DOM element is under it — not a fixed menu of items to cycle
// through. Adapted from the head-tracking + blink-to-click approach in
// https://github.com/RamaAbdallah7/SWE-headAndVoice (Python/MediaPipe/pyautogui,
// which moved the actual OS cursor via pyautogui.moveTo). A web page can't
// take over the OS pointer, so this drives an in-page cursor instead and
// clicks through document.elementFromPoint — the closest browser-side
// equivalent to real hands-free mouse control.
(function () {
  const video = document.getElementById("headVideo");
  const toggleBtn = document.getElementById("headToggle");
  const cursor = document.getElementById("headCursor");
  const previewDot = document.getElementById("headDot");
  const coordsEl = document.getElementById("headCoords");

  let camera = null;
  let faceMesh = null;
  let running = false;

  // Auto-calibrated center: first ~15 frames establish where "looking
  // straight ahead" sits, so the cursor doesn't start pinned to a corner.
  let calibrating = true;
  let calibSamples = [];
  let centerX = 0.5, centerY = 0.5;

  // Exponential smoothing to stop the cursor jittering frame to frame.
  let smoothX = 0.5, smoothY = 0.5;
  const SMOOTHING = 0.25;
  const SENSITIVITY = 3.2; // how far a small head turn moves the cursor across the viewport

  let blinkClosed = false;
  let lastBlinkTime = 0;
  let lastClickTarget = null;

  const CLICKABLE_SELECTOR = "button, a, input, select, textarea, [role='button'], .leaflet-marker-icon, path.leaflet-interactive";

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function updateCursorPosition(nx, ny) {
    const x = nx * window.innerWidth;
    const y = ny * window.innerHeight;
    cursor.style.left = x + "px";
    cursor.style.top = y + "px";

    const el = document.elementFromPoint(x, y);
    const target = el ? el.closest(CLICKABLE_SELECTOR) : null;
    cursor.classList.toggle("over-target", !!target);
    lastClickTarget = target;

    const label = target ? (target.getAttribute("aria-label") || target.textContent.trim().slice(0, 28) || target.tagName) : "—";
    coordsEl.textContent = `cursor: (${Math.round(x)}, ${Math.round(y)})${target ? " over “" + label + "”" : ""}`;

    previewDot.hidden = false;
    previewDot.style.left = (nx * 100) + "%";
    previewDot.style.top = (ny * 100) + "%";
  }

  function clickAtCursor() {
    if (!lastClickTarget) return;
    cursor.classList.add("clicking");
    setTimeout(() => cursor.classList.remove("clicking"), 220);
    lastClickTarget.click();
    speak((lastClickTarget.getAttribute("aria-label") || lastClickTarget.textContent.trim() || "Item") + " selected");
  }

  function onResults(results) {
    if (!results.multiFaceLandmarks || !results.multiFaceLandmarks.length) return;
    const lm = results.multiFaceLandmarks[0];
    const nose = lm[1];

    if (calibrating) {
      calibSamples.push({ x: nose.x, y: nose.y });
      if (calibSamples.length >= 15) {
        centerX = calibSamples.reduce((s, p) => s + p.x, 0) / calibSamples.length;
        centerY = calibSamples.reduce((s, p) => s + p.y, 0) / calibSamples.length;
        calibrating = false;
        speak("Calibrated. Move your head to steer the cursor.");
      }
      return;
    }

    const dx = (nose.x - centerX) * SENSITIVITY;
    const dy = (nose.y - centerY) * SENSITIVITY;

    // Mirror horizontally so tilting your head to your own right moves the
    // cursor right on screen (matches the mirrored preview video).
    const targetX = clamp(0.5 - dx, 0, 1);
    const targetY = clamp(0.5 + dy, 0, 1);

    smoothX += (targetX - smoothX) * SMOOTHING;
    smoothY += (targetY - smoothY) * SMOOTHING;
    updateCursorPosition(smoothX, smoothY);

    const upper = lm[159], lower = lm[145];
    const eyeGap = Math.abs(upper.y - lower.y);
    const now = Date.now();
    if (eyeGap < 0.010) {
      if (!blinkClosed && now - lastBlinkTime > 900) {
        blinkClosed = true;
        lastBlinkTime = now;
        clickAtCursor();
      }
    } else {
      blinkClosed = false;
    }
  }

  async function start() {
    if (typeof FaceMesh === "undefined" || typeof Camera === "undefined") {
      announce("Head-control library failed to load — check your internet connection.");
      return;
    }
    faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });
    faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    faceMesh.onResults(onResults);

    camera = new Camera(video, {
      onFrame: async () => { await faceMesh.send({ image: video }); },
      width: 320,
      height: 240
    });

    try {
      await camera.start();
    } catch (err) {
      announce("Camera unavailable for head control: " + err.message);
      return;
    }

    running = true;
    calibrating = true;
    calibSamples = [];
    cursor.hidden = false;
    toggleBtn.textContent = "Stop head cursor";
    speak("Hold still for a moment to calibrate.");
  }

  function stop() {
    running = false;
    if (camera) camera.stop();
    cursor.hidden = true;
    previewDot.hidden = true;
    coordsEl.textContent = "cursor: —";
    toggleBtn.textContent = "Start head cursor";
  }

  toggleBtn.addEventListener("click", () => running ? stop() : start());
})();
