const AppState = {
  screen: "home",
  profile: new Set(),
  currentStageIndex: 0,
  contrast: false,
  isArabic: false,
  textScale: 1,
  settings: { beacon: false, haptics: true, audioFirst: false, aiCues: false }
};

function announce(text) {
  const el = document.getElementById("announcer");
  el.textContent = "";
  requestAnimationFrame(() => { el.textContent = text; });
}

function pickVoice(lang) {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const localeMatch = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
  const pool = localeMatch.length ? localeMatch : voices;
  const warm = pool.find(v => /female|samantha|jenny|aria|libby|zira/i.test(v.name));
  return warm || pool[0];
}

let captionTimer = null;
function showCaption(text) {
  const bar = document.getElementById("captionBar");
  const label = document.getElementById("captionText");
  if (!bar || !text) return;
  label.textContent = text;
  bar.hidden = false;
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => { bar.hidden = true; }, Math.max(2500, text.length * 90));
}

// warmth: undefined = brisk nav-cue voice, "calm" = slower, gentler,
// storybook-style narration (mirrors the soft narrated tone from the
// Little Lantern storybook project)
function speak(text, warmth) {
  showCaption(text);
  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  const lang = AppState.isArabic ? "ar-AE" : "en-US";
  utter.lang = lang;
  const voice = pickVoice(lang);
  if (voice) utter.voice = voice;
  if (warmth === "calm") { utter.rate = 0.82; utter.pitch = 1.05; }
  else { utter.rate = 0.95; utter.pitch = 1.0; }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}
// Chrome loads voices asynchronously; warm the list so pickVoice has data.
if ("speechSynthesis" in window) { window.speechSynthesis.onvoiceschanged = () => {}; window.speechSynthesis.getVoices(); }

function goToScreen(name, opts = {}) {
  if (name !== "journey" && window.ClearPathMap) window.ClearPathMap.stopWalkthrough();
  if (name !== "story" && window.Sensory) Sensory.ambientStop();
  const screens = document.querySelectorAll(".screen");
  screens.forEach(s => s.classList.toggle("active", s.id === "screen-" + name));
  document.querySelectorAll("#tabbar button").forEach(b => {
    b.setAttribute("aria-selected", b.dataset.screen === name ? "true" : "false");
  });
  AppState.screen = name;
  window.scrollTo(0, 0);
  if (!opts.silent) announce(`${name} screen`);
  if (name === "journey" && window.ClearPathMap) window.ClearPathMap.refresh();
}

function setContrast(on) {
  AppState.contrast = on;
  document.body.dataset.contrast = on ? "high" : "normal";
  document.getElementById("contrastToggle").setAttribute("aria-pressed", String(on));
  document.getElementById("contrastSwitch").setAttribute("aria-checked", String(on));
}

const AR_LABELS = {
  Home: "الرئيسية", Map: "الخريطة", AR: "الواقع المعزز",
  Visit: "زيارة", Story: "القصة", Report: "الإبلاغ", "Hands-Free": "بدون لمس"
};
function setLanguage(arabic) {
  AppState.isArabic = arabic;
  document.documentElement.lang = arabic ? "ar" : "en";
  document.documentElement.dir = arabic ? "rtl" : "ltr";
  document.querySelectorAll("#tabbar button span").forEach(span => {
    if (!span.dataset.en) span.dataset.en = span.textContent;
    span.textContent = arabic ? (AR_LABELS[span.dataset.en] || span.dataset.en) : span.dataset.en;
  });
}

function setTextScale(scale) {
  AppState.textScale = Math.max(0.85, Math.min(1.4, scale));
  document.documentElement.style.fontSize = (16 * AppState.textScale) + "px";
  document.getElementById("textSizeLabel").textContent = Math.round(AppState.textScale * 100) + "%";
}

function setDyslexia(on) {
  document.body.classList.toggle("dyslexia-friendly", on);
  document.getElementById("dyslexiaToggle").setAttribute("aria-checked", String(on));
}

