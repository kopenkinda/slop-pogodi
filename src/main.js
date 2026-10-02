import "./style.css";
import { EggGame } from "./game.js";
import { createFarm } from "./scene.js";

const $ = (selector) => document.querySelector(selector);
const scoreEl = $("#score"),
  bestEl = $("#best"),
  livesEl = $("#lives");
const startPanel = $("#start-panel"),
  overlay = $("#overlay"),
  dialog = $("#help-dialog");
const laneButtons = [...document.querySelectorAll("[data-lane]")];
const eggIcon =
  '<svg viewBox="0 0 20 28" aria-hidden="true"><path d="M10 2C6 2 2 12 2 18a8 8 0 0 0 16 0C18 12 14 2 10 2Z"/><path d="M5 18c0 3 1 4 3 5" fill="none" opacity=".6"/></svg>';
const soundOnIcon =
  '<svg viewBox="0 0 24 24"><path d="m11 5-6 4H2v6h3l6 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const soundOffIcon =
  '<svg viewBox="0 0 24 24"><path d="m11 5-6 4H2v6h3l6 4V5Zm5 4 5 6m0-6-5 6"/></svg>';
const basketIcon =
  '<svg viewBox="0 0 24 24"><path d="m3 10 3 10h12l3-10H3Zm4 0 5-7 5 7M8 13l1 4m7-4-1 4m-3-4v4"/></svg>';
$(".basket-icon").innerHTML = basketIcon;
$(".egg-icon").innerHTML =
  '<svg viewBox="0 0 24 24"><path d="M12 2c-4 0-8 9-8 14a8 8 0 0 0 16 0c0-5-4-14-8-14Z"/><path d="m5 14 4-2 3 4 3-3 4 2"/></svg>';

function readStorage(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveStorage(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* Play still works when storage is unavailable. */
  }
}
let best = Math.max(0, Number(readStorage("wolf-best", 0)) || 0);
let soundEnabled = readStorage("wolf-sound", "on") === "on";
let audio,
  farm,
  feedbackTimer,
  encoreTime = null,
  resumeAfterHelp = false,
  loadFailed = false,
  roundBestBefore = best;
const formatScore = (value) => String(value).padStart(3, "0");
bestEl.textContent = formatScore(best);

let themeTurn = document.documentElement.dataset.theme === "dark" ? 180 : 0;
$("#theme").innerHTML =
  `<svg class="theme-dial" viewBox="0 0 40 40" aria-hidden="true">
  <defs><clipPath id="theme-sky"><path d="M0 0h40v28H0Z"/></clipPath></defs>
  <path class="theme-track" d="M5 27a15 15 0 0 1 30 0"/>
  <g clip-path="url(#theme-sky)"><g class="theme-orbit">
    <g class="dial-sun"><circle cx="20" cy="12" r="4"/><path d="M20 4v2m0 12v2M12 12h2m12 0h2M14.3 6.3l1.4 1.4m8.6 8.6 1.4 1.4m-11.4 0 1.4-1.4m8.6-8.6 1.4-1.4"/></g>
    <path class="dial-moon" d="M24.8 43a6 6 0 0 1-7-8 6.5 6.5 0 1 0 7 8Z"/>
  </g></g><path class="theme-horizon" d="M5 28h30"/>
</svg>`;
function updateTheme() {
  const dark = document.documentElement.dataset.theme === "dark";
  $("#theme").style.setProperty("--theme-turn", `${themeTurn}deg`);
  $("#theme").setAttribute(
    "aria-label",
    `Switch to ${dark ? "light" : "dark"} mode`,
  );
  $("#theme").setAttribute("aria-pressed", String(dark));
  $("meta[name='theme-color']").content = dark ? "#141c24" : "#f6f5ee";
  farm?.setTheme(dark);
}
$("#theme").addEventListener("click", () => {
  document.documentElement.dataset.theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  themeTurn -= 180;
  saveStorage("wolf-theme", document.documentElement.dataset.theme);
  updateTheme();
});
updateTheme();

// Move the same controls into the game when it runs as an installed app.
const standaloneDisplay = matchMedia("(display-mode: standalone)");
function updateDisplayMode() {
  const standalone = standaloneDisplay.matches || navigator.standalone === true;
  document.documentElement.classList.toggle("standalone", standalone);
  $(standalone ? "#game-actions" : "#page-actions").prepend(
    $("#theme"),
    $("#sound"),
  );
}
standaloneDisplay.addEventListener("change", updateDisplayMode);
updateDisplayMode();

