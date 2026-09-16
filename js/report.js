(function () {
  const STORAGE_KEY = "clearpath_reports";

  function loadReports() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch (_) { return []; }
  }
  function saveReports(reports) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(reports)); } catch (_) {}
  }

  function renderTable() {
    const tbody = document.querySelector("#reportTable tbody");
    tbody.innerHTML = "";
    loadReports().forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.stage}</td><td>${r.note}</td><td>${new Date(r.time).toLocaleString()}</td>`;
      tbody.appendChild(tr);
    });
  }

  function populateSelect() {
    const select = document.getElementById("reportStage");
    select.innerHTML = "";
    JOURNEY.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.title;
      opt.textContent = `${s.stage}. ${s.title}`;
      select.appendChild(opt);
    });
  }

  function addReport() {
    const stage = document.getElementById("reportStage").value;
    const noteEl = document.getElementById("reportNote");
    const note = noteEl.value.trim();
    if (!note) { announce("Please add a note before saving."); return; }
    const reports = loadReports();
    reports.push({ stage, note, time: Date.now() });
    saveReports(reports);
    noteEl.value = "";
    renderTable();
    announce("Added to checklist.");
    toast("Added to accessibility checklist");
    Sensory.earcon("barrier");
    if (AppState.settings.haptics) Sensory.vibrate(50);
  }

  function exportChecklist() {
    const reports = loadReports();
    const lines = [
      "ClearPath — Accessibility Arrival Checklist",
      "Al Jahili Park, Challenge 1 (KU x ZA Inclusion Innovation Hackathon)",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      ...reports.map((r, i) => `${i + 1}. [${r.stage}] ${r.note} — ${new Date(r.time).toLocaleString()}`)
    ];
    if (reports.length === 0) lines.push("(No barriers reported yet.)");
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "clearpath-accessibility-checklist.txt";
    a.click();
    toast("Checklist exported");
  }

  window.populateReportStageSelect = populateSelect;

  document.addEventListener("DOMContentLoaded", () => {
    renderTable();
    document.getElementById("reportAdd").addEventListener("click", addReport);
    document.getElementById("reportExport").addEventListener("click", exportChecklist);
  });
})();
