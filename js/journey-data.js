// Al Jahili Park — Challenge 1 journey data
// Anchor GIS point from the official challenge brief (hackathon-ku-and-za.netlify.app/#challenge-1)
const PARK_ANCHOR = { lat: 24.2187989, lng: 55.7535982 };

// Waypoints are illustrative offsets around the anchor, spaced to represent the
// brief's 5-stage journey (Parking -> Entrance -> Internal paths -> Seating/shade -> Park use).
// Replace with real surveyed points from the site plan / photos before the demo if precision matters.
const JOURNEY = [
  {
    id: "parking",
    stage: 1,
    title: "Parking",
    lat: PARK_ANCHOR.lat - 0.00075,
    lng: PARK_ANCHOR.lng - 0.00060,
    stepFree: true,
    shade: "low",
    surface: "paved",
    restPoint: false,
    description: "You're at the parking area. Look for the marked accessible bay closest to the entrance path.",
    cue: "Starting point. Head toward the park entrance, forty metres ahead.",
    photo: "assets/photos/001-thumb.jpg"
  },
  {
    id: "entrance",
    stage: 2,
    title: "Entrance",
    lat: PARK_ANCHOR.lat - 0.00035,
    lng: PARK_ANCHOR.lng - 0.00030,
    stepFree: true,
    shade: "medium",
    surface: "paved",
    restPoint: true,
    description: "This is the main entrance. There's a bench here if you'd like to rest before continuing.",
    cue: "You have reached the entrance. A seating area is on your right.",
    photo: "assets/photos/002-thumb.jpg"
  },
  {
    id: "internal-paths",
    stage: 3,
    title: "Internal paths",
    lat: PARK_ANCHOR.lat - 0.00010,
    lng: PARK_ANCHOR.lng - 0.00005,
    stepFree: true,
    shade: "high",
    surface: "paved, some uneven sections",
    restPoint: false,
    description: "The internal path is mostly step-free with good shade. One short section has uneven paving — keep to the left side.",
    cue: "Continue straight on the shaded path. Uneven paving ahead on the right, keep left.",
    photo: "assets/photos/003-thumb.jpg"
  },
  {
    id: "seating-shade",
    stage: 4,
    title: "Seating & shade",
    lat: PARK_ANCHOR.lat + 0.00015,
    lng: PARK_ANCHOR.lng + 0.00010,
    stepFree: true,
    shade: "high",
    surface: "paved",
    restPoint: true,
    description: "A shaded seating area. Toilets are nearby to the left.",
    cue: "Shaded seating on your left. Accessible toilets are close by.",
    photo: "assets/photos/004-thumb.jpg"
  },
  {
    id: "park-use",
    stage: 5,
    title: "Park use",
    lat: PARK_ANCHOR.lat + 0.00035,
    lng: PARK_ANCHOR.lng + 0.00025,
    stepFree: true,
    shade: "medium",
    surface: "paved",
    restPoint: true,
    description: "You've arrived at the main park area. Enjoy your visit!",
    cue: "You have arrived. Enjoy the park.",
    photo: "assets/photos/005-thumb.jpg"
  }
];

function confidenceScore(stage) {
  let score = 0;
  if (stage.stepFree) score += 40;
  if (stage.shade === "high") score += 25;
  else if (stage.shade === "medium") score += 15;
  else score += 5;
  if (stage.restPoint) score += 15;
  if (!stage.surface.includes("uneven")) score += 20;
  return Math.min(score, 100);
}
