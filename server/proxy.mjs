/* ═══════════════════════════════════════════════════════
   proxy.mjs — Local dev server + key proxy

   Serves ClearPath's static files AND exposes two endpoints whose API
   keys must never reach the browser:

     POST /api/chat    → OpenRouter, for the personalised route cues
     POST /api/assist  → OpenRouter vision, for the camera assist screen
     POST /api/explain → OpenRouter, for plain-language link explanations
     POST /api/route   → OpenRouteService, for the wheelchair routing profile
     /api/volunteer/*  → the volunteer hub (no keys; see volunteer.mjs)

   Ported from the same proxy in my Sunrise Semester repo. Both keys live
   in this process; the browser only ever sees the result.

   Run:  node server/proxy.mjs
   Then: http://localhost:5173

   Everything in ClearPath works without this server — cues fall back to
   the written text and routing falls back to keyless Valhalla. Run it only
   when you want the AI cues or the wheelchair profile.

   Requires Node 18+ (native fetch). Zero dependencies.
═══════════════════════════════════════════════════════ */

import http  from 'node:http';
import https from 'node:https';
import os    from 'node:os';
import fs    from 'node:fs/promises';
import path  from 'node:path';
import dns   from 'node:dns/promises';
import net   from 'node:net';
import { fileURLToPath } from 'node:url';
import * as volunteerHub from './volunteer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

/* ── Load .env (simple KEY=VALUE parser, no dependency) ── */
async function loadEnv() {
  try {
    const raw = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val   = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* no .env file — fall back to real environment variables */
  }
}

/* ── Guardrails ──
   The browser can only ask for models on this list, and only within these
   limits. Without an allowlist, anyone who can reach the proxy could bill
   your key against any model. */
const ALLOWED_MODELS = new Set([
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-sonnet-4.5',
  'openai/gpt-4o-mini',
  'openai/gpt-4o'
]);
const DEFAULT_MODEL  = 'anthropic/claude-haiku-4.5';
const MAX_TOKENS_CAP = 300;
const MAX_MESSAGES   = 8;
const MAX_BODY_BYTES = 32 * 1024;

const ALLOWED_ORS_PROFILES = new Set(['wheelchair', 'foot-walking']);
const MAX_ROUTE_POINTS = 10;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.woff2':'font/woff2',
  '.ico':  'image/x-icon'
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type':   'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control':  'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let overflow = false;
    const chunks = [];

    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // Stop buffering, but keep draining so we can still answer with a
        // real 413 instead of dropping the connection.
        overflow = true;
        chunks.length = 0;
        if (size > MAX_BODY_BYTES * 20) req.destroy();
        return;
      }
      chunks.push(c);
    });

    req.on('end', () => {
      if (overflow) {
        const err = new Error(`Request body too large (max ${MAX_BODY_BYTES} bytes).`);
        err.statusCode = 413;
        return reject(err);
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

/* ── POST /api/chat ── */
async function handleChat(req, res) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return sendJSON(res, 503, {
      error: 'OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your key.'
    });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJSON(res, e.statusCode || 400,
      { error: e.statusCode ? e.message : 'Invalid JSON body: ' + e.message });
  }

  const { system, messages, model, max_tokens, temperature } = payload || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return sendJSON(res, 400, { error: '"messages" must be a non-empty array.' });
  }
  if (messages.length > MAX_MESSAGES) {
    return sendJSON(res, 400, { error: `Too many messages (max ${MAX_MESSAGES}).` });
  }
  for (const m of messages) {
    if (!m || typeof m.content !== 'string' || !['user', 'assistant'].includes(m.role)) {
      return sendJSON(res, 400, { error: 'Each message needs role "user"|"assistant" and string content.' });
    }
  }

  const chosenModel = model || DEFAULT_MODEL;
  if (!ALLOWED_MODELS.has(chosenModel)) {
    return sendJSON(res, 400, {
      error: `Model "${chosenModel}" is not allowed. Allowed: ${[...ALLOWED_MODELS].join(', ')}`
    });
  }

  const outMessages = typeof system === 'string' && system.trim()
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(process.env.OPENROUTER_SITE_URL  ? { 'HTTP-Referer': process.env.OPENROUTER_SITE_URL  } : {}),
        ...(process.env.OPENROUTER_SITE_NAME ? { 'X-Title':      process.env.OPENROUTER_SITE_NAME } : {})
      },
      body: JSON.stringify({
        model:       chosenModel,
        messages:    outMessages,
        max_tokens:  Math.min(Number(max_tokens) || 120, MAX_TOKENS_CAP),
        temperature: typeof temperature === 'number' ? temperature : 0.4
      })
    });

    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      // Log server-side; return a sanitised message so upstream responses
      // can never leak key material to the browser.
      console.error(`[proxy] OpenRouter ${upstream.status}:`, data?.error?.message || '(no message)');
      return sendJSON(res, upstream.status, {
        error: data?.error?.message || `Upstream error ${upstream.status}`
      });
    }

    const text = data?.choices?.[0]?.message?.content ?? null;
    return sendJSON(res, 200, { text, model: chosenModel });

  } catch (e) {
    console.error('[proxy] chat request failed:', e.message);
    return sendJSON(res, 502, { error: 'Upstream request failed.' });
  }
}

