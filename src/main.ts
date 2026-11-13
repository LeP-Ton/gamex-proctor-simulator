import "./style.css";
import {
  BALANCE,
  CAMERAS,
  CHEATS,
  DIFFICULTIES,
  makeConfig,
  PRESET_SEEDS,
  RULE_VERSION,
  seconds,
  TICK_RATE,
} from "./engine/config.js";
import type { Difficulty, GameConfig } from "./engine/config.js";
import { Game, accuracy, detectionRate, replayAt } from "./engine/game.js";
import { buildPlan } from "./engine/schedule.js";
import { buildTutorialPlan, TUTORIAL_STEPS } from "./engine/tutorial.js";
import type {
  PauseEntry,
  Plan,
  RecordEntry,
  RunRecord,
} from "./engine/types.js";
import { actorViews } from "./engine/world.js";
import { renderCamera } from "./render/canvas.js";
import {
  clientToWorld,
  pick,
  pickWithProtection,
  sceneGeometry,
} from "./render/geometry.js";
import type { DrawOp } from "./render/geometry.js";
import { conditionKey, LocalStore } from "./storage.js";
import { AudioFeedback } from "./ui/audio.js";
import { escapeHtml as h, icon } from "./ui/icons.js";

let localStorageSafe: Storage | undefined;
try {
  localStorageSafe = window.localStorage;
} catch {
  /* 隐私模式下允许内存游戏。 */
}
const store = new LocalStore(localStorageSafe);
const audio = new AudioFeedback();
audio.enabled = store.data.settings.sound;
audio.volume = store.data.settings.volume;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const fmt = (tick: number) =>
  `${Math.floor(tick / TICK_RATE / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor((tick / TICK_RATE) % 60)
    .toString()
    .padStart(2, "0")}`;
const timestamp = (tick: number) =>
  `09:${Math.floor(tick / TICK_RATE / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor((tick / TICK_RATE) % 60)
    .toString()
    .padStart(2, "0")}`;
const pct = (n: number | null) =>
  n === null ? "—" : `${Math.round(n * 100)}%`;
let difficulty: Difficulty = store.data.settings.difficulty;
let seed = store.data.settings.seed;
let mode: "idle" | "playing" | "results" = "idle";
let game = new Game(buildPlan(makeConfig(seed, difficulty)));
let focused: number | null = null;
let paused = false;
let pauseStarted = 0;
let pauseReason = "";
let pauses: PauseEntry[] = [];
let accumulator = 0;
let previous = performance.now();
let lastRender = 0;
let previewTick = 0;
let latestRun: RunRecord | undefined;
let modalOpen = false;
let reviewPlaying = false;
let reviewFrame = 0;
let qaFrozen = false;
const debugRequested = new URLSearchParams(location.search).has("debug");
const hover = Array<number | null>(6).fill(null);
const geometries: DrawOp[][] = Array.from({ length: 6 }, () => []);
const protectedGeometry: Array<DrawOp[] | undefined> = Array(6).fill(undefined);

