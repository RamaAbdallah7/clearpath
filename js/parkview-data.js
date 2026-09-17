// parkview-data.js — the pre-visit virtual tour.
//
// Built on Google Street View rather than a hand-modelled 3D park. The
// reason is simply that the real imagery already exists: checking the
// challenge's GIS anchor against Google Maps shows 360° coverage right
// across this site — official car coverage on the surrounding roads and at
// Al Jahili Fort, and user-contributed photospheres inside the park itself.
// A modelled twin would be less true and take far longer to build.
//
// Every viewpoint below was verified to have imagery before being listed.
// `pano` is a specific panorama ID where one was captured; otherwise
// `location` lets Street View find the nearest panorama itself.
//
// The narration answers the three things a visitor actually wants to know
// before travelling: what is here, what is good about it, and what happens
// if something goes wrong. The last of those comes straight from the I.Can
// workshop deck's own slide — "an accessible place is not fully accessible
// if a person cannot evacuate safely" — which nothing in ClearPath covered
// until now.
const PARK_VIEWPOINTS = [
  {
    id: "arrival-parking",
    title: "1 · Parking",
    kind: "journey",
    location: { lat: 24.2194879, lng: 55.7578412 },
    heading: 250, pitch: 0,
    coverage: "Google car coverage",
    blurb: "The parking aisles east of the park. This is where the arrival journey starts.",
    services: ["Parking aisles", "Dropped kerb at the aisle end", "Step-free onto the footpath"],
    good: "You can be dropped off right at the kerb here, and the walk to the gate is flat the whole way.",
    emergency: "If you need to leave in a hurry, this is the widest vehicle access on this side of the park."
  },
  {
    id: "arrival-gate",
    title: "2 · East gate",
    kind: "journey",
    location: { lat: 24.2189105, lng: 55.7564058 },
    heading: 260, pitch: 0,
    coverage: "Google car coverage",
    blurb: "The east gate. Step-free, and wide enough for a wheelchair.",
    services: ["Step-free gate", "Bench just inside", "Lit at night"],
    good: "There's somewhere to sit the moment you're through the gate, so you don't have to walk the whole way in one go.",
    emergency: "Gates are the marked exits. This one is the closest exit to the east parking."
  },
  {
    id: "park-interior",
    title: "3 · Inside the park",
    kind: "journey",
    // Verified user photosphere, 10240x5120, about 40 m from the challenge
    // GIS anchor — this is the brief's own point, seen from the ground.
    pano: "CIHM0ogKEICAgICk3suJVw",
    location: { lat: 24.2191345, lng: 55.7533918 },
    heading: 308, pitch: 0,
    coverage: "Visitor photosphere",
    blurb: "The open lawn and walkways at the centre of the park — the challenge's GIS anchor point, from the ground.",
    services: ["Paved walkways", "Deep tree shade", "Open lawn", "Benches along the paths"],
    good: "This is the part people come for: big shaded lawns, wide flat paths, and room to stop wherever you like.",
    emergency: "Open ground with clear sightlines in every direction, and paths leading out to each gate."
  },
  {
    id: "fort",
    title: "Al Jahili Fort",
    kind: "highlight",
    // Verified official panorama beside the park's west side.
    pano: "HTlEJjkcclxmVG1nNdwcng",
    location: { lat: 24.2180896, lng: 55.7521064 },
    heading: 200, pitch: 5,
    coverage: "Google car coverage",
    blurb: "The fort sits on the park's west side — one of the oldest buildings in Al Ain.",
    services: ["Exhibition rooms", "Step-free courtyard", "Toilets nearby"],
    good: "You can see the fort from inside the park, and the courtyard approach is flat and paved.",
    emergency: "The courtyard is a large open area with a single wide gateway."
  },
  {
    id: "facilities",
    title: "Accessible toilets & rest",
    kind: "service",
    location: { lat: 24.2180604, lng: 55.7520307 },
    heading: 60, pitch: 0,
    coverage: "Google car coverage",
    // Every claim here is tagged in OpenStreetMap on this exact node —
    // wheelchair=yes, fee=no, changing_table=yes — not assumed.
    blurb: "The accessible toilets on the park's west side.",
    services: ["Step-free toilets", "Free to use", "Changing table", "Shaded seating alongside"],
    good: "These are tagged step-free and free, with a changing table — the detail most parks don't record at all.",
    emergency: "A staffed, shaded point to wait at if you need help or need to cool down."
  },
  {
    id: "playground",
    title: "Playground & lawn",
    kind: "highlight",
    location: { lat: 24.2186161, lng: 55.7519889 },
    heading: 120, pitch: 0,
    coverage: "Google car coverage",
    blurb: "The playground and the open lawn beside it.",
    services: ["Play equipment", "Swings and springers", "Lawn and benches around the edge"],
    good: "The approach path is paved right up to the edge, so you can get close even if sand is hard going.",
    emergency: "Busy and overlooked, so there are usually other families within earshot.",
    // Honest caveat rather than a uniformly cheerful description.
    caution: "The play area surface itself is sand, which is difficult for wheels and walking frames. It can also get loud."
  },
  {
    id: "assembly",
    title: "Emergency & assembly",
    kind: "emergency",
    location: { lat: 24.2162168, lng: 55.7520671 },
    heading: 20, pitch: 0,
    coverage: "Google car coverage",
    blurb: "The main entrance area, where the park's assembly-point signage is posted.",
    services: ["Assembly point signage", "Main entrance", "Wide step-free gateway", "Park notice board"],
    good: "Knowing where you would be told to gather, before anything happens, is worth more than reading it on the day.",
    emergency: "Green assembly-point signs mark where to gather. Gates double as the marked exits — the park has several, so there is almost always one behind you as well as one ahead."
  }
];

// Which gates exist, from OpenStreetMap. Used by the emergency panel to
// answer "where is my nearest way out" rather than naming a single exit.
const PARK_EXITS = [
  { label: "Main entrance (south-west)", lat: 24.2162168, lng: 55.7520671, foot: true },
  { label: "South-west entrance", lat: 24.2163327, lng: 55.7520711, foot: true },
  { label: "South entrance", lat: 24.2159156, lng: 55.7523688, foot: true },
  { label: "South gate", lat: 24.2163301, lng: 55.7530965, foot: true },
  { label: "South-east gate", lat: 24.2164941, lng: 55.7528486, foot: true },
  { label: "East gate", lat: 24.2189105, lng: 55.7564058, foot: true },
  { label: "North-east gate", lat: 24.2180181, lng: 55.7565287, foot: true }
];