/* ── POST /api/route ──
   OpenRouteService has a genuine wheelchair costing profile (kerb heights,
   incline limits, surface types) that Valhalla's pedestrian model does not.
   It needs a key, so it lives here. Without a key we answer 503 and the
   browser quietly uses Valhalla instead. */
async function handleRoute(req, res) {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return sendJSON(res, 503, { error: 'ORS_API_KEY is not set — client should use its keyless fallback.' });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJSON(res, e.statusCode || 400,
      { error: e.statusCode ? e.message : 'Invalid JSON body: ' + e.message });
  }

  const { points, profile } = payload || {};
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_ROUTE_POINTS) {
    return sendJSON(res, 400, { error: `"points" must be 2-${MAX_ROUTE_POINTS} [lng, lat] pairs.` });
  }
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      return sendJSON(res, 400, { error: 'Each point must be a [lng, lat] pair of numbers.' });
    }
    if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) {
      return sendJSON(res, 400, { error: 'Point out of range.' });
    }
  }

  const chosen = profile || 'wheelchair';
  if (!ALLOWED_ORS_PROFILES.has(chosen)) {
    return sendJSON(res, 400, { error: `Profile "${chosen}" is not allowed.` });
  }

  try {
    const upstream = await fetch(`https://api.openrouteservice.org/v2/directions/${chosen}/geojson`, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: points, instructions: true, units: 'm' })
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      console.error(`[proxy] ORS ${upstream.status}:`, data?.error?.message || '(no message)');
      return sendJSON(res, upstream.status, { error: `Routing upstream error ${upstream.status}` });
    }
    return sendJSON(res, 200, data);

  } catch (e) {
    console.error('[proxy] route request failed:', e.message);
    return sendJSON(res, 502, { error: 'Routing upstream request failed.' });
  }
}

/* ── POST /api/assist ──
   The camera half of the assist screen: a photograph plus a question, in
   Arabic or English.

   Three modes share this endpoint because they are the same call with a
   different instruction: "ask" answers a question about the scene, "read"
   reads any text out, "explain" says plainly what a form or notice wants.

   The model is asked for JSON with a `confident` flag, and that flag is what
   drives the hand-off to a human. Be My Eyes does the same thing: AI first,
   a person when the AI isn't sure. An assistant that bluffs at a kerb edge
   is worse than one that says "I'm not certain — shall I ask someone?". */
const ASSIST_MAX_IMAGE_CHARS = 1_400_000;   // ~1MB of base64