$("#app").innerHTML = `
  <aside class="sidebar" aria-label="主要导航">
    <a class="brand" href="#" aria-label="GameX 首页"><span>G<span class="brand-x">X</span></span></a>
    <div class="nav-items">
      <button class="nav-button active" id="nav-monitor" title="监控中心" aria-label="监控中心">${icon("monitor", 23)}<span>巡查</span></button>
      <button class="nav-button" id="nav-rules" title="规则手册" aria-label="规则手册">${icon("book", 22)}<span>手册</span></button>
      <button class="nav-button" id="nav-history" title="最近十局" aria-label="最近十局">${icon("history", 22)}<span>记录</span></button>
    </div>
    <button class="nav-button settings-nav" id="nav-settings" title="设置" aria-label="设置">${icon("settings", 22)}<span>设置</span></button>
    <div class="labx">LAB<span>X</span><small>独立游戏实验室</small></div>
  </aside>
  <main class="workspace">
    <header class="page-header">
      <div><div class="eyebrow">GAMEX <span>/</span> 监考模拟器</div><h1>考场视频巡查系统<span class="version">V1.0</span></h1></div>
      <div class="header-tools"><span class="online"><i></i> 本地系统已就绪</span><span class="tool-divider"></span><button class="icon-button" id="sound-toggle" aria-label="切换声音" title="切换声音"></button><button class="icon-button" id="help-button" aria-label="查看操作说明" title="查看操作说明">${icon("help")}</button></div>
    </header>
    <section class="session-bar" aria-label="本局状态">
      <div class="time-stat"><span class="stat-label">${icon("clock", 15)} 剩余时间</span><strong id="time-value">06:00</strong><div class="time-track"><i id="time-progress"></i></div></div>
      <div class="score-stat"><span class="stat-label">本局得分</span><strong id="score-value">0000</strong></div>
      <div class="combo-stat"><span class="stat-label">连续发现</span><strong id="combo-value">—<small>COMBO</small></strong></div>
      <div class="count-stats"><span><i class="count-dot good"></i>抓到 <b id="caught-value">00</b></span><span><i class="count-dot muted"></i>漏查 <b id="missed-value">00</b></span><span><i class="count-dot bad"></i>误报 <b id="false-value">00</b></span></div>
      <div class="session-tools"><span class="session-state" id="session-state">${icon("shield", 15)} 等待开始</span><button class="button secondary pause-button" id="pause-button" disabled>${icon("pause", 15)} 暂停</button></div>
    </section>
    <section class="briefing" id="briefing">
      <div class="briefing-copy"><span class="section-tag">观察 · 预判 · 准确举报</span><h2>每一个小动作，<br class="small-break">都值得多看一眼。</h2><p>六路画面，48 名考生。守住这六分钟的公平。</p></div>
      <div class="launch-controls"><div class="condition-row"><button class="condition-control" id="difficulty-control">常规 ${icon("chevron", 13)}</button><button class="condition-control seed-control" id="seed-control">${icon("shuffle", 14)} <span id="seed-title"></span>${icon("chevron", 13)}</button></div><div class="launch-row"><button class="button secondary" id="tutorial-button">${icon("book", 17)} 新手教学</button><button class="button primary" id="start-button">开始巡查 ${icon("arrow", 17)}</button></div></div>
    </section>
    <div class="game-meta"><div><span class="live-mark"><i></i> <span id="live-label">实时预览</span></span><span class="meta-divider">/</span><span id="view-label">全部机位</span><span class="camera-count">06 路在线</span></div><span id="condition-label"></span></div>
    <section class="board" id="board" aria-label="六路监控">
      <div class="camera-grid" id="camera-grid">
        ${CAMERAS.map((c, i) => `<article class="camera-card" data-scene="${i}" aria-label="${c.name}监控"><header class="camera-header"><div><span class="camera-number">${String(i + 1).padStart(2, "0")}</span><h2>${c.name}</h2><span class="camera-live">实时</span></div><button class="expand-button" data-expand="${i}" aria-label="放大${c.name}" title="放大 / 快捷键 ${i + 1}">${icon("expand", 15)}</button></header><div class="canvas-wrap"><canvas data-camera="${i}" aria-label="${c.name}，点击可见人物或物品举报" tabindex="0"></canvas><span class="camera-code">${c.code}</span><span class="recording"><i></i> REC</span><span class="hover-label"></span><div class="inactive-camera">${icon("monitor", 27)}<span>教学中稍后开放</span></div><div class="cooldown"><span>举报冷却</span></div></div><footer class="camera-footer"><span>${c.area}</span><time>09:00:00</time></footer></article>`).join("")}
      </div>
      <div class="pause-cover" id="pause-cover"><div class="pause-symbol">${icon("pause", 28)}</div><span class="section-tag">所有画面与时钟已暂停</span><h2 id="pause-title">休息一下，再继续观察。</h2><p>暂停期间监控画面已遮住，事件不会向前推进。</p><button class="button primary" id="resume-button">${icon("play", 17)} 继续巡查</button><button class="text-button" id="abandon-button">返回准备页</button></div>
    </section>
    <section class="tutorial-banner" id="tutorial-banner" hidden><div><strong id="tutorial-title"></strong><p id="tutorial-text"></p></div><button class="button secondary" id="skip-tutorial">开始正式考试 ${icon("arrow", 15)}</button></section>
    <footer class="bottom-bar"><div><span>${icon("target", 14)} 点击人物 / 物品举报</span><span><kbd>1</kbd>—<kbd>6</kbd> 放大</span><span><kbd>空格</kbd> 暂停</span><span><kbd>Esc</kbd> 返回六屏</span></div><span class="bottom-note">观察细节 · 审慎判断 <i></i> RULE ${RULE_VERSION}</span></footer>
  </main><div id="modal-root"></div><div class="notification" id="notification" role="status"></div>`;

const canvases = [
  ...document.querySelectorAll<HTMLCanvasElement>("canvas[data-camera]"),
];
const cards = [...document.querySelectorAll<HTMLElement>(".camera-card")];
const previewPlan: Plan = { ...game.plan, events: [] };
const preview = new Game(previewPlan);

