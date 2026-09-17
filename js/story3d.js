// A real, working immersive viewer for the pre-visit story, in the spirit
// of the Little Lantern storybook project's "View in 3D" goggles button
// (WebXR + Three.js, drag to look around, Enter VR on a headset). These
// story photos are single frames, not true panoramas, so rather than
// wrapping a full sphere (which would pinch and distort badly at the
// poles), this maps each photo onto a wide curved arc in front of the
// viewer — an honest "step into the scene" effect for a single image, with
// pan/tilt clamped to the mapped arc so you can't drag past the seams.
(function () {
  let renderer, scene, camera, mesh, rafId = null;
  let dragging = false, lastX = 0, lastY = 0;
  let lon = 0, lat = 0;
  let xrSession = null;

  const overlay = document.getElementById("story3dOverlay");
  const canvas = document.getElementById("story3dCanvas");
  const closeBtn = document.getElementById("story3dClose");
  const vrBtn = document.getElementById("story3dVR");
  const hint = document.getElementById("story3dHint");

  function ready() { return typeof THREE !== "undefined"; }

  function buildScene(imageUrl) {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.xr.enabled = true;

    const loader = new THREE.TextureLoader();
    const texture = loader.load(imageUrl);
    const geometry = new THREE.CylinderGeometry(6, 6, 6, 48, 1, true, -Math.PI / 3, (Math.PI * 2) / 3);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide });
    mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    lon = 0; lat = 0;
    updateCamera();
  }

  // CylinderGeometry places theta=0 at world +Z (x = r·sinθ, z = r·cosθ), so
  // the look direction must be built the same way — lon/lat both zero must
  // aim at (0,0,1) to face the centre of the mapped arc, not -Z.
  function updateCamera() {
    const theta = THREE.MathUtils.degToRad(lon);
    const phi = THREE.MathUtils.degToRad(lat);
    camera.position.set(0, 0, 0);
    camera.lookAt(
      Math.sin(theta) * Math.cos(phi),
      Math.sin(phi),
      Math.cos(theta) * Math.cos(phi)
    );
  }

  function onPointerDown(e) {
    dragging = true;
    lastX = e.clientX ?? e.touches?.[0]?.clientX;
    lastY = e.clientY ?? e.touches?.[0]?.clientY;
    hint.style.opacity = "0";
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX;
    const y = e.clientY ?? e.touches?.[0]?.clientY;
    lon -= (x - lastX) * 0.15;
    lat += (y - lastY) * 0.15;
    lat = Math.max(-25, Math.min(25, lat));
    lon = Math.max(-45, Math.min(45, lon));
    lastX = x; lastY = y;
    updateCamera();
  }
  function onPointerUp() { dragging = false; }

  function loop() {
    if (renderer.xr.isPresenting) {
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
    } else {
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(loop);
    }
  }

  function resize() {
    if (!renderer) return;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  }

  async function checkVRSupport() {
    vrBtn.hidden = true;
    if (navigator.xr && navigator.xr.isSessionSupported) {
      try {
        const supported = await navigator.xr.isSessionSupported("immersive-vr");
        vrBtn.hidden = !supported;
      } catch (_) {}
    }
  }

  async function enterVR() {
    if (!navigator.xr) return;
    try {
      xrSession = await navigator.xr.requestSession("immersive-vr");
      await renderer.xr.setSession(xrSession);
      xrSession.addEventListener("end", () => { xrSession = null; });
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
    } catch (err) {
      announce("VR session couldn't start: " + err.message);
    }
  }

  function open(page) {
    overlay.hidden = false;
    hint.style.opacity = "1";
    if (!ready()) {
      hint.textContent = "3D viewer failed to load — check your internet connection.";
      return;
    }
    buildScene(page.photo);
    checkVRSupport();
    loop();
    window.addEventListener("resize", resize);
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function close() {
    overlay.hidden = true;
    tour = null;
    const bar = document.getElementById("story3dTourBar");
    if (bar) bar.hidden = true;
    window.removeEventListener("keydown", onTourKey);
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (xrSession) { xrSession.end(); xrSession = null; }
    if (renderer) { renderer.setAnimationLoop(null); renderer.dispose(); }
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resize);
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  closeBtn.addEventListener("click", close);
  vrBtn.addEventListener("click", enterVR);

  /* ── Guided VR tour ──
     The viewer already put one photo on a curved arc with drag-to-look and
     Enter VR. A pre-visit only works as preparation if it walks you through
     the place in order, narrating as it goes — so this sequences the
     verified viewpoints, speaks each one, and lets you step at your own
     pace. On a headset it is the same tour in stereo; on a phone it is
     drag-to-look; on a laptop it is arrow keys. */
  let tour = null;
  let tourIndex = 0;

  function tourLabel() {
    const el = document.getElementById("story3dLabel");
    if (!el || !tour) return;
    const v = tour[tourIndex];
    el.innerHTML =
      `<strong>${I18n.tx(v, "title")}</strong>` +
      `<span>${tourIndex + 1} / ${tour.length}</span>` +
      `<p>${I18n.tx(v, "blurb")}</p>`;
  }

  function narrate() {
    const v = tour[tourIndex];
    const services = (I18n.lang() === "ar" && v.ar && v.ar.services) ? v.ar.services : v.services;
    speak([I18n.tx(v, "title"), I18n.tx(v, "blurb"),
           (I18n.lang() === "ar" ? "الخدمات هنا: " : "Services here: ") + services.join(I18n.lang() === "ar" ? "، " : ", "),
           I18n.tx(v, "good")].filter(Boolean).join(". "), "calm");
  }

  function showTourStop(i) {
    if (!tour) return;
    tourIndex = Math.max(0, Math.min(tour.length - 1, i));
    const v = tour[tourIndex];
    if (mesh && mesh.material) {
      // Swap the texture rather than rebuilding the scene, so an active XR
      // session is never interrupted between stops.
      new THREE.TextureLoader().load(v.photo, (tex) => {
        mesh.material.map = tex;
        mesh.material.needsUpdate = true;
      });
    }
    lon = 0; lat = 0; updateCamera();
    tourLabel();
    narrate();
  }

  function nextStop() { if (tour && tourIndex < tour.length - 1) showTourStop(tourIndex + 1); }
  function prevStop() { if (tour && tourIndex > 0) showTourStop(tourIndex - 1); }

  function onTourKey(e) {
    if (overlay.hidden) return;
    if (e.key === "ArrowRight") { e.preventDefault(); nextStop(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prevStop(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  }

  function openTour(viewpoints, startIndex) {
    tour = (viewpoints && viewpoints.length) ? viewpoints : PARK_VIEWPOINTS;
    tourIndex = Math.max(0, Math.min(tour.length - 1, startIndex || 0));
    open(tour[tourIndex]);
    document.getElementById("story3dTourBar").hidden = false;
    tourLabel();
    // Let the viewer settle before speaking, so the narration does not
    // start over a blank screen.
    setTimeout(narrate, 600);
    window.addEventListener("keydown", onTourKey);
  }

  // Repeat the current stop's narration without moving. Someone who missed
  // a detail should not have to restart the tour to hear it again.
  function replay() { if (tour) narrate(); }

  window.ClearPathStory3D = {
    open, close, openTour, nextStop, prevStop, replay,
    get isTour() { return !!tour && !overlay.hidden; }
  };
})();
