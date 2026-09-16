const AppState = {
  screen: "home",
  profile: new Set(),
  currentStageIndex: 0,
  contrast: false
};

function announce(text) {
  const el = document.getElementById("announcer");
  el.textContent = "";
  requestAnimationFrame(() => { el.textContent = text; });
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

function goToScreen(name, opts = {}) {
  const screens = document.querySelectorAll(".screen");
  screens.forEach(s => s.classList.toggle("active", s.id === "screen-" + name));
  document.querySelectorAll("#tabbar button").forEach(b => {
    b.setAttribute("aria-selected", b.dataset.screen === name ? "true" : "false");
  });
  AppState.screen = name;
  document.querySelector("main").scrollTo?.(0, 0);
  window.scrollTo(0, 0);
  if (!opts.silent) announce(`${name} screen`);
  if (name === "journey" && window.ClearPathMap) window.ClearPathMap.refresh();
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("#tabbar button").forEach(btn => {
    btn.addEventListener("click", () => goToScreen(btn.dataset.screen));
  });
  document.querySelectorAll("[data-goto]").forEach(btn => {
    btn.addEventListener("click", () => goToScreen(btn.dataset.goto));
  });

  document.querySelectorAll(".profile-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.profile;
      const pressed = btn.getAttribute("aria-pressed") === "true";
      btn.setAttribute("aria-pressed", String(!pressed));
      if (pressed) AppState.profile.delete(key); else AppState.profile.add(key);
      if (window.ClearPathMap) window.ClearPathMap.refresh();
    });
  });

  document.getElementById("contrastToggle").addEventListener("click", (e) => {
    AppState.contrast = !AppState.contrast;
    document.body.dataset.contrast = AppState.contrast ? "high" : "normal";
    e.target.setAttribute("aria-pressed", String(AppState.contrast));
  });

  const AR_LABELS = {
    home: "الرئيسية", profile: "الملف الشخصي", journey: "خريطة الرحلة",
    ar: "الملاحة بالواقع المعزز", story: "قصة ما قبل الزيارة",
    report: "الإبلاغ والقائمة", access: "التحكم بدون لمس"
  };
  let isArabic = false;
  document.getElementById("langToggle").addEventListener("click", () => {
    isArabic = !isArabic;
    document.documentElement.lang = isArabic ? "ar" : "en";
    document.documentElement.dir = isArabic ? "rtl" : "ltr";
    document.querySelectorAll("#tabbar button").forEach(b => {
      const key = b.dataset.screen;
      if (!b.dataset.enLabel) b.dataset.enLabel = b.textContent;
      b.textContent = isArabic ? AR_LABELS[key] : b.dataset.enLabel;
    });
  });

  renderStageList();
  populateReportStageSelect();
});

function scoreClass(score) {
  if (score >= 75) return "high";
  if (score >= 45) return "mid";
  return "low";
}

function renderStageList() {
  const list = document.getElementById("stageList");
  list.innerHTML = "";
  JOURNEY.forEach((stage, idx) => {
    const score = confidenceScore(stage);
    const li = document.createElement("li");
    li.className = "stage-item" + (idx === AppState.currentStageIndex ? " current" : "");
    li.innerHTML = `
      <img src="${stage.photo}" alt="" />
      <div class="stage-info">
        <strong>${stage.stage}. ${stage.title}</strong>
        <p style="margin:4px 0; color:var(--muted); font-size:0.95rem;">${stage.description}</p>
      </div>
      <span class="score-pill ${scoreClass(score)}">${score}%</span>
    `;
    list.appendChild(li);
  });
}
