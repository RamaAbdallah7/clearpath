// screenreader.js — read the whole screen aloud.
//
// Added because testers who are blind pointed out the obvious: the app
// narrates cues and answers, but never the screen itself. Everything between
// those announcements — headings, descriptions, scores, button labels — was
// only ever available by looking at it.
//
// Real screen readers (VoiceOver, TalkBack, NVDA) do this far better, and
// nothing here tries to replace them: the app keeps its semantic HTML, ARIA
// labels and live regions so those tools work properly. But a visitor on a
// borrowed phone, or who has never turned VoiceOver on, or who is standing in
// a park one-handed, needs the app itself to be able to read out loud. So
// this is a reading mode built into the product, not an assistive-tech
// substitute.
//
// How it reads:
//   - walks the ACTIVE screen in DOM order, which is authored to match
//     visual order, so the reading order is the reading order
//   - announces the role of things that are interactive ("button: Play
//     walkthrough"), because "Play walkthrough" alone doesn't tell you it
//     can be pressed
//   - skips anything hidden, decorative, or already-spoken chrome
//   - highlights the sentence being read, for low-vision users who have
//     some sight and for anyone following along
//   - speaks in whichever language the app is in, with that language's voice
//
// Controls are deliberately large, fixed, and reachable from any screen.
(function () {
  const t = (k) => (window.I18n ? I18n.t(k) : k);

  let items = [];          // [{ el, text }]
  let index = -1;
  let playing = false;
  let paused = false;
  let autoRead = false;
  let bar = null;

  /* ── What counts as readable ────────────────────────────────────── */
  const READ_SELECTOR = [
    "h1", "h2", "h3", "h4",
    "p", "li", "strong",
    "button", "a[href]",
    "label", "summary",
    "td", "th",
    "[data-read]"
  ].join(",");

  // Chrome that either speaks itself, duplicates something else, or is
  // meaningless read aloud.
  const SKIP_CLOSEST = [
    ".visually-hidden", ".skip-link", "#toastRegion", "#captionBar",
    "#screenreader-bar", ".ar-path-overlay", ".ar-vision-overlay",
    "#headCursor", ".leaflet-container", ".head-cursor"
  ].join(",");

  function isHidden(el) {
    if (el.hidden || el.closest("[hidden]")) return true;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return true;
    if (el.getAttribute("aria-hidden") === "true" || el.closest('[aria-hidden="true"]')) return true;
    return el.offsetParent === null && cs.position !== "fixed";
  }

  function label(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    // Only the element's own text, so a heading inside a card isn't read
    // again as part of the card.
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
      else if (node.nodeType === Node.ELEMENT_NODE && !node.matches(READ_SELECTOR)) text += node.textContent;
    }
    return text.replace(/\s+/g, " ").trim();
  }

  // Say what a thing IS, not just what it says — otherwise a list of button
  // labels sounds like prose and you can't tell what you can act on.
  function withRole(el, text) {
    const tag = el.tagName.toLowerCase();
    const ar = I18n.lang() === "ar";
    if (tag === "button" || el.getAttribute("role") === "button") {
      const pressed = el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-checked") === "true";
      const sel = el.getAttribute("aria-selected") === "true";
      const state = pressed ? (ar ? "، مُفعّل" : ", on")
        : sel ? (ar ? "، محدّد" : ", selected")
        : el.disabled ? (ar ? "، غير متاح" : ", unavailable") : "";
      return (ar ? "زر: " : "Button: ") + text + state;
    }
    if (tag === "a") return (ar ? "رابط: " : "Link: ") + text;
    if (/^h[1-4]$/.test(tag)) return (ar ? "عنوان: " : "Heading: ") + text;
    if (tag === "label") return (ar ? "خيار: " : "Option: ") + text;
    return text;
  }

  function collect() {
    const screen = document.querySelector(".screen.active");
    if (!screen) return [];
    const out = [];
    const seen = new Set();
    for (const el of screen.querySelectorAll(READ_SELECTOR)) {
      if (el.closest(SKIP_CLOSEST)) continue;
      if (isHidden(el)) continue;
      // A <strong> inside an <li> we already took would otherwise be read a
      // second time on its own, which sounds like a stutter. If an ancestor
      // is already queued, its text covered this element.
      if (out.some(prev => prev.el.contains(el))) continue;
      const text = label(el);
      if (!text || text.length < 2) continue;
      // Emoji-only labels read as nonsense; skip anything with no letters.
      if (!/[\p{L}\p{N}]/u.test(text)) continue;
      const key = text.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ el, text: withRole(el, text) });
    }
    return out;
  }

  /* ── Speaking ───────────────────────────────────────────────────── */
  function clearHighlight() {
    document.querySelectorAll(".sr-reading").forEach(e => e.classList.remove("sr-reading"));
  }

  function speakItem(i) {
    if (i < 0 || i >= items.length) { stop(true); return; }
    index = i;
    const item = items[i];
    clearHighlight();
    item.el.classList.add("sr-reading");
    item.el.scrollIntoView({ block: "center", behavior: "smooth" });
    updateBar();

    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(item.text);
    u.lang = I18n.speechLang();
    const v = (typeof pickVoice === "function") ? pickVoice(u.lang) : null;
    if (v) u.voice = v;
    u.rate = 0.98;
    u.onend = () => { if (playing && !paused) speakItem(index + 1); };
    // A failed utterance must not silently end the whole reading.
    u.onerror = () => { if (playing && !paused) setTimeout(() => speakItem(index + 1), 120); };
    window.speechSynthesis.speak(u);
  }

  function start(fromIndex = 0) {
    items = collect();
    if (!items.length) { toast(I18n.lang() === "ar" ? "لا يوجد نص لقراءته" : "Nothing to read here"); return; }
    window.speechSynthesis.cancel();
    playing = true; paused = false;
    speakItem(fromIndex);
  }

  function stop(finished) {
    playing = false; paused = false;
    window.speechSynthesis.cancel();
    clearHighlight();
    index = finished ? items.length : index;
    updateBar();
  }

  function togglePause() {
    if (!playing) { start(0); return; }
    paused = !paused;
    if (paused) window.speechSynthesis.pause();
    else {
      // Chrome's resume() is unreliable after a long pause; re-speaking the
      // current item is more dependable than trusting it.
      window.speechSynthesis.cancel();
      speakItem(index);
    }
    updateBar();
  }

  function next() { window.speechSynthesis.cancel(); playing = true; paused = false; speakItem(index + 1); }
  function prev() { window.speechSynthesis.cancel(); playing = true; paused = false; speakItem(Math.max(0, index - 1)); }

  /* ── Controls ───────────────────────────────────────────────────── */
  const ICON = {
    play: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M17 5v14L7 12z" fill="currentColor"/><rect x="5" y="5" width="2" height="14" fill="currentColor"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 5v14l10-7z" fill="currentColor"/><rect x="17" y="5" width="2" height="14" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };

  function buildBar() {
    bar = document.createElement("div");
    bar.id = "screenreader-bar";
    bar.className = "sr-bar";
    bar.setAttribute("role", "toolbar");
    bar.innerHTML = `
      <button class="sr-main" id="srToggle" type="button">${ICON.speaker}<span id="srToggleLabel"></span></button>
      <div class="sr-transport" id="srTransport" hidden>
        <button class="sr-btn" id="srPrev" type="button">${ICON.prev}</button>
        <button class="sr-btn" id="srPlay" type="button">${ICON.pause}</button>
        <button class="sr-btn" id="srNext" type="button">${ICON.next}</button>
        <button class="sr-btn" id="srStop" type="button">${ICON.stop}</button>
        <span class="sr-progress" id="srProgress"></span>
      </div>`;
    document.body.appendChild(bar);

    document.getElementById("srToggle").addEventListener("click", () => playing ? stop() : start(0));
    document.getElementById("srPlay").addEventListener("click", togglePause);
    document.getElementById("srNext").addEventListener("click", next);
    document.getElementById("srPrev").addEventListener("click", prev);
    document.getElementById("srStop").addEventListener("click", () => stop());
    updateBar();
  }

  function updateBar() {
    if (!bar) return;
    const ar = I18n.lang() === "ar";
    const toggle = document.getElementById("srToggle");
    const lbl = document.getElementById("srToggleLabel");
    const transport = document.getElementById("srTransport");
    const play = document.getElementById("srPlay");
    const prog = document.getElementById("srProgress");

    lbl.textContent = playing ? (ar ? "إيقاف القراءة" : "Stop reading") : (ar ? "اقرأ الشاشة" : "Read screen");
    toggle.setAttribute("aria-label", lbl.textContent);
    toggle.classList.toggle("active", playing);
    transport.hidden = !playing;
    play.innerHTML = paused ? ICON.play : ICON.pause;
    play.setAttribute("aria-label", paused ? (ar ? "متابعة" : "Resume") : (ar ? "إيقاف مؤقت" : "Pause"));
    document.getElementById("srNext").setAttribute("aria-label", ar ? "التالي" : "Next");
    document.getElementById("srPrev").setAttribute("aria-label", ar ? "السابق" : "Previous");
    document.getElementById("srStop").setAttribute("aria-label", ar ? "إيقاف" : "Stop");
    prog.textContent = playing && items.length ? `${Math.min(index + 1, items.length)} / ${items.length}` : "";
  }

  /* ── Wiring ─────────────────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    buildBar();

    // Keyboard: R reads, Escape stops, arrows step. Ignored while typing.
    document.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
      if (typing) return;
      if (e.key === "r" || e.key === "R") { e.preventDefault(); playing ? stop() : start(0); }
      else if (e.key === "Escape" && playing) { e.preventDefault(); stop(); }
      else if (playing && (e.key === "ArrowRight" || e.key === "ArrowDown")) { e.preventDefault(); next(); }
      else if (playing && (e.key === "ArrowLeft" || e.key === "ArrowUp")) { e.preventDefault(); prev(); }
    });

    // Changing screen mid-read should re-read the new screen, not keep
    // narrating the one the visitor just left.
    const origGoTo = window.goToScreen;
    if (typeof origGoTo === "function") {
      window.goToScreen = function (name, opts) {
        const wasPlaying = playing;
        stop();
        origGoTo.call(this, name, opts);
        if (wasPlaying || autoRead) setTimeout(() => start(0), 400);
      };
    }

    window.addEventListener("clearpath:language", () => { stop(); updateBar(); });
  });

  window.ClearPathReader = {
    start, stop, next, prev, togglePause,
    get isPlaying() { return playing; },
    setAutoRead(v) { autoRead = !!v; },
    get autoRead() { return autoRead; }
  };
})();