function updateSound() {
  $("#sound-toggle").innerHTML = icon(audio.enabled ? "sound" : "mute");
  $("#sound-toggle").setAttribute("aria-pressed", String(audio.enabled));
}
function saveSettings() {
  store.data.settings = {
    ...store.data.settings,
    seed,
    difficulty,
    sound: audio.enabled,
    volume: audio.volume,
  };
  store.persist();
}
function notify(message: string) {
  const el = $("#notification");
  el.textContent = message;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 2800);
}
function newSeed() {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return `GX-${bytes[0].toString(36).toUpperCase()}`;
}
function updateConditions() {
  $("#difficulty-control").innerHTML =
    `${DIFFICULTIES[difficulty].name}难度 ${icon("chevron", 13)}`;
  $("#seed-title").textContent =
    PRESET_SEEDS.find((p) => p.id === seed)?.name ?? seed;
  $("#condition-label").textContent =
    `${DIFFICULTIES[difficulty].name} · 种子 ${seed}`;
  saveSettings();
}
function setFocus(scene: number | null) {
  focused = focused === scene ? null : scene;
  $("#camera-grid").classList.toggle("has-focus", focused !== null);
  cards.forEach((c, i) => c.classList.toggle("featured", i === focused));
  $("#view-label").textContent =
    focused === null
      ? "全部机位"
      : `${CAMERAS[focused].name} · 其余五路仍在运行`;
  document
    .querySelectorAll<HTMLButtonElement>("[data-expand]")
    .forEach((button, i) => {
      button.setAttribute(
        "aria-label",
        `${focused === i ? "返回六屏，" : "放大"}${CAMERAS[i].name}`,
      );
    });
}
function updateStats() {
  const s = game.score;
  const time =
    mode === "idle"
      ? BALANCE.duration
      : Math.max(0, game.plan.config.duration - game.tick);
  $("#time-value").textContent = fmt(time);
  $("#time-value").classList.toggle(
    "time-warning",
    time < seconds(30) && mode === "playing",
  );
  $("#time-progress").style.width =
    `${(time / (mode === "idle" ? BALANCE.duration : game.plan.config.duration)) * 100}%`;
  $("#score-value").textContent =
    s.total === 0 ? "0000" : s.total.toLocaleString("zh-CN");
  $("#combo-value").innerHTML =
    `${s.combo || "—"}<small>${game.multiplier > 1 ? `×${game.multiplier.toFixed(1)}` : "COMBO"}</small>`;
  for (const key of ["caught", "missed", "false"] as const)
    $(`#${key}-value`).textContent = String(s[key]).padStart(2, "0");
  const state =
    mode === "idle"
      ? "等待开始"
      : mode === "results"
        ? "巡查结束"
        : paused
          ? "已暂停"
          : game.plan.config.tutorial
            ? "教学进行中"
            : "巡查进行中";
  $("#session-state").innerHTML = `${icon("shield", 15)} ${state}`;
  const tutorial = mode === "playing" && game.plan.config.tutorial;
  $("#tutorial-banner").hidden = !tutorial;
  let activeCameras = 6;
  if (tutorial) {
    const step =
      TUTORIAL_STEPS.find((s) => game.tick < seconds(s.until)) ??
      TUTORIAL_STEPS[2];
    activeCameras = step.cameras;
    $("#tutorial-title").textContent = step.title;
    $("#tutorial-text").textContent = step.text;
  }
  cards.forEach((card, i) => {
    card.classList.toggle("inactive", i >= activeCameras);
    card.classList.toggle(
      "is-cooling",
      mode === "playing" && game.cooldown[i] > game.tick,
    );
    card.querySelector("time")!.textContent = timestamp(
      mode === "idle" ? preview.tick : game.tick,
    );
  });
}
function start(tutorial = false, reuseConfig?: GameConfig) {
  closeModal();
  const config = reuseConfig
    ? { ...reuseConfig }
    : {
        ...makeConfig(seed, difficulty),
        layout: (innerWidth < 1000
          ? "practice"
          : "desktop") as GameConfig["layout"],
        debug: debugRequested,
      };
  game = new Game(tutorial ? buildTutorialPlan() : buildPlan(config));
  protectedGeometry.fill(undefined);
  mode = "playing";
  paused = false;
  qaFrozen = false;
  pauses = [];
  accumulator = 0;
  previous = performance.now();
  const freezeButton = document.getElementById("qa-freeze");
  if (freezeButton) freezeButton.textContent = "冻结模拟";
  $("#board").classList.remove("is-paused");
  $("#briefing").hidden = true;
  $("#live-label").textContent = tutorial ? "教学巡查" : "实时巡查";
  $("#pause-button").removeAttribute("disabled");
  $("#condition-label").textContent =
    `${tutorial ? "渐进教学" : DIFFICULTIES[config.difficulty].name} · ${tutorial ? "固定引导场景" : `种子 ${config.seed}`}${config.layout === "practice" ? " · 窄屏练习" : ""}${config.debug ? " · 辅助调试" : ""}`;
  if (focused !== null) setFocus(focused);
  audio.play("start");
  updateStats();
}
function pause(reason = "手动暂停") {
  if (mode !== "playing" || paused) return;
  paused = true;
  accumulator = 0;
  pauseStarted = Date.now();
  pauseReason = reason;
  $("#board").classList.add("is-paused");
  $("#pause-title").textContent =
    reason === "切到后台"
      ? "欢迎回来，考试已安全暂停。"
      : "休息一下，再继续观察。";
  updateStats();
}
function resume() {
  if (!paused || modalOpen) return;
  pauses.push({
    tick: game.tick,
    durationMs: Date.now() - pauseStarted,
    reason: pauseReason,
  });
  paused = false;
  accumulator = 0;
  previous = performance.now();
  $("#board").classList.remove("is-paused");
  updateStats();
}
function reset() {
  closeModal();
  mode = "idle";
  paused = false;
  accumulator = 0;
  game = new Game(buildPlan(makeConfig(seed, difficulty)));
  $("#briefing").hidden = false;
  $("#board").classList.remove("is-paused");
  $("#pause-button").setAttribute("disabled", "");
  $("#live-label").textContent = "实时预览";
  if (focused !== null) setFocus(focused);
  updateConditions();
  updateStats();
}
function report(scene: number, x: number, y: number) {
  if (
    mode !== "playing" ||
    paused ||
    modalOpen ||
    cards[scene].classList.contains("inactive")
  )
    return;
  // 使用本次模拟时刻实际显示的可见对象，放大和 DPR 不参与游戏规则。
  const geometry = sceneGeometry(game.plan, game.tick, scene, game.caught);
  const id = pickWithProtection(
    geometry.ops,
    protectedGeometry[scene],
    game.protectedUntil,
    game.tick,
    x,
    y,
  );
  const entry = game.report(scene, id, x, y);
  if (entry?.verdict === "caught") protectedGeometry[scene] = geometry.ops;
  if (entry) {
    audio.play(entry.verdict === "caught" ? "caught" : "false");
    updateStats();
    renderAll();
  }
}
function renderAll() {
  if (paused) return;
  const display = mode === "idle" ? preview : game;
  canvases.forEach((canvas, i) => {
    geometries[i] = renderCamera(canvas, display, i, hover[i]);
  });
}
function finish() {
  mode = "results";
  $("#pause-button").setAttribute("disabled", "");
  audio.play("end");
  latestRun = {
    id: `${Date.now()}-${game.plan.config.seed}`,
    date: new Date().toISOString(),
    config: { ...game.plan.config },
    score: { ...game.score },
    eventCount: game.plan.events.length,
    inputs: game.inputs.map((i) => ({ ...i })),
    pauses: [...pauses],
    plan: game.plan,
  };
  const best = store.saveRun(latestRun);
  updateStats();
  showResults(latestRun, best);
}
function frame(now: number) {
  const elapsed = now - previous;
  previous = now;
  if (mode === "playing" && !paused && !qaFrozen) {
    if (elapsed > 1000) pause("运行中断");
    else {
      accumulator += elapsed;
      while (accumulator >= 1000 / TICK_RATE && !game.ended) {
        game.step();
        accumulator -= 1000 / TICK_RATE;
      }
      if (game.ended) finish();
    }
  } else if (mode === "idle") {
    previewTick += Math.min(elapsed, 100) / (1000 / TICK_RATE);
    preview.tick = Math.floor(previewTick) % BALANCE.duration;
  }
  if (now - lastRender > 32) {
    renderAll();
    if (mode === "playing") updateStats();
    lastRender = now;
  }
  requestAnimationFrame(frame);
}

