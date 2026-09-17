// gemini.js — talk to Gemini directly from the browser, with the visitor's
// own key.
//
// The published site is static: there is no server, so there is nowhere safe
// to keep a shared key. Three options were possible and only one is honest:
//
//   1. bake a key into the page        — it is public the moment it ships,
//                                        and anyone can bill the owner
//   2. run the proxy and keep it there — safest, but needs a machine running
//   3. each visitor supplies their own — key lives in their browser, is sent
//                                        only to Google, and is never in the
//                                        repo, the HTML, or anyone's git log
//
// This is (3), with (2) still preferred whenever the proxy is reachable:
// assist.js tries the proxy first and only falls back to here. A key entered
// here is stored in localStorage on that device alone.
//
// Model names move; rather than hardcode one and break later, a 404 triggers
// ListModels and the first available flash-class model that supports
// generateContent is adopted and remembered.
(function () {
  const KEY_STORAGE = "clearpath_gemini_key";
  const MODEL_STORAGE = "clearpath_gemini_model";
  const BASE = "https://generativelanguage.googleapis.com/v1beta";
  const DEFAULT_MODEL = "gemini-2.5-flash";
  const TIMEOUT_MS = 25000;

  function getKey() {
    try { return localStorage.getItem(KEY_STORAGE) || ""; } catch (_) { return ""; }
  }
  function setKey(k) {
    try {
      const v = String(k || "").trim();
      if (v) localStorage.setItem(KEY_STORAGE, v);
      else localStorage.removeItem(KEY_STORAGE);
    } catch (_) {}
  }
  function getModel() {
    try { return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL; } catch (_) { return DEFAULT_MODEL; }
  }
  function setModel(m) {
    try { localStorage.setItem(MODEL_STORAGE, m); } catch (_) {}
  }

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  }

  // Names change between releases. Ask the API what it actually has rather
  // than shipping a guess that rots.
  async function discoverModel(key) {
    try {
      const res = await withTimeout(fetch(`${BASE}/models?key=${encodeURIComponent(key)}`), TIMEOUT_MS);
      if (!res.ok) return null;
      const data = await res.json();
      const usable = (data.models || []).filter(m =>
        (m.supportedGenerationMethods || []).includes("generateContent"));
      const pick = usable.find(m => /flash/i.test(m.name) && !/thinking|vision-only/i.test(m.name))
        || usable.find(m => /pro/i.test(m.name))
        || usable[0];
      if (!pick) return null;
      const name = pick.name.replace(/^models\//, "");
      setModel(name);
      return name;
    } catch (_) {
      return null;
    }
  }

  function dataUrlToInline(dataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
    if (!m) return null;
    return { mime_type: m[1], data: m[2] };
  }

  async function call(model, key, body) {
    const res = await withTimeout(fetch(
      `${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    ), TIMEOUT_MS);
    return res;
  }

  function textFrom(data) {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map(p => p.text || "").join("").trim();
  }

  function stripFence(s) {
    return String(s || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }

  /* ── Ask about an image ──
     Mirrors the proxy's /api/assist contract exactly — same modes, same
     {answer, confident} shape — so assist.js does not care which path
     answered. `confident:false` is what drives the hand-off to a human. */
  const SYSTEM = {
    ask: `You are the eyes of a blind or low-vision person, describing a photograph they just took with their phone.

Answer their question directly and first. Then add only what matters for moving safely: the walking surface, steps or kerbs, obstacles, people in the way, shade, somewhere to sit.

Describe only what is visibly in the photograph. Never guess. If you cannot tell, say so plainly.`,
    read: `You read text aloud for a blind or low-vision person from a photograph they just took.

Transcribe every piece of text you can actually read, in reading order. Keep the original wording. If some text is cut off or blurred, say which part. If there is no readable text, say so.

After the transcription, add one short sentence saying what the text appears to be.`,
    explain: `You explain confusing documents, forms, notices and screens to someone who finds official language hard — including people with learning disabilities, and people reading in a second language.

Be concrete and calm. Short sentences. No jargon. Never invent a requirement, deadline, fee or phone number that is not visibly there. Never tell the person to enter a password or payment details.`
  };

  function buildPrompt(mode, question, lang, simple) {
    const langLine = lang === "ar"
      ? "Answer in Arabic (Modern Standard Arabic, as used in the UAE). Do not answer in English."
      : "Answer in English.";
    const simpleLine = simple ? "Use very simple language: short sentences, common words, one idea per sentence." : "";
    const task = mode === "read"
      ? "Read out the text in this photograph."
      : mode === "explain"
        ? "Explain this document or screen: what it is, what it is asking the person to do, the steps to follow, and anything to be careful about."
        : (question || "What is in front of me?");
    return [
      task, langLine, simpleLine,
      'Reply as JSON only, no code fence: {"answer": "...", "confident": true|false}.',
      '"confident" must be false if the image is blurred, dark, ambiguous, or the question cannot be settled from it.'
    ].filter(Boolean).join("\n");
  }

  async function assist({ image, question, mode = "ask", lang = "en", simple = false }) {
    const key = getKey();
    if (!key) return { ok: false, reason: "no-key" };
    const inline = dataUrlToInline(image);
    if (!inline) return { ok: false, reason: "bad-image" };

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM[mode] || SYSTEM.ask }] },
      contents: [{ role: "user", parts: [
        { text: buildPrompt(mode, question, lang, simple) },
        { inline_data: inline }
      ] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 700, responseMimeType: "application/json" }
    };

    let model = getModel();
    let res = await call(model, key, body);

    // Model retired or renamed — find a live one and retry once.
    if (res.status === 404) {
      const found = await discoverModel(key);
      if (found) { model = found; res = await call(model, key, body); }
    }
    if (res.status === 400 || res.status === 403) {
      return { ok: false, reason: "bad-key" };
    }
    if (!res.ok) return { ok: false, reason: "upstream", status: res.status };

    const data = await res.json().catch(() => null);
    const raw = stripFence(textFrom(data));
    if (!raw) return { ok: false, reason: "empty" };
    try {
      const o = JSON.parse(raw);
      if (typeof o.answer === "string") return { ok: true, answer: o.answer, confident: o.confident !== false, model };
    } catch (_) { /* prose instead of JSON */ }
    // It answered, just not as JSON. Usable, but we cannot claim confidence.
    return { ok: true, answer: raw, confident: false, model };
  }

  /* ── Explain a link ──
     The browser cannot fetch an arbitrary page (CORS), so unlike the proxy
     path this asks the model about the URL itself and says so plainly rather
     than pretending it read the page. */
  async function explainUrl({ url, lang = "en", simple = false }) {
    const key = getKey();
    if (!key) return { ok: false, reason: "no-key" };
    const langLine = lang === "ar"
      ? "Write your whole answer in Arabic (Modern Standard Arabic)."
      : "Write your whole answer in English.";
    const prompt = `${langLine}
${simple ? "Use very simple language." : ""}

A person who finds official language hard has been sent this web address and wants to know what it is before they open it:

${url}

Say what kind of page this address most likely leads to, judging only from the address itself — the domain, the path, and any obvious words in it. Be explicit that you have NOT opened the page and are reading the address only. Warn them if the address looks like a login page, a payment page, a shortened or disguised link, or does not match the organisation it claims to be from.

Reply as JSON only, no code fence:
{"what":"...","asks":"...","steps":["..."],"watch":"..."}`;

    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 700, responseMimeType: "application/json" }
    };
    let model = getModel();
    let res = await call(model, key, body);
    if (res.status === 404) {
      const found = await discoverModel(key);
      if (found) { model = found; res = await call(model, key, body); }
    }
    if (res.status === 400 || res.status === 403) return { ok: false, reason: "bad-key" };
    if (!res.ok) return { ok: false, reason: "upstream", status: res.status };
    const data = await res.json().catch(() => null);
    const raw = stripFence(textFrom(data));
    try {
      const o = JSON.parse(raw);
      return { ok: true, addressOnly: true, ...o };
    } catch (_) {
      return { ok: true, addressOnly: true, what: raw, asks: "", steps: [], watch: "" };
    }
  }

  // Cheap validation so the settings UI can tell the truth immediately
  // instead of failing later on a real question.
  async function test() {
    const key = getKey();
    if (!key) return { ok: false, reason: "no-key" };
    try {
      const res = await withTimeout(fetch(`${BASE}/models?key=${encodeURIComponent(key)}`), TIMEOUT_MS);
      if (res.status === 400 || res.status === 403) return { ok: false, reason: "bad-key" };
      if (!res.ok) return { ok: false, reason: "upstream", status: res.status };
      const data = await res.json();
      const n = (data.models || []).length;
      return { ok: true, models: n, model: getModel() };
    } catch (_) {
      return { ok: false, reason: "network" };
    }
  }

  window.ClearPathGemini = {
    assist, explainUrl, test,
    getKey, setKey, getModel, setModel, discoverModel,
    get hasKey() { return !!getKey(); }
  };
})();
