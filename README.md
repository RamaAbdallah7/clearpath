# ClearPath

Independent, hands-free arrival journey for **Al Jahili Park** — built for **Challenge 1** of the
Khalifa University × Zayed Authority for People of Determination **Inclusion Innovation Hackathon**
(Focus Area: Vision & Sensory Technology).

## The issue

People of Determination can't reliably move independently from the parking area to Al Jahili Park's
entrance and internal paths. Some path segments are step-free and shaded, others have uneven paving
or long exposed stretches — and there's no way to know which is which, or to get a confirming cue at
each decision point.

## What ClearPath does

- **Journey Map** — the 5-stage arrival journey (Parking → Entrance → Internal paths → Seating/shade
  → Park use) plotted on a live map anchored to the challenge's real GIS point (24.2187989,
  55.7535982), each stage scored for step-free continuity, shade, and rest points.
- **AR Navigate** — opens the camera and overlays a live arrow pointing toward the next stage, using
  device GPS + compass bearing, with a manual heading simulator for indoor/desktop testing.
- **Hands-free control** — every screen can be driven by:
  - **Voice**: "open map", "start navigation", "next", "back", "read description", "report a
    barrier", "help" (Web Speech API, speech-to-text and text-to-speech).
  - **Head-tilt + blink**: tilt left/right to move focus across the nav tabs, blink to select —
    adapted from [SWE-headAndVoice](https://github.com/RamaAbdallah7/SWE-headAndVoice) (originally a
    desktop MediaPipe + pyautogui OS-cursor project), reworked to run entirely in-browser via
    MediaPipe FaceMesh and control the app's own UI instead of the OS cursor.
- **Pre-visit story** — a calm, illustrated walkthrough of the visit for a child, read aloud, to
  reduce anxiety about the unfamiliar before arriving (per the I.Can workshop's guidance that
  unexpected changes are a major stressor).
- **Report & checklist** — flag a barrier at any stage (by typing or dictating), and export a plain
  accessibility checklist — the brief's own suggested "accessible arrival checklist for municipality
  teams" direction.

## Data sources