function openModal(content: string, wide = false) {
  if (mode === "playing") pause("打开面板");
  closeModal();
  modalOpen = true;
  $("#modal-root").innerHTML =
    `<div class="modal-backdrop"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="巡查系统面板"><button class="icon-button modal-close" id="modal-close" aria-label="关闭面板">${icon("close")}</button>${content}</section></div>`;
  $("#modal-close").onclick = closeModal;
  $("#modal-close").focus();
  $(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
}
function closeModal() {
  modalOpen = false;
  reviewPlaying = false;
  cancelAnimationFrame(reviewFrame);
  $("#modal-root").innerHTML = "";
}

function showSetup(tab: "difficulty" | "seed" = "difficulty") {
  openModal(
    `<span class="section-tag">巡查准备 / SESSION CONFIG</span><h2>选择你的挑战</h2><p class="modal-intro">同样的种子和规则，拥有同样的计分机会。</p><h3>巡查难度</h3><div class="difficulty-options">${(
      Object.keys(DIFFICULTIES) as Difficulty[]
    )
      .map((key) => {
        const d = DIFFICULTIES[key];
        return `<button class="difficulty-option ${key === difficulty ? "selected" : ""}" data-difficulty="${key}"><strong>${d.name}<span>${key === "beginner" ? "01" : key === "standard" ? "02" : "03"}</span></strong><p>${d.subtitle}</p><small>窗口 ${d.window[0]}—${d.window[1]} 秒 · 最多 ${d.concurrency} 件并发 · ${d.count} 件 / 局</small></button>`;
      })
      .join(
        "",
      )}</div><h3>挑战种子</h3><div class="seed-options">${PRESET_SEEDS.map((p) => `<button class="seed-option ${p.id === seed ? "selected" : ""}" data-seed="${p.id}"><span>${p.name}</span><small>${p.note}</small></button>`).join("")}</div><label class="input-label" for="custom-seed">自定义种子 <small>相同文字即可重现同一局</small></label><div class="custom-seed"><input id="custom-seed" value="${h(seed)}" maxlength="60" placeholder="输入种子文字" autocomplete="off"/><button class="icon-button" id="random-seed" aria-label="随机生成种子" title="随机生成种子">${icon("shuffle", 20)}</button></div><div class="modal-actions"><button class="button primary" id="save-setup">保存设置 ${icon("check", 16)}</button></div>`,
  );
  let selectedDifficulty = difficulty;
  document.querySelectorAll<HTMLButtonElement>("[data-difficulty]").forEach(
    (button) =>
      (button.onclick = () => {
        selectedDifficulty = button.dataset.difficulty as Difficulty;
        document
          .querySelectorAll("[data-difficulty]")
          .forEach((b) => b.classList.toggle("selected", b === button));
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-seed]").forEach(
    (button) =>
      (button.onclick = () => {
        $<HTMLInputElement>("#custom-seed").value = button.dataset.seed!;
        document
          .querySelectorAll("[data-seed]")
          .forEach((b) => b.classList.toggle("selected", b === button));
      }),
  );
  $("#random-seed").onclick = () => {
    $<HTMLInputElement>("#custom-seed").value = newSeed();
    document
      .querySelectorAll("[data-seed]")
      .forEach((b) => b.classList.remove("selected"));
  };
  $("#save-setup").onclick = () => {
    difficulty = selectedDifficulty;
    seed =
      $<HTMLInputElement>("#custom-seed").value.trim() || PRESET_SEEDS[0].id;
    updateConditions();
    closeModal();
    if (mode === "idle") reset();
    else notify("设置已保存，下局生效。");
  };
  if (tab === "seed") $<HTMLInputElement>("#custom-seed").focus();
}

function showRules() {
  openModal(
    `<span class="section-tag">值班手册 / FIELD GUIDE</span><h2>先看清，再举报。</h2><p class="modal-intro">直接点击正在违规的人物或可见物品。普通转头、伸展和准备动作不能作为举报依据。</p><div class="rules-grid">${Object.entries(
      CHEATS,
    )
      .map(
        ([key, c], i) =>
          `<div class="rule-card"><span class="rule-no">0${i + 1}</span><strong>${c.name}</strong><p>${c.feature}</p><span class="rule-label">明确动作期间可举报</span></div>`,
      )
      .join(
        "",
      )}<div class="rule-card allowed"><span class="rule-no">✓</span><strong>这些行为允许</strong><p>书写、思考、看时钟、伸展、捡笔、整理文具、正常转头、归还蓝色笔、离场、洗手和等候。</p><span class="rule-label">不要因小动作误报</span></div></div><div class="scoring-guide"><span>正确 <b>+100</b></span><span>误报 <b>−150</b></span><span>漏查 <b>−100</b></span><span>5 连击 <b>×1.2</b></span><span>10 连击 <b>×1.5</b></span></div><p class="fine-print">误报只让当前机位冷却 1 秒；成功没有全局冷却。同一事件只计分一次。点击空白也算误报。放大保留其他五路，所有动作窗口照常运行。后台自动暂停并遮住画面。</p><div class="modal-actions"><button class="button secondary" id="rules-close">已了解</button>${mode === "idle" ? `<button class="button primary" id="rules-tutorial">进入教学 ${icon("arrow", 16)}</button>` : ""}</div>`,
    true,
  );
  $("#rules-close").onclick = closeModal;
  if (mode === "idle") $("#rules-tutorial").onclick = () => start(true);
}
function showSettings() {
  openModal(
    `<span class="section-tag">偏好设置 / PREFERENCES</span><h2>保持适合你的节奏</h2><div class="setting-row"><div><strong>操作反馈音</strong><p>只在开始、举报和结束时播放。没有目标提示音。</p></div><button class="switch ${audio.enabled ? "on" : ""}" id="sound-setting" role="switch" aria-checked="${audio.enabled}" aria-label="操作反馈音"></button></div><label class="input-label" for="volume">反馈音量</label><input id="volume" type="range" min="0" max="1" step="0.05" value="${audio.volume}"/><div class="storage-note">${icon("shield", 21)}<div><strong>数据保存在当前浏览器</strong><p>记录最近十局，最佳成绩按种子、难度、时长、规则版本和布局分别保存。窄屏练习与辅助调试成绩独立标记。</p><small>${store.available ? "本地存储可用" : "当前存储受限，记录仅在内存保留"}</small></div></div><div class="modal-actions"><button class="button primary" id="settings-done">完成</button></div>`,
  );
  $("#sound-setting").onclick = () => {
    audio.enabled = !audio.enabled;
    $("#sound-setting").classList.toggle("on", audio.enabled);
    $("#sound-setting").setAttribute("aria-checked", String(audio.enabled));
    updateSound();
    saveSettings();
  };
  $<HTMLInputElement>("#volume").oninput = (e) => {
    audio.volume = Number((e.target as HTMLInputElement).value);
    saveSettings();
  };
  $("#settings-done").onclick = closeModal;
}
function showHistory() {
  openModal(
    `<span class="section-tag">巡查档案 / RECENT SESSIONS</span><h2>最近十局</h2><p class="modal-intro">每一场观察，都留下进步的线索。</p><div class="history-list">${store.data.recent.length ? store.data.recent.map((r, i) => `<button class="history-row" data-history="${i}"><div><strong>${h(PRESET_SEEDS.find((s) => s.id === r.config.seed)?.name ?? r.config.seed)}</strong><small>${new Date(r.date).toLocaleString("zh-CN")} · ${DIFFICULTIES[r.config.difficulty].name} · ${r.config.layout === "practice" ? "窄屏练习" : r.config.debug ? "辅助调试" : "桌面正式"}</small></div><b>${r.score.total.toLocaleString()}</b>${icon("chevron", 16)}</button>`).join("") : `<div class="empty-state">${icon("history", 36)}<strong>还没有巡查记录</strong><p>完成第一场考试后，在这里回看成绩和真实片段。</p></div>`}</div>`,
    true,
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-history]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          showResults(store.data.recent[Number(b.dataset.history)], false)),
    );
}

