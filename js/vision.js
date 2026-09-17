// vision.js — obstacle and amenity detection on the live AR camera.
//
// Ported from the MediaPipe Tasks object-detector prototype in my
// Sunrise Semester repo (detector-demo/), which was a "guess the box before
// the model does" teaching toy: EfficientDet-Lite0, a confidence slider, and
// boxes drawn on a mirrored canvas.
//
// The model and the loading strategy carry over unchanged. What changes is
// what a detection MEANS. The toy cared about accuracy; this cares about
// whether the thing in front of you is going to stop you. So every COCO
// class is mapped to one of three path meanings —
//
//   block    something parked or placed across the route
//   caution  something moving that may cross your path
//   amenity  something you actively want told about (a bench, shade)
//
// — and only detections that are ahead of you (centre of frame) and close
// (large in frame) are announced at all. A car detected small and off to the
// left is not news; a car filling the middle of the frame is.
//
// The brief lists "obstacle and confidence alerts" as a wanted direction,
// and the workshop deck is explicit that alerts must reach people in more
// than one way — so every alert is spoken, shown, earconed and vibrated.
import { ObjectDetector, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const BARRIERS = {
  // Parked / placed things that occupy the walking surface.
  car: { sev: "block", say: "a car" },
  truck: { sev: "block", say: "a truck" },
  bus: { sev: "block", say: "a bus" },
  motorcycle: { sev: "block", say: "a motorbike" },
  bicycle: { sev: "block", say: "a bicycle" },
  "potted plant": { sev: "block", say: "a planter" },
  chair: { sev: "block", say: "a chair" },
  couch: { sev: "block", say: "furniture" },
  "dining table": { sev: "block", say: "a table" },
  suitcase: { sev: "block", say: "a suitcase" },
  backpack: { sev: "block", say: "a bag on the ground" },
  "fire hydrant": { sev: "block", say: "a hydrant" },
  "stop sign": { sev: "block", say: "a sign post" },
  "parking meter": { sev: "block", say: "a post" },

  // Moving things. Lower urgency, because they move out of the way —
  // but a visitor who cannot see them still wants to know they are there.
  person: { sev: "caution", say: "someone" },
  dog: { sev: "caution", say: "a dog" },
  cat: { sev: "caution", say: "a cat" },
  bird: { sev: "caution", say: "a bird" },
  skateboard: { sev: "caution", say: "a skateboard" },
  "sports ball": { sev: "caution", say: "a ball" },

  // Not obstacles at all — the two things this park's visitors are most
  // often looking for. Reporting these is the whole "confidence" half.
  bench: { sev: "amenity", say: "a bench you could rest on" },
  umbrella: { sev: "amenity", say: "shade" }
};

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

// Only the middle of the frame counts as "ahead of you".
const CENTRE_MIN = 0.22, CENTRE_MAX = 0.78;
// Fraction of frame height a box must fill before we call it close enough
// to matter. Tuned so a person at roughly 3-4 m trips it.
const NEAR_HEIGHT = 0.34;
const MID_HEIGHT = 0.18;
// Per-class silence after an announcement, so the app does not chant
// "someone ahead" once a second at a busy gate.
const CLASS_COOLDOWN_MS = 7000;
const GLOBAL_COOLDOWN_MS = 2600;

let detector = null;
let running = false;
let threshold = 0.45;
let lastVideoTime = -1;
let lastGlobalSay = 0;
const lastSaid = Object.create(null);
let video = null, canvas = null, ctx = null;
let statusCb = null;
let detectionCount = 0;

function setStatus(text, kind) {
  if (statusCb) statusCb(text, kind);
}

async function load() {
  if (detector) return true;
  try {
    setStatus("Loading obstacle model…", "loading");
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    detector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      // Load wide and filter in JS, so the on-screen sensitivity slider
      // works live without reloading the model — same trick as the original.
      scoreThreshold: 0.02,
      maxResults: 25
    });
    setStatus("Obstacle detection ready", "ready");
    return true;
  } catch (e) {
    console.warn("[vision] model failed to load:", e);
    setStatus("Obstacle model unavailable (needs internet on first load)", "error");
    return false;
  }
}

// Where in the frame, and how close. Returns null for things we should
// stay quiet about.
function assess(det, frameW, frameH) {
  const cat = det.categories && det.categories[0];
  if (!cat) return null;
  const meaning = BARRIERS[cat.categoryName];
  if (!meaning) return null;
  if (cat.score < threshold) return null;

  const b = det.boundingBox;
  const centreX = (b.originX + b.width / 2) / frameW;
  const heightFrac = b.height / frameH;

  const ahead = centreX >= CENTRE_MIN && centreX <= CENTRE_MAX;
  if (!ahead) return null;
  if (heightFrac < MID_HEIGHT) return null;

  const near = heightFrac >= NEAR_HEIGHT;
  // Left/right/ahead, phrased from the walker's point of view.
  const side = centreX < 0.42 ? "on your left" : centreX > 0.58 ? "on your right" : "straight ahead";

  return {
    name: cat.categoryName,
    score: cat.score,
    meaning,
    near,
    side,
    box: b
  };
}

