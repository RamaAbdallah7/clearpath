// assist.js — "be my eyes", with a choice of whose eyes.
//
// Built from feedback by People of Determination testing ClearPath, who
// asked for the two apps they already rely on, combined:
//
//   Be My Eyes  one button, and a sighted volunteer looks through your
//               camera and tells you what's there. Plus an AI describer,
//               with a hand-off to a human when the AI isn't sure.
//   OOrion      point the phone and it finds a named object for you,
//               guiding you in with beeps, vibration and distance.
//
// The combination they asked for is the choice itself: when the camera
// opens, you decide whether a machine or a person answers. Not a fallback
// buried in a menu — a choice on the main screen, every time.
//
// Four modes:
//   ask      any question about the scene, spoken in Arabic or English
//   find     OOrion-style object finding, guided by the proximity beacon
//            this app already had but only ever used for map stages
//   read     point at a sign or form and hear it read out
//   explain  a tester said the links and forms she's sent are the barrier,
//            not the park — so this takes a URL or a photo of a document
//            and says plainly what it is and what it wants from her
//
// The whole screen injects itself into the DOM at load rather than living
// in index.html, so this feature adds one script tag to the page and
// touches nothing else.
(function () {
  const t = (k, v) => I18n.t(k, v);

  let stream = null;
  let mode = "ask";
  let answerWho = "ai";          // "ai" | "volunteer"
  let recognizer = null;
  let listening = false;
  let busy = false;
  let simple = false;

  // Find-mode state
  let finding = false;
  let findTarget = null;
  let findRaf = null;
  let lastSeen = 0;

  // Volunteer-call state
  let callId = null;
  let callEvents = null;
  let peer = null;

  const el = {};

  /* ── Object vocabulary for find mode ──
     The detector only knows the 80 COCO classes, so the honest thing is to
     say which words work rather than silently failing on the rest. Both
     languages map onto the same class names. */
  const FIND_VOCAB = {
    bench:        { en: ["bench", "seat", "somewhere to sit"], ar: ["مقعد", "كرسي", "مكان للجلوس", "بنش"] },
    chair:        { en: ["chair"], ar: ["كرسي"] },
    person:       { en: ["person", "someone", "people"], ar: ["شخص", "أحد", "ناس", "إنسان"] },
    car:          { en: ["car"], ar: ["سيارة", "سياره"] },
    bicycle:      { en: ["bicycle", "bike"], ar: ["دراجة", "دراجه"] },
    "potted plant": { en: ["plant", "planter", "pot"], ar: ["نبتة", "نبات", "حوض نباتات"] },
    "fire hydrant": { en: ["hydrant"], ar: ["صنبور إطفاء"] },
    "stop sign":  { en: ["sign", "sign post"], ar: ["لافتة", "إشارة", "لوحة"] },
    backpack:     { en: ["bag", "backpack", "rucksack"], ar: ["حقيبة", "شنطة", "حقيبة ظهر"] },
    handbag:      { en: ["handbag", "purse"], ar: ["حقيبة يد"] },
    bottle:       { en: ["bottle", "water"], ar: ["قارورة", "زجاجة", "ماء"] },
    cup:          { en: ["cup", "glass"], ar: ["كوب", "فنجان"] },
    "cell phone": { en: ["phone", "mobile"], ar: ["هاتف", "جوال", "موبايل"] },
    umbrella:     { en: ["umbrella", "shade", "parasol"], ar: ["مظلة", "ظل", "شمسية"] },
    dog:          { en: ["dog"], ar: ["كلب"] },
    cat:          { en: ["cat"], ar: ["قطة", "قط"] }
  };

  function matchTarget(said) {
    const q = String(said || "").trim().toLowerCase();
    if (!q) return null;
    for (const [cls, words] of Object.entries(FIND_VOCAB)) {
      for (const w of [...words.en, ...words.ar]) {
        if (q.includes(w.toLowerCase())) return cls;
      }
    }
    return null;
  }

  function vocabList() {
    const l = I18n.lang();
    return Object.values(FIND_VOCAB).map(w => w[l][0]).join("، ".trim() === "" ? ", " : (l === "ar" ? "، " : ", "));
  }

  /* ── Markup, injected ───────────────────────────────────────────── */
  function buildScreen() {
    const section = document.createElement("section");
    section.className = "screen";
    section.id = "screen-assist";
    section.setAttribute("aria-labelledby", "assist-h");
    section.innerHTML = `
      <div class="card">
        <h2 id="assist-h" data-i18n="assist.title"></h2>
        <p style="color:var(--muted)" data-i18n="assist.intro"></p>

        <div class="assist-modes" role="tablist" aria-label="Assist modes">
          <button class="assist-mode active" data-mode="ask"     role="tab" aria-selected="true"  data-i18n="assist.mode.ask"></button>
          <button class="assist-mode"        data-mode="find"    role="tab" aria-selected="false" data-i18n="assist.mode.find"></button>
          <button class="assist-mode"        data-mode="read"    role="tab" aria-selected="false" data-i18n="assist.mode.read"></button>
          <button class="assist-mode"        data-mode="explain" role="tab" aria-selected="false" data-i18n="assist.mode.explain"></button>
        </div>

        <div class="assist-stage" id="assistStage">
          <video id="assistVideo" autoplay playsinline muted></video>
          <div class="assist-placeholder" id="assistPlaceholder">
            <button class="btn primary" id="assistStart" data-i18n="assist.start"></button>
          </div>
          <div class="assist-answer" id="assistAnswer" hidden aria-live="polite"></div>
        </div>

        <p class="assist-hint" id="assistHint"></p>

        <!-- Who answers. Deliberately on the main screen and not in a
             settings menu: the choice between a machine and a person is
             the whole point of the feature. -->
        <div class="assist-who" id="assistWho">
          <button class="who-btn active" data-who="ai"        data-i18n="assist.who.ai"></button>
          <button class="who-btn"        data-who="volunteer" data-i18n="assist.who.volunteer"></button>
          <span class="who-hint" data-i18n="assist.who.hint"></span>
        </div>

        <div class="assist-input" id="assistInput">
          <input type="text" id="assistQuestion" data-i18n-placeholder="assist.ask.placeholder">
          <button class="btn secondary" id="assistMic" data-i18n="assist.ask.listen"></button>
          <button class="btn primary" id="assistSend" data-i18n="assist.ask.send"></button>
        </div>

        <div class="row" style="margin-top:10px;">
          <label class="audio-first-toggle" for="assistSimple" style="flex:1; margin-top:0;">
            <input type="checkbox" id="assistSimple">
            <span data-i18n="assist.simple"></span>
          </label>
          <button class="btn ghost" id="assistStop" data-i18n="assist.stop" hidden></button>
        </div>
      </div>

      <div class="card" id="assistCallCard" hidden>
        <h3 id="assistCallState"></h3>
        <div class="assist-call">
          <video id="assistRemote" autoplay playsinline></video>
          <div class="assist-call-actions">
            <button class="btn secondary" id="assistHangup" data-i18n="vol.hangup"></button>
          </div>
        </div>
      </div>`;
    document.getElementById("main-content").appendChild(section);

    // Tab, inserted before the Story tab so navigation order still reads
    // as a journey: plan, map, navigate, visit, assist, prepare.
    const bar = document.getElementById("tabbar");
    const storyTab = bar.querySelector('[data-screen="story"]');
    const btn = document.createElement("button");
    btn.dataset.screen = "assist";
    btn.setAttribute("aria-selected", "false");
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span data-i18n="tab.assist"></span>`;
    btn.addEventListener("click", () => goToScreen("assist"));
    bar.insertBefore(btn, storyTab);

    for (const id of ["assistStage", "assistVideo", "assistPlaceholder", "assistAnswer", "assistHint",
      "assistWho", "assistInput", "assistQuestion", "assistMic", "assistSend", "assistStart",
      "assistStop", "assistSimple", "assistCallCard", "assistCallState", "assistRemote", "assistHangup"]) {
      el[id] = document.getElementById(id);
    }
  }

  /* ── Camera ─────────────────────────────────────────────────────── */
  async function startCamera() {
    if (stream) return true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }, audio: false
      });
    } catch (_) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (err) {
        showAnswer(t("assist.camera.denied"), "error");
        speak(t("assist.camera.denied"));
        return false;
      }
    }
    el.assistVideo.srcObject = stream;
    el.assistPlaceholder.hidden = true;
    el.assistStop.hidden = false;
    return true;
  }

  function stopCamera() {
    stopFinding();
    endCall();
    if (stream) { stream.getTracks().forEach(tr => tr.stop()); stream = null; }
    el.assistVideo.srcObject = null;
    el.assistPlaceholder.hidden = false;
    el.assistStop.hidden = true;
  }

  // A frame, small enough to send quickly over a phone connection but big
  // enough for a model to read a sign from.
  function snapshot(maxWidth = 900) {
    const v = el.assistVideo;
    if (!v.videoWidth) return null;
    const scale = Math.min(1, maxWidth / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.75);
  }

  /* ── Answers ────────────────────────────────────────────────────── */
  function showAnswer(html, kind, opts = {}) {
    el.assistAnswer.hidden = false;
    el.assistAnswer.dataset.kind = kind || "";
    el.assistAnswer.innerHTML = html +
      (opts.escalate ? `<div class="assist-escalate"><button class="btn secondary" id="assistEscalate">${t("assist.escalate")}</button></div>` : "");
    if (opts.escalate) {
      document.getElementById("assistEscalate").addEventListener("click", () => {
        answerWho = "volunteer";
        syncWho();
        askVolunteer(el.assistQuestion.value || t("assist.ask.hint"));
      });
    }
  }

  function badge(kind) {
    return `<span class="assist-by">${kind === "volunteer" ? t("assist.answeredBy.volunteer") : t("assist.answeredBy.ai")}</span>`;
  }

  /* ── Ask / read / explain via the AI ────────────────────────────── */
  async function askAI(question, forMode) {
    const image = snapshot();
    if (!image) { showAnswer(t("assist.camera.denied"), "error"); return; }
    busy = true;
    showAnswer(`<p>${t(forMode === "explain" ? "assist.explain.working" : "assist.answering")}</p>`, "loading");

    try {
      let data = null;

      // Preferred path: the local proxy, where the key never reaches the
      // browser at all.
      if (ClearPathAPI.available) {
        const res = await fetch(ClearPathAPI.url("/api/assist"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image, question, mode: forMode, lang: I18n.lang(), simple })
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.answer) data = body;
      }

      // Fallback: the visitor's own Gemini key, held in their browser. This
      // is what makes the published static site actually answer.
      if (!data && window.ClearPathGemini && ClearPathGemini.hasKey) {
        const g = await ClearPathGemini.assist({ image, question, mode: forMode, lang: I18n.lang(), simple });
        if (g.ok) data = { answer: g.answer, confident: g.confident };
        else if (g.reason === "bad-key") { badKey(); return; }
      }

      if (!data || !data.answer) { offline(); return; }

      // The hand-off. When the model says it isn't sure, we don't dress the
      // answer up — we say so and offer a person, which is exactly what the
      // testers said they wanted from Be My Eyes.
      showAnswer(
        `${badge("ai")}<p>${escapeHtml(data.answer)}</p>` +
        (data.confident ? "" : `<p class="assist-unsure">${t("assist.unsure")}</p>`),
        data.confident ? "ai" : "unsure",
        { escalate: !data.confident });
      speak(data.answer);
    } catch (_) {
      offline();
    } finally {
      busy = false;
    }
  }

  function badKey() {
    showAnswer(`<p>${t("gemini.badkey")}</p>`, "error");
    speak(t("gemini.badkey"));
    busy = false;
  }

  function offline() {
    showAnswer(`<p>${t("assist.offline")}</p>`, "error");
    speak(t("assist.offline"));
    busy = false;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ── Explain a link ─────────────────────────────────────────────── */
  async function explainLink(raw) {
    const looksLikeUrl = /^https?:\/\//i.test(raw.trim()) || /^[\w-]+\.[a-z]{2,}([/?#]|$)/i.test(raw.trim());
    if (!looksLikeUrl) {
      // Not a link: if the camera is live, read the document in front of
      // them instead of refusing outright.
      if (stream) return askAI(raw, "explain");
      showAnswer(`<p>${t("assist.explain.notlink")}</p>`, "error");
      return;
    }
    const url = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : "https://" + raw.trim();
    showAnswer(`<p>${t("assist.explain.working")}</p>`, "loading");
    try {
      let d = null;
      if (ClearPathAPI.available) {
        const res = await fetch(ClearPathAPI.url("/api/explain"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, lang: I18n.lang(), simple })
        });
        const body = await res.json().catch(() => ({}));
        if (body && body.ok) d = body;
      }
      // Browsers cannot fetch an arbitrary page (CORS), so the Gemini path
      // reads the ADDRESS only and the answer says so.
      if (!d && window.ClearPathGemini && ClearPathGemini.hasKey) {
        const g = await ClearPathGemini.explainUrl({ url, lang: I18n.lang(), simple });
        if (g.ok) d = g;
        else if (g.reason === "bad-key") { badKey(); return; }
      }
      if (!d) d = { ok: false, code: "failed" };
      if (!d.ok) {
        showAnswer(`<p>${t(d.code === "notlink" ? "assist.explain.notlink" : "assist.explain.failed")}</p>`, "error");
        speak(t(d.code === "notlink" ? "assist.explain.notlink" : "assist.explain.failed"));
        return;
      }
      const steps = (d.steps || []).map(x => `<li>${escapeHtml(x)}</li>`).join("");
      showAnswer(
        `${badge("ai")}
         <div class="explain-block"><h4>${t("assist.explain.what")}</h4><p>${escapeHtml(d.what || "")}</p></div>
         ${d.asks ? `<div class="explain-block"><h4>${t("assist.explain.asks")}</h4><p>${escapeHtml(d.asks)}</p></div>` : ""}
         ${steps ? `<div class="explain-block"><h4>${t("assist.explain.steps")}</h4><ol>${steps}</ol></div>` : ""}
         ${d.watch ? `<div class="explain-block warn"><h4>${t("assist.explain.watch")}</h4><p>${escapeHtml(d.watch)}</p></div>` : ""}
         ${d.addressOnly ? `<p class="assist-caveat">${t("assist.explain.addressOnly")}</p>` : ""}`,
        "explain");
      speak([d.what, d.asks, ...(d.steps || []), d.watch].filter(Boolean).join(". "), "calm");
    } catch (_) {
      offline();
    }
  }

  /* ── Find an object, OOrion-style ───────────────────────────────── */
  // The beacon already existed for map stages: chime rate rises as distance
  // falls. Here "distance" is inferred from how much of the frame the object
  // fills, which is crude but monotonic — and monotonic is all a beacon
  // needs to guide a hand.
  async function startFinding(said) {
    const cls = matchTarget(said);
    if (!cls) {
      const msg = t("assist.find.unsupported") + vocabList();
      showAnswer(`<p>${escapeHtml(msg)}</p>`, "error");
      speak(msg);
      return;
    }
    if (!await startCamera()) return;
    if (!window.ClearPathVision) { offline(); return; }

    findTarget = cls;
    finding = true;
    lastSeen = 0;
    Sensory.beaconStart();
    const label = (FIND_VOCAB[cls][I18n.lang()] || FIND_VOCAB[cls].en)[0];
    showAnswer(`<p>${t("assist.find.searching")} <strong>${escapeHtml(label)}</strong></p>`, "finding");
    speak(`${t("assist.find.searching")} ${label}`);

    await ClearPathVision.startRaw(el.assistVideo);
    tickFind(label);
  }

  function tickFind(label) {
    if (!finding) return;
    findRaf = requestAnimationFrame(() => tickFind(label));
    const hits = ClearPathVision.rawDetections();
    if (!hits) return;
    const match = hits
      .filter(d => d.categories?.[0]?.categoryName === findTarget && d.categories[0].score > 0.35)
      .sort((a, b) => b.boundingBox.height - a.boundingBox.height)[0];

    if (!match) {
      if (lastSeen && Date.now() - lastSeen > 2500) {
        lastSeen = 0;
        Sensory.beaconSetDistance(80);
        showAnswer(`<p>${t("assist.find.lost")}</p>`, "finding");
      }
      return;
    }

    lastSeen = Date.now();
    const frac = match.boundingBox.height / (el.assistVideo.videoHeight || 1);
    // frac 0.05 (far) → 60 m, frac 0.7 (right there) → 3 m.
    const pseudoMetres = Math.max(3, Math.min(60, Math.round(60 - frac * 82)));
    Sensory.beaconSetDistance(pseudoMetres);

    const centreX = (match.boundingBox.originX + match.boundingBox.width / 2) / (el.assistVideo.videoWidth || 1);
    const side = centreX < 0.4 ? (I18n.lang() === "ar" ? "يسارك" : "your left")
      : centreX > 0.6 ? (I18n.lang() === "ar" ? "يمينك" : "your right")
        : (I18n.lang() === "ar" ? "أمامك" : "straight ahead");

    if (frac > 0.45) {
      showAnswer(`<p><strong>${t("assist.find.found")}</strong> — ${escapeHtml(label)}, ${side}</p>`, "found");
      if (AppState.settings.haptics) Sensory.vibrate([90, 50, 90]);
      Sensory.earcon("arrive");
      speak(`${t("assist.find.found")}. ${label}, ${side}`);
      stopFinding();
    } else {
      showAnswer(`<p>${t("assist.find.searching")} <strong>${escapeHtml(label)}</strong> — ${side}</p>`, "finding");
    }
  }

  function stopFinding() {
    finding = false;
    findTarget = null;
    if (findRaf) cancelAnimationFrame(findRaf);
    Sensory.beaconStop();
    if (window.ClearPathVision && ClearPathVision.stopRaw) ClearPathVision.stopRaw();
  }

  /* ── Volunteer ──────────────────────────────────────────────────── */
  async function askVolunteer(question) {
    if (!await startCamera()) return;
    const snap = snapshot(700);
    el.assistCallCard.hidden = false;
    el.assistCallState.textContent = t("vol.calling");
    speak(t("vol.calling"));

    try {
      const res = await fetch(ClearPathAPI.url("/api/volunteer/request"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, snapshot: snap, lang: I18n.lang(), mode })
      });
      if (!res.ok) { offline(); el.assistCallCard.hidden = true; return; }
      const { id } = await res.json();
      callId = id;
      el.assistCallState.textContent = t("vol.waiting");
      listenForVolunteer(id);
    } catch (_) {
      offline();
      el.assistCallCard.hidden = true;
    }
  }

  function listenForVolunteer(id) {
    callEvents = new EventSource(ClearPathAPI.url(`/api/volunteer/events?role=user&id=${encodeURIComponent(id)}`));

    callEvents.addEventListener("accepted", async () => {
      el.assistCallState.textContent = t("vol.connected");
      speak(t("vol.connected"));
      await startPeer(id);
    });

    // Nobody picked up. Rather than leave someone standing at a kerb
    // watching a spinner, the AI helper answers straight away from the same
    // snapshot — and the request stays open, so a volunteer who wakes up
    // later can still correct it. Human or AI is a choice, never a wait.
    callEvents.addEventListener("timeout", async () => {
      el.assistCallState.textContent = t("vol.sent");
      showAnswer(`<p>${t("vol.none")}</p>`, "waiting");
      speak(t("vol.none"));
      const q = el.assistQuestion.value.trim();
      await askAI(q, mode === "read" ? "read" : "ask");
    });

    // A person answering after the AI already spoke replaces it, and is
    // labelled as a person — the two must never be mistaken for each other.
    callEvents.addEventListener("answer", (e) => {
      const d = JSON.parse(e.data);
      showAnswer(`${badge("volunteer")}<p>${escapeHtml(d.answer || "")}</p>`, "volunteer");
      speak(d.answer || "");
      el.assistCallCard.hidden = true;
      endCall();
    });

    callEvents.addEventListener("signal", async (e) => {
      const { signal } = JSON.parse(e.data);
      if (!peer) return;
      if (signal.type === "answer") await peer.setRemoteDescription(signal);
      else if (signal.candidate) { try { await peer.addIceCandidate(signal); } catch (_) {} }
    });

    callEvents.addEventListener("ended", () => {
      el.assistCallState.textContent = t("vol.ended");
      endCall();
    });
  }

  async function startPeer(id) {
    peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    // Send the camera; we also accept a return track so a volunteer can
    // talk back with audio if they choose to.
    stream.getTracks().forEach(tr => peer.addTrack(tr, stream));
    peer.ontrack = (e) => { el.assistRemote.srcObject = e.streams[0]; };
    peer.onicecandidate = (e) => {
      if (e.candidate) sendSignal(id, e.candidate.toJSON());
    };
    const offer = await peer.createOffer({ offerToReceiveAudio: true });
    await peer.setLocalDescription(offer);
    sendSignal(id, offer);
  }

  function sendSignal(id, signal) {
    fetch(ClearPathAPI.url("/api/volunteer/signal"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, from: "user", signal })
    }).catch(() => {});
  }

  function endCall() {
    if (peer) { try { peer.close(); } catch (_) {} peer = null; }
    if (callEvents) { callEvents.close(); callEvents = null; }
    if (callId) {
      fetch(ClearPathAPI.url("/api/volunteer/end"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: callId })
      }).catch(() => {});
      callId = null;
    }
    el.assistRemote.srcObject = null;
  }

  /* ── Speech input ───────────────────────────────────────────────── */
  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Speech recognition isn't supported in this browser"); return; }
    if (listening) { recognizer && recognizer.stop(); return; }

    recognizer = new SR();
    // Follows the chosen language — listening in the wrong one is how these
    // features end up unusable for the people who need them most.
    recognizer.lang = I18n.speechLang();
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;
    recognizer.onstart = () => { listening = true; el.assistMic.textContent = t("assist.ask.listening"); };
    recognizer.onend = () => { listening = false; el.assistMic.textContent = t("assist.ask.listen"); };
    recognizer.onresult = (e) => {
      const said = e.results[0][0].transcript.trim();
      el.assistQuestion.value = said;
      submit();
    };
    recognizer.onerror = () => { listening = false; el.assistMic.textContent = t("assist.ask.listen"); };
    recognizer.start();
  }

  /* ── Dispatch ───────────────────────────────────────────────────── */
  async function submit() {
    if (busy) return;
    const q = el.assistQuestion.value.trim();

    if (mode === "find") { startFinding(q); return; }
    if (mode === "explain") { explainLink(q); return; }

    if (!await startCamera()) return;
    if (answerWho === "volunteer") { askVolunteer(q || t("assist.ask.hint")); return; }
    askAI(q, mode === "read" ? "read" : "ask");
  }

  function syncWho() {
    el.assistWho.querySelectorAll(".who-btn").forEach(b => {
      const on = b.dataset.who === answerWho;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  function syncMode() {
    document.querySelectorAll(".assist-mode").forEach(b => {
      const on = b.dataset.mode === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    if (backendOff) {
      const hint = el.assistWho.querySelector(".who-hint");
      if (hint) hint.textContent = t("backend.off.ask");
    }
    el.assistHint.textContent = t(
      mode === "find" ? "assist.find.hint" :
      mode === "read" ? "assist.read.hint" :
      mode === "explain" ? "assist.explain.hint" : "assist.ask.hint");
    el.assistQuestion.placeholder = t(
      mode === "find" ? "assist.find.placeholder" :
      mode === "explain" ? "assist.explain.placeholder" : "assist.ask.placeholder");
    el.assistSend.textContent = t(
      mode === "find" ? "assist.find.start" :
      mode === "read" ? "assist.read.start" :
      mode === "explain" ? "assist.explain.link" : "assist.ask.send");
    // Reading and finding never involve a volunteer, so the choice is hidden
    // rather than shown and ignored.
    el.assistWho.hidden = (mode === "find" || mode === "read");
    el.assistQuestion.hidden = (mode === "read");
    el.assistMic.hidden = (mode === "read");
    stopFinding();
  }

  let backendOff = false;

  // Static host + own key: AI works, volunteers do not.
  function showVolunteerOnlyNote() {
    const card = document.querySelector("#screen-assist .card");
    if (card.querySelector(".backend-note")) return;
    const note = document.createElement("div");
    note.className = "backend-note";
    note.innerHTML = `<strong data-i18n="gemini.on.title"></strong><p data-i18n="gemini.on.body"></p>`;
    card.insertBefore(note, card.querySelector(".assist-modes"));
    el.assistWho.querySelector('[data-who="volunteer"]').disabled = true;
    answerWho = "ai";
    syncWho();
    I18n.apply(card);
  }

  function refreshLanguage() {
    I18n.apply(document.getElementById("screen-assist"));
    I18n.apply(document.getElementById("tabbar"));
    syncMode();
    syncWho();
    // syncMode() re-shows the who-picker for ask/explain, so on a static
    // deployment it has to be re-disabled after every language change.
    if (backendOff) {
      el.assistWho.querySelectorAll(".who-btn").forEach(b => { b.disabled = true; });
    }
  }

  /* ── Wire up ────────────────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    buildScreen();

    document.querySelectorAll(".assist-mode").forEach(b => {
      b.addEventListener("click", () => { mode = b.dataset.mode; syncMode(); });
    });
    el.assistWho.querySelectorAll(".who-btn").forEach(b => {
      b.addEventListener("click", () => { answerWho = b.dataset.who; syncWho(); });
    });
    el.assistStart.addEventListener("click", startCamera);
    el.assistStop.addEventListener("click", stopCamera);
    el.assistSend.addEventListener("click", submit);
    el.assistMic.addEventListener("click", toggleMic);
    el.assistHangup.addEventListener("click", () => { endCall(); el.assistCallCard.hidden = true; });
    el.assistQuestion.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    el.assistSimple.addEventListener("change", (e) => {
      simple = e.target.checked;
      toast(t(simple ? "assist.simple.on" : "assist.simple.off"));
    });

    refreshLanguage();
    window.addEventListener("clearpath:language", refreshLanguage);

    // On a static deployment there is no helper service. Say so once, up
    // front, instead of letting each button fail separately when tapped.
    window.addEventListener("clearpath:backend", (e) => {
      if (e.detail.available) return;
      // A visitor who has supplied their own key does have AI answers, so
      // telling them otherwise would be wrong. Only volunteers need a server.
      if (window.ClearPathGemini && ClearPathGemini.hasKey) { showVolunteerOnlyNote(); return; }
      const note = document.createElement("div");
      note.className = "backend-note";
      // Marked up with keys rather than baked strings, so switching language
      // re-translates it like everything else — it was appearing in English
      // on an otherwise fully Arabic page.
      note.innerHTML = `<strong data-i18n="backend.off.title"></strong><p data-i18n="backend.off.body"></p>`;
      const card = document.querySelector("#screen-assist .card");
      card.insertBefore(note, card.querySelector(".assist-modes"));
      // Find and read run entirely in the browser, so they stay usable.
      el.assistWho.querySelectorAll('.who-btn').forEach(b => { b.disabled = true; });
      el.assistWho.querySelector(".who-hint").dataset.i18n = "backend.off.ask";
      backendOff = true;
      refreshLanguage();
    });
  });

  window.ClearPathAssist = {
    open: (m) => { if (m) { mode = m; syncMode(); } goToScreen("assist"); },
    stopCamera,
    refreshLanguage,
    get mode() { return mode; }
  };
})();
