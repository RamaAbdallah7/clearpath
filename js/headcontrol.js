// Hands-free head-tilt + blink control.
// Adapted from the head-tracking + blink-to-click approach in
// https://github.com/RamaAbdallah7/SWE-headAndVoice (Python/MediaPipe/pyautogui, OS-level cursor)
// reworked to run fully client-side in the browser: instead of moving the OS
// cursor, head-tilt moves focus across the app's own nav tabs and blink
// "clicks" the focused tab — the same head+blink interaction model, scoped
// to what a web page can control.
(function () {
  const video = document.getElementById("headVideo");
  const toggleBtn = document.getElementById("headToggle");
  let camera = null;
  let faceMesh = null;
  let running = false;
  let focusIndex = 0;
  let lastMoveTime = 0;
  let blinkClosed = false;
  let lastBlinkTime = 0;

  function tabs() { return Array.from(document.querySelectorAll("#tabbar button")); }

  function setFocus(idx) {
    const btns = tabs();
    btns.forEach(b => b.classList.remove("head-focus"));
    focusIndex = ((idx % btns.length) + btns.length) % btns.length;
    btns[focusIndex].classList.add("head-focus");
    btns[focusIndex].scrollIntoView({ inline: "center", behavior: "smooth", block: "nearest" });
  }

  function selectFocused() {
    const btns = tabs();
    const btn = btns[focusIndex];
    if (!btn) return;
    btn.click();
    speak(btn.textContent + " selected");
  }

  function onResults(results) {
    if (!results.multiFaceLandmarks || !results.multiFaceLandmarks.length) return;
    const lm = results.multiFaceLandmarks[0];
    const nose = lm[1];
    const leftEye = lm[33];
    const rightEye = lm[263];
    const midX = (leftEye.x + rightEye.x) / 2;
    const offset = nose.x - midX;
    const now = Date.now();

    if (Math.abs(offset) > 0.018 && now - lastMoveTime > 900) {
      lastMoveTime = now;
      setFocus(focusIndex + (offset > 0 ? -1 : 1));
    }

    const upper = lm[159], lower = lm[145];
    const eyeGap = Math.abs(upper.y - lower.y);
    if (eyeGap < 0.010) {
      if (!blinkClosed && now - lastBlinkTime > 1200) {
        blinkClosed = true;
        lastBlinkTime = now;
        selectFocused();
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
    await camera.start();

    running = true;
    setFocus(0);
    toggleBtn.textContent = "🛑 Stop head control";
    speak("Head control on. Tilt your head to move, blink to select.");
  }

  function stop() {
    running = false;
    if (camera) camera.stop();
    tabs().forEach(b => b.classList.remove("head-focus"));
    toggleBtn.textContent = "👤 Start head control";
  }

  toggleBtn.addEventListener("click", () => running ? stop() : start());
})();
