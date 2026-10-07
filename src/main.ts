import "./style.css";
import { EggGame, type GameEvent } from "./game.ts";
import { createFarm } from "./scene.ts";
import type { Farm } from "./types.ts";

/** Query a required element. Missing markup is a build error, so fail loudly. */
function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}
const scoreEl = $("#score"),
  bestEl = $("#best"),
  livesEl = $("#lives");
const startPanel = $("#start-panel"),
  overlay = $("#overlay"),
  dialog = $<HTMLDialogElement>("#help-dialog");
const laneButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-lane]"),
];

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
declare global {
  interface Window {
    __wolf?: {
      game: EggGame;
      readonly farm: Farm | undefined;
      step(dt?: number, frames?: number): void;
      feedback: typeof feedback;
      showLevelBanner: typeof showLevelBanner;
      flashStage: typeof flashStage;
    };
    webkitAudioContext?: typeof AudioContext;
  }
  interface Navigator {
    standalone?: boolean;
  }
}
const eggIcon =
  '<svg viewBox="0 0 20 28" aria-hidden="true"><path d="M10 2C6 2 2 12 2 18a8 8 0 0 0 16 0C18 12 14 2 10 2Z"/><path d="M5 18c0 3 1 4 3 5" fill="none" opacity=".6"/><path class="crack" d="m4 14 3 2 2-3 3 3 2-2 2 3" fill="none"/></svg>';
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const soundOnIcon =
  '<svg viewBox="0 0 24 24"><path d="m11 5-6 4H2v6h3l6 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const soundOffIcon =
  '<svg viewBox="0 0 24 24"><path d="m11 5-6 4H2v6h3l6 4V5Zm5 4 5 6m0-6-5 6"/></svg>';
const basketIcon =
  '<svg viewBox="0 0 24 24"><path d="m3 10 3 10h12l3-10H3Zm4 0 5-7 5 7M8 13l1 4m7-4-1 4m-3-4v4"/></svg>';
$(".basket-icon").innerHTML = basketIcon;
$(".egg-icon").innerHTML =
  '<svg viewBox="0 0 24 24"><path d="M12 2c-4 0-8 9-8 14a8 8 0 0 0 16 0c0-5-4-14-8-14Z"/><path d="m5 14 4-2 3 4 3-3 4 2"/></svg>';

function readStorage(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveStorage(key: string, value: string | number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* Play still works when storage is unavailable. */
  }
}
let best = Math.max(0, Number(readStorage("wolf-best", "0")) || 0);
let soundEnabled = readStorage("wolf-sound", "on") === "on";
let audio: AudioContext | undefined,
  farm: Farm | undefined,
  feedbackTimer: ReturnType<typeof setTimeout> | undefined,
  encoreTime: number | null = null,
  resumeAfterHelp = false,
  loadFailed = false,
  roundBestBefore = best;
const formatScore = (value: number) => String(value).padStart(3, "0");
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
  $<HTMLMetaElement>("meta[name='theme-color']").content = dark
    ? "#141c24"
    : "#f6f5ee";
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