function setSwitch(btn, on) { btn.setAttribute("aria-checked", String(on)); }

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("#tabbar button").forEach(btn => {
    btn.addEventListener("click", () => goToScreen(btn.dataset.screen));
  });
  document.querySelectorAll("[data-goto]").forEach(btn => {
    btn.addEventListener("click", () => goToScreen(btn.dataset.goto));
  });

  document.querySelectorAll(".profile-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.profile;
      const pressed = btn.getAttribute("aria-pressed") === "true";
      btn.setAttribute("aria-pressed", String(!pressed));
      if (pressed) AppState.profile.delete(key); else AppState.profile.add(key);
      if (window.ClearPathMap) window.ClearPathMap.refresh();
      toast(`Profile updated: ${AppState.profile.size ? [...AppState.profile].join(", ") : "none selected"}`);
    });
  });

  document.getElementById("contrastToggle").addEventListener("click", () => setContrast(!AppState.contrast));
  document.getElementById("contrastSwitch").addEventListener("click", () => setContrast(!AppState.contrast));

  document.getElementById("langToggle").addEventListener("click", () => setLanguage(!AppState.isArabic));
  document.getElementById("langToggleSettings").addEventListener("click", () => setLanguage(!AppState.isArabic));

  document.getElementById("textSizeUp").addEventListener("click", () => setTextScale(AppState.textScale + 0.1));
  document.getElementById("textSizeDown").addEventListener("click", () => setTextScale(AppState.textScale - 0.1));

  document.getElementById("dyslexiaToggle").addEventListener("click", (e) => {
    setDyslexia(e.currentTarget.getAttribute("aria-checked") !== "true");
  });

  document.getElementById("beaconToggle").addEventListener("click", (e) => {
    const on = e.currentTarget.getAttribute("aria-checked") !== "true";
    AppState.settings.beacon = on;
    setSwitch(e.currentTarget, on);
    if (on) { Sensory.beaconStart(); Sensory.earcon("toggle"); toast("Proximity beacon on"); }
    else { Sensory.beaconStop(); toast("Proximity beacon off"); }
  });

  document.getElementById("hapticsToggle").addEventListener("click", (e) => {
    const on = e.currentTarget.getAttribute("aria-checked") !== "true";
    AppState.settings.haptics = on;
    setSwitch(e.currentTarget, on);
    if (on) Sensory.vibrate(40);
    toast(on ? "Haptic pulses on" : "Haptic pulses off");
  });

  // Personalised cues. The status line tells the truth about whether the
  // proxy is actually reachable, so nobody demos this believing it is on
  // when it has been silently falling back to the written text all along.
  const aiStatusEl = document.getElementById("aiStatus");
  document.getElementById("aiToggle").addEventListener("click", async (e) => {
    const on = e.currentTarget.getAttribute("aria-checked") !== "true";
    AppState.settings.aiCues = on;
    setSwitch(e.currentTarget, on);
    ClearPathAI.setEnabled(on);
    if (!on) { aiStatusEl.textContent = "off"; aiStatusEl.dataset.state = "off"; return; }
    aiStatusEl.textContent = "checking…";
    aiStatusEl.dataset.state = "checking";
    const ok = await ClearPathAI.probe();
    aiStatusEl.textContent = ok ? "proxy connected" : "proxy not running — using written cues";
    aiStatusEl.dataset.state = ok ? "ok" : "fallback";
    toast(ok ? "Personalised cues on" : "Proxy not running — written cues will be used");
  });

  const audioFirst = document.getElementById("audioFirstToggle");
  audioFirst.addEventListener("change", (e) => {
    AppState.settings.audioFirst = e.target.checked;
    document.getElementById("arWrap").classList.toggle("audio-first", e.target.checked);
    if (e.target.checked) {
      AppState.settings.beacon = true;
      setSwitch(document.getElementById("beaconToggle"), true);
      Sensory.beaconStart();
      Sensory.earcon("toggle");
      speak("Audio-first mode on. Listen for the proximity beeps and feel for vibration.");
    } else {
      speak("Audio-first mode off.");
    }
  });

  document.getElementById("mapWalkBtn").addEventListener("click", () => window.ClearPathMap.startWalkthrough());

  document.querySelectorAll(".aac-tile").forEach(btn => {
    btn.addEventListener("click", () => {
      const phrase = btn.dataset.phrase;
      document.getElementById("aacSpoken").textContent = phrase;
      speak(phrase, "calm");
      Sensory.earcon("toggle");
      if (AppState.settings.haptics) Sensory.vibrate(30);
    });
  });

  renderStageList();
  populateReportStageSelect();
});

function scoreClass(score) {
  if (score >= 75) return "high";
  if (score >= 45) return "mid";
  return "low";
}

function renderStageList() {
  const list = document.getElementById("stageList");
  list.innerHTML = "";
  JOURNEY.forEach((stage, idx) => {
    const score = confidenceScore(stage);
    const li = document.createElement("li");
    li.className = "stage-item" + (idx === AppState.currentStageIndex ? " current" : "");
    const breakdown = confidenceBreakdown(stage)
      .map(b => `${b.label} ${b.earned}/${b.max}`).join(" · ");
    li.innerHTML = `
      <img src="${stage.photo}" alt="" />
      <div class="stage-info">
        <strong>${stage.stage}. ${stage.title}</strong>
        <p style="margin:4px 0; color:var(--muted); font-size:0.95rem;">${stage.description}</p>
        <p class="stage-provenance">${stage.osm}</p>
      </div>
      <span class="score-pill ${scoreClass(score)}" title="${breakdown}">${score}%</span>
    `;
    list.appendChild(li);
  });
}
