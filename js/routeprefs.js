// routeprefs.js — "best route for me", not "shortest route".
//
// The profile toggles used to do two small things: flag stages that might not
// suit you, and switch the routing profile to wheelchair. They never changed
// which way you were actually sent.
//
// This makes the preferences decide the route. It builds several candidate
// routes over the same park, scores each one against what this particular
// visitor needs, and picks a winner — then says WHY it won, because a route
// chosen by an opaque score is not something you can disagree with.
//
// The scoring is deliberately simple and inspectable. It is not a model, it
// is arithmetic over attributes that are recorded in journey-data.js and
// OpenStreetMap, and every number it produces can be traced to one of them.
(function () {
  // What each need actually cares about. Weights sum to roughly 1 per need,
  // and needs stack when a visitor selects more than one.
  const NEEDS = {
    mobility: {
      label: { en: "Wheelchair or mobility aid", ar: "كرسي متحرك أو وسيلة مساعدة" },
      weights: { stepFree: 0.55, evenSurface: 0.25, rest: 0.10, shade: 0.05, distance: 0.05 },
      profile: "wheelchair"
    },
    walkingAid: {
      label: { en: "I tire easily / use a stick", ar: "أتعب بسرعة / أستخدم عصا" },
      weights: { rest: 0.40, distance: 0.25, evenSurface: 0.20, stepFree: 0.10, shade: 0.05 }
    },
    vision: {
      label: { en: "Blind or low vision", ar: "كفيف أو ضعيف البصر" },
      // Predictability matters more than speed: fewer turns, even surface,
      // and landmarks you can be told about.
      weights: { evenSurface: 0.35, simplicity: 0.30, stepFree: 0.20, rest: 0.10, distance: 0.05 }
    },
    heat: {
      label: { en: "Affected by heat", ar: "أتأثر بالحرارة" },
      weights: { shade: 0.50, rest: 0.25, distance: 0.20, evenSurface: 0.05 }
    },
    quiet: {
      label: { en: "Sensitive to noise and crowds", ar: "حسّاس للضجيج والزحام" },
      weights: { quiet: 0.55, rest: 0.20, simplicity: 0.15, distance: 0.10 }
    },
    stroller: {
      label: { en: "Pushing a stroller", ar: "أدفع عربة أطفال" },
      weights: { stepFree: 0.40, evenSurface: 0.35, distance: 0.15, shade: 0.10 }
    }
  };

  // Candidate routes over the same five stages. Each is a real ordering of
  // real OSM features, not a synthetic variant.
  const CANDIDATES = [
    {
      id: "full",
      name: { en: "The full arrival journey", ar: "رحلة الوصول الكاملة" },
      why: { en: "Every stage, with the toilets and shaded seating on the way.",
             ar: "كل المراحل، مع دورات المياه والمقاعد الظليلة في الطريق." },
      stages: ["parking", "entrance", "internal-paths", "seating-shade", "park-use"]
    },
    {
      id: "direct",
      name: { en: "Straight to the park", ar: "مباشرةً إلى الحديقة" },
      why: { en: "Fewest stops and the shortest walk, skipping the rest points.",
             ar: "أقل توقفات وأقصر مسير، مع تخطّي نقاط الاستراحة." },
      stages: ["parking", "entrance", "internal-paths", "park-use"]
    },
    {
      id: "shaded",
      name: { en: "Shade and rest first", ar: "الظل والاستراحة أولاً" },
      why: { en: "Goes via the shaded walkway and the seating before the open lawn.",
             ar: "يمرّ بالممشى الظليل ومنطقة الجلوس قبل المساحة المكشوفة." },
      stages: ["parking", "entrance", "internal-paths", "seating-shade"]
    }
  ];

  function stagesOf(ids) {
    return ids.map(id => JOURNEY.find(s => s.id === id)).filter(Boolean);
  }

  /* ── Attribute scores, each 0..1 ────────────────────────────────── */
  function attributes(stages, routeResult) {
    const n = stages.length || 1;
    const stepFree = stages.filter(s => s.stepFree).length / n;
    const evenSurface = stages.filter(s => !/uneven|sand|gravel/i.test(s.surface)).length / n;
    const shade = stages.reduce((a, s) => a + (s.shade === "high" ? 1 : s.shade === "medium" ? 0.55 : 0.15), 0) / n;
    const rest = Math.min(1, stages.filter(s => s.restPoint).length / Math.max(1, n - 1));
    // Playgrounds are the loud part of this park; treat them as the noise
    // proxy rather than inventing a decibel figure we do not have.
    const quiet = 1 - (stages.filter(s => /play/i.test(s.id + s.title)).length / n);

    // Distance and simplicity come from the actual routed result when we have
    // one, so they reflect the paths rather than the straight line.
    const metres = routeResult ? routeResult.distance : null;
    const turns = routeResult
      ? routeResult.legs.reduce((a, l) => a + (l.maneuvers ? l.maneuvers.length : 0), 0)
      : null;
    // 300 m is effortless, 1500 m is a long way in Al Ain heat.
    const distance = metres == null ? 0.5 : Math.max(0, Math.min(1, 1 - (metres - 300) / 1200));
    // Under 8 manoeuvres is easy to follow; over 30 is a maze.
    const simplicity = turns == null ? 0.5 : Math.max(0, Math.min(1, 1 - (turns - 8) / 22));

    return { stepFree, evenSurface, shade, rest, quiet, distance, simplicity, metres, turns };
  }

  // Combine the weights of every need the visitor selected.
  function weightsFor(selected) {
    const keys = [...selected].filter(k => NEEDS[k]);
    if (!keys.length) {
      // No profile chosen: a sensible general default rather than nothing.
      return { stepFree: 0.25, shade: 0.2, rest: 0.15, evenSurface: 0.15, distance: 0.15, simplicity: 0.1, quiet: 0 };
    }
    const out = {};
    for (const k of keys) {
      for (const [attr, w] of Object.entries(NEEDS[k].weights)) {
        out[attr] = (out[attr] || 0) + w;
      }
    }
    const total = Object.values(out).reduce((a, b) => a + b, 0) || 1;
    for (const k of Object.keys(out)) out[k] /= total;
    return out;
  }

  function scoreOf(attrs, weights) {
    let score = 0;
    for (const [attr, w] of Object.entries(weights)) score += (attrs[attr] ?? 0.5) * w;
    return Math.round(score * 100);
  }

  // The two or three attributes that actually decided it, so the choice can
  // be explained in a sentence instead of asserted as a number.
  function reasons(attrs, weights, lang) {
    const L = (en, arT) => (lang === "ar" ? arT : en);
    const named = {
      stepFree:    [L("step-free the whole way", "خالٍ من الدرجات طوال الطريق"),  L("has steps or kerbs", "به درجات أو أرصفة مرتفعة")],
      evenSurface: [L("even paving throughout", "بلاط مستوٍ بالكامل"),            L("some uneven or sandy ground", "أرض غير مستوية أو رملية")],
      shade:       [L("well shaded", "ظليل جيداً"),                                L("little shade", "ظل قليل")],
      rest:        [L("rest points along the way", "نقاط استراحة على الطريق"),     L("few places to stop", "أماكن توقف قليلة")],
      quiet:       [L("avoids the noisy play area", "يتجنّب منطقة اللعب الصاخبة"), L("passes the play area", "يمرّ بمنطقة اللعب")],
      distance:    [L("a short walk", "مسير قصير"),                                L("a longer walk", "مسير أطول")],
      simplicity:  [L("few turns to follow", "منعطفات قليلة"),                      L("many turns", "منعطفات كثيرة")]
    };
    return Object.entries(weights)
      .filter(([, w]) => w > 0.08)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([attr]) => {
        const good = (attrs[attr] ?? 0.5) >= 0.6;
        return { text: named[attr] ? named[attr][good ? 0 : 1] : attr, good };
      });
  }

  /* ── Rank every candidate ───────────────────────────────────────── */
  async function rank(selected) {
    const weights = weightsFor(selected);
    const wantsWheelchair = selected.has("mobility") || selected.has("stroller");
    const out = [];

    for (const c of CANDIDATES) {
      const stages = stagesOf(c.stages);
      let routed = null;
      try {
        routed = await ClearPathRouting.route(
          stages.map(s => ({ lat: s.lat, lng: s.lng })),
          { profile: wantsWheelchair ? "wheelchair" : "foot" });
      } catch (_) { /* scored on attributes alone */ }

      const attrs = attributes(stages, routed);
      out.push({
        ...c,
        stages,
        route: routed,
        attrs,
        score: scoreOf(attrs, weights),
        reasons: reasons(attrs, weights, I18n.lang()),
        profileUsed: wantsWheelchair ? "wheelchair" : "foot"
      });
    }

    out.sort((a, b) => b.score - a.score);
    return { weights, ranked: out, needs: [...selected].filter(k => NEEDS[k]) };
  }

  window.ClearPathRoutePrefs = { NEEDS, CANDIDATES, rank, weightsFor };
})();