let installPrompt: BeforeInstallPromptEvent | null = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event as BeforeInstallPromptEvent;
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  $("#install").hidden = true;
});
const installDialog = $<HTMLDialogElement>("#install-dialog");
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
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    if (!audio) audio = new Context();
    if (audio.state === "suspended") audio.resume().catch(() => {});
  } catch {
    /* Sound is optional on browsers without Web Audio. */
  }
}
function tone(
  frequency: number,
  duration = 0.09,
  delay = 0,
  type: OscillatorType = "sine",
  volume = 0.045,
): void {
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

// Toasts sit near the lane they describe: left or right half, upper or lower ramp.
// Notes sit in the sky strip at the top of the stage, on the side of the lane
// they describe, so they never cover a ramp or the basket.
const laneAnchor = (lane?: number): [string, string] =>
  lane === undefined ? ["50%", "9%"] : [lane < 2 ? "28%" : "72%", "9%"];
let deltaTimer: ReturnType<typeof setTimeout> | undefined;
function scoreDelta(points: number, golden: boolean): void {
  const el = $("#score-delta");
  clearTimeout(deltaTimer);
  el.className = "score-delta";
  void el.offsetWidth;
  el.textContent = `+${points}`;
  el.className = `score-delta show${golden ? " gold" : ""}`;
  deltaTimer = setTimeout(() => {
    el.className = "score-delta";
  }, 950);
}
let feedbackLeaveTimer: ReturnType<typeof setTimeout> | undefined;
interface FeedbackOptions {
  miss?: boolean;
  golden?: boolean;
  level?: boolean;
  lane?: number;
}
function feedback(
  text: string,
  { miss = false, golden = false, level = false, lane }: FeedbackOptions = {},
): void {
  clearTimeout(feedbackTimer);
  clearTimeout(feedbackLeaveTimer);
  const el = $("#feedback");
  const [x, y] = laneAnchor(lane);
  el.style.setProperty("--fx", x);
  el.style.setProperty("--fy", y);
  el.textContent = text;
  // Restart the entrance animation even when the same class set is reused.
  el.className = "feedback";
  void el.offsetWidth;
  el.className = `feedback visible${miss ? " miss" : ""}${golden ? " golden" : ""}${level ? " level" : ""}`;
  feedbackTimer = setTimeout(
    () => {
      el.classList.add("leaving");
      feedbackLeaveTimer = setTimeout(() => {
        el.className = "feedback";
      }, 400);
    },
    golden || level ? 1400 : 900,
  );
}
function clearFeedback() {
  clearTimeout(feedbackTimer);
  clearTimeout(feedbackLeaveTimer);
  $("#feedback").className = "feedback";
}
let bannerTimer: ReturnType<typeof setTimeout> | undefined;
function showLevelBanner(level: number): void {
  const banner = $("#level-banner");
  clearTimeout(bannerTimer);
  banner.hidden = true;
  $("#level-banner-title").textContent = String(level).padStart(2, "0");
  void banner.offsetWidth;
  banner.hidden = false;
  bannerTimer = setTimeout(() => {
    banner.hidden = true;
  }, 2100);
}
function flashStage(kind: "flash-miss" | "flash-gold"): void {
  const stage = $("#stage");
  stage.classList.remove("flash-miss", "flash-gold");
  void stage.offsetWidth;
  stage.classList.add(kind);
  stage.addEventListener(
    "animationend",
    () => stage.classList.remove(kind),
    { once: true },
  );
}
function buzz(pattern: number | number[]): void {
  try {
    if (soundEnabled && navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* Haptics are a bonus. */
  }
}
// The score counts up instead of jumping, so a golden egg reads as five quick ticks.
let shownScore = 0,
  scoreTween = 0;
function animateScore(target: number): void {
  cancelAnimationFrame(scoreTween);
  const from = shownScore;
  if (reducedMotion.matches || target < from || target - from === 1) {
    shownScore = target;
    scoreEl.textContent = formatScore(target);
    return;
  }
  const duration = Math.min(600, 120 + (target - from) * 90);
  const started = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    shownScore = Math.round(from + (target - from) * eased);
    scoreEl.textContent = formatScore(shownScore);
    if (t < 1) scoreTween = requestAnimationFrame(tick);
  };
  scoreTween = requestAnimationFrame(tick);
}
let shownMisses = 0;
function updateStats() {
  animateScore(game.score);
  bestEl.textContent = formatScore(best);
  const lostNow = game.misses > shownMisses;
  livesEl.innerHTML = Array.from({ length: 3 }, (_, i) => {
    const lost = i >= 3 - game.misses;
    const justLost = lostNow && i === 3 - game.misses;
    return lost
      ? eggIcon.replace(
          "<svg ",
          `<svg class="lost${justLost ? " cracking" : ""}" `,
        )
      : eggIcon;
  }).join("");
  shownMisses = game.misses;
  livesEl.setAttribute(
    "aria-label",
    `${Math.max(0, 3 - game.misses)} lives remaining`,
  );
  const tag = $("#scene-level");
  const levelText = String(game.level).padStart(2, "0");
  if (tag.textContent !== levelText) {
    tag.textContent = levelText;
    tag.classList.remove("tick");
    void tag.offsetWidth;
    tag.classList.add("tick");
  }
}
function updateState() {
  if (game.state !== "playing" && shownScore !== game.score) {
    cancelAnimationFrame(scoreTween);
    shownScore = game.score;
    scoreEl.textContent = formatScore(game.score);
  }
  startPanel.hidden = game.state !== "ready";
  const encore = encoreTime !== null;
  overlay.hidden = encore || (game.state !== "paused" && game.state !== "over");
  $("#cinematic").hidden = !encore;
  $("#stage").classList.toggle("is-encore", encore);
  const shell = $(".game-shell");
  for (const state of ["ready", "playing", "paused", "over"] as const)
    shell.classList.toggle(`is-${state}`, game.state === state && !encore);
  $<HTMLButtonElement>("#pause").disabled =
    game.state === "ready" || game.state === "over";
  $("#pause").setAttribute(
    "aria-label",
    game.state === "paused" ? "Resume game" : "Pause game",
  );
  $("#pause").innerHTML =
    game.state === "paused"
      ? '<svg viewBox="0 0 24 24"><path d="m9 5 10 7-10 7Z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M8 6v12M16 6v12"/></svg>';
  $("#round-label").textContent = encore
    ? "BONUS"
    : game.state === "ready"
      ? "READY"
      : game.state === "paused"
        ? "PAUSED"
        : game.state === "over"
          ? "ROUND OVER"
          : `LEVEL ${String(game.level).padStart(2, "0")}`;
  $("#bottom-hint").innerHTML =
    game.state === "ready"
      ? '<kbd>SPACE</kbd> START <span class="small-dot">·</span> <span class="desktop-hint">Q / A + E / D MOVE</span><span class="touch-hint">TAP THE ARROWS TO MOVE</span>'
      : '<span class="desktop-hint">Q / A + E / D MOVE <span class="small-dot">·</span> <kbd>SPACE</kbd> PAUSE</span><span class="touch-hint">TAP THE ARROWS TO MOVE</span>';
  const card = $(".overlay-card");
  const description = $("#overlay-description");
  if (game.state === "paused") {
    $("#overlay-eyebrow").textContent = "PAUSED";
    $("#overlay-score").hidden = true;
    card.classList.remove("is-best");
    $("#overlay-title").textContent = "Paused";
    description.hidden = true;
    $("#resume").textContent = "Resume";
    $("#restart").hidden = false;
  } else if (game.state === "over") {
    const newBest = game.score > roundBestBefore && game.score > 0;
    $("#overlay-eyebrow").textContent = newBest ? "NEW BEST" : "ROUND OVER";
    card.classList.toggle("is-best", newBest);
    $("#overlay-score").hidden = game.score === 0;
    $("#overlay-score").innerHTML =
      `${formatScore(game.score)}<small>${game.score === 1 ? "POINT" : "POINTS"} · LEVEL ${String(game.level).padStart(2, "0")}</small>`;
    $("#overlay-title").textContent =
      game.score === 0 ? "No eggs caught." : "Three eggs missed.";
    description.hidden = false;
    description.textContent =
      game.score === 0
        ? "Move the basket to the end of a ramp before the egg gets there."
        : newBest && roundBestBefore > 0
          ? `Previous best ${roundBestBefore}.`
          : newBest
            ? "First score on the board."
            : `Best ${best}.`;
    $("#resume").textContent = "Play again";
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
  onEvent(event: GameEvent) {
    farm?.event(event);
    if (event.type === "catch") {
      if (game.score > best) {
        best = game.score;
        saveStorage("wolf-best", best);
      }
      updateStats();
      scoreEl.classList.remove("score-pop", "gold");
      void scoreEl.offsetWidth;
      scoreEl.classList.add("score-pop");
      if (event.egg.golden) scoreEl.classList.add("gold");
      tone(740, 0.1);
      tone(990, 0.15, 0.07);
      if (event.levelUp) {
        updateState();
        showLevelBanner(game.level);
        tone(1320, 0.15, 0.16);
        tone(1760, 0.2, 0.26, "sine", 0.035);
      }
      if (event.egg.golden) {
        scoreDelta(5, true);
        flashStage("flash-gold");
        buzz([12, 40, 18]);
        tone(1480, 0.18, 0.14);
        tone(1760, 0.22, 0.23);
      } else {
        scoreDelta(1, false);
        buzz(8);
      }
    } else if (event.type === "miss") {
      updateStats();
      feedback(game.misses === 2 ? "Missed. Last life." : "Missed", {
        miss: true,
        lane: event.egg.lane,
      });
      flashStage("flash-miss");
      buzz(45);
      tone(190, 0.19, 0, "triangle", 0.065);
      tone(130, 0.2, 0.12, "triangle", 0.05);
    } else if (event.type === "spawn") {
      tone(440 + event.egg.lane * 55, 0.06, 0, "sine", 0.013);
      if (event.egg.golden) tone(1100, 0.15, 0.06, "sine", 0.03);
    } else {
      if (event.type === "over" && game.hasEncore) encoreTime = 0;
      updateStats();
      updateState();
      if (event.type === "start") {
        clearFeedback();
        clearTimeout(bannerTimer);
        $("#level-banner").hidden = true;
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

function move(lane: number): void {
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
    if (selected && changed) {
      button.classList.remove("pressed");
      void button.offsetWidth;
      button.classList.add("pressed");
    }
  }
  if (changed && game.state === "playing")
    tone(260 + lane * 35, 0.04, 0, "sine", 0.014);
}
function start() {
  if (loadFailed) return;
  unlockAudio();
  encoreTime = null;
  roundBestBefore = best;
  shownScore = 0;
  shownMisses = 0;
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
  const target = event.target instanceof Element ? event.target : null;
  if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    return;
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
    if (key === " " && target?.closest("button, a")) return;
    event.preventDefault();
    if (!event.repeat) {
      if (key === "escape") {
        if (game.state === "playing") game.pause();
        else if (game.state === "paused") game.resume();
      } else togglePause();
    }
    return;
  }
  const keyLanes: Record<string, number> = { q: 0, a: 1, e: 2, d: 3 };
  let lane: number | undefined = keyLanes[key];
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
  const createdFarm = createFarm($("#canvas-mount"));
  farm = createdFarm;
  updateTheme();
  let previous = performance.now();
  // Development hook so a browser without a running frame loop can step the game.
  if (import.meta.env.DEV)
    window.__wolf = {
      game,
      get farm() {
        return farm;
      },
      step(dt = 1 / 60, frames = 1) {
        for (let i = 0; i < frames; i++) {
          previous = performance.now() - dt * 1000;
          frame(performance.now());
        }
      },
      feedback,
      showLevelBanner,
      flashStage,
    };
  function frame(now: number): void {
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
      if (previousEncore < 5.4 && encoreTime >= 5.4)
        [660, 830, 990, 1320].forEach((note, i) => tone(note, 0.22, i * 0.13));
      if (encoreTime >= 8.5) finishEncore();
    }
    createdFarm.render(game, dt, now / 1000, encoreTime);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  $("#canvas-mount canvas").addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    game.pause();
    feedback("Graphics context lost. Reload the page.", { miss: true });
  });
} catch (error) {
  loadFailed = true;
  startPanel.hidden = true;
  laneButtons.forEach((button) => {
    button.hidden = true;
  });
  $("#canvas-mount").innerHTML =
    '<div class="load-error"><h2>WebGL is unavailable.</h2><p>Enable graphics acceleration in your browser, then reload.</p><button class="primary-button" id="reload">Reload</button></div>';
  $("#reload").addEventListener("click", () => location.reload());
  console.error("Unable to create the 3D farm:", error);
}
if (import.meta.hot) import.meta.hot.dispose(() => farm?.dispose());
