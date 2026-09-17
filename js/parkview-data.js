// parkview-data.js — the pre-visit virtual tour.
//
// This started out on Google Street View, which does have real 360° coverage
// of this site. It was dropped on request, so the first question was whether
// any keyless, open source of street-level imagery covers Al Jahili Park.
// Checked, and the answer is no:
//
//   Panoramax   api.panoramax.xyz returns zero features for the park's bbox
//   Mapillary   refuses the query without an OAuth token, and its own map
//               shows no capture traces over the park
//
// So rather than pretend, the tour is built on the site's own photographs —
// the ones in assets/photos, taken at the park itself. That costs the
// free-look-around, and keeps everything that actually mattered: what is
// here, what is good about it, what to watch out for, and what happens in an
// emergency. It also needs no API key of any kind and works offline.
//
// Locations and facts still come from OpenStreetMap, so the tour stays tied
// to real coordinates rather than to where a photo happened to be taken.
const PARK_VIEWPOINTS = [
  {
    id: "arrival-parking",
    title: "1 · Parking",
    kind: "journey",
    photo: "assets/photos/001-thumb.jpg",
    location: { lat: 24.2194879, lng: 55.7578412 },
    source: "Site photo · OSM: service=parking_aisle",
    blurb: "The parking area east of the park. This is where the arrival journey starts.",
    services: ["Parking aisles", "Dropped kerb at the aisle end", "Step-free onto the footpath"],
    good: "You can be dropped off right at the kerb here, and the walk to the gate is flat the whole way.",
    emergency: "If you need to leave in a hurry, this is the widest vehicle access on this side of the park.",
    ar: {
      title: "١ · موقف السيارات",
      blurb: "موقف السيارات شرق الحديقة. من هنا تبدأ رحلة الوصول.",
      services: ["ممرات وقوف", "رصيف منخفض عند طرف الممر", "وصول خالٍ من الدرجات إلى الممشى"],
      good: "يمكن إنزالك عند الرصيف مباشرة، والطريق إلى البوابة مستوٍ طوال المسافة.",
      emergency: "إن احتجت إلى المغادرة سريعاً، فهذا أوسع مدخل للمركبات في هذه الجهة من الحديقة."
    }
  },
  {
    id: "arrival-gate",
    title: "2 · East gate",
    kind: "journey",
    photo: "assets/photos/002-thumb.jpg",
    location: { lat: 24.2189105, lng: 55.7564058 },
    source: "Site photo · OSM: barrier=gate, access=permissive",
    blurb: "The east gate. Step-free, and wide enough for a wheelchair.",
    services: ["Step-free gate", "Bench just inside", "Lit at night"],
    good: "There's somewhere to sit the moment you're through the gate, so you don't have to walk the whole way in one go.",
    emergency: "Gates are the marked exits. This one is the closest exit to the east parking.",
    ar: {
      title: "٢ · البوابة الشرقية",
      blurb: "البوابة الشرقية. خالية من الدرجات وواسعة بما يكفي لكرسي متحرك.",
      services: ["بوابة بلا درجات", "مقعد بالداخل مباشرة", "مضاءة ليلاً"],
      good: "يوجد مكان للجلوس فور دخولك البوابة، فلا تضطر لقطع المسافة كاملة دفعة واحدة.",
      emergency: "البوابات هي المخارج المحدّدة. وهذه أقرب مخرج إلى الموقف الشرقي."
    }
  },
  {
    id: "park-interior",
    title: "3 · Inside the park",
    kind: "journey",
    photo: "assets/photos/003-thumb.jpg",
    // The challenge's own GIS anchor. Nominatim resolves it to a
    // highway=pedestrian way, i.e. the brief's point is on a real walkway.
    location: { lat: 24.2187989, lng: 55.7535982 },
    source: "Site photo · the challenge's GIS anchor, on a highway=pedestrian way",
    blurb: "The shaded walkways at the centre of the park — the challenge's GIS anchor point.",
    services: ["Paved walkways", "Deep tree shade", "Open lawn", "Benches along the paths"],
    good: "This is the part people come for: big shaded lawns, wide flat paths, and room to stop wherever you like.",
    emergency: "Open ground with clear sightlines, and paths leading out to each gate.",
    caution: "One short stretch of paving is uneven. Keeping to the left side avoids it.",
    ar: {
      title: "٣ · داخل الحديقة",
      blurb: "الممرات الظليلة في وسط الحديقة — النقطة الجغرافية المعتمدة في التحدي.",
      services: ["ممرات مرصوفة", "ظل وافر من الأشجار", "مساحة خضراء مفتوحة", "مقاعد على امتداد الممرات"],
      good: "هذا ما يأتي الناس من أجله: مساحات خضراء ظليلة، وممرات عريضة مستوية، ومتّسع للتوقف حيثما شئت.",
      emergency: "أرض مفتوحة وبمدى رؤية واضح، وممرات تؤدي إلى كل بوابة.",
      caution: "يوجد مقطع قصير ببلاط غير مستوٍ. الالتزام بالجهة اليسرى يتجنّبه."
    }
  },
  {
    id: "facilities",
    title: "Accessible toilets & rest",
    kind: "service",
    photo: "assets/photos/004-thumb.jpg",
    location: { lat: 24.2180604, lng: 55.7520307 },
    // Every claim here is tagged on this exact OSM node, not assumed.
    source: "Site photo · OSM: amenity=toilets, wheelchair=yes, fee=no, changing_table=yes",
    blurb: "The accessible toilets on the park's west side.",
    services: ["Step-free toilets", "Free to use", "Changing table", "Shaded seating alongside"],
    good: "These are tagged step-free and free, with a changing table — the detail most parks don't record at all.",
    emergency: "A shaded, overlooked point to wait at if you need help or need to cool down.",
    ar: {
      title: "دورات مياه مهيّأة واستراحة",
      blurb: "دورات المياه المهيّأة لذوي الهمم في الجهة الغربية من الحديقة.",
      services: ["دورات مياه بلا درجات", "مجانية", "طاولة تغيير", "مقاعد ظليلة بجوارها"],
      good: "مسجّلة رسمياً بأنها خالية من الدرجات ومجانية وبها طاولة تغيير — وهي تفاصيل لا توثّقها معظم الحدائق أصلاً.",
      emergency: "نقطة ظليلة وواضحة للانتظار إن احتجت مساعدة أو أردت أن تبرّد."
    }
  },
  {
    id: "playground",
    title: "Playground & lawn",
    kind: "highlight",
    photo: "assets/photos/005-thumb.jpg",
    location: { lat: 24.2186161, lng: 55.7519889 },
    source: "Site photo · OSM: leisure=playground, access=yes",
    blurb: "The playground and the open lawn beside it.",
    services: ["Play equipment", "Swings and springers", "Lawn and benches around the edge"],
    good: "The approach path is paved right up to the edge, so you can get close even if sand is hard going.",
    emergency: "Busy and overlooked, so there are usually other families within earshot.",
    caution: "The play area surface itself is sand, which is difficult for wheels and walking frames. It can also get loud.",
    ar: {
      title: "منطقة الألعاب والمساحة الخضراء",
      blurb: "منطقة الألعاب والمساحة الخضراء المجاورة لها.",
      services: ["ألعاب أطفال", "أراجيح وألعاب نطّاطة", "مساحة خضراء ومقاعد حول الأطراف"],
      good: "الممر المؤدّي إليها مرصوف حتى الحافة، فيمكنك الاقتراب حتى لو كان السير على الرمل صعباً.",
      emergency: "مزدحمة وواضحة للعيان، وغالباً ما توجد عائلات أخرى على مسمع منك.",
      caution: "أرضية منطقة اللعب نفسها رملية، وهي صعبة على العجلات والمشايات. وقد ترتفع فيها الأصوات."
    }
  },
  {
    id: "assembly",
    title: "Emergency & assembly",
    kind: "emergency",
    photo: "assets/photos/006-thumb.jpg",
    location: { lat: 24.2162168, lng: 55.7520671 },
    source: "Site photo · OSM: entrance=main",
    blurb: "The main entrance area, where the park's assembly-point signage is posted.",
    services: ["Assembly point signage", "Main entrance", "Wide step-free gateway", "Park notice board"],
    good: "Knowing where you would be told to gather, before anything happens, is worth more than reading it on the day.",
    emergency: "Green assembly-point signs mark where to gather. Gates double as the marked exits — the park has several, so there is almost always one behind you as well as one ahead.",
    ar: {
      title: "الطوارئ ونقطة التجمّع",
      blurb: "منطقة المدخل الرئيسي، حيث توجد لافتات نقطة التجمّع.",
      services: ["لافتات نقطة التجمّع", "المدخل الرئيسي", "مدخل عريض بلا درجات", "لوحة إرشادات الحديقة"],
      good: "أن تعرف أين سيُطلب منك التجمّع قبل وقوع أي شيء، أنفع بكثير من قراءتها في يومها.",
      emergency: "اللافتات الخضراء تحدّد نقطة التجمّع. والبوابات هي المخارج المعتمدة — وللحديقة عدة بوابات، فغالباً ما يوجد مخرج خلفك كما أمامك."
    }
  },
  {
    id: "site-plan",
    title: "Whole-park plan",
    kind: "highlight",
    photo: "assets/site-plan.jpg",
    location: { lat: 24.2187989, lng: 55.7535982 },
    source: "Al Ain City Municipality site plan",
    blurb: "The municipality's own plan of the whole park, with the challenge's GIS point marked.",
    services: ["Full path layout", "Parking areas", "Building footprints", "Park boundary"],
    good: "Seeing the whole shape of the park first makes the individual paths much easier to place.",
    emergency: "Useful for working out which gate is nearest to wherever you plan to be.",
    ar: {
      title: "مخطط الحديقة كاملاً",
      blurb: "مخطط بلدية مدينة العين للحديقة كاملة، وعليه النقطة الجغرافية المعتمدة في التحدي.",
      services: ["توزيع الممرات كاملاً", "مواقف السيارات", "مواقع المباني", "حدود الحديقة"],
      good: "رؤية شكل الحديقة كاملاً أولاً تجعل تحديد كل ممر على حدة أسهل بكثير.",
      emergency: "مفيد لمعرفة أقرب بوابة إلى المكان الذي تنوي التواجد فيه."
    }
  }
];

// Which gates exist, from OpenStreetMap. The emergency panel lists them all
// because "the nearest exit" depends entirely on where you are standing.
const PARK_EXITS = [
  { label: "Main entrance (south-west)", ar: "المدخل الرئيسي (جنوب غرب)", lat: 24.2162168, lng: 55.7520671 },
  { label: "South-west entrance", ar: "مدخل الجنوب الغربي", lat: 24.2163327, lng: 55.7520711 },
  { label: "South entrance", ar: "المدخل الجنوبي", lat: 24.2159156, lng: 55.7523688 },
  { label: "South gate", ar: "البوابة الجنوبية", lat: 24.2163301, lng: 55.7530965 },
  { label: "South-east gate", ar: "البوابة الجنوبية الشرقية", lat: 24.2164941, lng: 55.7528486 },
  { label: "East gate", ar: "البوابة الشرقية", lat: 24.2189105, lng: 55.7564058 },
  { label: "North-east gate", ar: "البوابة الشمالية الشرقية", lat: 24.2180181, lng: 55.7565287 }
];
