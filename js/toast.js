(function () {
  let container;
  document.addEventListener("DOMContentLoaded", () => {
    container = document.getElementById("toastRegion");
  });

  window.toast = function (message, kind) {
    if (!container) container = document.getElementById("toastRegion");
    const el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.textContent = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 250);
    }, 2600);
  };
})();
