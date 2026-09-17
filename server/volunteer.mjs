/* ═══════════════════════════════════════════════════════
   volunteer.mjs — the human half of the assist screen.

   Be My Eyes connects a blind user to the first sighted volunteer who
   picks up. This is the same shape, small enough to read in one sitting:

     1. The visitor posts a request (question + a snapshot + language).
     2. Every volunteer with the volunteer page open hears about it over
        Server-Sent Events.
     3. The first volunteer to accept gets paired, and from then on this
        module just relays WebRTC signalling between the two — the video
        itself goes peer to peer and never touches this server.
     4. If nobody accepts before the timeout, the request degrades to the
        async path: the snapshot and question stay queued, and whenever a
        volunteer answers in text, the answer is pushed back to the visitor
        and read aloud in their language.

   Step 4 is the important one. A live-call-only design shows nothing at all
   when no volunteer happens to be awake, which for a demo — and for a real
   visitor at 6am — is the same as having no feature.

   State is in memory on purpose. Requests are transient by nature, and
   nothing here should outlive the process or be written to disk: the
   snapshots are photographs of whatever a disabled person is looking at,
   which is about as sensitive as data gets.
═══════════════════════════════════════════════════════ */

const REQUEST_TTL_MS = 10 * 60 * 1000;   // nothing lives longer than this
const RING_TIMEOUT_MS = 30 * 1000;       // then fall back to async
const MAX_SNAPSHOT_BYTES = 900 * 1024;
const MAX_TEXT = 2000;

/** @type {Map<string, any>} */
const requests = new Map();
/** volunteers currently listening */
const volunteers = new Set();
/** visitors waiting on their own request id */
const visitors = new Map();

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Without this, a proxy in front of the server can sit on the stream
    // and the volunteer never hears the first request.
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');
}

function sseSend(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (_) { /* client vanished; reaped below */ }
}

function broadcastVolunteers(event, data) {
  for (const res of volunteers) sseSend(res, event, data);
}

function notifyVisitor(id, event, data) {
  const res = visitors.get(id);
  if (res) sseSend(res, event, data);
}

// A request the volunteer list should see: never includes the raw snapshot,
// which is fetched separately only once a volunteer has actually engaged.
function publicView(r) {
  return {
    id: r.id,
    question: r.question,
    lang: r.lang,
    mode: r.mode,
    state: r.state,
    createdAt: r.createdAt,
    hasSnapshot: !!r.snapshot,
    answer: r.answer || null
  };
}

function sweep() {
  const now = Date.now();
  for (const [id, r] of requests) {
    if (now - r.createdAt > REQUEST_TTL_MS) {
      requests.delete(id);
      visitors.delete(id);
      broadcastVolunteers('expired', { id });
    } else if (r.state === 'ringing' && now - r.createdAt > RING_TIMEOUT_MS) {
      // Nobody picked up. Keep the request alive as an async question
      // rather than dropping it, and tell the visitor honestly.
      r.state = 'queued';
      notifyVisitor(id, 'timeout', publicView(r));
      broadcastVolunteers('updated', publicView(r));
    }
  }
}
setInterval(sweep, 5000).unref?.();

/* ── Routes ───────────────────────────────────────────────────────── */

