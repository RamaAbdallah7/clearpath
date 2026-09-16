// Sensory substitution + haptics layer.
// Grounded directly in Focus Area 2 (Vision & Sensory Technology) from the
// KU hackathon page: "AI-Powered Solutions — Smart Navigation Systems,
// Haptic Feedback Systems, Sensory Substitution" — and in the challenge
// brief's own listed direction "Smart wayfinding with tactile or audio
// guidance." This turns distance-to-next-stage into sound and vibration so
// a blind or low-vision visitor never has to look at the screen.
(function () {
  let audioCtx = null;
  let oscillator = null;
  let gainNode = null;
  let beaconTimer = null;
  let beaconOn = false;

  function ctx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) {} }
  }

  // Short, distinct tones per event type — "earcons" — so the app can
  // communicate without speech or text at all.
  function earcon(type) {
    const c = ctx();
    const now = c.currentTime;
    const notes = {
      stage: [523.25, 659.25],   // rising two-note chime — reached a stage
      barrier: [392],            // single low click — barrier logged
      toggle: [880],             // short high tick — a mode switched
      arrive: [523.25, 659.25, 783.99]
    }[type] || [440];

    notes.forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, now + i * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.18);
      osc.connect(gain).connect(c.destination);
      osc.start(now + i * 0.11);
      osc.stop(now + i * 0.11 + 0.2);
    });
  }

  // Continuous proximity beacon: beep rate increases as distance to the
  // next stage shrinks — the same principle as a parking-sensor or metal
  // detector, translating a spatial value into an audio one.
  function beaconSetDistance(meters) {
    if (!beaconOn) return;
    clearTimeout(beaconTimer);
    const clamped = Math.max(3, Math.min(meters, 80));
    const intervalMs = 180 + (clamped / 80) * 820; // ~180ms close, ~1000ms far
    playBeep();
    beaconTimer = setTimeout(() => beaconSetDistance(meters), intervalMs);
  }

  function playBeep() {
    const c = ctx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, c.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.09);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.1);
  }

  function beaconStart() { beaconOn = true; }
  function beaconStop() { beaconOn = false; clearTimeout(beaconTimer); }

  window.Sensory = { earcon, vibrate, beaconStart, beaconStop, beaconSetDistance };
})();