const ASSIST_SYSTEM = {
  ask: `You are the eyes of a blind or low-vision person, describing a photograph they just took with their phone.

Answer their question directly and first. Then add only what matters for moving safely: the walking surface, steps or kerbs, obstacles, people in the way, shade, somewhere to sit.

Describe only what is visibly in the photograph. Never guess. If you cannot tell, say so plainly.`,

  read: `You read text aloud for a blind or low-vision person from a photograph they just took.

Transcribe every piece of text you can actually read, in reading order. Keep the original wording. If some text is cut off or blurred, say which part. If there is no readable text, say so.

After the transcription, add one short sentence saying what the text appears to be (a sign, a menu, a form, an opening-hours notice).`,

  explain: `You explain confusing documents, forms, notices and screens to someone who finds official language hard — including people with learning disabilities, and people whose first language is not the one the document is written in.

Be concrete and calm. Short sentences. No jargon, no officialese. Never invent a requirement, a deadline, a fee or a phone number that is not visibly there.`
};

function assistUserPrompt(mode, question, lang, simple) {
  const langLine = lang === 'ar'
    ? 'Answer in Arabic (Modern Standard Arabic, as used in the UAE). Do not answer in English.'
    : 'Answer in English.';
  const simpleLine = simple
    ? 'Use very simple language: short sentences, common words, one idea per sentence.'
    : '';
  const task = mode === 'read'
    ? 'Read out the text in this photograph.'
    : mode === 'explain'
      ? 'Explain this document or screen: what it is, what it is asking the person to do, the steps to follow, and anything to be careful about.'
      : (question || 'What is in front of me?');

  return [
    task,
    langLine,
    simpleLine,
    'Reply as JSON only, no code fence: {"answer": "...", "confident": true|false}.',
    '"confident" must be false if the image is blurred, dark, ambiguous, or the question cannot be settled from it.'
  ].filter(Boolean).join('\n');
}

function parseAssistReply(raw) {
  if (!raw) return null;
  // Models sometimes fence the JSON despite being asked not to.
  const cleaned = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const o = JSON.parse(cleaned);
    if (typeof o.answer === 'string') return { answer: o.answer, confident: o.confident !== false };
  } catch (_) { /* fall through */ }
  // If it answered in prose anyway, the answer is still useful — but we
  // cannot claim it was confident, so we route it as uncertain.
  return { answer: cleaned, confident: false };
}

async function handleAssist(req, res) {
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey) return sendJSON(res, 503, { error: 'OPENROUTER_API_KEY is not set.' });

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJSON(res, e.statusCode || 400, { error: e.statusCode ? e.message : 'Invalid JSON body.' });
  }

  const { image, question, lang, simple } = payload || {};
  const mode = ['ask', 'read', 'explain'].includes(payload?.mode) ? payload.mode : 'ask';
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return sendJSON(res, 400, { error: '"image" must be a data:image/... URL.' });
  }
  if (image.length > ASSIST_MAX_IMAGE_CHARS) {
    return sendJSON(res, 413, { error: 'Image too large.' });
  }

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${orKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4.5',
        max_tokens: 700,
        temperature: 0.2,
        messages: [
          { role: 'system', content: ASSIST_SYSTEM[mode] },
          { role: 'user', content: [
            { type: 'text', text: assistUserPrompt(mode, question, lang, simple) },
            { type: 'image_url', image_url: { url: image } }
          ] }
        ]
      })
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      console.error(`[proxy] assist ${upstream.status}:`, data?.error?.message || '(no message)');
      return sendJSON(res, upstream.status, { error: `Assist upstream error ${upstream.status}` });
    }
    const parsed = parseAssistReply(data?.choices?.[0]?.message?.content);
    if (!parsed) return sendJSON(res, 502, { error: 'Empty answer.' });
    return sendJSON(res, 200, parsed);
  } catch (e) {
    console.error('[proxy] assist failed:', e.message);
    return sendJSON(res, 502, { error: 'Assist request failed.' });
  }
}

/* ── POST /api/explain ──
   "The links and forms people send me are the barrier, not the park."

   Fetches a page server-side, strips it to text, and returns a plain-language
   account of what it is and what it wants from you, in Arabic or English.

   Fetching a URL that a user supplies is a server-side request forgery risk:
   without a guard, anyone who can reach this proxy could use it to probe the
   host's own network (169.254.169.254, 127.0.0.1, 192.168.x.x). So the host
   is resolved first and every resolved address must be public. */
