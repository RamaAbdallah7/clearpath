// places.js — what is actually around you, from OpenStreetMap.
//
// The stage descriptions in journey-data.js are written by hand. That is
// fine for the five fixed stages, but a visitor standing in the park has a
// more immediate question: where is the nearest accessible toilet, bench or
// gate from HERE? Hand-written text cannot answer that.
//
// So this queries Overpass live for accessibility-relevant features around
// a point, and reverse-geocodes through Nominatim to say where "here" is in
// words. Both are keyless and CORS-open. Both are also other people's free
// infrastructure, so: one query per screen visit, cached, with a polite
// identifying comment in the query itself.
(function () {
  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ];
  const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
  const TIMEOUT_MS = 20000;
  let cache = null;
  let inFlight = null;

  // What we ask for, and how each result should be spoken about. `priority`
  // decides ordering when several things are the same distance away — an
  // accessible toilet matters more to this app's users than a bin does.
  const WANTED = [
    { tag: 'amenity=toilets',        icon: "🚻", label: "Toilets",          priority: 1 },
    { tag: 'amenity=bench',          icon: "🪑", label: "Bench",            priority: 3 },
    { tag: 'amenity=drinking_water', icon: "🚰", label: "Drinking water",   priority: 2 },
    { tag: 'amenity=parking',        icon: "🅿️", label: "Parking",          priority: 2 },
    { tag: 'leisure=playground',     icon: "🛝", label: "Playground",       priority: 4 },
    { tag: 'entrance',               icon: "🚪", label: "Entrance",         priority: 1 },
    { tag: 'barrier=gate',           icon: "🚧", label: "Gate",             priority: 2 }
  ];

  function buildQuery(lat, lng, radius) {
    const parts = WANTED.map(w => {
      const filter = w.tag.includes("=")
        ? `["${w.tag.split("=")[0]}"="${w.tag.split("=")[1]}"]`
        : `["${w.tag}"]`;
      return `node(around:${radius},${lat},${lng})${filter};way(around:${radius},${lat},${lng})${filter};`;
    }).join("");
    return `[out:json][timeout:25];(${parts});out center 150;`;
  }

  async function fetchWithTimeout(url, options, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  function classify(tags) {
    for (const w of WANTED) {
      if (w.tag.includes("=")) {
        const [k, v] = w.tag.split("=");
        if (tags[k] === v) return w;
      } else if (tags[w.tag] !== undefined) {
        return w;
      }
    }
    return { icon: "📍", label: "Feature", priority: 9 };
  }

  // OSM's wheelchair tag is a three-state answer to a real question, so
  // pass it through honestly — "limited" is not "yes", and an untagged
  // feature is unknown, not accessible.
  function accessNote(tags) {
    const bits = [];
    if (tags.wheelchair === "yes") bits.push("step-free");
    else if (tags.wheelchair === "limited") bits.push("partly accessible");
    else if (tags.wheelchair === "no") bits.push("not step-free");
    else bits.push("accessibility not recorded");
    if (tags.fee === "no") bits.push("free");
    if (tags.changing_table === "yes") bits.push("changing table");
    if (tags["capacity:disabled"]) bits.push(tags["capacity:disabled"] + " accessible bays");
    return bits.join(" · ");
  }

  async function overpass(query) {
    let lastErr;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetchWithTimeout(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query)
        }, TIMEOUT_MS);
        if (!res.ok) throw new Error("HTTP " + res.status);
        // Overpass answers an overloaded server with an HTML error page and
        // a 200, so a JSON parse failure here means "busy", not "broken".
        return await res.json();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("all Overpass endpoints failed");
  }

  async function nearby(lat = PARK_ANCHOR.lat, lng = PARK_ANCHOR.lng, radius = 400) {
    if (cache) return cache;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const data = await overpass(buildQuery(lat, lng, radius));
      const seen = new Set();
      const out = [];
      for (const el of data.elements || []) {
        const p = el.center || el;
        if (p.lat == null || p.lon == null) continue;
        const tags = el.tags || {};
        const kind = classify(tags);
        // Ways and their centre nodes can both come back for one feature.
        const dedupe = kind.label + ":" + p.lat.toFixed(5) + "," + p.lon.toFixed(5);
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push({
          lat: p.lat,
          lng: p.lon,
          icon: kind.icon,
          label: tags.name || kind.label,
          kind: kind.label,
          priority: kind.priority,
          wheelchair: tags.wheelchair || null,
          note: accessNote(tags),
          distance: Math.round(Geo.distanceMeters({ lat, lng }, { lat: p.lat, lng: p.lon }))
        });
      }
      out.sort((a, b) => (a.priority - b.priority) || (a.distance - b.distance));
      cache = out;
      inFlight = null;
      return out;
    })();

    return inFlight;
  }

  // Nearest features to a live position, re-sorted from there.
  async function nearestTo(fix, kinds = null, limit = 5) {
    const all = await nearby();
    return all
      .map(p => ({ ...p, distance: Math.round(Geo.distanceMeters(fix, p)) }))
      .filter(p => !kinds || kinds.includes(p.kind))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

  async function describeLocation(lat, lng) {
    const url = `${NOMINATIM_URL}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=${document.documentElement.lang === "ar" ? "ar" : "en"}`;
    try {
      const res = await fetchWithTimeout(url, {}, TIMEOUT_MS);
      if (!res.ok) return null;
      const d = await res.json();
      const a = d.address || {};
      // Prefer the specific over the administrative: a visitor wants to hear
      // "on the walkway in Al Jahili", not "United Arab Emirates".
      const where = d.name || a.road || a.pedestrian || a.footway || a.leisure || a.village || a.suburb;
      return {
        short: where || d.display_name,
        full: d.display_name,
        type: d.type,
        category: d.category
      };
    } catch (_) {
      return null;
    }
  }

  window.ClearPathPlaces = { nearby, nearestTo, describeLocation, clearCache: () => { cache = null; } };
})();
