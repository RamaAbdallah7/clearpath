(function () {
  let map, routeLine, markers = [];

  function init() {
    map = L.map("map").setView([PARK_ANCHOR.lat, PARK_ANCHOR.lng], 17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    draw();
  }

  function draw() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    if (routeLine) map.removeLayer(routeLine);

    const latlngs = JOURNEY.map(s => [s.lat, s.lng]);
    routeLine = L.polyline(latlngs, { color: "#1f6f54", weight: 5 }).addTo(map);

    JOURNEY.forEach((stage, idx) => {
      const score = confidenceScore(stage);
      const flagged = flaggedForProfile(stage);
      const color = flagged ? "#a8461e" : (score >= 75 ? "#1f6f54" : score >= 45 ? "#c68a00" : "#a8461e");
      const marker = L.circleMarker([stage.lat, stage.lng], {
        radius: 10,
        color,
        fillColor: color,
        fillOpacity: 0.9
      }).addTo(map);
      marker.bindPopup(
        `<strong>${stage.stage}. ${stage.title}</strong><br>${stage.description}` +
        (flagged ? `<br><em style="color:#a8461e">May not suit your selected profile</em>` : "")
      );
      markers.push(marker);
    });
  }

  function flaggedForProfile(stage) {
    const p = AppState.profile;
    if (p.has("mobility") && !stage.stepFree) return true;
    if (p.has("heat") && stage.shade === "low") return true;
    if (p.has("quiet") && stage.title.toLowerCase().includes("play")) return true;
    return false;
  }

  window.ClearPathMap = {
    refresh() {
      if (!map) init();
      else draw();
      renderStageList();
    }
  };
})();