let installPrompt;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  $("#install").hidden = true;
});
const installDialog = $("#install-dialog");
$("#install").addEventListener("click", async () => {
  game.pause();
  if (installPrompt) {
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    if (outcome === "accepted") $("#install").hidden = true;
  } else {
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    $("#install-instructions").textContent = ios
      ? 'Tap your browser\'s Share button, then "Add to Home Screen". Keep "Open as Web App" on if that option appears, and tap Add.'
      : 'Open your browser\'s menu and choose "Install app" or "Add to Home Screen". On desktop, look for the install icon in the address bar.';
    installDialog.showModal();
  }
});
$("#close-install").addEventListener("click", () => installDialog.close());
$("#install-done").addEventListener("click", () => installDialog.close());

function unlockAudio() {
  if (!soundEnabled) return;
  try {
    if (!audio)
      audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume().catch(() => {});
  } catch {
    /* Sound is optional on browsers without Web Audio. */
  }
}
function tone(
  frequency,
  duration = 0.09,
  delay = 0,
  type = "sine",
  volume = 0.045,
) {
  if (!soundEnabled || !audio || audio.state !== "running") return;
  const oscillator = audio.createOscillator(),
    gain = audio.createGain();
  const start = audio.currentTime + delay;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}
function updateSound() {
  $("#sound").innerHTML =
    `${soundEnabled ? soundOnIcon : soundOffIcon}<span class="sound-label">Sound ${soundEnabled ? "on" : "off"}</span>`;
  $("#sound").setAttribute(
    "aria-label",
    `Turn sound ${soundEnabled ? "off" : "on"}`,
  );
  $("#sound").setAttribute("aria-pressed", String(soundEnabled));
}
updateSound();
$("#sound").addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  saveStorage("wolf-sound", soundEnabled ? "on" : "off");
  updateSound();
  if (soundEnabled) {
    unlockAudio();
    tone(650, 0.09);
  }
});

function feedback(text, miss = false, golden = false) {
  clearTimeout(feedbackTimer);
  $("#feedback").textContent = text;
  $("#feedback").className =
    `feedback visible${miss ? " miss" : ""}${golden ? " golden" : ""}`;
  feedbackTimer = setTimeout(() => {
    $("#feedback").className = "feedback";
  }, 1000);
}
function updateStats() {
  scoreEl.textContent = formatScore(game.score);
  bestEl.textContent = formatScore(best);
  livesEl.innerHTML = Array.from({ length: 3 }, (_, i) =>
    i >= 3 - game.misses
      ? eggIcon.replace("<svg ", '<svg class="lost" ')
      : eggIcon,
  ).join("");
  livesEl.setAttribute(
    "aria-label",
    `${Math.max(0, 3 - game.misses)} lives remaining`,
  );
}
function updateState() {
  startPanel.hidden = game.state !== "ready";
  const encore = encoreTime !== null;
  overlay.hidden = encore || (game.state !== "paused" && game.state !== "over");
  $("#cinematic").hidden = !encore;
  $("#stage").classList.toggle("is-encore", encore);
  $("#pause").disabled = game.state === "ready" || game.state === "over";
  $("#pause").setAttribute(
    "aria-label",
    game.state === "paused" ? "Resume game" : "Pause game",
  );
  $("#pause").innerHTML =
    game.state === "paused"
      ? '<svg viewBox="0 0 24 24"><path d="m9 5 10 7-10 7Z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M8 6v12M16 6v12"/></svg>';
  $("#round-label").textContent = encore
    ? "A SPECIAL DELIVERY"
    : game.state === "ready"
      ? "READY WHEN YOU ARE"
      : game.state === "paused"
        ? "ON A LITTLE BREAK"
        : game.state === "over"
          ? "UNTIL NEXT TIME"
          : `LEVEL ${String(game.level).padStart(2, "0")} · ${game.level < 3 ? "NICE & EASY" : game.level < 6 ? "PICKING UP PACE" : "QUICK PAWS"}`;
  $("#bottom-hint").innerHTML =
    game.state === "ready"
      ? 'PRESS <kbd>SPACE</kbd> TO START <span class="small-dot">·</span> <span class="desktop-hint">Q / A + E / D TO MOVE</span><span class="touch-hint">TAP THE ARROWS TO MOVE</span>'
      : '<span class="desktop-hint">Q / A + E / D TO MOVE <span class="small-dot">·</span> <kbd>SPACE</kbd> TO PAUSE</span><span class="touch-hint">TAP THE ARROWS TO MOVE</span>';
  if (game.state === "paused") {
    $("#overlay-eyebrow").textContent = "TAKE A BREATHER";
    $("#overlay-title").textContent = "The hens can wait.";
    $("#overlay-description").textContent = "Your eggs will be right here.";
    $("#resume").innerHTML = "Back to the farm <span>→</span>";
    $("#restart").hidden = false;
  } else if (game.state === "over") {
    $("#overlay-eyebrow").textContent =
      game.score > roundBestBefore
        ? "A NEW PERSONAL BEST"
        : "THAT'S ALL, YOLKS";
    $("#overlay-title").textContent =
      game.score === 0
        ? "A little egg practice?"
        : `${game.score} points. Nice paws.`;
    $("#overlay-description").textContent =
      game.score === 0
        ? "Watch the eggs roll down, then move to the end of their ramp."
        : `Three eggs got away. Your best is ${best}. The hens are ready for another round.`;
    $("#resume").innerHTML = "One more round <span>↗</span>";
    $("#restart").hidden = true;
  }
}

