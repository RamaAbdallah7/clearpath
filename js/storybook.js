(function () {
  let pageIndex = 0;
  let mood = null;

  const MOOD_INTRO = {
    calm: "That's great to hear. Let's take a calm walk through what today looks like.",
    excited: "Yay! Let's see what's waiting for you at the park.",
    nervous: "That's okay — lots of people feel that way before somewhere new. Let's go through it together, slowly.",
    scared: "Thank you for telling me. We'll go one small step at a time, and you can stop whenever you like."
  };

  function render(speakIt) {
    const page = STORY_PAGES[pageIndex];
    const el = document.getElementById("storyPage");
    el.innerHTML = `
      <img src="${page.photo}" alt="" />
      <div class="story-text">${page.text}</div>
      <div class="story-sub">${page.sub}</div>
    `;
    document.getElementById("storyProgress").textContent = `${pageIndex + 1} / ${STORY_PAGES.length}`;
    document.getElementById("storyBack").disabled = pageIndex === 0;
    document.getElementById("storyNext").disabled = pageIndex === STORY_PAGES.length - 1;
    if (speakIt) readAloud();
  }

  function next() {
    if (pageIndex < STORY_PAGES.length - 1) { pageIndex++; render(true); }
  }
  function back() {
    if (pageIndex > 0) { pageIndex--; render(true); }
  }
  function readAloud() {
    const page = STORY_PAGES[pageIndex];
    speak(`${page.text} ${page.sub}`, "calm");
  }

  function chooseMood(m) {
    mood = m;
    document.getElementById("storyMoodCard").hidden = true;
    document.getElementById("storyReaderCard").hidden = false;
    pageIndex = 0;
    render(false);
    Sensory.ambientStart();
    speak(MOOD_INTRO[m] || "", "calm");
    setTimeout(() => readAloud(), 3200);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("#moodGrid .profile-toggle").forEach(btn => {
      btn.addEventListener("click", () => chooseMood(btn.dataset.mood));
    });
    document.getElementById("storyNext").addEventListener("click", next);
    document.getElementById("storyBack").addEventListener("click", back);
    document.getElementById("storyRead").addEventListener("click", readAloud);
    document.getElementById("storyView3D").addEventListener("click", () => {
      window.ClearPathStory3D.open(STORY_PAGES[pageIndex]);
    });
  });

  window.ClearPathStory = {
    next, back, readAloud,
    reset() {
      mood = null;
      pageIndex = 0;
      document.getElementById("storyMoodCard").hidden = false;
      document.getElementById("storyReaderCard").hidden = true;
      Sensory.ambientStop();
    }
  };
})();
