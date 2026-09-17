// i18n.js — Arabic and English, as equals.
//
// The app had a language toggle that swapped six tab labels and set dir=rtl.
// Everything a visitor actually needed to read — every stage description,
// every spoken cue, every button — stayed in English. For a park in Al Ain
// that is not a language toggle, it is a decoration.
//
// Feedback from People of Determination testing the app was blunt about it:
// English is a barrier. So Arabic is not a translation layer bolted on top
// here; it is the second content language, and where the two disagree the
// app follows the one the visitor chose — including which voice speaks, which
// speech recogniser listens, and which way the layout runs.
//
// Two mechanisms:
//   t("key")        UI chrome, from the STRINGS table below
//   tx(obj, "f")    content fields, reading obj.ar.f when Arabic is active
//                   and falling back to obj.f when no translation exists
//
// Falling back rather than showing an empty string is deliberate: an English
// sentence a reader can paste into a translator is far more use than a blank.
(function () {
  const STRINGS = {
    en: {
      "app.name": "ClearPath",
      "app.tagline": "Al Jahili Park · Arrival journey",

      "tab.home": "Home",
      "tab.journey": "Map",
      "tab.ar": "AR",
      "tab.visit": "Visit",
      "tab.assist": "Assist",
      "tab.story": "Story",
      "tab.report": "Report",
      "tab.access": "Hands-Free",

      "lang.switch": "التبديل إلى العربية",
      "lang.name": "English",

      // ── Assist screen ──
      "assist.title": "Ask about what's in front of you",
      "assist.intro": "Point the camera at anything and ask a question out loud, in Arabic or English. An AI answers in seconds — or a human volunteer can look for you.",
      "assist.start": "Open camera",
      "assist.stop": "Close camera",
      "assist.mode.ask": "Ask a question",
      "assist.mode.find": "Find an object",
      "assist.mode.read": "Read text aloud",
      "assist.ask.hint": "Ask anything — \"what is in front of me?\", \"is the path clear?\", \"what does this sign say?\"",
      "assist.ask.placeholder": "Type or speak your question",
      "assist.ask.listen": "🎤 Speak your question",
      "assist.ask.listening": "Listening…",
      "assist.ask.send": "Ask",
      "assist.answering": "Looking…",
      "assist.answeredBy.ai": "Answered by AI",
      "assist.answeredBy.volunteer": "Answered by a volunteer",
      "assist.who.ai": "🤖 Ask the AI",
      "assist.who.volunteer": "🧑 Ask a volunteer",
      "assist.who.hint": "The AI answers immediately. A volunteer is a real person — slower, but better when the AI isn't sure.",
      "assist.unsure": "The AI wasn't confident about that. Would you like a volunteer to look?",
      "assist.escalate": "Ask a volunteer instead",
      "assist.find.placeholder": "What should I look for?",
      "assist.find.start": "Start searching",
      "assist.find.stop": "Stop searching",
      "assist.find.hint": "Say what you're looking for, then sweep the camera slowly. The beeps get faster as it comes into view.",
      "assist.find.searching": "Searching for",
      "assist.find.found": "Found it",
      "assist.find.lost": "Lost it — keep sweeping slowly",
      "assist.find.unsupported": "I can't look for that yet. I can find: ",
      "assist.read.start": "Read what's in view",
      "assist.read.hint": "Point at a sign, notice or menu and I'll read it out.",
      "assist.read.none": "I can't see any readable text. Try moving closer or steadying the camera.",

      // ── Plain language ──
      // Added after a tester said the links, forms and apps she is sent are
      // the barrier — not the park. Understanding what something asks of you
      // is an access need like any other.
      "assist.mode.explain": "Explain this to me",
      "assist.explain.hint": "Paste a link, or point the camera at a form, letter or sign. I'll say plainly what it is and what it wants you to do.",
      "assist.explain.placeholder": "Paste a link, or type what confused you",
      "assist.explain.link": "Explain this link",
      "assist.explain.camera": "Explain what I'm pointing at",
      "assist.explain.working": "Reading it…",
      "assist.explain.what": "What this is",
      "assist.explain.asks": "What it's asking you to do",
      "assist.explain.steps": "Steps to follow",
      "assist.explain.watch": "Be careful about",
      "assist.explain.failed": "I couldn't open that link. It may need a login, or the address may be wrong.",
      "assist.explain.notlink": "That doesn't look like a web address. Paste a link starting with http, or use the camera instead.",
      "assist.simple": "Simple language",
      "assist.simple.on": "Simple language is on. I'll keep everything short and plain.",
      "assist.simple.off": "Simple language is off.",

      "visit.title": "Visit before you travel",
      "visit.intro": "See the park before you decide to make the trip — the gate, the paths, the toilets and the assembly point, in photographs taken at Al Jahili Park itself. Works offline and needs no API key of any kind.",
      "visit.exits": "Every way out",
      "visit.exits.intro": "Gates mapped in OpenStreetMap. In an evacuation the nearest exit depends on where you are — so here is all of them, not just the main one.",

      // Home screen. Was English-only, which for a park in Al Ain made the
      // very first screen a barrier for the people the app is built for.
      "home.badge": "Challenge 1 · Al Jahili Park",
      "home.title": "Independent arrival, from parking to Al Jahili Park",
      "home.sub": "Built for Focus Area 2 (Vision & Sensory Technology) of the KU × ZA Inclusion Innovation Hackathon.",
      "home.problem.h": "The problem",
      "home.problem.quote": "\"Can a Person of Determination move independently from parking areas to the park entrance and internal pathways without obstacles, gaps in accessibility, or unclear directions?\" — the challenge brief, verbatim.",
      "home.problem.body": "Right now: nothing tells a visitor, before or during the walk, which parts of the route are step-free, shaded, or safe — or confirms they're going the right way. Confidence breaks down before the visit even starts.",
      "home.solution.h": "How ClearPath addresses it",
      "home.cta.trip": "See the simulated trip",
      "home.cta.map": "See journey map",
      "home.s1": "Unclear directions — a live simulated trip and AR arrow show exactly where to go, stage by stage.",
      "home.s2": "Can't tell what's ahead — the journey map scores every stage for step-free access, shade, and rest points before you commit.",
      "home.s3": "Needs to look at a screen to navigate — a proximity sound beacon, haptic pulses, and voice control mean you never have to.",
      "home.s4": "Anxiety about the unfamiliar — a narrated, mood-aware pre-visit story prepares a child before arrival.",
      "home.s5": "No way to flag what's actually broken — barrier reports export straight into a municipality-ready checklist.",
      "home.stat1": "journey stages",
      "home.stat2": "GIS-anchored route",
      "home.stat3": "people live with vision impairment worldwide",
      "home.f1": "Journey Map", "home.f1d": "GIS route with a confidence score per stage",
      "home.f2": "AR & Simulated Trip", "home.f2d": "See the walk before you make it",
      "home.f3": "Pre-visit Story", "home.f3d": "A calm, narrated walkthrough for children",
      "home.f4": "Report a Barrier", "home.f4d": "Export a municipality-ready checklist",

      // Shown on a static deployment, where there is no backend to answer.
      "backend.off.title": "AI answers and volunteers need the local server",
      "backend.off.body": "This published copy is a static site, so it cannot run the helper service. Everything else works: the routed map, facilities, obstacle alerts, the path line, the virtual visit, and both languages. To use AI answers, link explanations and volunteers, run the app from your own machine.",
      "backend.off.ask": "Asking a volunteer and AI answers are unavailable here.",
      "assist.camera.denied": "Camera access is blocked. Allow it in your browser settings and try again.",
      "assist.offline": "The assist service isn't running. Start the local proxy to use AI answers and volunteers.",

      // ── Volunteer ──
      "vol.calling": "Calling a volunteer…",
      "vol.waiting": "Waiting for someone to pick up",
      "vol.connected": "Connected — a volunteer can see your camera",
      "vol.ended": "Call ended",
      "vol.none": "No volunteer picked up. I've sent them a photo and your question instead — the answer will appear here.",
      "vol.sent": "Sent to volunteers",
      "vol.hangup": "End call",
      "vol.cancel": "Cancel",

      "common.cancel": "Cancel",
      "common.retry": "Try again",
      "common.close": "Close",
      "common.speak": "🔊 Read aloud"
    },

    ar: {
      "app.name": "كليربَاث",
      "app.tagline": "حديقة الجاهلي · رحلة الوصول",

      "tab.home": "الرئيسية",
      "tab.journey": "الخريطة",
      "tab.ar": "الواقع المعزز",
      "tab.visit": "زيارة",
      "tab.assist": "مساعدة",
      "tab.story": "القصة",
      "tab.report": "الإبلاغ",
      "tab.access": "بدون لمس",

      "lang.switch": "Switch to English",
      "lang.name": "العربية",

      "assist.title": "اسأل عمّا أمامك",
      "assist.intro": "وجّه الكاميرا نحو أي شيء واطرح سؤالك بصوتك، بالعربية أو الإنجليزية. يجيبك الذكاء الاصطناعي خلال ثوانٍ، أو يمكن لمتطوّع أن ينظر نيابةً عنك.",
      "assist.start": "افتح الكاميرا",
      "assist.stop": "أغلق الكاميرا",
      "assist.mode.ask": "اطرح سؤالاً",
      "assist.mode.find": "ابحث عن شيء",
      "assist.mode.read": "اقرأ النص بصوت عالٍ",
      "assist.ask.hint": "اسأل ما تشاء — «ماذا أمامي؟»، «هل الطريق خالٍ؟»، «ماذا تقول هذه اللافتة؟»",
      "assist.ask.placeholder": "اكتب سؤالك أو انطق به",
      "assist.ask.listen": "🎤 انطق سؤالك",
      "assist.ask.listening": "أستمع…",
      "assist.ask.send": "اسأل",
      "assist.answering": "أنظر…",
      "assist.answeredBy.ai": "إجابة من الذكاء الاصطناعي",
      "assist.answeredBy.volunteer": "إجابة من متطوّع",
      "assist.who.ai": "🤖 اسأل الذكاء الاصطناعي",
      "assist.who.volunteer": "🧑 اسأل متطوّعاً",
      "assist.who.hint": "يجيب الذكاء الاصطناعي فوراً. أما المتطوّع فهو إنسان حقيقي — أبطأ، لكنه أفضل حين لا يكون الذكاء الاصطناعي واثقاً.",
      "assist.unsure": "لم يكن الذكاء الاصطناعي واثقاً من ذلك. هل تودّ أن ينظر متطوّع؟",
      "assist.escalate": "اسأل متطوّعاً بدلاً من ذلك",
      "assist.find.placeholder": "عمّ أبحث؟",
      "assist.find.start": "ابدأ البحث",
      "assist.find.stop": "أوقف البحث",
      "assist.find.hint": "قل ما تبحث عنه، ثم حرّك الكاميرا ببطء. تتسارع النغمات كلما اقترب من مجال الرؤية.",
      "assist.find.searching": "أبحث عن",
      "assist.find.found": "وجدته",
      "assist.find.lost": "فقدته — واصل التحريك ببطء",
      "assist.find.unsupported": "لا أستطيع البحث عن ذلك بعد. أستطيع أن أجد: ",
      "assist.read.start": "اقرأ ما في المشهد",
      "assist.read.hint": "وجّه الكاميرا إلى لافتة أو إعلان أو قائمة وسأقرأها لك.",
      "assist.read.none": "لا أرى نصاً واضحاً. حاول الاقتراب أكثر أو تثبيت الكاميرا.",

      "assist.mode.explain": "اشرح لي هذا",
      "assist.explain.hint": "الصق رابطاً، أو وجّه الكاميرا إلى نموذج أو رسالة أو لافتة. سأخبرك ببساطة ما هذا وما المطلوب منك.",
      "assist.explain.placeholder": "الصق رابطاً، أو اكتب ما أشكل عليك",
      "assist.explain.link": "اشرح هذا الرابط",
      "assist.explain.camera": "اشرح ما أوجّه إليه الكاميرا",
      "assist.explain.working": "أقرؤه…",
      "assist.explain.what": "ما هذا",
      "assist.explain.asks": "ما المطلوب منك",
      "assist.explain.steps": "الخطوات المطلوبة",
      "assist.explain.watch": "انتبه إلى",
      "assist.explain.failed": "لم أتمكّن من فتح هذا الرابط. قد يحتاج إلى تسجيل دخول، أو قد يكون العنوان خاطئاً.",
      "assist.explain.notlink": "لا يبدو هذا عنوان موقع. الصق رابطاً يبدأ بـ http، أو استخدم الكاميرا بدلاً من ذلك.",
      "assist.simple": "لغة مبسّطة",
      "assist.simple.on": "اللغة المبسّطة مُفعّلة. سأبقي كل شيء قصيراً وواضحاً.",
      "assist.simple.off": "اللغة المبسّطة مُعطّلة.",

      "visit.title": "زُر المكان قبل أن تسافر",
      "visit.intro": "شاهد الحديقة قبل أن تقرّر الذهاب — البوابة والممرات ودورات المياه ونقطة التجمّع، في صور التُقطت في حديقة الجاهلي نفسها. تعمل بلا إنترنت ولا تحتاج أي مفتاح برمجي.",
      "visit.exits": "كل المخارج",
      "visit.exits.intro": "بوابات موثّقة في خرائط الشارع المفتوحة. في حالة الإخلاء يعتمد أقرب مخرج على موقعك — لذا هذه كلها، لا المدخل الرئيسي وحده.",

      "home.badge": "التحدي الأول · حديقة الجاهلي",
      "home.title": "وصول مستقل، من موقف السيارات إلى حديقة الجاهلي",
      "home.sub": "أُنجز لمجال التركيز الثاني (تقنيات البصر والحواس) في هاكاثون الابتكار الشامل بين جامعة خليفة وهيئة زايد لأصحاب الهمم.",
      "home.problem.h": "المشكلة",
      "home.problem.quote": "«هل يستطيع أحد أصحاب الهمم التنقّل باستقلالية من مواقف السيارات إلى مدخل الحديقة وممراتها الداخلية دون عوائق أو فجوات في إمكانية الوصول أو إرشادات غير واضحة؟» — نصّ التحدي حرفياً.",
      "home.problem.body": "الوضع اليوم: لا شيء يخبر الزائر، قبل المسير أو أثناءه، أيّ أجزاء الطريق خالية من الدرجات أو ظليلة أو آمنة — ولا يؤكّد له أنه يسير في الاتجاه الصحيح. فتنهار الثقة قبل أن تبدأ الزيارة أصلاً.",
      "home.solution.h": "كيف تعالج كليربَاث ذلك",
      "home.cta.trip": "شاهد الرحلة المحاكاة",
      "home.cta.map": "اعرض خريطة الرحلة",
      "home.s1": "إرشادات غير واضحة — رحلة محاكاة حيّة وسهم بالواقع المعزز يبيّنان الوجهة بدقة، مرحلة بمرحلة.",
      "home.s2": "لا تعرف ما ينتظرك — خريطة الرحلة تقيّم كل مرحلة من حيث خلوّها من الدرجات والظل وأماكن الاستراحة قبل أن تلتزم بالذهاب.",
      "home.s3": "الاضطرار إلى النظر إلى الشاشة للتنقّل — منارة صوتية تتبع القرب، ونبضات اهتزاز، وتحكّم بالصوت تغنيك عن ذلك تماماً.",
      "home.s4": "القلق من المكان غير المألوف — قصة مروية قبل الزيارة تراعي مشاعر الطفل وتهيّئه قبل الوصول.",
      "home.s5": "لا سبيل للإبلاغ عمّا هو معطَّل فعلاً — تقارير العوائق تُصدَّر مباشرة في قائمة تحقّق جاهزة للبلدية.",
      "home.stat1": "مراحل الرحلة",
      "home.stat2": "مسار مثبّت جغرافياً",
      "home.stat3": "شخص يعيشون مع إعاقة بصرية حول العالم",
      "home.f1": "خريطة الرحلة", "home.f1d": "مسار جغرافي مع درجة ثقة لكل مرحلة",
      "home.f2": "الواقع المعزز والرحلة المحاكاة", "home.f2d": "شاهد الطريق قبل أن تسلكه",
      "home.f3": "قصة ما قبل الزيارة", "home.f3d": "جولة مروية هادئة للأطفال",
      "home.f4": "الإبلاغ عن عائق", "home.f4d": "صدّر قائمة تحقّق جاهزة للبلدية",

      "backend.off.title": "إجابات الذكاء الاصطناعي والمتطوّعون تحتاج الخادم المحلي",
      "backend.off.body": "هذه النسخة المنشورة موقع ثابت، فلا يمكنها تشغيل خدمة المساعدة. أما البقية فتعمل: الخريطة والمسار، والمرافق، وتنبيهات العوائق، وخط المسار، والزيارة الافتراضية، واللغتان. ولاستخدام إجابات الذكاء الاصطناعي وشرح الروابط والمتطوّعين، شغّل التطبيق من جهازك.",
      "backend.off.ask": "طلب متطوّع وإجابات الذكاء الاصطناعي غير متاحة هنا.",
      "assist.camera.denied": "الوصول إلى الكاميرا محجوب. اسمح به في إعدادات المتصفح ثم أعد المحاولة.",
      "assist.offline": "خدمة المساعدة غير مُشغَّلة. شغّل الخادم المحلي لاستخدام إجابات الذكاء الاصطناعي والمتطوّعين.",

      "vol.calling": "أتصل بمتطوّع…",
      "vol.waiting": "في انتظار من يجيب",
      "vol.connected": "تم الاتصال — يستطيع المتطوّع رؤية كاميرتك",
      "vol.ended": "انتهت المكالمة",
      "vol.none": "لم يُجب أي متطوّع. أرسلتُ إليهم صورة وسؤالك بدلاً من ذلك — وستظهر الإجابة هنا.",
      "vol.sent": "أُرسل إلى المتطوّعين",
      "vol.hangup": "أنهِ المكالمة",
      "vol.cancel": "إلغاء",

      "common.cancel": "إلغاء",
      "common.retry": "أعد المحاولة",
      "common.close": "إغلاق",
      "common.speak": "🔊 اقرأ بصوت عالٍ"
    }
  };

  function lang() {
    // AppState is declared `const` at the top level of a classic script, so
    // it is a script-scope binding and NOT a property of window. Guarding on
    // `window.AppState` therefore always failed, and every string silently
    // came back English no matter what the user had selected. Reference the
    // binding directly, with typeof to stay safe if load order ever changes.
    return (typeof AppState !== "undefined" && AppState.isArabic) ? "ar" : "en";
  }

  function t(key, vars) {
    const table = STRINGS[lang()] || STRINGS.en;
    let s = table[key];
    if (s === undefined) s = STRINGS.en[key];
    if (s === undefined) {
      console.warn("[i18n] missing key:", key);
      return key;
    }
    if (vars) for (const k of Object.keys(vars)) s = s.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
    return s;
  }

  // Content fields. `obj.ar` holds the Arabic version of whichever fields
  // have been translated; anything missing falls back to the English field
  // rather than rendering blank.
  function tx(obj, field) {
    if (!obj) return "";
    if (lang() === "ar" && obj.ar && obj.ar[field]) return obj.ar[field];
    return obj[field] ?? "";
  }

  // BCP-47 tags for the Web Speech APIs. Both the recogniser and the
  // synthesiser have to follow the chosen language, or the app listens in
  // the wrong language and answers in the wrong accent.
  function speechLang() { return lang() === "ar" ? "ar-AE" : "en-US"; }

  // Apply every translatable attribute in the DOM. Elements opt in with
  // data-i18n (text), data-i18n-placeholder, or data-i18n-aria.
  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
      el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
    });
    root.querySelectorAll("[data-i18n-aria]").forEach(el => {
      el.setAttribute("aria-label", t(el.dataset.i18nAria));
    });
    document.documentElement.lang = lang();
    document.documentElement.dir = lang() === "ar" ? "rtl" : "ltr";
  }

  // Arabic-speaking visitors shouldn't have to find a toggle before they can
  // read anything, so honour the browser's own language on first load.
  function detect() {
    try {
      const prefs = (navigator.languages && navigator.languages.length)
        ? navigator.languages
        : [navigator.language || "en"];
      // Only start in Arabic if Arabic actually outranks English in the
      // browser's own order. Matching Arabic anywhere in the list would flip
      // the UI for someone whose first language is English but who happens
      // to have ar-AE third — a worse default than leaving it alone.
      for (const raw of prefs) {
        const l = String(raw).toLowerCase();
        if (l.startsWith("ar")) return true;
        if (l.startsWith("en")) return false;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  window.I18n = { t, tx, apply, lang, speechLang, detect, STRINGS };
})();