const EXPLAIN_MAX_BYTES = 600 * 1024;
const EXPLAIN_MAX_CHARS = 14000;

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127);
  }
  const s = ip.toLowerCase();
  return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
}

async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('not-a-url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad-scheme');
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length) throw new Error('no-dns');
  for (const a of addrs) if (isPrivateAddress(a.address)) throw new Error('private-address');
  return u;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    // Keep block boundaries so headings and list items don't run together.
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function handleExplain(req, res) {
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey) return sendJSON(res, 503, { error: 'OPENROUTER_API_KEY is not set.' });

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJSON(res, e.statusCode || 400, { error: e.statusCode ? e.message : 'Invalid JSON body.' });
  }

  const { url, text, lang, simple } = payload || {};
  let source = typeof text === 'string' ? text.slice(0, EXPLAIN_MAX_CHARS) : '';
  let title = '';

  if (url) {
    let u;
    try {
      u = await assertPublicUrl(String(url));
    } catch (e) {
      const code = e.message === 'not-a-url' || e.message === 'bad-scheme' ? 'notlink' : 'blocked';
      return sendJSON(res, 400, { error: 'Cannot open that address.', code });
    }
    try {
      const page = await fetch(u.href, {
        redirect: 'follow',
        headers: { 'User-Agent': 'ClearPath/1.0 (accessibility reader)', Accept: 'text/html,text/plain' }
      });
      if (!page.ok) return sendJSON(res, 200, { ok: false, code: 'failed', status: page.status });
      const ctype = page.headers.get('content-type') || '';
      if (!/text\/html|text\/plain/i.test(ctype)) {
        return sendJSON(res, 200, { ok: false, code: 'failed', reason: 'not-a-page' });
      }
      const raw = (await page.text()).slice(0, EXPLAIN_MAX_BYTES);
      title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim().slice(0, 200);
      source = htmlToText(raw).slice(0, EXPLAIN_MAX_CHARS);
    } catch (e) {
      console.error('[proxy] explain fetch failed:', e.message);
      return sendJSON(res, 200, { ok: false, code: 'failed' });
    }
  }

  if (!source.trim()) return sendJSON(res, 200, { ok: false, code: 'failed', reason: 'empty' });

  const system = `You explain confusing web pages, forms and official notices to someone who finds them hard to understand — including people with learning disabilities, people with low digital confidence, and people reading in a second language.

Rules:
- Only describe what is actually in the text you are given. Never invent a deadline, fee, phone number, requirement or link.
- Short sentences. Common words. One idea per sentence.
- Say plainly if the page seems to be asking for personal information, money, or a login, so the person can decide before they act.
- Never tell the person to enter a password or payment details.`;

  const langLine = lang === 'ar'
    ? 'Write your whole answer in Arabic (Modern Standard Arabic, as used in the UAE).'
    : 'Write your whole answer in English.';

  const prompt = `${langLine}
${simple ? 'Use very simple language, as if explaining to someone who reads slowly.' : ''}

Reply as JSON only, no code fence:
{"what": "one or two sentences on what this is",
 "asks": "what it wants the person to do, or \\"Nothing — it is only information\\"",
 "steps": ["short step", "short step"],
 "watch": "anything to be careful about, or empty string"}

${title ? `Page title: ${title}\n` : ''}Page content:
${source}`;

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${orKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4.5',
        max_tokens: 700,
        temperature: 0.2,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }]
      })
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      console.error(`[proxy] explain ${upstream.status}:`, data?.error?.message || '(no message)');
      return sendJSON(res, upstream.status, { error: `Explain upstream error ${upstream.status}` });
    }
    const cleaned = String(data?.choices?.[0]?.message?.content || '')
      .trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      return sendJSON(res, 200, { ok: true, title, ...parsed });
    } catch (_) {
      return sendJSON(res, 200, { ok: true, title, what: cleaned, asks: '', steps: [], watch: '' });
    }
  } catch (e) {
    console.error('[proxy] explain failed:', e.message);
    return sendJSON(res, 502, { error: 'Explain request failed.' });
  }
}