function finishEncore() {
  if (encoreTime === null) return;
  encoreTime = null;
  updateState();
}
$("#skip-movie").addEventListener("click", finishEncore);

const game = new EggGame({
  onEvent(event) {
    farm?.event(event);
    if (event.type === "catch") {
      if (game.score > best) {
        best = game.score;
        saveStorage("wolf-best", best);
      }
      updateStats();
      scoreEl.classList.remove("score-pop");
      void scoreEl.offsetWidth;
      scoreEl.classList.add("score-pop");
      tone(740, 0.1);
      tone(990, 0.15, 0.07);
      if (event.levelUp) {
        updateState();
        tone(1320, 0.15, 0.16);
      }
      if (event.egg.golden) {
        feedback(
          event.levelUp ? `+5 GOLDEN! Level ${game.level}` : "+5 GOLDEN!",
          false,
          true,
        );
        tone(1480, 0.18, 0.14);
        tone(1760, 0.22, 0.23);
      } else if (event.levelUp)
        feedback(`Level ${game.level}. Here come the hens!`);
      else feedback("+1");
    } else if (event.type === "miss") {
      updateStats();
      feedback(
        ["", "One got away!", "Careful. One egg to spare.", "Oh, crumbs."][
          game.misses
        ],
        true,
      );
      tone(190, 0.19, 0, "triangle", 0.065);
      tone(130, 0.2, 0.12, "triangle", 0.05);
    } else if (event.type === "spawn") {
      tone(440 + event.egg.lane * 55, 0.06, 0, "sine", 0.013);
      if (event.egg.golden) {
        feedback("Golden egg. Quick paws!", false, true);
        tone(1100, 0.15, 0.06, "sine", 0.03);
      }
    } else {
      if (event.type === "over" && game.hasEncore) {
        encoreTime = 0;
        $("#movie-caption").textContent = "Someone heard about your score.";
      }
      updateStats();
      updateState();
      if (event.type === "start") {
        clearTimeout(feedbackTimer);
        $("#feedback").className = "feedback";
        tone(440, 0.1);
        tone(550, 0.1, 0.1);
        tone(660, 0.16, 0.2);
      }
      if (event.type === "over") {
        tone(330, 0.18, 0.24);
        tone(220, 0.3, 0.42);
      }
    }
  },
});