function showResults(run: RunRecord, newBest: boolean) {
  const reconstructed = replayAt(run.plan, run.inputs, run.config.duration);
  const entries = [...reconstructed.records].sort(
    (a, b) => a.tick - b.tick || a.id.localeCompare(b.id),
  );
  openModal(
    `<div class="results-heading"><span class="section-tag">${run.config.tutorial ? "教学完成" : "巡查报告"} / SESSION COMPLETE</span><h2>${run.config.tutorial ? "现在，准备好独立巡查。" : "这一场专注，值得被记录。"}</h2><p class="modal-intro">${DIFFICULTIES[run.config.difficulty].name} · ${h(run.config.seed)} · ${fmt(run.config.duration)}${run.config.layout === "practice" ? " · 窄屏练习" : ""}${run.config.debug ? " · 辅助调试" : ""}</p></div><div class="results-score"><div><span>最终得分</span><strong>${run.score.total.toLocaleString("zh-CN")}</strong>${newBest ? "<em>同条件最佳</em>" : ""}</div><div class="result-metrics"><span>抓到 / 总事件<b>${run.score.caught}<small> / ${run.eventCount}</small></b></span><span>漏查<b>${run.score.missed}</b></span><span>误报<b>${run.score.false}</b></span><span>最高连击<b>${run.score.maxCombo}</b></span><span>命中率<b>${pct(accuracy(run.score))}</b></span><span>检出率<b>${pct(detectionRate(run.score, run.eventCount))}</b></span></div></div><div class="review-heading"><h3>${icon("history", 18)} 事件复盘</h3><span>从本局种子与实际操作重建 · 只读</span></div><div class="review-layout"><div class="review-events"><div class="review-filters"><button class="selected" data-filter="all">全部 ${entries.length}</button><button data-filter="missed">漏查 ${run.score.missed}</button><button data-filter="false">误报 ${run.score.false}</button></div><div class="event-list" id="event-list"></div></div><div class="review-player" id="review-player"><div class="review-camera-title"><strong id="review-camera-title"></strong><span id="review-time"></span></div><canvas id="review-canvas" aria-label="真实事件复盘片段"></canvas><div class="review-controls"><button class="icon-button" id="review-play" aria-label="播放或暂停复盘">${icon("play", 16)}</button><input id="review-slider" aria-label="复盘时间" type="range" step="1"/><span id="review-duration"></span></div><div class="review-explanation"><strong id="review-event-title"></strong><p id="review-explanation"></p><small id="review-phase"></small></div></div></div><div class="results-footer"><div><span>暂停 ${run.pauses.length} 次 · ${Math.round(run.pauses.reduce((a, p) => a + p.durationMs, 0) / 1000)} 秒</span><small>${run.config.tutorial ? "教学成绩不进入正式记录" : `同条件最佳 ${store.data.best[conditionKey(run)]?.toLocaleString() ?? "—"} 分 · ${store.available ? "已保存至本地" : "仅内存保存"}`}</small></div><div class="result-buttons"><button class="button secondary" id="results-home">返回准备</button><button class="button secondary" id="same-seed">${icon("refresh", 15)} 同种子再挑战</button><button class="button primary" id="new-seed">${icon("shuffle", 15)} ${run.config.tutorial ? "开始正式巡查" : "新种子开始"}</button></div></div>`,
    true,
  );
  $("#results-home").onclick = reset;
  $("#same-seed").onclick = () => {
    seed = run.config.seed;
    difficulty = run.config.difficulty;
    start(run.config.tutorial, run.config);
  };
  $("#new-seed").onclick = () => {
    seed = newSeed();
    difficulty = run.config.tutorial ? "beginner" : run.config.difficulty;
    saveSettings();
    start();
  };
  let selected: RecordEntry | undefined;
  let reviewGame = new Game(run.plan);
  let rangeStart = 0;
  let rangeEnd = 0;
  let reviewTick = 0;
  let filter = "all";
  let lastReviewTime = 0;
  let fractional = 0;
  const renderReview = () => {
    if (!selected) return;
    const slider = $<HTMLInputElement>("#review-slider");
    slider.value = String(reviewTick);
    $("#review-time").textContent = timestamp(reviewTick);
    $("#review-duration").textContent =
      `${((reviewTick - rangeStart) / TICK_RATE).toFixed(1)}s`;
    renderCamera(
      $<HTMLCanvasElement>("#review-canvas"),
      reviewGame,
      selected.scene,
      null,
      selected.actorId,
    );
    const event = run.plan.events.find((e) => e.id === selected!.eventId);
    $("#review-phase").textContent = event
      ? reviewGame.caught.has(event.id)
        ? "当前时刻：已举报，人物恢复普通活动"
        : reviewTick < event.prepare
          ? "当前时刻：普通活动"
          : reviewTick < event.start
            ? "当前时刻：准备阶段，举报会误报"
            : reviewTick < event.end
              ? "当前时刻：明确违规，有效举报窗口"
              : "当前时刻：动作已结束"
      : "重建当时的可见行为与实际点击";
  };
  const seek = (target: number) => {
    reviewTick = Math.max(rangeStart, Math.min(rangeEnd, target));
    reviewGame = replayAt(run.plan, run.inputs, reviewTick);
    renderReview();
  };
  const selectEntry = (entry: RecordEntry) => {
    selected = entry;
    reviewPlaying = false;
    $("#review-play").innerHTML = icon("play", 16);
    const event = run.plan.events.find((e) => e.id === entry.eventId);
    rangeStart = Math.max(0, (event?.prepare ?? entry.tick) - seconds(3));
    rangeEnd = Math.min(
      run.config.duration,
      (event?.end ?? entry.tick) + seconds(3),
    );
    const slider = $<HTMLInputElement>("#review-slider");
    slider.min = String(rangeStart);
    slider.max = String(rangeEnd);
    const person =
      entry.actorId === null ? undefined : run.plan.people[entry.actorId];
    $("#review-camera-title").textContent =
      `${CAMERAS[entry.scene].name} · ${person ? `${String.fromCharCode(65 + person.room)}-${String(person.seat).padStart(2, "0")} ${person.name}` : "空白 / 家具区域"}`;
    $("#review-event-title").textContent =
      `${entry.verdict === "caught" ? "已抓到" : entry.verdict === "missed" ? "漏查" : "误报"} · ${event ? CHEATS[event.kind].name : "当时没有明确违规"}`;
    $("#review-explanation").textContent =
      `${entry.reason}${event ? ` 关键特征：${CHEATS[event.kind].feature}` : ""}`;
    seek(
      event
        ? Math.min(
            entry.tick - 1,
            event.start + Math.floor((event.end - event.start) / 2),
          )
        : entry.tick,
    );
    document
      .querySelectorAll("[data-record]")
      .forEach((el) =>
        el.classList.toggle(
          "selected",
          el.getAttribute("data-record") === entry.id,
        ),
      );
  };
  const renderList = () => {
    const filtered = entries.filter(
      (e) => filter === "all" || e.verdict === filter,
    );
    $("#event-list").innerHTML = filtered.length
      ? filtered
          .map(
            (e) =>
              `<button class="event-row ${selected?.id === e.id ? "selected" : ""}" data-record="${e.id}"><time>${fmt(e.tick)}</time><span class="verdict ${e.verdict}">${e.verdict === "caught" ? "抓到" : e.verdict === "missed" ? "漏查" : "误报"}</span><span>${CAMERAS[e.scene].name}</span><b>${e.delta > 0 ? "+" : ""}${e.delta}</b></button>`,
          )
          .join("")
      : '<p class="list-empty">这类事件没有记录。</p>';
    document
      .querySelectorAll<HTMLButtonElement>("[data-record]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            selectEntry(entries.find((e) => e.id === b.dataset.record)!)),
      );
  };
  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        filter = b.dataset.filter!;
        document
          .querySelectorAll("[data-filter]")
          .forEach((el) => el.classList.toggle("selected", el === b));
        renderList();
      }),
  );
  $<HTMLInputElement>("#review-slider").oninput = (e) => {
    reviewPlaying = false;
    $("#review-play").innerHTML = icon("play", 16);
    seek(Number((e.target as HTMLInputElement).value));
  };
  $("#review-play").onclick = () => {
    reviewPlaying = !reviewPlaying;
    if (reviewPlaying && reviewTick >= rangeEnd) seek(rangeStart);
    $("#review-play").innerHTML = icon(reviewPlaying ? "pause" : "play", 16);
    lastReviewTime = performance.now();
  };
  const animateReview = (now: number) => {
    if (!modalOpen || !document.querySelector("#review-canvas")) return;
    if (reviewPlaying) {
      fractional += (Math.min(now - lastReviewTime, 100) * TICK_RATE) / 1000;
      const n = Math.floor(fractional);
      fractional -= n;
      if (n > 0) seek(reviewTick + n);
      if (reviewTick >= rangeEnd) {
        reviewPlaying = false;
        $("#review-play").innerHTML = icon("play", 16);
      }
    }
    lastReviewTime = now;
    reviewFrame = requestAnimationFrame(animateReview);
  };
  renderList();
  if (entries.length)
    selectEntry(entries.find((e) => e.verdict === "missed") ?? entries[0]);
  reviewFrame = requestAnimationFrame(animateReview);
}