function phrase(hit) {
  const { meaning, side, near } = hit;
  if (meaning.sev === "amenity") return `There's ${meaning.say} ${side}.`;
  if (meaning.sev === "block") {
    return near
      ? `Careful — ${meaning.say} blocking the path ${side}.`
      : `${meaning.say.charAt(0).toUpperCase() + meaning.say.slice(1)} ${side}.`;
  }
  return `${meaning.say.charAt(0).toUpperCase() + meaning.say.slice(1)} ${side}.`;
}

function announce(hit) {
  const now = Date.now();
  if (now - lastGlobalSay < GLOBAL_COOLDOWN_MS) return;
  if (now - (lastSaid[hit.name] || 0) < CLASS_COOLDOWN_MS) return;
  lastSaid[hit.name] = now;
  lastGlobalSay = now;

  const text = phrase(hit);
  speak(text);
  // Distinct non-speech signal per severity, so the alert lands even with
  // the phone in a pocket or the visitor not using speech at all.
  if (hit.meaning.sev === "block") {
    Sensory.earcon("barrier");
    if (AppState.settings.haptics) Sensory.vibrate([120, 60, 120]);
  } else if (hit.meaning.sev === "amenity") {
    Sensory.earcon("toggle");
    if (AppState.settings.haptics) Sensory.vibrate(30);
  } else {
    Sensory.earcon("toggle");
    if (AppState.settings.haptics) Sensory.vibrate(60);
  }
  detectionCount++;
  window.dispatchEvent(new CustomEvent("clearpath:obstacle", { detail: { ...hit, text } }));
}

const COLOURS = { block: "#e4572e", caution: "#c68a00", amenity: "#1f6f54" };

function draw(hits, frameW, frameH) {
  if (!ctx) return;
  if (canvas.width !== frameW || canvas.height !== frameH) {
    canvas.width = frameW;
    canvas.height = frameH;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = Math.max(3, canvas.width / 240);
  ctx.font = `${Math.max(15, canvas.width / 38)}px -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "top";

  for (const hit of hits) {
    const colour = COLOURS[hit.meaning.sev] || "#1f6f54";
    const b = hit.box;
    ctx.strokeStyle = colour;
    ctx.strokeRect(b.originX, b.originY, b.width, b.height);

    const label = `${hit.name} ${(hit.score * 100).toFixed(0)}%`;
    const padX = 8;
    const fh = Math.max(22, canvas.width / 26);
    const tw = ctx.measureText(label).width + padX * 2;
    ctx.fillStyle = colour;
    ctx.fillRect(b.originX, Math.max(0, b.originY - fh), tw, fh);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, b.originX + padX, Math.max(0, b.originY - fh) + fh * 0.18);
  }
}

function loop() {
  if (!running) return;
  if (video && video.readyState >= 2 && detector) {
    const w = video.videoWidth, h = video.videoHeight;
    if (w && h && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      try {
        const res = detector.detectForVideo(video, performance.now());
        const hits = (res.detections || [])
          .map(d => assess(d, w, h))
          .filter(Boolean)
          // Most urgent first: blocking beats moving beats amenity, and
          // within that, closer (bigger) beats further.
          .sort((a, b) => {
            const rank = { block: 0, caution: 1, amenity: 2 };
            return (rank[a.meaning.sev] - rank[b.meaning.sev]) || (b.box.height - a.box.height);
          });
        draw(hits, w, h);
        if (hits.length) announce(hits[0]);
      } catch (e) {
        console.warn("[vision] detect failed", e);
      }
    }
  }
  requestAnimationFrame(loop);
}

async function start(videoEl, canvasEl, onStatus) {
  video = videoEl;
  canvas = canvasEl;
  ctx = canvas ? canvas.getContext("2d") : null;
  statusCb = onStatus || null;
  const ok = await load();
  if (!ok) return false;
  running = true;
  lastVideoTime = -1;
  setStatus("Watching the path ahead", "live");
  requestAnimationFrame(loop);
  return true;
}

function stop() {
  running = false;
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  setStatus("Obstacle detection off", "idle");
}

window.ClearPathVision = {
  start,
  stop,
  preload: load,
  get isRunning() { return running; },
  get count() { return detectionCount; },
  setThreshold(v) { threshold = Math.max(0.05, Math.min(0.9, Number(v) || 0.45)); },
  getThreshold: () => threshold,
  // Exposed so the UI can explain what the app is actually looking for
  // rather than presenting the model as a black box.
  classes: BARRIERS
};
window.dispatchEvent(new Event("clearpath:vision-ready"));
