// streetview.js — "Visit before you travel".
//
// A pre-visit walkthrough of the park, so a visitor can see the gate, the
// paths, the toilets and the assembly point from home. The workshop deck's
// point that unexpected changes are a major stressor applies just as much to
// an adult planning a trip as to the child the storybook was written for —
// the difference is the adult wants the real place.
//
// It was built on Google Street View first, which does cover this site. That
// was dropped on request, and the keyless alternatives were checked rather
// than assumed: Panoramax returns nothing for the park's bounding box, and
// Mapillary will not answer without an OAuth token and shows no captures
// here. There is no free 360° imagery of Al Jahili Park.
//
// So this runs on the site's own photographs instead. Everything now needs
// no API key at all — the whole screen works offline — and the "what am I
// looking at" guide reads the local photo through the same vision model the
// assist screen uses, so there is one optional key in the project instead of
// three.
(function () {
  let current = 0;
  let describing = false;

  const t = (k) => I18n.t(k);
  const stage = () => document.getElementById("svStage");

  function vp() { return PARK_VIEWPOINTS[current]; }

  // Content fields fall back to English when no Arabic exists, and arrays
  // need the same treatment as strings.
  function txList(o, field) {
    if (I18n.lang() === "ar" && o.ar && Array.isArray(o.ar[field])) return o.ar[field];
    return o[field] || [];
  }

  function renderViewpointList() {
    const list = document.getElementById("svList");
    list.innerHTML = "";
    PARK_VIEWPOINTS.forEach((v, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sv-chip" + (i === current ? " active" : "") + " kind-" + v.kind;
      btn.setAttribute("aria-pressed", String(i === current));
      btn.textContent = I18n.tx(v, "title");
      btn.addEventListener("click", () => { current = i; render(); });
      list.appendChild(btn);
    });
  }

  function renderStage() {
    const v = vp();
    stage().innerHTML = `
      <img id="svPhoto" src="${v.photo}" alt="${I18n.tx(v, "blurb")}">
      <div class="sv-controls">
        <button class="btn secondary sv-3d" id="sv3d">🥽 ${I18n.lang() === "ar" ? "ادخل المشهد" : "Step into it"}</button>
        <button class="btn primary sv-ask" id="svAsk">👁 ${I18n.lang() === "ar" ? "ماذا أرى هنا؟" : "What am I looking at?"}</button>
      </div>
      <div class="sv-guide" id="svGuide" hidden aria-live="polite"></div>`;

    // The immersive viewer that already shipped with the app: it maps a flat
    // photo onto a wide curved arc rather than a sphere, which is the honest
    // way to "step into" a single frame without pinching it at the poles.
    document.getElementById("sv3d").addEventListener("click", () => {
      window.ClearPathStory3D.open({ photo: v.photo });
    });
    document.getElementById("svAsk").addEventListener("click", () => describeView(v));
  }

  function renderInfo() {
    const v = vp();
    const info = document.getElementById("svInfo");
    const services = txList(v, "services").map(s => `<li>${s}</li>`).join("");
    const caution = I18n.tx(v, "caution");
    info.innerHTML = `
      <h3>${I18n.tx(v, "title")}</h3>
      <p class="sv-blurb">${I18n.tx(v, "blurb")}</p>
      <p class="sv-coverage">${v.source}</p>

      <div class="sv-panel">
        <h4>${I18n.lang() === "ar" ? "الخدمات هنا" : "Services here"}</h4>
        <ul class="sv-services">${services}</ul>
      </div>

      <div class="sv-panel good">
        <h4>${I18n.lang() === "ar" ? "ما يميّزه" : "What's good about it"}</h4>
        <p>${I18n.tx(v, "good")}</p>
      </div>

      ${caution ? `<div class="sv-panel caution"><h4>${I18n.lang() === "ar" ? "انتبه إلى" : "Worth knowing"}</h4><p>${caution}</p></div>` : ""}

      <div class="sv-panel emergency">
        <h4>${I18n.lang() === "ar" ? "إن حدث طارئ" : "If something goes wrong"}</h4>
        <p>${I18n.tx(v, "emergency")}</p>
      </div>

      <div class="row" style="margin-top:12px;">
        <button class="btn primary" id="svSpeak">${t("common.speak")}</button>
        <button class="btn secondary" id="svNext">${I18n.lang() === "ar" ? "المحطة التالية ←" : "Next viewpoint →"}</button>
      </div>`;

    document.getElementById("svSpeak").addEventListener("click", () => {
      // Read at the storybook pace: someone using this is preparing for a
      // trip, not navigating one.
      const text = [
        I18n.tx(v, "title"), I18n.tx(v, "blurb"),
        (I18n.lang() === "ar" ? "الخدمات: " : "Services: ") + txList(v, "services").join("، "),
        I18n.tx(v, "good"), caution, I18n.tx(v, "emergency")
      ].filter(Boolean).join(". ");
      speak(text, "calm");
    });
    document.getElementById("svNext").addEventListener("click", () => {
      current = (current + 1) % PARK_VIEWPOINTS.length;
      render();
    });
  }

  function renderExits() {
    const el = document.getElementById("svExits");
    if (!el) return;
    el.innerHTML = PARK_EXITS.map(x =>
      `<li><strong>${I18n.lang() === "ar" ? x.ar : x.label}</strong><span>${x.lat.toFixed(5)}, ${x.lng.toFixed(5)}</span></li>`
    ).join("");
  }

  function showGuide(html, kind) {
    const g = document.getElementById("svGuide");
    if (!g) return;
    g.hidden = false;
    g.dataset.kind = kind || "";
    g.innerHTML = html;
  }

  /* ── The AI guide ──
     Loads the local photo into a canvas and sends it to the same /api/assist
     endpoint the camera uses. No Google key, no server-side image fetch —
     the picture is already ours. */
  function photoToDataUrl(img) {
    const c = document.createElement("canvas");
    const scale = Math.min(1, 900 / (img.naturalWidth || 900));
    c.width = Math.round((img.naturalWidth || 900) * scale);
    c.height = Math.round((img.naturalHeight || 600) * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  }

  async function describeView(v) {
    if (describing) return;
    describing = true;
    const btn = document.getElementById("svAsk");
    btn.disabled = true;
    showGuide(`<p class="sv-guide-loading">${t("assist.answering")}</p>`, "loading");

    try {
      const img = document.getElementById("svPhoto");
      if (!img.complete) await new Promise(r => { img.onload = r; img.onerror = r; });
      const image = photoToDataUrl(img);

      const question = I18n.lang() === "ar"
        ? "ماذا أرى في هذه الصورة؟ ركّز على سطح المشي والدرجات والظل وأماكن الجلوس."
        : "What am I looking at? Focus on the walking surface, steps, shade and places to sit.";

      const res = await fetch(ClearPathAPI.url("/api/assist"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, question, mode: "ask", lang: I18n.lang() })
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.answer) {
        showGuide(`<p>${data.answer}</p><p class="sv-guide-src">${I18n.lang() === "ar" ? "وصف من الصورة نفسها" : "Described from this photo"}</p>`, "ai");
        speak(data.answer, "calm");
      } else {
        fallbackGuide(v);
      }
    } catch (_) {
      fallbackGuide(v);
    } finally {
      describing = false;
      btn.disabled = false;
    }
  }

  // A written description of a real place is honest; a guessed one is not.
  // So when the proxy is not running we say so and use the verified text.
  function fallbackGuide(v) {
    const text = `${I18n.tx(v, "blurb")} ${I18n.tx(v, "good")}`;
    showGuide(
      `<p>${text}</p><p class="sv-guide-src">${I18n.lang() === "ar"
        ? "وصف مكتوب — الوصف الحيّ يحتاج تشغيل الخادم المحلي. لا شيء هنا مُخمَّن."
        : "Written description — the live guide needs the local proxy running. Nothing here is guessed."}</p>`,
      "fallback");
    speak(text, "calm");
  }

  function render() {
    renderViewpointList();
    renderStage();
    renderInfo();
    renderExits();
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Start the guided tour from whichever viewpoint is currently selected,
    // so "walk the park" continues from where the visitor was reading.
    document.getElementById("startVrTour").addEventListener("click", () => {
      window.ClearPathStory3D.openTour(PARK_VIEWPOINTS, current);
    });
    document.getElementById("story3dNext").addEventListener("click", () => ClearPathStory3D.nextStop());
    document.getElementById("story3dPrev").addEventListener("click", () => ClearPathStory3D.prevStop());
    document.getElementById("story3dReplay").addEventListener("click", () => ClearPathStory3D.replay());
    render();
    window.addEventListener("clearpath:language", render);
  });

  window.ClearPathStreetView = {
    render,
    go: (id) => {
      const i = PARK_VIEWPOINTS.findIndex(v => v.id === id);
      if (i >= 0) { current = i; render(); }
    }
  };
})();