- Challenge brief, GIS anchor, and site photos/plan: [hackathon-ku-and-za.netlify.app](https://hackathon-ku-and-za.netlify.app/#challenge-1)
- Event context, focus areas, and judging criteria: [ku.ac.ae/inclusive-innovation-accessibility-hackathon](https://www.ku.ac.ae/inclusive-innovation-accessibility-hackathon)

Stage-by-stage waypoints in `js/journey-data.js` are **real OpenStreetMap features**, not offsets.
Each stage records what it actually is in its `osm` field:

| Stage | Real feature | Source |
|---|---|---|
| 1 Parking | `service=parking_aisle` east of the park | OSM |
| 2 Entrance | `barrier=gate`, `access=permissive` | OSM |
| 3 Internal paths | `highway=pedestrian` — **the challenge's own GIS anchor**, which Nominatim confirms sits on the park's internal path network | Challenge brief + OSM |
| 4 Seating & shade | `amenity=toilets`, `wheelchair=yes`, `fee=no`, `changing_table=yes` | OSM |
| 5 Park use | `leisure=playground`, `access=yes` | OSM |

The chain routes end to end on Valhalla's pedestrian profile at **924 m / ~18 min**, with legs 3→5
entirely on park walkways.

## Running it

No build step — plain HTML/CSS/JS.

```bash
python3 -m http.server 5500
```

Open `http://localhost:5500`. Camera, microphone, and geolocation all require a secure context —
`localhost` qualifies, a plain `file://` open will not have camera/mic access.

Everything above works from that static server with **no keys at all**: routing (Valhalla), nearby
facilities (Overpass), and place names (Nominatim) are keyless and CORS-open.

### With the optional proxy

`server/proxy.mjs` serves the same files and adds the three things that need a secret. Node 18+, zero
dependencies:

```bash
cp .env.example .env && node server/proxy.mjs
```

| Key | Unlocks | Without it |
|---|---|---|
| `OPENROUTER_API_KEY` | Personalised stage cues | Written cues — nothing breaks |
| `ORS_API_KEY` | OpenRouteService wheelchair routing profile | Keyless Valhalla pedestrian routing |
| `GOOGLE_MAPS_SERVER_KEY` | "What am I looking at?" scene descriptions | Written descriptions, clearly labelled |

The Visit screen's 360° viewer uses a **separate** key you paste into the UI, which only needs the
free Maps Embed API. It's stored in your browser and never sent anywhere except Google.

### On your phone

Camera, compass and GPS are all gated behind a secure context. `localhost` counts; `http://192.168.x.x`
— which is how your phone reaches your laptop — does not. So phone testing means HTTPS:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout server/key.pem -out server/cert.pem -subj "/CN=ClearPath" -addext "subjectAltName=IP:$(ipconfig getifaddr en0),DNS:localhost"
```

Then `node server/proxy.mjs` — it detects the cert, switches to HTTPS, binds to all interfaces and
prints the URL to open on your phone. Your phone will warn once that the certificate is self-signed;
accept it and the sensors work. The `.pem` files are gitignored.

For a public demo, GitHub Pages or Netlify give you real HTTPS with no cert juggling (but no proxy,
so the three optional features above fall back).

## Judging alignment

- **Application Implementation and Functionality (40%)** — every feature above is wired end-to-end
  and runs live in the browser, no mockups.
- **Idea Originality and Relevance to the Theme (30%)** — directly answers Challenge 1's own listed
  directions: AI-assisted route scoring, tactile/audio wayfinding, obstacle/confidence alerts, and a
  municipality-facing checklist export.
- **Application Quality (20%)** — WCAG 2.2-conscious UI: ≥44px tap targets, visible focus states, high
  contrast mode, ARIA live announcements, EN/AR toggle.
- **AI Focus (10%)** — two models, each doing a job that isn't decoration. On-device MediaPipe
  EfficientDet-Lite0 reads the path ahead through the camera; a language model rewrites each stage
  cue for the access profile you selected, and a vision model describes the Street View scene you're
  looking at. The cue writer is constrained to restate supplied facts only — unsupported access
  claims are rejected before they are ever spoken, because telling someone a route is step-free when
  nobody established that could physically strand them.

## Architecture

Load order matters: `geo.js` owns every position fix and everything else measures through it.

| File | Responsibility |
|---|---|
| `js/geo.js` | Every GPS fix. Accuracy gating, staleness, geofences with hysteresis + dwell. Shared distance/bearing maths. |
| `js/routing.js` | Real pedestrian routing (Valhalla keyless, ORS wheelchair via proxy), polyline6 decoding, honest straight-line fallback. |
| `js/places.js` | Live Overpass query for accessible facilities; Nominatim reverse geocoding. |
| `js/vision.js` | MediaPipe obstacle detection on the AR camera. ESM module. |
| `js/arpath.js` | The routed path projected onto the ground in the camera view. |
| `js/streetview.js` | The pre-visit 360° tour and the scene guide. |
| `js/ai.js` | Personalised stage cues, with fact-constrained prompting and output validation. |
| `server/proxy.mjs` | Static server + `/api/chat`, `/api/route`, `/api/look`. Holds every secret. Optional HTTPS. |

### Design rule: never sound more certain than the data

The single most dangerous thing a wayfinding app can do to someone who can't see the gate is sound
confident while being wrong. So, throughout:

- A stage only advances on a fix that passed accuracy gating, hysteresis **and** a dwell requirement.
  The previous version advanced on any single sample under 15 m.
- With no GPS, the AR screen shows no distance and dims the arrow. It used to substitute a position
  about 80 m south-west of stage 1 and render a confident arrow from it.
- A straight-line route is drawn dashed and in warning colour, and labelled as an estimate.
- The ground path line refuses to draw without a real fix, a real heading **and** a real route.
- OSM's `wheelchair` tag is reported as-is, including "accessibility not recorded". Untagged is
  unknown, not accessible.
- AI cues are rejected if they assert a facility that wasn't in the facts given to the model.