function move(lane) {
  if (
    dialog.open ||
    installDialog.open ||
    encoreTime !== null ||
    game.state === "paused" ||
    game.state === "over" ||
    loadFailed
  )
    return;
  const changed = game.lane !== lane;
  game.move(lane);
  for (const button of laneButtons) {
    const selected = Number(button.dataset.lane) === lane;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  if (changed && game.state === "playing")
    tone(260 + lane * 35, 0.04, 0, "sine", 0.014);
}
function start() {
  if (loadFailed) return;
  unlockAudio();
  encoreTime = null;
  roundBestBefore = best;
  game.start();
  move(1);
}
function togglePause() {
  unlockAudio();
  if (game.state === "ready" || game.state === "over") start();
  else if (game.state === "playing") game.pause();
  else game.resume();
}
$("#start").addEventListener("click", start);
$("#pause").addEventListener("click", togglePause);
$("#resume").addEventListener("click", () => {
  if (game.state === "over") start();
  else {
    unlockAudio();
    game.resume();
  }
});
$("#restart").addEventListener("click", start);
for (const button of laneButtons) {
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    unlockAudio();
    move(Number(button.dataset.lane));
  });
  button.addEventListener("click", (event) => {
    if (event.detail === 0) {
      unlockAudio();
      move(Number(button.dataset.lane));
    }
  });
}

function openHelp() {
  resumeAfterHelp = game.state === "playing";
  if (resumeAfterHelp) game.pause();
  dialog.showModal();
}
$("#help").addEventListener("click", openHelp);
$("#close-help").addEventListener("click", () => dialog.close());
$("#got-it").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
dialog.addEventListener("close", () => {
  if (resumeAfterHelp && !document.hidden) game.resume();
  resumeAfterHelp = false;
});

document.addEventListener("keydown", (event) => {
  if (
    dialog.open ||
    installDialog.open ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    loadFailed
  )
    return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  if (encoreTime !== null) {
    if (key === " " || key === "escape") {
      event.preventDefault();
      finishEncore();
    }
    return;
  }
  if (key === " " || key === "escape" || key === "p") {
    // Let Space activate a focused button using the browser's normal behavior.
    if (key === " " && event.target.closest("button, a")) return;
    event.preventDefault();
    if (!event.repeat) {
      if (key === "escape") {
        if (game.state === "playing") game.pause();
        else if (game.state === "paused") game.resume();
      } else togglePause();
    }
    return;
  }
  let lane = { q: 0, a: 1, e: 2, d: 3 }[key];
  if (key === "arrowleft") lane = game.lane % 2;
  if (key === "arrowright") lane = 2 + (game.lane % 2);
  if (key === "arrowup") lane = game.lane < 2 ? 0 : 2;
  if (key === "arrowdown") lane = game.lane < 2 ? 1 : 3;
  if (lane !== undefined) {
    event.preventDefault();
    unlockAudio();
    move(lane);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    game.pause();
    resumeAfterHelp = false;
  }
});
window.addEventListener("blur", () => {
  if (game.state === "playing") {
    game.pause();
    resumeAfterHelp = false;
  }
});

updateStats();
move(1);
updateState();
try {
  farm = createFarm($("#canvas-mount"));
  updateTheme();
  let previous = performance.now();
  function frame(now) {
    const dt = Math.min((now - previous) / 1000, 0.1);
    previous = now;
    game.update(dt);
    if (
      encoreTime !== null &&
      !document.hidden &&
      !dialog.open &&
      !installDialog.open
    ) {
      const previousEncore = encoreTime;
      encoreTime += dt;
      if (previousEncore < 3.2 && encoreTime >= 3.2)
        $("#movie-caption").textContent = "Hare mail. One very special egg.";
      if (previousEncore < 5.4 && encoreTime >= 5.4) {
        $("#movie-caption").textContent = "Even the hens are impressed.";
        [660, 830, 990, 1320].forEach((note, i) => tone(note, 0.22, i * 0.13));
      }
      if (encoreTime >= 8.5) finishEncore();
    }
    farm.render(game, dt, now / 1000, encoreTime);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  $("#canvas-mount canvas").addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    game.pause();
    feedback("The scene needs a refresh.", true);
  });
} catch (error) {
  loadFailed = true;
  startPanel.hidden = true;
  laneButtons.forEach((button) => {
    button.hidden = true;
  });
  $("#canvas-mount").innerHTML =
    '<div class="load-error"><h2>The farm couldn\'t load.</h2><p>This game needs WebGL. Try enabling graphics acceleration in your browser, then reload.</p><button class="primary-button" id="reload">Try again</button></div>';
  $("#reload").addEventListener("click", () => location.reload());
  console.error("Unable to create the 3D farm:", error);
}
if (import.meta.hot) import.meta.hot.dispose(() => farm?.dispose());
