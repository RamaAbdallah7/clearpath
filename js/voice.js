(function () {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let listening = false;
  let dictateTarget = null;

  const toggleBtn = document.getElementById("voiceToggle");
  const indicator = document.getElementById("micIndicator");
  const label = document.getElementById("micLabel");
  const log = document.getElementById("voiceLog");
  const dictateBtn = document.getElementById("reportVoice");

  function setListeningUI(on) {
    listening = on;
    indicator.classList.toggle("live", on);
    label.textContent = on ? "Listening..." : "Off";
    toggleBtn.textContent = on ? "🎤 Stop listening" : "🎤 Start listening";
  }

  const COMMANDS = [
    { match: /open map|journey map|show map/, action: () => goToScreen("journey") },
    { match: /start navigation|navigate|open ar|ar navigate/, action: () => { goToScreen("ar"); window.ClearPathAR.start(); } },
    { match: /stop navigation/, action: () => window.ClearPathAR.stop() },
    { match: /open story|story ?book|pre.?visit story/, action: () => goToScreen("story") },
    { match: /open profile/, action: () => goToScreen("profile") },
    { match: /open home/, action: () => goToScreen("home") },
    { match: /report|checklist/, action: () => goToScreen("report") },
    { match: /hands.?free|head control/, action: () => goToScreen("access") },
    { match: /next/, action: () => nextAction() },
    { match: /back|previous/, action: () => backAction() },
    { match: /read description|what.?s here|where am i/, action: () => readCurrent() },
    { match: /high contrast/, action: () => document.getElementById("contrastToggle").click() },
    { match: /help/, action: () => speak("You can say: open map, start navigation, next, back, read description, report a barrier, or hands-free.") }
  ];

  function nextAction() {
    if (AppState.screen === "story" && window.ClearPathStory) window.ClearPathStory.next();
    else if (AppState.currentStageIndex < JOURNEY.length - 1) {
      AppState.currentStageIndex++;
      renderStageList();
      readCurrent();
    }
  }
  function backAction() {
    if (AppState.screen === "story" && window.ClearPathStory) window.ClearPathStory.back();
    else if (AppState.currentStageIndex > 0) {
      AppState.currentStageIndex--;
      renderStageList();
      readCurrent();
    }
  }
  function readCurrent() {
    const stage = JOURNEY[AppState.currentStageIndex];
    speak(`${stage.title}. ${stage.description}`);
  }

  function handleTranscript(text) {
    log.textContent = `Heard: "${text}"`;
    if (dictateTarget) {
      dictateTarget.value = (dictateTarget.value ? dictateTarget.value + " " : "") + text;
      dictateTarget = null;
      return;
    }
    const lower = text.toLowerCase();
    for (const cmd of COMMANDS) {
      if (cmd.match.test(lower)) { cmd.action(); return; }
    }
  }

  function ensureRecognizer() {
    if (recognizer || !SpeechRecognition) return recognizer;
    recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.lang = document.documentElement.lang === "ar" ? "ar-AE" : "en-US";
    recognizer.onresult = (e) => {
      const text = e.results[e.results.length - 1][0].transcript.trim();
      handleTranscript(text);
    };
    recognizer.onerror = () => {};
    recognizer.onend = () => { if (listening) recognizer.start(); };
    return recognizer;
  }

  function startListening() {
    if (!SpeechRecognition) {
      log.textContent = "Speech recognition isn't supported in this browser. Try Chrome on desktop or Android.";
      return;
    }
    ensureRecognizer();
    setListeningUI(true);
    recognizer.start();
  }
  function stopListening() {
    setListeningUI(false);
    if (recognizer) recognizer.stop();
  }

  toggleBtn.addEventListener("click", () => listening ? stopListening() : startListening());
  dictateBtn.addEventListener("click", () => {
    dictateTarget = document.getElementById("reportNote");
    if (!listening) startListening();
    log.textContent = "Listening for your note...";
  });

  window.ClearPathVoice = { startListening, stopListening };
})();
