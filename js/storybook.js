(function () {
  let pageIndex = 0;

  function render() {
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
  }

  function next() {
    if (pageIndex < STORY_PAGES.length - 1) { pageIndex++; render(); }
  }
  function back() {
    if (pageIndex > 0) { pageIndex--; render(); }
  }
  function readAloud() {
    const page = STORY_PAGES[pageIndex];
    speak(`${page.text} ${page.sub}`);
  }

  document.addEventListener("DOMContentLoaded", () => {
    render();
    document.getElementById("storyNext").addEventListener("click", next);
    document.getElementById("storyBack").addEventListener("click", back);
    document.getElementById("storyRead").addEventListener("click", readAloud);
  });

  window.ClearPathStory = { next, back, readAloud };
})();
