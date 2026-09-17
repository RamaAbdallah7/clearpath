// routing.js — real pedestrian routing, not straight lines.
//
// The original map drew a polyline straight through the five stages, which
// cut across lawns, flowerbeds and a road. That is precisely the kind of
// "route" that strands a wheelchair user, so it had to go.
//
// This asks a real routing engine for a real walking route along mapped
// footpaths. Provider is Valhalla on the OpenStreetMap community server:
// it is keyless, sends Access-Control-Allow-Origin, and has a genuine
// pedestrian costing model (it will not route you along a carriageway).
// OpenRouteService is supported as an alternative because its
// wheelchair profile is better, but it needs an API key, so it is opt-in
// and the key stays on the local proxy — never in this file.
//
// If both are unreachable the app degrades to the straight line it used to
// draw, clearly labelled as such, rather than silently pretending.
(function () {
  const VALHALLA_URL = "https://valhalla1.openstreetmap.de/route";
  const PROXY_ROUTE_URL = "/api/route";   // optional ORS-via-proxy
  const CACHE = new Map();
  const TIMEOUT_MS = 12000;

  // Valhalla encodes shapes at precision 6, not the precision 5 that most
  // "decode a Google polyline" snippets assume. Getting this wrong puts the
  // route in the Indian Ocean, so it is worth the explicit constant.
  function decodePolyline(str, precision = 6) {
    const factor = Math.pow(10, precision);
    const coords = [];
    let index = 0, lat = 0, lng = 0;
    while (index < str.length) {
      for (let i = 0; i < 2; i++) {
        let shift = 0, result = 0, byte;
        do {
          byte = str.charCodeAt(index++) - 63;
          result |= (byte & 0x1f) << shift;
          shift += 5;
        } while (byte >= 0x20);
        const delta = (result & 1) ? ~(result >> 1) : (result >> 1);
        if (i === 0) lat += delta; else lng += delta;
      }
      coords.push([lat / factor, lng / factor]);
    }
    return coords;
  }

  function keyFor(points) {
    return points.map(p => p.lat.toFixed(5) + "," + p.lng.toFixed(5)).join("|");
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("routing timeout")), ms))
    ]);
  }

  function straightLineFallback(points) {
    let distance = 0;
    for (let i = 1; i < points.length; i++) distance += Geo.distanceMeters(points[i - 1], points[i]);
    return {
      provider: "straight-line",
      degraded: true,
      shape: points.map(p => [p.lat, p.lng]),
      distance: Math.round(distance),
      // 1.0 m/s is a deliberately unhurried walking pace — the people this
      // app is for are not power-walking, and over-promising arrival times
      // is its own small accessibility failure.
      duration: Math.round(distance / 1.0),
      legs: []
    };
  }

  async function viaValhalla(points) {
    const body = {
      locations: points.map(p => ({ lat: p.lat, lon: p.lng, type: "break" })),
      costing: "pedestrian",
      costing_options: { pedestrian: { walking_speed: 3.0, use_ferry: 0 } },
      directions_options: { units: "kilometers" }
    };
    const res = await withTimeout(fetch(VALHALLA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }), TIMEOUT_MS);
    if (!res.ok) throw new Error("Valhalla HTTP " + res.status);
    const data = await res.json();
    const trip = data && data.trip;
    if (!trip || !trip.legs || !trip.legs.length) throw new Error("Valhalla returned no route");

    let shape = [];
    const legs = trip.legs.map(leg => {
      const legShape = decodePolyline(leg.shape, 6);
      shape = shape.concat(legShape);
      return {
        distance: Math.round((leg.summary.length || 0) * 1000),
        duration: Math.round(leg.summary.time || 0),
        maneuvers: (leg.maneuvers || []).map(m => ({
          distance: Math.round((m.length || 0) * 1000),
          // verbal_pre_transition_instruction is written to be spoken;
          // `instruction` is written to be read. We do both, so keep both.
          spoken: m.verbal_pre_transition_instruction || m.instruction || "",
          text: m.instruction || "",
          street: (m.street_names || []).join(", ")
        }))
      };
    });

    return {
      provider: "valhalla",
      degraded: false,
      shape,
      distance: Math.round((trip.summary.length || 0) * 1000),
      duration: Math.round(trip.summary.time || 0),
      legs
    };
  }

  // Optional: OpenRouteService wheelchair profile, proxied so the key never
  // reaches the browser. Returns null (not throws) when the proxy has no key
  // configured, so the caller just moves on to Valhalla.
  async function viaProxyORS(points, profile) {
    try {
      const res = await withTimeout(fetch(PROXY_ROUTE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: points.map(p => [p.lng, p.lat]), profile })
      }), TIMEOUT_MS);
      if (res.status === 503 || res.status === 404) return null;   // no key / no proxy
      if (!res.ok) return null;
      const data = await res.json();
      const feat = data.features && data.features[0];
      if (!feat) return null;
      return {
        provider: "openrouteservice/" + profile,
        degraded: false,
        shape: feat.geometry.coordinates.map(c => [c[1], c[0]]),
        distance: Math.round(feat.properties.summary.distance),
        duration: Math.round(feat.properties.summary.duration),
        legs: (feat.properties.segments || []).map(seg => ({
          distance: Math.round(seg.distance),
          duration: Math.round(seg.duration),
          maneuvers: (seg.steps || []).map(s => ({
            distance: Math.round(s.distance),
            spoken: s.instruction,
            text: s.instruction,
            street: s.name && s.name !== "-" ? s.name : ""
          }))
        }))
      };
    } catch (_) {
      return null;
    }
  }

  // points: [{lat,lng}, ...]. Profile "wheelchair" is only honoured by ORS;
  // Valhalla falls back to its pedestrian model, which is still path-aware.
  async function route(points, opts = {}) {
    if (!points || points.length < 2) throw new Error("route() needs at least two points");
    const cacheKey = (opts.profile || "foot") + ":" + keyFor(points);
    if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

    let result = null;
    if (opts.profile === "wheelchair") {
      result = await viaProxyORS(points, "wheelchair");
    }
    if (!result) {
      try {
        result = await viaValhalla(points);
      } catch (e) {
        console.warn("[routing] falling back to straight line:", e.message);
        result = straightLineFallback(points);
      }
    }
    CACHE.set(cacheKey, result);
    return result;
  }

  // The whole 5-stage arrival journey.
  function routeJourney(opts) {
    return route(JOURNEY.map(s => ({ lat: s.lat, lng: s.lng })), opts);
  }

  // From wherever the visitor actually is, to the stage they're heading for.
  // Not cached by live position — that would defeat the point — so the
  // caller is responsible for not hammering it.
  function routeFromLive(fix, stage, opts = {}) {
    return route([{ lat: fix.lat, lng: fix.lng }, { lat: stage.lat, lng: stage.lng }], opts);
  }

  window.ClearPathRouting = { route, routeJourney, routeFromLive, decodePolyline };
})();