canvases.forEach((canvas, scene) => {
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    const point = clientToWorld(
      e.clientX,
      e.clientY,
      canvas.getBoundingClientRect(),
    );
    report(scene, point.x, point.y);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (paused || modalOpen) return;
    const p = clientToWorld(
      e.clientX,
      e.clientY,
      canvas.getBoundingClientRect(),
    );
    const id = pick(geometries[scene], p.x, p.y);
    hover[scene] = id;
    const label = cards[scene].querySelector<HTMLElement>(".hover-label")!;
    const person = game.plan.people.find((p) => p.id === id);
    label.textContent = person
      ? `${String.fromCharCode(65 + person.room)}-${String(person.seat).padStart(2, "0")} · ${person.name}`
      : "";
    label.classList.toggle("visible", id !== null);
  });
  canvas.addEventListener("pointerleave", () => {
    hover[scene] = null;
    cards[scene].querySelector(".hover-label")!.classList.remove("visible");
  });
});
document.querySelectorAll<HTMLButtonElement>("[data-expand]").forEach(
  (b) =>
    (b.onclick = () => {
      if (!paused && !modalOpen) setFocus(Number(b.dataset.expand));
    }),
);
$("#start-button").onclick = () => start();
$("#tutorial-button").onclick = () => start(true);
$("#difficulty-control").onclick = () => showSetup();
$("#seed-control").onclick = () => showSetup("seed");
$("#pause-button").onclick = () => (paused ? resume() : pause());
$("#resume-button").onclick = resume;
$("#abandon-button").onclick = reset;
$("#skip-tutorial").onclick = () => {
  difficulty = "beginner";
  seed = store.data.settings.seed;
  start();
};
$("#nav-rules").onclick = showRules;
$("#help-button").onclick = showRules;
$("#nav-history").onclick = showHistory;
$("#nav-settings").onclick = showSettings;
$("#nav-monitor").onclick = () => {
  closeModal();
  if (mode === "results" && latestRun) showResults(latestRun, false);
};
$("#sound-toggle").onclick = () => {
  audio.enabled = !audio.enabled;
  updateSound();
  saveSettings();
};
$(".brand").onclick = (e) => {
  e.preventDefault();
  if (mode === "playing") pause();
  else reset();
};
document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if ((e.target as HTMLElement).matches("input,textarea,select")) return;
  if (modalOpen) {
    if (e.key === "Escape") closeModal();
    if (e.key === "Tab") {
      const items = [
        ...document.querySelectorAll<HTMLElement>(".modal button,.modal input"),
      ].filter((el) => !(el as HTMLButtonElement).disabled);
      if (e.shiftKey && document.activeElement === items[0]) {
        e.preventDefault();
        items.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
        e.preventDefault();
        items[0]?.focus();
      }
    }
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (mode === "playing") paused ? resume() : pause();
  }
  if (e.key === "Escape" && focused !== null) {
    e.preventDefault();
    setFocus(focused);
  }
  if (/^[1-6]$/.test(e.key) && !paused) {
    e.preventDefault();
    const index = Number(e.key) - 1;
    if (!cards[index].classList.contains("inactive")) setFocus(index);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause("切到后台");
  previous = performance.now();
  accumulator = 0;
});
window.addEventListener("blur", () => {
  if (mode === "playing") pause("窗口失去焦点");
});
window.addEventListener("resize", () => {
  if (
    mode === "playing" &&
    innerWidth < 1000 &&
    game.plan.config.layout === "desktop"
  ) {
    game.plan.config.layout = "practice";
    notify("已切换到窄屏练习，成绩单独记录。");
  }
  renderAll();
});
updateConditions();
updateSound();
updateStats();
requestAnimationFrame(frame);

