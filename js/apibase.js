// apibase.js — where the backend lives, and whether there is one at all.
//
// Two problems this solves.
//
// First, paths. Every /api/... call was written root-absolute, which is
// correct when the app is served from the root by server/proxy.mjs. On
// GitHub Pages the app lives at /clearpath/, so "/api/assist" would resolve
// to the domain root and miss entirely. Resolving against the page's own
// base fixes that without changing a single call site's shape.
//
// Second, honesty. On a static host there is no backend at all, and the
// features that need one — personalised cues, the AI half of the assist
// screen, plain-language link explanations, the volunteer hub — cannot work.
// Rather than let them fail one at a time when a visitor taps them, the app
// probes once and says up front which parts are unavailable and why.
//
// The override exists so a static deployment can be pointed at a tunnel or a
// hosted copy of the proxy later, without editing or rebuilding anything:
//   localStorage.setItem("clearpath_api_base", "https://your-proxy.example")
(function () {
  const OVERRIDE_KEY = "clearpath_api_base";

  function readOverride() {
    try { return localStorage.getItem(OVERRIDE_KEY) || ""; } catch (_) { return ""; }
  }

  // Strip the trailing filename so /clearpath/index.html and /clearpath/
  // both resolve to /clearpath/.
  function sameOriginBase() {
    const path = location.pathname.replace(/[^/]*$/, "");
    return location.origin + path.replace(/\/$/, "");
  }

  let base = readOverride().replace(/\/$/, "") || sameOriginBase();
  let available = null;          // null = not yet probed

  function url(path) {
    return base + (path.startsWith("/") ? path : "/" + path);
  }

  // One cheap request decides it for every feature. A static host answers a
  // POST to a missing path with 404/405 and an HTML body, which is exactly
  // the signal we want — no backend here.
  async function probe() {
    try {
      const res = await fetch(url("/api/volunteer/status"), { method: "GET" });
      if (!res.ok) { available = false; }
      else {
        const data = await res.json().catch(() => null);
        available = !!data && typeof data.volunteersOnline === "number";
      }
    } catch (_) {
      available = false;
    }
    document.body.dataset.backend = available ? "on" : "off";
    window.dispatchEvent(new CustomEvent("clearpath:backend", { detail: { available, base } }));
    return available;
  }

  function setBase(next) {
    base = String(next || "").replace(/\/$/, "");
    try {
      if (base && base !== sameOriginBase()) localStorage.setItem(OVERRIDE_KEY, base);
      else localStorage.removeItem(OVERRIDE_KEY);
    } catch (_) {}
    return probe();
  }

  window.ClearPathAPI = {
    url,
    probe,
    setBase,
    get base() { return base; },
    get available() { return available; },
    get isStatic() { return available === false; }
  };

  document.addEventListener("DOMContentLoaded", probe);
})();