export function handle(req, res, route, { readBody, sendJSON }) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ── Visitor: open a help request ──
  if (route === '/api/volunteer/request' && req.method === 'POST') {
    return readBody(req).then(raw => {
      let body;
      try { body = JSON.parse(raw); } catch { return sendJSON(res, 400, { error: 'Invalid JSON.' }); }

      const question = String(body.question || '').slice(0, MAX_TEXT);
      const snapshot = typeof body.snapshot === 'string' ? body.snapshot : null;
      if (snapshot && snapshot.length > MAX_SNAPSHOT_BYTES) {
        return sendJSON(res, 413, { error: 'Snapshot too large.' });
      }
      const r = {
        id: uid(),
        question,
        snapshot,
        lang: body.lang === 'ar' ? 'ar' : 'en',
        mode: String(body.mode || 'ask').slice(0, 24),
        state: 'ringing',
        createdAt: Date.now(),
        answer: null
      };
      requests.set(r.id, r);
      broadcastVolunteers('request', publicView(r));
      return sendJSON(res, 200, { id: r.id, waitingFor: RING_TIMEOUT_MS, volunteersOnline: volunteers.size });
    }).catch(e => sendJSON(res, e.statusCode || 400, { error: e.message }));
  }

  // ── Either side: subscribe to updates ──
  if (route === '/api/volunteer/events' && req.method === 'GET') {
    const role = url.searchParams.get('role');
    sseInit(res);

    if (role === 'volunteer') {
      volunteers.add(res);
      // Catch a newly-opened volunteer page up on anything still outstanding.
      for (const r of requests.values()) {
        if (r.state === 'ringing' || r.state === 'queued') sseSend(res, 'request', publicView(r));
      }
      broadcastVolunteers('presence', { online: volunteers.size });
      req.on('close', () => {
        volunteers.delete(res);
        broadcastVolunteers('presence', { online: volunteers.size });
      });
    } else {
      const id = url.searchParams.get('id');
      if (!id || !requests.has(id)) { sseSend(res, 'error', { error: 'Unknown request.' }); return res.end(); }
      visitors.set(id, res);
      sseSend(res, 'state', publicView(requests.get(id)));
      req.on('close', () => { if (visitors.get(id) === res) visitors.delete(id); });
    }

    // Idle SSE connections get closed by intermediaries; a comment line
    // every 20s is enough to keep them alive without sending real events.
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 20000);
    req.on('close', () => clearInterval(ping));
    return;
  }

  // ── Volunteer: fetch the snapshot for one request ──
  if (route === '/api/volunteer/snapshot' && req.method === 'GET') {
    const r = requests.get(url.searchParams.get('id'));
    if (!r || !r.snapshot) return sendJSON(res, 404, { error: 'No snapshot.' });
    return sendJSON(res, 200, { snapshot: r.snapshot, question: r.question, lang: r.lang });
  }

  // ── Volunteer: accept (go live) ──
  if (route === '/api/volunteer/accept' && req.method === 'POST') {
    return readBody(req).then(raw => {
      let body;
      try { body = JSON.parse(raw); } catch { return sendJSON(res, 400, { error: 'Invalid JSON.' }); }
      const r = requests.get(body.id);
      if (!r) return sendJSON(res, 404, { error: 'Request not found.' });
      if (r.state === 'live') return sendJSON(res, 409, { error: 'Another volunteer already took this.' });
      r.state = 'live';
      notifyVisitor(r.id, 'accepted', publicView(r));
      broadcastVolunteers('updated', publicView(r));
      return sendJSON(res, 200, { ok: true });
    }).catch(e => sendJSON(res, 400, { error: e.message }));
  }

  // ── Both: relay WebRTC signalling ──
  // Offers, answers and ICE candidates pass through; the media does not.
  if (route === '/api/volunteer/signal' && req.method === 'POST') {
    return readBody(req).then(raw => {
      let body;
      try { body = JSON.parse(raw); } catch { return sendJSON(res, 400, { error: 'Invalid JSON.' }); }
      const r = requests.get(body.id);
      if (!r) return sendJSON(res, 404, { error: 'Request not found.' });
      if (body.from === 'volunteer') notifyVisitor(r.id, 'signal', { signal: body.signal });
      else broadcastVolunteers('signal', { id: r.id, signal: body.signal });
      return sendJSON(res, 200, { ok: true });
    }).catch(e => sendJSON(res, 400, { error: e.message }));
  }

  // ── Volunteer: answer in text (the async path) ──
  if (route === '/api/volunteer/answer' && req.method === 'POST') {
    return readBody(req).then(raw => {
      let body;
      try { body = JSON.parse(raw); } catch { return sendJSON(res, 400, { error: 'Invalid JSON.' }); }
      const r = requests.get(body.id);
      if (!r) return sendJSON(res, 404, { error: 'Request not found.' });
      r.answer = String(body.answer || '').slice(0, MAX_TEXT);
      r.state = 'answered';
      notifyVisitor(r.id, 'answer', publicView(r));
      broadcastVolunteers('updated', publicView(r));
      return sendJSON(res, 200, { ok: true });
    }).catch(e => sendJSON(res, 400, { error: e.message }));
  }

  // ── Either: end ──
  if (route === '/api/volunteer/end' && req.method === 'POST') {
    return readBody(req).then(raw => {
      let body;
      try { body = JSON.parse(raw); } catch { return sendJSON(res, 400, { error: 'Invalid JSON.' }); }
      const r = requests.get(body.id);
      if (r) {
        r.state = 'ended';
        notifyVisitor(r.id, 'ended', publicView(r));
        broadcastVolunteers('updated', publicView(r));
        // Drop the snapshot the moment the exchange is over. There is no
        // reason to keep a photograph of someone's surroundings around.
        r.snapshot = null;
      }
      return sendJSON(res, 200, { ok: true });
    }).catch(e => sendJSON(res, 400, { error: e.message }));
  }

  if (route === '/api/volunteer/status' && req.method === 'GET') {
    return sendJSON(res, 200, {
      volunteersOnline: volunteers.size,
      open: [...requests.values()].filter(r => r.state === 'ringing' || r.state === 'queued').length
    });
  }

  return false;   // not ours
}
