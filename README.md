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

Stage-by-stage waypoints in `js/journey-data.js` are illustrative offsets around the official GIS
anchor (only one anchor point is published per challenge, not a full surveyed polyline) — swap in
real coordinates from the site plan if you have them before a live outdoor demo.

## Running it

No build step — plain HTML/CSS/JS.

```bash
python -m http.server 5500
```

Open `http://localhost:5500`. Camera, microphone, and geolocation all require a secure context —
`localhost` qualifies, a plain `file://` open will not have camera/mic access.

For a real outdoor AR demo, open it on a phone over HTTPS (e.g. deploy to GitHub Pages/Netlify) so
GPS and compass sensors are available.

## Judging alignment

- **Application Implementation and Functionality (40%)** — every feature above is wired end-to-end
  and runs live in the browser, no mockups.
- **Idea Originality and Relevance to the Theme (30%)** — directly answers Challenge 1's own listed
  directions: AI-assisted route scoring, tactile/audio wayfinding, obstacle/confidence alerts, and a
  municipality-facing checklist export.
- **Application Quality (20%)** — WCAG 2.2-conscious UI: ≥44px tap targets, visible focus states, high
  contrast mode, ARIA live announcements, EN/AR toggle.
- **AI Focus (10%)** — kept deliberately small and reliable rather than bolted-on: this is a strong
  area to extend (e.g. swap the static `cue` text for an LLM-generated explanation) if time allows.
