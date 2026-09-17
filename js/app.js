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
  // A screen that does not exist would otherwise deactivate everything and
  // leave a blank page — which is exactly what a deep link to a
  // JS-injected screen did before it had finished being built.
  if (!document.getElementById("screen-" + name)) {
    console.warn("[nav] no such screen:", name);
    name = "home";
  }
  screens.forEach(s => s.classList.toggle("active", s.id === "screen-" + name));
  document.querySelectorAll("#tabbar button").forEach(b => {
    b.setAttribute("aria-selected", b.dataset.screen === name ? "true" : "false");
  });
  AppState.screen = name;
  // Deep link each screen. Makes any screen shareable and bookmarkable —
  // and means "open the assist screen" is a link a carer can send someone,
  // rather than a set of directions they have to follow.
  if (location.hash.slice(1) !== name) {
    try { history.replaceState(null, "", "#" + name); } catch (_) {}
  }
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
    if (span.dataset.i18n) return;              // i18n.apply owns these
    if (!span.dataset.en) span.dataset.en = span.textContent;
    span.textContent = arabic ? (AR_LABELS[span.dataset.en] || span.dataset.en) : span.dataset.en;
  });
  // Re-render every translatable string, then let the screens that hold
  // their own content (assist, story, visit) redraw in the new language.
  if (window.I18n) I18n.apply();
  window.dispatchEvent(new CustomEvent("clearpath:language", { detail: { lang: arabic ? "ar" : "en" } }));
  if (window.ClearPathMap && AppState.screen === "journey") ClearPathMap.refresh();
  renderStageList();
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

  /* ── Read-aloud preferences ── */
  const autoReadBtn = document.getElementById("autoReadToggle");
  const rateInput = document.getElementById("readRate");
  const rateVal = document.getElementById("readRateVal");

  function showRate() { rateVal.textContent = Number(ClearPathReader.rate).toFixed(2) + "×"; }

  setSwitch(autoReadBtn, ClearPathReader.autoRead);
  rateInput.value = ClearPathReader.rate;
  showRate();

  autoReadBtn.addEventListener("click", (e) => {
    const on = e.currentTarget.getAttribute("aria-checked") !== "true";
    setSwitch(e.currentTarget, on);
    ClearPathReader.setAutoRead(on);
    // Confirm by doing the thing, so the effect is audible immediately.
    if (on) ClearPathReader.start(0);
    else { ClearPathReader.stop(); toast(I18n.t("a11y.autoread")); }
  });
  rateInput.addEventListener("input", (e) => { ClearPathReader.setRate(e.target.value); showRate(); });
  document.getElementById("readSlower").addEventListener("click", () => {
    rateInput.value = Math.max(0.5, Number(rateInput.value) - 0.1);
    ClearPathReader.setRate(rateInput.value); showRate();
  });
  document.getElementById("readFaster").addEventListener("click", () => {
    rateInput.value = Math.min(1.6, Number(rateInput.value) + 0.1);
    ClearPathReader.setRate(rateInput.value); showRate();
  });

  /* ── Gemini key ──
     Saved to this browser only. The status line reports what actually
     happened when the key was tested, rather than assuming it works. */
  const gKeyInput = document.getElementById("geminiKey");
  const gStatus = document.getElementById("geminiStatus");

  function renderKeyStatus(text, state) {
    gStatus.textContent = text;
    gStatus.dataset.state = state || "";
  }

  async function testGeminiKey() {
    renderKeyStatus(I18n.t("gemini.testing"), "checking");
    const r = await ClearPathGemini.test();
    if (r.ok) {
      renderKeyStatus(I18n.t("gemini.ok") + ` (${r.model})`, "ok");
      // AI answers just became possible; let the assist screen re-evaluate.
      window.dispatchEvent(new CustomEvent("clearpath:backend", { detail: { available: false } }));
    } else if (r.reason === "bad-key") renderKeyStatus(I18n.t("gemini.badkey"), "bad");
    else if (r.reason === "network") renderKeyStatus(I18n.t("gemini.network"), "bad");
    else renderKeyStatus(I18n.t("gemini.badkey"), "bad");
  }

  document.getElementById("geminiSave").addEventListener("click", async () => {
    const v = gKeyInput.value.trim();
    if (!v) return;
    ClearPathGemini.setKey(v);
    gKeyInput.value = "";
    await testGeminiKey();
  });
  document.getElementById("geminiClear").addEventListener("click", () => {
    ClearPathGemini.setKey("");
    renderKeyStatus(I18n.t("gemini.none"), "");
    toast(I18n.t("gemini.none"));
  });
  renderKeyStatus(ClearPathGemini.hasKey ? I18n.t("gemini.ok") : I18n.t("gemini.none"),
                  ClearPathGemini.hasKey ? "ok" : "");

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

  // Honour a deep link on load, and respond to back/forward.
  const SCREENS = ["home", "profile", "journey", "ar", "visit", "assist", "story", "report", "access"];
  const fromHash = () => {
    const h = location.hash.slice(1);
    return SCREENS.includes(h) ? h : null;
  };
  window.addEventListener("hashchange", () => {
    const h = fromHash();
    if (h && h !== AppState.screen) goToScreen(h);
  });

  // An Arabic-speaking visitor should not have to find a toggle before the
  // app becomes readable, so the browser's own language decides the default.
  if (window.I18n && I18n.detect()) setLanguage(true);
  else I18n.apply();

  renderStageList();
  populateReportStageSelect();

  // Some screens (Assist) are injected by their own module on
  // DOMContentLoaded, and this handler runs before those. Deferring by a
  // tick lets every module finish building before we navigate.
  const deep = fromHash();
  if (deep && deep !== "home") setTimeout(() => goToScreen(deep, { silent: true }), 0);
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
        <strong>${stage.stage}. ${I18n.tx(stage, "title")}</strong>
        <p style="margin:4px 0; color:var(--muted); font-size:0.95rem;">${I18n.tx(stage, "description")}</p>
        <p class="stage-provenance">${stage.osm}</p>
      </div>
      <span class="score-pill ${scoreClass(score)}" title="${breakdown}">${score}%</span>
    `;
    list.appendChild(li);
  });
}