/* ── Static files ── */
async function handleStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const filePath = path.join(ROOT, urlPath);
  // Block path traversal: resolved path must stay inside ROOT.
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      res.writeHead(302, { Location: urlPath + '/' }); return res.end();
    }
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type':  MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

async function handler(req, res) {
  const route = req.url.split('?')[0];

  // The volunteer hub owns every /api/volunteer/* route and answers false
  // when a path isn't one of its own.
  if (route.startsWith('/api/volunteer/')) {
    const taken = volunteerHub.handle(req, res, route, { readBody, sendJSON });
    if (taken !== false) return taken;
    return sendJSON(res, 404, { error: 'Unknown volunteer route.' });
  }

  if (route === '/api/chat' || route === '/api/route' ||
      route === '/api/assist' || route === '/api/explain') {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }); return res.end('Method Not Allowed');
    }
    if (route === '/api/chat')   return handleChat(req, res);
    if (route === '/api/route')  return handleRoute(req, res);
    if (route === '/api/assist') return handleAssist(req, res);
    return handleExplain(req, res);
  }
  if (req.method === 'GET' || req.method === 'HEAD') return handleStatic(req, res);
  res.writeHead(405); res.end('Method Not Allowed');
}

/* ── HTTPS for phone testing ──
   Camera, compass and GPS are all gated behind a secure context. localhost
   counts as secure, but http://192.168.x.x — which is how a phone reaches
   this laptop — does not. So testing on a real phone means HTTPS, and for a
   LAN address that means a self-signed certificate.

   Generate one (it is gitignored):

     openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
       -keyout server/key.pem -out server/cert.pem \
       -subj "/CN=ClearPath" \
       -addext "subjectAltName=IP:<your LAN IP>,DNS:localhost"

   The phone will warn that the certificate is untrusted — that is expected
   for a self-signed cert. Accept it once and the sensors work. */
async function loadCert() {
  try {
    const [key, cert] = await Promise.all([
      fs.readFile(path.join(__dirname, 'key.pem')),
      fs.readFile(path.join(__dirname, 'cert.pem'))
    ]);
    return { key, cert };
  } catch {
    return null;
  }
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family === 'IPv4' && !nic.internal) out.push(nic.address);
    }
  }
  return out;
}

await loadEnv();

const creds = await loadCert();
// Bind to every interface when serving HTTPS, otherwise the phone can't
// reach it. Plain HTTP stays on loopback, because an unencrypted LAN
// listener is not something to switch on by accident.
const bindHost = creds ? (process.env.HOST || '0.0.0.0') : HOST;
const server = creds
  ? https.createServer(creds, handler)
  : http.createServer(handler);

server.listen(PORT, bindHost, () => {
  const scheme = creds ? 'https' : 'http';
  console.log(`\n  ClearPath  →  ${scheme}://localhost:${PORT}`);
  if (creds) {
    for (const ip of lanAddresses()) {
      console.log(`  On your phone (same Wi-Fi) →  ${scheme}://${ip}:${PORT}`);
    }
    console.log('  Self-signed cert: your phone will warn once. Accept it, then camera/GPS work.');
  } else {
    console.log('  HTTP only — camera, compass and GPS will NOT work from a phone.');
    console.log('  For phone testing, create server/key.pem + server/cert.pem (see the comment in this file).');
  }
  console.log(`  AI cues:            ${process.env.OPENROUTER_API_KEY ? 'enabled' : 'off (no OPENROUTER_API_KEY — written cues will be used)'}`);
  console.log(`  Wheelchair routing: ${process.env.ORS_API_KEY ? 'enabled' : 'off (no ORS_API_KEY — keyless Valhalla will be used)'}`);
  console.log(`  Assist (ask/read/explain): ${process.env.OPENROUTER_API_KEY ? 'enabled' : 'off (needs OPENROUTER_API_KEY)'}`);
  console.log(`  Volunteer hub:      ready  →  ${scheme}://localhost:${PORT}/volunteer.html\n`);
});
