/* ═══════════════════════════════════════════════════════
   ai.js — Personalised route cues

   Ported from the AI dialogue layer in my Sunrise Semester repo
   (js/ai.js + server/proxy.mjs). Same shape as there: the browser talks
   only to a local proxy, the API key lives in the server process, and
   every call returns null on any failure so the caller falls back to the
   written text without the user ever seeing an error.

   Why it exists here: the README's own honest note was that ClearPath's
   AI was thin, and that the obvious fix was to generate the stage `cue`
   instead of hardcoding one string for everybody. That is what this does.
   The same stage is described differently to someone using a wheelchair,
   someone who cannot see the gate, and someone who overheats — which is
   exactly the workshop deck's point that the same place creates different
   barriers for different people.

   Hard rule, enforced in the prompt and re-checked on the way out: the
   model may only rephrase facts it was handed. It must never invent an
   accessibility claim. Telling someone a route is step-free when nobody
   established that is the one failure mode this feature could have.
═══════════════════════════════════════════════════════ */

const ClearPathAI = (() => {

  let enabled = false;
  let available = null;          // null = untested, true/false after first call
  const cache = Object.create(null);

  function setEnabled(val) {
    enabled = !!val;
    if (enabled && available === null) probe();
  }

  const PROFILE_NEEDS = {
    mobility: "uses a wheelchair or mobility aid — step-free continuity, kerb drops and path width matter most",
    vision:   "is blind or has low vision — cannot read signs, needs direction, surface changes and landmarks described in words",
    heat:     "is affected by heat — shade and distance between rest points matter most",
    quiet:    "is sensitive to noise and crowds — needs warning about busy or loud areas and where the calm routes are",
    cognitive:"needs simple, predictable instructions — one step at a time, no jargon, no surprises"
  };

  const SYSTEM = `You write short spoken wayfinding cues for visitors with disabilities arriving at Al Jahili Park in Al Ain, UAE.

ABSOLUTE RULE: you may only restate facts given to you in the FACTS block. Never invent or assume any accessibility detail — not step-free status, not shade, not distances, not facilities. If a fact is not in the block, do not mention it. Inventing an access claim could physically strand someone.

Style:
- Second person, present tense, plain language. No jargon.
- At most two short sentences. This is read aloud while someone is walking.
- Lead with the action, then the reason.
- Never say "disabled", "handicapped" or "suffers from". Never be patronising or congratulatory.
- No emoji, no markdown, no quotation marks.`;

  async function ask({ prompt, maxTokens }) {
    try {
      const response = await fetch(ClearPathAPI.url("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: SYSTEM,
          model: "anthropic/claude-haiku-4.5",
          max_tokens: maxTokens || 120,
          temperature: 0.4,
          messages: [{ role: "user", content: prompt }]
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.warn("[ai] proxy error:", data.error || response.status);
        available = false;
        return null;
      }
      available = true;
      return data.text || null;

    } catch (e) {
      console.warn("[ai] request failed:", e.message);
      available = false;
      return null;
    }
  }

  // Cheap liveness check so the settings toggle can tell the truth about
  // whether AI cues are actually going to happen.
  async function probe() {
    try {
      const res = await fetch(ClearPathAPI.url("/api/chat"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "ping" }], max_tokens: 5 }) });
      available = res.ok;
    } catch (_) {
      available = false;
    }
    window.dispatchEvent(new CustomEvent("clearpath:ai-status", { detail: { available } }));
    return available;
  }

  function factsFor(stage, ctx = {}) {
    const lines = [
      `Stage ${stage.stage} of ${JOURNEY.length}: ${stage.title}.`,
      `Written description: ${stage.description}`,
      `Step-free: ${stage.stepFree ? "yes" : "no"}.`,
      `Shade: ${stage.shade}.`,
      `Surface: ${stage.surface}.`,
      `Rest point here: ${stage.restPoint ? "yes" : "no"}.`,
      `Route-confidence score: ${confidenceScore(stage)} out of 100.`
    ];
    if (ctx.distance != null) lines.push(`Distance from the visitor right now: ${ctx.distance} metres.`);
    if (ctx.gpsQuality) lines.push(`GPS quality: ${ctx.gpsQuality}.`);
    if (ctx.maneuver) lines.push(`Next routing instruction from the map: ${ctx.maneuver}`);
    if (ctx.places && ctx.places.length) {
      lines.push("Nearby mapped features: " + ctx.places
        .map(p => `${p.label} ${p.distance} m away (${p.note})`).join("; ") + ".");
    }
    if (ctx.obstacle) lines.push(`The camera just detected: ${ctx.obstacle}.`);
    return lines.join("\n");
  }

  function needsFor(profile) {
    const set = [...(profile || [])].map(k => PROFILE_NEEDS[k]).filter(Boolean);
    if (!set.length) return "No specific access profile selected — keep it general and clear.";
    return "The visitor " + set.join("; and ") + ".";
  }

  // Last line of defence. If the model rambles, or wanders into a claim we
  // never gave it, we drop the whole thing and use the written cue.
  const FORBIDDEN = /\b(ramp|lift|elevator|handrail|escalator|braille|tactile paving|wheelchair[- ]accessible)\b/i;

  function validate(text, stage) {
    if (!text) return null;
    const clean = text.trim().replace(/^["']|["']$/g, "");
    if (clean.length < 8 || clean.length > 260) return null;
    // Only allow a facility word through if the facts we supplied actually
    // contained it.
    const supplied = (stage.description + " " + stage.surface).toLowerCase();
    const m = clean.match(FORBIDDEN);
    if (m && !supplied.includes(m[0].toLowerCase())) {
      console.warn("[ai] rejected cue: unsupported claim", m[0]);
      return null;
    }
    return clean;
  }

  /* ── Main entry point ──
     Returns a personalised cue, or null so the caller uses stage.cue. */
  async function cueFor(stage, ctx = {}) {
    if (!enabled || available === false) return null;

    const profileKey = [...(AppState.profile || [])].sort().join(",") || "none";
    const key = `${stage.id}|${I18n.lang()}|${profileKey}|${ctx.distance != null ? Math.round(ctx.distance / 25) : "x"}|${ctx.obstacle || ""}`;
    if (cache[key]) return cache[key];

    const langLine = I18n.lang() === "ar"
      ? "Write the cue in Arabic (Modern Standard Arabic, as used in the UAE). Do not write in English."
      : "Write the cue in English.";

    const prompt = `${needsFor(AppState.profile)}

${langLine}

FACTS:
${factsFor(stage, ctx)}

Write the spoken cue for this stage, for this visitor.`;

    const raw = await ask({ prompt });
    const cue = validate(raw, stage);
    if (cue) cache[key] = cue;
    return cue;
  }

  /* Speak a stage: AI cue if we can get one in time, written cue otherwise.
     The timeout matters — someone walking toward a gate cannot wait three
     seconds to be told which way to turn, so the written cue wins on delay. */
  async function speakStage(stage, ctx = {}, warmth) {
    // The written fallback has to follow the chosen language too, or Arabic
    // speakers silently get English the moment the proxy isn't running.
    const written = I18n.tx(stage, "cue") || stage.cue;
    if (!enabled || available === false) { speak(written, warmth); return written; }
    const raced = await Promise.race([
      cueFor(stage, ctx),
      new Promise(resolve => setTimeout(() => resolve(null), 2500))
    ]);
    const text = raced || written;
    speak(text, warmth);
    return text;
  }

  return {
    setEnabled,
    cueFor,
    speakStage,
    probe,
    get isEnabled() { return enabled; },
    get isAvailable() { return available; }
  };
})();

window.ClearPathAI = ClearPathAI;
