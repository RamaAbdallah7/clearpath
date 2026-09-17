// streetview.js — "Visit before you travel".
//
// A pre-visit walkthrough of the real park in Google Street View, so a
// visitor can see the gate, the paths, the toilets and the assembly point
// from home. The workshop deck's point that unexpected changes are a major
// stressor applies just as much to an adult planning a trip as to the child
// the storybook was written for — the difference is an adult wants the real
// place, not an illustration of it.
//
// Uses the Maps EMBED API deliberately, not the Maps JavaScript API. The
// Embed API is free to use with no usage cap, which matters for a student
// project that may be left running; the JS API bills per panorama load once
// the monthly credit is gone. The cost is control: an iframe can be pointed
// at a panorama, heading and pitch, and that is all. For a curated tour of
// verified viewpoints, that is enough.
//
// No key, no problem: the screen falls back to the existing photo viewer in
// story3d.js, which needs nothing and already works offline.
(function () {
  const KEY_STORAGE = "clearpath_gmaps_key";
  let current = 0;
  // Heading offset applied on top of the viewpoint's own heading, so the
  // visitor can turn on the spot and ask about a different direction.
  let headingOffset = 0;
  let describing = false;

  function activeHeading(vp) {
    return (((vp.heading ?? 0) + headingOffset) % 360 + 360) % 360;
  }

  const frame = () => document.getElementById("svFrame");
  const stage = () => document.getElementById("svStage");

  function getKey() {
    try { return localStorage.getItem(KEY_STORAGE) || ""; } catch (_) { return ""; }
  }
  function setKey(k) {
    try { k ? localStorage.setItem(KEY_STORAGE, k) : localStorage.removeItem(KEY_STORAGE); } catch (_) {}
  }

  function embedUrl(vp, key) {
    const base = "https://www.google.com/maps/embed/v1/streetview";
    const params = new URLSearchParams({ key, heading: String(activeHeading(vp)), pitch: String(vp.pitch ?? 0), fov: "90" });
    // Prefer a verified panorama ID where we captured one: `location` lets
    // Google pick, and it can pick a different (or no) panorama over time.
    if (vp.pano) params.set("pano", vp.pano);
    else params.set("location", `${vp.location.lat},${vp.location.lng}`);
    return `${base}?${params.toString()}`;
  }

  // Without a key there is nothing to embed, so say exactly what to do
  // rather than showing a broken grey box.
  function renderKeyPrompt() {
    stage().innerHTML = `
      <div class="sv-keyprompt">
        <h3>Add a Google Maps key to walk the park</h3>
        <p>The virtual visit streams real 360° imagery of Al Jahili Park through Google's
          <strong>Maps Embed API</strong>, which is free to use with no usage limit. It needs your own
          key.</p>
        <ol>
          <li>Open <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noopener">Google Cloud → Maps credentials</a> and create an API key.</li>
          <li>Enable <strong>Maps Embed API</strong> for it.</li>
          <li>Paste it below. It is stored only in this browser and never sent anywhere except Google.</li>
        </ol>
        <div class="row">
          <input type="password" id="svKeyInput" placeholder="AIza…" autocomplete="off" aria-label="Google Maps API key">
          <button class="btn primary" id="svKeySave" type="button">Save key</button>
        </div>
        <p class="sv-fallback-note">No key? The <button class="linklike" type="button" data-goto="story">pre-visit story</button>
          works with no key at all and uses the site's own photos.</p>
      </div>`;
    document.getElementById("svKeySave").addEventListener("click", () => {
      const v = document.getElementById("svKeyInput").value.trim();
      if (!v) { toast("Paste a key first"); return; }
      setKey(v);
      toast("Key saved — loading the park");
      render();
    });
  }

  function renderViewpointList() {
    const list = document.getElementById("svList");
    list.innerHTML = "";
    PARK_VIEWPOINTS.forEach((vp, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sv-chip" + (i === current ? " active" : "") + " kind-" + vp.kind;
      btn.setAttribute("aria-pressed", String(i === current));
      btn.textContent = vp.title;
      btn.addEventListener("click", () => { current = i; headingOffset = 0; render(); });
      list.appendChild(btn);
    });
  }

  function renderInfo(vp) {
    const info = document.getElementById("svInfo");
    const services = vp.services.map(s => `<li>${s}</li>`).join("");
    info.innerHTML = `
      <h3>${vp.title}</h3>
      <p class="sv-blurb">${vp.blurb}</p>
      <p class="sv-coverage">Imagery: ${vp.coverage}</p>

      <div class="sv-panel">
        <h4>Services here</h4>
        <ul class="sv-services">${services}</ul>
      </div>

      <div class="sv-panel good">
        <h4>What's good about it</h4>
        <p>${vp.good}</p>
      </div>

      ${vp.caution ? `<div class="sv-panel caution"><h4>Worth knowing</h4><p>${vp.caution}</p></div>` : ""}

      <div class="sv-panel emergency">
        <h4>If something goes wrong</h4>
        <p>${vp.emergency}</p>
      </div>

      <div class="row" style="margin-top:12px;">
        <button class="btn primary" id="svSpeak" type="button">🔊 Read this aloud</button>
        <button class="btn secondary" id="svNext" type="button">Next viewpoint →</button>
      </div>`;

    document.getElementById("svSpeak").addEventListener("click", () => {
      // Read it the way the storybook reads: slower and gentler. Someone
      // using this is preparing, not navigating.
      const text = `${vp.title}. ${vp.blurb} Services here: ${vp.services.join(", ")}. ` +
        `What's good about it: ${vp.good} ` +
        (vp.caution ? `Worth knowing: ${vp.caution} ` : "") +
        `If something goes wrong: ${vp.emergency}`;
      speak(text, "calm");
    });
    document.getElementById("svNext").addEventListener("click", () => {
      current = (current + 1) % PARK_VIEWPOINTS.length;
      headingOffset = 0;
      render();
    });
  }

  function renderExits() {
    const el = document.getElementById("svExits");
    if (!el) return;
    el.innerHTML = PARK_EXITS.map(x =>
      `<li><strong>${x.label}</strong><span>${x.lat.toFixed(5)}, ${x.lng.toFixed(5)}</span></li>`
    ).join("");
  }

  function render() {
    const key = getKey();
    const vp = PARK_VIEWPOINTS[current];
    renderViewpointList();
    renderInfo(vp);
    renderExits();

    if (!key) { renderKeyPrompt(); return; }

    stage().innerHTML = `
      <iframe id="svFrame" title="Street View of ${vp.title}"
        loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"
        src="${embedUrl(vp, key)}"></iframe>

      <div class="sv-controls">
        <button class="sv-turn" id="svLeft" type="button" aria-label="Turn left">↺</button>
        <button class="btn primary sv-ask" id="svAsk" type="button">👁 What am I looking at?</button>
        <button class="sv-turn" id="svRight" type="button" aria-label="Turn right">↻</button>
      </div>

      <div class="sv-guide" id="svGuide" hidden aria-live="polite"></div>`;

    document.getElementById("svLeft").addEventListener("click", () => { headingOffset -= 45; render(); });
    document.getElementById("svRight").addEventListener("click", () => { headingOffset += 45; render(); });
    document.getElementById("svAsk").addEventListener("click", () => describeView(vp));
  }

  function showGuide(html, kind) {
    const g = document.getElementById("svGuide");
    if (!g) return;
    g.hidden = false;
    g.dataset.kind = kind || "";
    g.innerHTML = html;
  }

  /* ── The AI guide ──
     Sends only where we are looking; the proxy fetches the matching Street
     View still and runs it past a vision model. The image URL carries the
     Google key, so it is built and used server-side and never here.

     When the proxy isn't running (or has no keys) this falls back to the
     verified facts for this viewpoint, clearly labelled as such — a written
     description of a place is honest; a guessed one is not. */
  async function describeView(vp) {
    if (describing) return;
    describing = true;
    const btn = document.getElementById("svAsk");
    btn.disabled = true;
    btn.textContent = "👁 Looking…";
    showGuide(`<p class="sv-guide-loading">Looking at this view…</p>`, "loading");

    const needs = [...(AppState.profile || [])].join(", ");
    const facts = [
      vp.title, vp.blurb,
      "Services: " + vp.services.join(", "),
      vp.caution ? "Caution: " + vp.caution : ""
    ].filter(Boolean).join("\n");

    try {
      const res = await fetch("/api/look", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pano: vp.pano || null,
          lat: vp.location.lat, lng: vp.location.lng,
          heading: activeHeading(vp), pitch: vp.pitch ?? 0, fov: 90,
          facts, needs
        })
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.text) {
        showGuide(
          `<p>${data.text}</p><p class="sv-guide-src">Described from the Street View image at ${Math.round(activeHeading(vp))}°</p>`,
          "ai");
        speak(data.text, "calm");
      } else if (data.reason === "no-imagery") {
        showGuide(`<p>There's no Street View image facing this way. Try turning with the arrows.</p>`, "empty");
      } else {
        fallbackGuide(vp);
      }
    } catch (_) {
      fallbackGuide(vp);
    } finally {
      describing = false;
      btn.disabled = false;
      btn.textContent = "👁 What am I looking at?";
    }
  }

  function fallbackGuide(vp) {
    const text = `${vp.blurb} ${vp.good}`;
    showGuide(
      `<p>${text}</p>
       <p class="sv-guide-src">Written description — the live scene guide needs the local proxy running
       with a Google Maps key. Nothing here is guessed.</p>`,
      "fallback");
    speak(text, "calm");
  }

  document.addEventListener("DOMContentLoaded", () => {
    const changeBtn = document.getElementById("svChangeKey");
    if (changeBtn) {
      changeBtn.addEventListener("click", () => {
        setKey("");
        toast("Key cleared");
        render();
      });
    }
    render();
  });

  window.ClearPathStreetView = {
    render,
    go: (id) => {
      const i = PARK_VIEWPOINTS.findIndex(v => v.id === id);
      if (i >= 0) { current = i; render(); }
    },
    hasKey: () => !!getKey()
  };
})();