if (debugRequested) {
  const panel = document.createElement("section");
  panel.className = "qa-tools";
  panel.setAttribute("aria-label", "辅助调试工具");
  panel.innerHTML = `<strong>辅助调试 · 成绩独立</strong><select id="qa-kind" aria-label="动作类型">${Object.entries(
    CHEATS,
  )
    .map(([key, c]) => `<option value="${key}">${c.name}</option>`)
    .join(
      "",
    )}</select><select id="qa-variant" aria-label="动作变体"><option value="0">变体一</option><option value="1">变体二</option></select><button id="qa-fixture">固定动作场景</button><input type="number" id="qa-tick" aria-label="目标模拟 tick" value="0" min="0" max="7200"/><button id="qa-seek">定位时刻</button><button id="qa-freeze">冻结模拟</button><button id="qa-finish">走完本局</button><button id="qa-hide">收起工具</button>`;
  $(".workspace").insertBefore(panel, $(".bottom-bar"));
  $("#qa-fixture").onclick = () => {
    if (mode !== "playing") start();
    const kind = $<HTMLSelectElement>("#qa-kind").value;
    const variant = Number($<HTMLSelectElement>("#qa-variant").value);
    const e = game.plan.events.find(
      (e) => e.kind === kind && e.variant === variant,
    );
    if (!e) {
      notify("本种子没有该变体，请选择另一种子。");
      return;
    }
    game = replayAt(game.plan, [], e.start + seconds(1));
    paused = false;
    $("#board").classList.remove("is-paused");
    qaFrozen = true;
    $<HTMLInputElement>("#qa-tick").value = String(game.tick);
    $("#qa-freeze").textContent = "继续模拟";
    renderAll();
    updateStats();
  };
  $("#qa-seek").onclick = () => {
    if (mode !== "playing") start();
    const target = Math.max(
      0,
      Math.min(
        game.plan.config.duration,
        Number($<HTMLInputElement>("#qa-tick").value) || 0,
      ),
    );
    game = replayAt(game.plan, game.inputs, target);
    accumulator = 0;
    qaFrozen = true;
    $("#qa-freeze").textContent = "继续模拟";
    updateStats();
    renderAll();
    if (game.ended) finish();
  };
  $("#qa-freeze").onclick = () => {
    qaFrozen = !qaFrozen;
    accumulator = 0;
    previous = performance.now();
    $("#qa-freeze").textContent = qaFrozen ? "继续模拟" : "冻结模拟";
  };
  $("#qa-finish").onclick = () => {
    if (mode === "playing") {
      game.advanceTo(game.plan.config.duration);
      updateStats();
      finish();
    }
  };
  $("#qa-hide").onclick = () => {
    panel.hidden = true;
  };
}

