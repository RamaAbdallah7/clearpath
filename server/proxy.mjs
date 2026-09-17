/* ═══════════════════════════════════════════════════════
   proxy.mjs — Local dev server + key proxy

   Serves ClearPath's static files AND exposes two endpoints whose API
   keys must never reach the browser:

     POST /api/chat   → OpenRouter, for the personalised route cues
     POST /api/route  → OpenRouteService, for the wheelchair routing profile

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
import { fileURLToPath } from 'node:url';

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

/* ── POST /api/look ──
   "What am I actually looking at?"

   The Visit screen shows Street View in an iframe, and an iframe's pixels
   cannot be read from the page — so the browser cannot send the view to a
   model itself. Instead it sends the coordinates, and this endpoint fetches
   the matching Street View Static image server-side and hands that to a
   vision model.

   Doing it here rather than in the browser is what keeps the Google key
   secret: the image URL contains the key, and that URL never leaves this
   process. The browser only ever receives the resulting sentence.

   Needs GOOGLE_MAPS_SERVER_KEY with the Street View Static API enabled.
   Without it we answer 503 and the page falls back to its written facts. */
const LOOK_MAX_FACTS = 1200;

async function handleLook(req, res) {
  const gKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!gKey || !orKey) {
    return sendJSON(res, 503, {
      error: 'Needs GOOGLE_MAPS_SERVER_KEY and OPENROUTER_API_KEY — client should use its written fallback.'
    });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJSON(res, e.statusCode || 400,
      { error: e.statusCode ? e.message : 'Invalid JSON body: ' + e.message });
  }

  const { lat, lng, pano, heading, pitch, fov, facts, needs } = payload || {};
  if (!pano && (!Number.isFinite(lat) || !Number.isFinite(lng))) {
    return sendJSON(res, 400, { error: 'Needs either a pano id or numeric lat/lng.' });
  }
  if (Number.isFinite(lat) && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) {
    return sendJSON(res, 400, { error: 'Coordinates out of range.' });
  }

  const params = new URLSearchParams({
    size: '640x400',
    key: gKey,
    heading: String(Number(heading) || 0),
    pitch: String(Number(pitch) || 0),
    fov: String(Math.min(Math.max(Number(fov) || 90, 20), 120))
  });
  if (pano) params.set('pano', String(pano).slice(0, 128));
  else params.set('location', `${lat},${lng}`);

  try {
    const imgRes = await fetch(`https://maps.googleapis.com/maps/api/streetview?${params}`);
    if (!imgRes.ok) {
      console.error('[proxy] Street View image', imgRes.status);
      return sendJSON(res, 502, { error: 'Could not fetch the Street View image.' });
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    // Google answers "no imagery here" with a grey placeholder JPEG rather
    // than an error status, and it is tiny. Describing that would be worse
    // than saying nothing.
    if (buf.length < 6000) {
      return sendJSON(res, 200, { text: null, reason: 'no-imagery' });
    }
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;

    const system = `You are describing a real photograph of Al Jahili Park in Al Ain, UAE, to a visitor with a disability who is deciding whether to travel there.

Describe ONLY what is visibly in the photograph. Do not guess at facilities you cannot see. If the picture is unclear, say so.

Prioritise, in this order: the walking surface and whether it looks level; steps, kerbs or obstacles; shade; somewhere to sit; where the path appears to lead.

Three or four short sentences, plain language, second person. No markdown, no lists, no emoji. Never say "disabled" or "handicapped".`;

    const userText = [
      needs ? `The visitor ${String(needs).slice(0, 300)}` : '',
      facts ? `Verified facts about this spot (use them only if they match what you can see):\n${String(facts).slice(0, LOOK_MAX_FACTS)}` : '',
      'Describe what is in this photograph.'
    ].filter(Boolean).join('\n\n');

    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${orKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4.5',
        max_tokens: 220,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: dataUrl } }
          ] }
        ]
      })
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      console.error(`[proxy] vision ${upstream.status}:`, data?.error?.message || '(no message)');
      return sendJSON(res, upstream.status, { error: `Vision upstream error ${upstream.status}` });
    }
    return sendJSON(res, 200, { text: data?.choices?.[0]?.message?.content ?? null });

  } catch (e) {
    console.error('[proxy] look failed:', e.message);
    return sendJSON(res, 502, { error: 'Look-up failed.' });
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

  if (route === '/api/chat' || route === '/api/route' || route === '/api/look') {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }); return res.end('Method Not Allowed');
    }
    if (route === '/api/chat')  return handleChat(req, res);
    if (route === '/api/route') return handleRoute(req, res);
    return handleLook(req, res);
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
  console.log(`  Scene descriptions: ${process.env.GOOGLE_MAPS_SERVER_KEY && process.env.OPENROUTER_API_KEY ? 'enabled' : 'off (needs GOOGLE_MAPS_SERVER_KEY + OPENROUTER_API_KEY)'}\n`);
});
