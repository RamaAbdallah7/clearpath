// Sensory substitution + haptics layer.
// Grounded directly in Focus Area 2 (Vision & Sensory Technology) from the
// KU hackathon page: "AI-Powered Solutions — Smart Navigation Systems,
// Haptic Feedback Systems, Sensory Substitution" — and in the challenge
// brief's own listed direction "Smart wayfinding with tactile or audio
// guidance." This turns distance-to-next-stage into sound and vibration so
// a blind or low-vision visitor never has to look at the screen.
//
// Tones use a triangle wave through a warm lowpass filter with a soft
// attack/release, rather than a bare sine "beep" — closer to a soft bell
// or marimba than an alarm clock.
(function () {
  let audioCtx = null;
  let padNodes = null;

  function ctx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) {} }
  }

  function warmTone(freq, startAt, duration, peakGain) {
    const c = ctx();
    const osc = c.createOscillator();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peakGain, startAt + duration * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(filter).connect(gain).connect(c.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  // Short, distinct tones per event type — "earcons" — so the app can
  // communicate without speech or text at all. Built from warm, gently
  // rounded triangle tones rather than sharp sine beeps.
  function earcon(type) {
    const c = ctx();
    const now = c.currentTime;
    const notes = {
      stage: [{ f: 392.0, at: 0 }, { f: 523.25, at: 0.12 }],   // soft rising chime — reached a stage
      barrier: [{ f: 349.23, at: 0 }],                          // single low, gentle note — barrier logged
      toggle: [{ f: 659.25, at: 0 }],                           // short soft tick — a mode switched
      arrive: [{ f: 392.0, at: 0 }, { f: 523.25, at: 0.13 }, { f: 659.25, at: 0.26 }]
    }[type] || [{ f: 440, at: 0 }];

    notes.forEach(n => warmTone(n.f, now + n.at, 0.32, 0.12));
  }

  // Continuous proximity beacon: chime rate increases as distance to the
  // next stage shrinks — the same principle as a parking-sensor or metal
  // detector, translating a spatial value into an audio one. Uses the same
  // warm tone as the earcons rather than a harsh sine blip.
  let beaconOn = false;
  let beaconTimer = null;

  function beaconSetDistance(meters) {
    if (!beaconOn) return;
    clearTimeout(beaconTimer);
    const clamped = Math.max(3, Math.min(meters, 80));
    const intervalMs = 220 + (clamped / 80) * 780;
    warmTone(587.33, ctx().currentTime, 0.14, 0.1);
    beaconTimer = setTimeout(() => beaconSetDistance(meters), intervalMs);
  }
  function beaconStart() { beaconOn = true; }
  function beaconStop() { beaconOn = false; clearTimeout(beaconTimer); }

  // Gentle ambient pad for the pre-visit story — two slowly detuned, softly
  // filtered sine pads, evoking calm background music under narration
  // (mirrors the "soft music" behind narration in the Little Lantern
  // storybook this feature is inspired by) without needing an audio file.
  function ambientStart() {
    if (padNodes) return;
    const c = ctx();
    const master = c.createGain();
    master.gain.setValueAtTime(0.0001, c.currentTime);
    master.gain.exponentialRampToValueAtTime(0.05, c.currentTime + 2.5);
    master.connect(c.destination);

    const freqs = [220, 277.18, 329.63]; // A3, C#4, E4 — a calm major triad pad
    const oscs = freqs.map((f, i) => {
      const osc = c.createOscillator();
      const filter = c.createBiquadFilter();
      const lfo = c.createOscillator();
      const lfoGain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      filter.type = "lowpass";
      filter.frequency.value = 900;
      lfo.frequency.value = 0.08 + i * 0.02;
      lfoGain.gain.value = 2.5;
      lfo.connect(lfoGain).connect(osc.frequency);
      osc.connect(filter).connect(master);
      osc.start();
      lfo.start();
      return { osc, lfo };
    });
    padNodes = { master, oscs };
  }

  function ambientStop() {
    if (!padNodes) return;
    const c = ctx();
    padNodes.master.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.2);
    const nodes = padNodes;
    padNodes = null;
    setTimeout(() => nodes.oscs.forEach(({ osc, lfo }) => { osc.stop(); lfo.stop(); }), 1300);
  }

  window.Sensory = { earcon, vibrate, beaconStart, beaconStop, beaconSetDistance, ambientStart, ambientStop };
})();