// 开发环境的可重复验证入口；正式包只有显式 ?debug 才开放并标记辅助成绩。
if (import.meta.env.DEV || debugRequested) {
  const markAssisted = () => {
    game.plan.config.debug = true;
    if (!$("#condition-label").textContent?.includes("辅助调试"))
      $("#condition-label").textContent += " · 辅助调试";
  };
  (window as unknown as { __proctor: unknown }).__proctor = {
    get game() {
      return game;
    },
    get mode() {
      return mode;
    },
    get paused() {
      return paused;
    },
    get store() {
      return store;
    },
    start: (config?: Partial<GameConfig>) =>
      start(false, { ...makeConfig(seed, difficulty), ...config, debug: true }),
    advanceTo: (tick: number) => {
      markAssisted();
      game.advanceTo(tick);
      accumulator = 0;
      updateStats();
      renderAll();
      if (game.ended && mode === "playing") finish();
    },
    freeze: () => {
      markAssisted();
      qaFrozen = true;
      accumulator = 0;
    },
    unfreeze: () => {
      markAssisted();
      qaFrozen = false;
      previous = performance.now();
    },
    report: (scene: number, x: number, y: number) => {
      markAssisted();
      report(scene, x, y);
    },
    setFocus,
    pause,
    resume,
    geometry: (scene: number) =>
      sceneGeometry(game.plan, game.tick, scene, game.caught),
    replayAt,
    actorViews,
    fixture: (kind: keyof typeof CHEATS, variant: number) => {
      start(false, { ...makeConfig(seed, difficulty), debug: true });
      const e =
        game.plan.events.find(
          (e) => e.kind === kind && e.variant === variant,
        ) ?? game.plan.events.find((e) => e.kind === kind)!;
      game.advanceTo(e.start + 15);
      qaFrozen = true;
      renderAll();
      updateStats();
      return e;
    },
  };
}
