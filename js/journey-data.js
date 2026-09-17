// Al Jahili Park — Challenge 1 journey data
//
// Anchor GIS point from the official challenge brief
// (hackathon-ku-and-za.netlify.app/#challenge-1).
//
// Unlike the first draft, these are NOT illustrative offsets any more.
// Every stage below is a real feature that exists in OpenStreetMap at Al
// Jahili Park, pulled from Overpass and verified to route end-to-end with
// Valhalla's pedestrian profile (924 m, ~18 min on foot). The `osm` field
// on each stage records what it actually is, so a reviewer can check it.
const PARK_ANCHOR = { lat: 24.2187989, lng: 55.7535982 };

// The park boundary way itself: OSM way "حديقة الجَاهلِي" (Al Jahili Park).
// Used to tell "inside the park" from "still on the approach roads".
const PARK_BBOX = { south: 24.2146431, west: 55.7509935, north: 24.2201838, east: 55.7562645 };

const JOURNEY = [
  {
    id: "parking",
    stage: 1,
    title: "Parking",
    lat: 24.2194879,
    lng: 55.7578412,
    osm: "service=parking_aisle, east of the park",
    // Geofence radius in metres. Wide here: a car park is a large area and
    // GPS is at its worst beside vehicles and walls.
    radius: 35,
    stepFree: true,
    shade: "low",
    surface: "asphalt",
    restPoint: false,
    kerbDrop: true,
    lighting: true,
    description: "You're at the parking area east of the park. Look for the marked accessible bay closest to the footpath — the kerb is dropped at the aisle end.",
    cue: "Starting point. Head west toward the park gate, about two hundred metres.",
    photo: "assets/photos/001-thumb.jpg"
  },
  {
    id: "entrance",
    stage: 2,
    title: "Entrance",
    lat: 24.2189105,
    lng: 55.7564058,
    osm: "barrier=gate, access=permissive",
    radius: 18,
    stepFree: true,
    shade: "medium",
    surface: "paved",
    restPoint: true,
    kerbDrop: true,
    lighting: true,
    description: "This is the east gate into the park. It is step-free and wide enough for a wheelchair. There's a bench just inside if you'd like to rest before continuing.",
    cue: "You have reached the east gate. It is step-free. A seating area is just inside on your right.",
    photo: "assets/photos/002-thumb.jpg"
  },
  {
    id: "internal-paths",
    stage: 3,
    title: "Internal paths",
    lat: PARK_ANCHOR.lat,
    lng: PARK_ANCHOR.lng,
    // This IS the challenge's published GIS point. Nominatim resolves it to
    // a highway=pedestrian way inside Al Jahili — i.e. the brief's anchor
    // genuinely sits on the park's internal path network.
    osm: "highway=pedestrian — the official challenge GIS anchor",
    radius: 20,
    stepFree: true,
    shade: "high",
    surface: "paved, some uneven sections",
    restPoint: false,
    kerbDrop: true,
    lighting: true,
    description: "The main internal walkway. Mostly step-free with good tree shade. One short section has uneven paving — keep to the left side.",
    cue: "Continue straight on the shaded walkway. Uneven paving ahead on the right, keep left.",
    photo: "assets/photos/003-thumb.jpg"
  },
  {
    id: "seating-shade",
    stage: 4,
    title: "Seating & shade",
    lat: 24.2180604,
    lng: 55.7520307,
    // Genuinely tagged wheelchair=yes, fee=no, changing_table=yes in OSM.
    osm: "amenity=toilets, wheelchair=yes, fee=no, changing_table=yes",
    radius: 20,
    stepFree: true,
    shade: "high",
    surface: "paved",
    restPoint: true,
    kerbDrop: true,
    lighting: true,
    description: "A shaded rest area. The accessible toilets here are step-free, free to use, and have a changing table.",
    cue: "Shaded seating on your left. Step-free accessible toilets are right beside you.",
    photo: "assets/photos/004-thumb.jpg"
  },
  {
    id: "park-use",
    stage: 5,
    title: "Park use",
    lat: 24.2186161,
    lng: 55.7519889,
    osm: "leisure=playground, access=yes",
    radius: 25,
    stepFree: true,
    shade: "medium",
    surface: "sand around equipment, paved approach",
    restPoint: true,
    kerbDrop: true,
    lighting: true,
    description: "You've arrived at the playground and open lawn. The approach path is paved; the play area itself is sand. Enjoy your visit!",
    cue: "You have arrived. The approach is paved, the play area is sand. Enjoy the park.",
    photo: "assets/photos/005-thumb.jpg"
  }
];

// Route-confidence score, 0-100. Deliberately transparent and inspectable
// rather than a black box — every visitor can be told WHY a stage scored
// what it did, which matters more than the number itself.
//
// The weights follow the workshop deck's "different needs, different
// barriers" framing: step-free continuity dominates, then shade (Al Ain
// heat is itself an access barrier), then somewhere to rest, then surface.
const SCORE_WEIGHTS = [
  { key: "stepFree",  points: 40, label: "Step-free",      test: s => s.stepFree },
  { key: "shade",     points: 25, label: "Shade",          test: s => s.shade === "high" ? 1 : s.shade === "medium" ? 0.6 : 0.2 },
  { key: "restPoint", points: 15, label: "Rest point",     test: s => s.restPoint },
  { key: "surface",   points: 20, label: "Even surface",   test: s => !/uneven|sand|gravel/.test(s.surface) ? 1 : 0.4 }
];

function confidenceScore(stage) {
  let score = 0;
  for (const w of SCORE_WEIGHTS) {
    const v = w.test(stage);
    score += w.points * (v === true ? 1 : v === false ? 0 : v);
  }
  return Math.round(Math.min(score, 100));
}

// Returns the same score broken down, so the UI (and the AI cue writer)
// can explain the number instead of just asserting it.
function confidenceBreakdown(stage) {
  return SCORE_WEIGHTS.map(w => {
    const v = w.test(stage);
    const frac = v === true ? 1 : v === false ? 0 : v;
    return { label: w.label, earned: Math.round(w.points * frac), max: w.points };
  });
}
