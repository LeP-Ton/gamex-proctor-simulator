import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 只操作正式页面和已有调试入口，录像只复制页面真正绘出的 Canvas。
const port = 4205;
const base = new URL(
  process.env.PROCTOR_TEST_URL || `http://127.0.0.1:${port}/`,
);
base.search = "";
base.hash = "";
if (!base.pathname.endsWith("/")) base.pathname += "/";
const artifacts =
  process.env.PROCTOR_ARTIFACT_DIR ||
  fileURLToPath(new URL("../artifacts/rig-5/", import.meta.url));
const flowsOnly = process.argv.includes("--flows-only");
const recordingsOnly = process.argv.includes("--recordings-only");
assert.ok(!(flowsOnly && recordingsOnly), "不能同时选择仅流程和仅录像");
const report = {
  date: new Date().toISOString(),
  base: base.href,
  scope: flowsOnly
    ? "仅全流程，未执行录像"
    : recordingsOnly
      ? "仅动作录像，未重复全流程"
      : "完整浏览器流程与三段动作录像",
  results: [],
  recordings: [],
  errors: [],
  failedResponses: [],
  networkErrors: [],
  passed: false,
};
let server, browser, page;
await mkdir(artifacts, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const address = (debug) => {
  const result = new URL(base);
  if (debug) result.searchParams.set("debug", "1");
  return result.href;
};
const check = (name, detail) => {
  report.results.push({ name, detail, passed: true });
  console.log(`通过：${name}`);
};
const ready = (target) =>
  target.waitForFunction(
    () => document.querySelector("#start-button")?.disabled === false,
    null,
    { timeout: 90_000 },
  );
const shot = async (name) => {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
};
async function pointer(scene, point) {
  assert.ok(
    point && Number.isFinite(point.x) && Number.isFinite(point.y),
    "没有有限的实际头部投影",
  );
  const canvas = page.locator(`canvas[data-camera="${scene}"]`);
  const box = await canvas.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, "目标机位没有实际尺寸");
  const factor = Math.min(box.width / 600, box.height / 350);
  const x = (box.width - 600 * factor) / 2 + point.x * factor;
  const y = (box.height - 350 * factor) / 2 + point.y * factor;
  assert.ok(
    x >= 0 && y >= 0 && x < box.width && y < box.height,
    `头部投影超出可点击画面：${JSON.stringify(point)}`,
  );
  await canvas.click({ position: { x, y } });
}
async function head(scene, actorId) {
  return page.evaluate(
    ({ scene, actorId }) => {
      const op = window.__proctor
        .geometry(scene)
        .ops.find(
          (op) => op.actorId === actorId && op.shape.kind === "rig-person",
        );
      if (!op?.shape.head)
        throw new Error(`机位${scene}没有人物${actorId}的实际骨骼投影`);
      return op.shape.head;
    },
    { scene, actorId },
  );
}
async function fixture(kind, variant) {
  const event = await page.evaluate(
    ({ kind, variant }) => window.__proctor.fixture(kind, variant),
    { kind, variant },
  );
  assert.ok(event, `无法生成${kind}/${variant}固定场景`);
  return { ...event, head: await head(event.scene, event.actors[0]) };
}
async function score() {
  return page.evaluate(() => ({
    caught: window.__proctor.game.score.caught,
    false: window.__proctor.game.score.false,
  }));
}

async function loadingChecks() {
  const loading = await browser.newContext();
  const target = await loading.newPage();
  let release, requested;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const request = new Promise((resolve) => {
    requested = resolve;
  });
  await loading.route("**/assets/rig-5/*.glb", async (route) => {
    requested();
    await gate;
    await route.continue();
  });
  try {
    await target.goto(address(true), { waitUntil: "domcontentloaded" });
    await target.locator("#start-button").waitFor();
    await Promise.race([
      request,
      wait(15_000).then(() => {
        throw new Error("页面未请求本地骨骼 GLB 资源");
      }),
    ]);
    assert.equal(await target.locator("#start-button").isDisabled(), true);
    assert.equal(await target.locator("#tutorial-button").isDisabled(), true);
    assert.ok(await target.locator("#asset-loading").isVisible());
    await target.evaluate(() => window.__proctor.start());
    await target.waitForTimeout(150);
    assert.deepEqual(
      await target.evaluate(() => ({
        mode: window.__proctor.mode,
        tick: window.__proctor.game.tick,
      })),
      { mode: "idle", tick: 0 },
    );
    await target.screenshot({
      path: path.join(artifacts, "rig-loading-blocked.png"),
    });
    release();
    await ready(target);
    assert.equal(await target.locator("#asset-loading").isVisible(), false);
    check("骨骼资源未完成加载时禁止开局与教学，考试时钟保持0");
  } finally {
    release();
    await loading.close();
  }

  const retry = await browser.newContext();
  const failed = await retry.newPage();
  let rejected = false;
  await retry.route("**/assets/rig-5/*.glb", async (route) => {
    if (!rejected) {
      rejected = true;
      await route.abort("failed");
    } else await route.continue();
  });
  try {
    await failed.goto(address(true), { waitUntil: "domcontentloaded" });
    await failed
      .getByRole("button", { name: "重新载入", exact: true })
      .waitFor();
    assert.ok(rejected);
    assert.equal(await failed.locator("#start-button").isDisabled(), true);
    await failed.evaluate(() => window.__proctor.start());
    await failed.waitForTimeout(150);
    assert.deepEqual(
      await failed.evaluate(() => ({
        mode: window.__proctor.mode,
        tick: window.__proctor.game.tick,
      })),
      { mode: "idle", tick: 0 },
    );
    await failed.screenshot({
      path: path.join(artifacts, "rig-loading-failure.png"),
    });
    await failed.getByRole("button", { name: "最近十局", exact: true }).click();
    assert.ok(
      await failed
        .getByRole("heading", { name: "最近十局", exact: true })
        .isVisible(),
    );
    await failed.getByRole("button", { name: "关闭面板", exact: true }).click();
    await failed.getByRole("button", { name: "重新载入", exact: true }).click();
    await ready(failed);
    assert.equal(await failed.locator("#asset-loading").isVisible(), false);
    check("GLB加载失败不计时、历史仍可访问，重试后恢复可开局状态");
  } finally {
    await retry.close();
  }
}

async function productionChecks() {
  await page.goto(address(false));
  await ready(page);
  assert.equal(await page.evaluate(() => typeof window.__proctor), "undefined");
  assert.equal(await page.locator("canvas[data-camera]").count(), 6);
  report.bundle = await page
    .locator('script[type="module"]')
    .getAttribute("src");
  await shot("rig-production-start");
  await page.getByRole("button", { name: "开始巡查", exact: true }).click();
  const before = await page.locator("#time-value").textContent();
  await page.waitForTimeout(1200);
  assert.notEqual(await page.locator("#time-value").textContent(), before);
  await shot("rig-production-1440");
  await page.setViewportSize({ width: 1280, height: 720 });
  await shot("rig-production-1280");
  await page.setViewportSize({ width: 1440, height: 900 });
  check("普通生产入口没有调试接口，六屏实际计时且两种桌面尺寸可见");
}

async function pointerChecks() {
  await page.goto(address(true));
  await ready(page);
  assert.equal(
    await page.evaluate(() => typeof window.__proctor.rig),
    "function",
    "尚未接入实际骨骼诊断 q.rig",
  );
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    for (const kind of ["device", "notes", "peeking", "passing", "restroom"])
      for (const variant of [0, 1]) {
        const event = await fixture(kind, variant);
        assert.deepEqual(await score(), { caught: 0, false: 0 });
        await shot(`rig-${size.width}-${kind}-${variant}`);
        await pointer(event.scene, event.head);
        await pointer(event.scene, event.head);
        assert.deepEqual(
          await score(),
          { caught: 1, false: 0 },
          `${size.width}/${kind}/${variant}实际头部举报或重复保护失败`,
        );
      }
    check(`${size.width}×${size.height}五类两变体实际骨骼头部点击与重复保护`, {
      pointerScenarios: 10,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const event = await fixture("device", 0);
  await page.evaluate((tick) => {
    const q = window.__proctor;
    const config = { ...q.game.plan.config };
    q.start(config);
    q.freeze();
    q.advanceTo(tick);
  }, event.start - 1);
  await pointer(event.scene, await head(event.scene, event.actors[0]));
  assert.deepEqual(await score(), { caught: 0, false: 1 });
  assert.match(
    await page.evaluate(() => window.__proctor.game.records.at(-1).reason),
    /过早/,
  );
  await fixture("device", 0);
  await page.evaluate((tick) => window.__proctor.advanceTo(tick), event.end);
  await pointer(event.scene, await head(event.scene, event.actors[0]));
  assert.deepEqual(await score(), { caught: 0, false: 1 });
  check("三维拾取保留准备期误报与结束不包含的计分边界");
}

async function tutorialChecks() {
  await page.goto(address(true));
  await ready(page);
  const recentBefore = await page.evaluate(
    () => window.__proctor.store.data.recent.length,
  );
  await page.getByRole("button", { name: "新手教学", exact: true }).click();
  await page.evaluate(() => window.__proctor.freeze());
  assert.equal(
    await page.evaluate(() => window.__proctor.game.plan.config.duration),
    2800,
  );
  for (const [tick, inactive] of [
    [400, 4],
    [1100, 2],
    [1960, 0],
  ]) {
    await page.evaluate((tick) => window.__proctor.advanceTo(tick), tick);
    assert.equal(await page.locator(".camera-card.inactive").count(), inactive);
  }
  await page.evaluate(() => window.__proctor.advanceTo(2800));
  assert.match(await page.locator(".results-heading").innerText(), /教学完成/);
  assert.equal(
    await page.evaluate(() => window.__proctor.store.data.recent.length),
    recentBefore,
  );
  await shot("rig-tutorial-complete");
  await page.getByRole("button", { name: "开始正式巡查", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__proctor.game.plan.config.difficulty),
    "beginner",
  );
  check("140秒教学按2→4→6路开放、结算不混入正式记录并可进入正式考试");
}

async function fullRunChecks() {
  await page.evaluate(() => {
    const q = window.__proctor;
    q.start({ seed: "morning-01", difficulty: "standard" });
    q.freeze();
    q.setFocus(null);
  });
  const plan = await page.evaluate(() => window.__proctor.game.plan);
  assert.equal(plan.config.visualVersion, "rig-5");
  assert.equal(plan.config.ruleVersion, "1.1.0");
  assert.equal(plan.events.length, 48);
  await pointer(0, { x: 590, y: 340 });
  assert.deepEqual(await score(), { caught: 0, false: 1 });
  for (let index = 0; index < plan.events.length; index++) {
    const event = plan.events[index];
    await page.evaluate(
      (tick) => window.__proctor.advanceTo(tick),
      event.start + 15,
    );
    if (index % 3 !== 0)
      await pointer(event.scene, await head(event.scene, event.actors[0]));
  }
  await page.evaluate(() =>
    window.__proctor.advanceTo(window.__proctor.game.plan.config.duration),
  );
  await page.locator(".results-heading").waitFor();
  const run = await page.evaluate(() => window.__proctor.store.data.recent[0]);
  assert.equal(run.config.duration, 7200);
  assert.equal(run.score.caught, 32);
  assert.equal(run.score.missed, 16);
  assert.equal(run.score.false, 1);
  assert.equal(await page.locator(".event-row").count(), 49);
  await shot("rig-complete-six-minute-flow");
  const before = await page.evaluate(() =>
    JSON.stringify(window.__proctor.store.data),
  );
  await page.locator('[data-filter="false"]').click();
  await page.locator(".event-row").click();
  await page.locator("#review-slider").press("End");
  await page
    .getByRole("button", { name: "播放或暂停复盘", exact: true })
    .click();
  await page.waitForTimeout(250);
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.__proctor.store.data)),
    before,
  );
  await page.getByRole("button", { name: "同种子再挑战", exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() => window.__proctor.game.plan.events),
    plan.events,
  );
  await page.evaluate(() => {
    window.__proctor.freeze();
    window.__proctor.advanceTo(window.__proctor.game.plan.config.duration);
  });
  await page.getByRole("button", { name: "新种子开始", exact: true }).click();
  assert.notEqual(
    await page.evaluate(() => window.__proctor.game.plan.config.seed),
    "morning-01",
  );
  check("完整360秒模拟局实际举报、结算保存、只读复盘及同种子/新种子重赛", {
    caught: 32,
    missed: 16,
    false: 1,
    total: run.score.total,
  });
  return run;
}

async function compatibilityChecks(run) {
  await page.evaluate((run) => {
    const q = window.__proctor;
    const versions = ["rig-5", "motion-4", "photo-3", "cctv-2", null];
    q.store.data.recent = versions.map((version, index) => {
      const record = structuredClone(run);
      record.id = `rig-browser-compat-${index}`;
      if (version) {
        record.config.visualVersion = version;
        record.plan.config.visualVersion = version;
      } else {
        delete record.config.visualVersion;
        delete record.plan.config.visualVersion;
      }
      if (version !== "rig-5") {
        record.config.ruleVersion = "1.0.0";
        record.plan.config.ruleVersion = "1.0.0";
      }
      return record;
    });
    q.store.persist();
  }, run);
  await page.reload();
  await ready(page);
  const before = await page.evaluate(() =>
    JSON.stringify(window.__proctor.store.data),
  );
  const labels = [
    "三维监控画面",
    "连贯动作画面",
    "照片质感画面",
    "监控画面 V2",
    "经典画面",
  ];
  for (const label of labels) {
    await page.getByRole("button", { name: "最近十局", exact: true }).click();
    for (const expected of labels)
      assert.equal(
        await page
          .locator(".history-row")
          .filter({ hasText: expected })
          .count(),
        1,
        `${expected}的历史标签未保持独立`,
      );
    await page.locator(".history-row").filter({ hasText: label }).click();
    assert.ok(
      (
        await page.locator(".results-heading .modal-intro").textContent()
      ).includes(label),
    );
    await page.locator("#review-slider").press("End");
    await shot(`rig-compat-${labels.indexOf(label)}`);
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.__proctor.store.data)),
      before,
    );
    if (label !== labels.at(-1))
      await page.getByRole("button", { name: "返回准备", exact: true }).click();
  }
  await page.getByRole("button", { name: "同种子再挑战", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__proctor.game.plan.config.visualVersion),
    "rig-5",
  );
  assert.equal(
    await page.evaluate(() => window.__proctor.game.plan.config.ruleVersion),
    "1.1.0",
  );
  check("五代视觉标签独立、四种旧画面只读复盘，旧局重赛使用rig-5与当前规则");
}

async function chooseJourney() {
  return page.evaluate(() => {
    const q = window.__proctor;
    q.start({ seed: "morning-01", difficulty: "standard" });
    q.freeze();
    const plan = q.game.plan;
    const rooms = plan.visits.filter(
      (visit) =>
        plan.people.find((person) => person.id === visit.actorId)?.room === 0,
    );
    const candidates = rooms.length ? rooms : plan.visits;
    const scored = candidates.map((visit) => ({
      visit,
      person: plan.people.find((person) => person.id === visit.actorId),
    }));
    scored.sort(
      (a, b) =>
        b.visit.arrive -
        b.visit.depart +
        (b.person.row === 2 && b.person.col === 0 ? 50 : 0) -
        b.person.col -
        (a.visit.arrive -
          a.visit.depart +
          (a.person.row === 2 && a.person.col === 0 ? 50 : 0) -
          a.person.col),
    );
    const publicCandidates = plan.visits.filter((visit) => !visit.eventId);
    publicCandidates.sort((a, b) => a.exit - a.arrive - (b.exit - b.arrive));
    const chosen = scored[0],
      publicVisit = publicCandidates[0] || chosen?.visit;
    if (!chosen || !publicVisit)
      throw new Error("种子缺少可验证的真实离场/公共区行程");
    return {
      room: chosen.person.room,
      person: chosen.person,
      visit: chosen.visit,
      publicVisit,
    };
  });
}

async function recordJourney(specification) {
  const { name, scene, actorId, startTick, endTick, minimumSeconds } =
    specification;
  const ticks = Math.max(endTick - startTick, Math.ceil(minimumSeconds * 20));
  const durationMs = ticks * 50;
  await page.evaluate(
    ({ scene, startTick }) => {
      const q = window.__proctor;
      q.start({ seed: "morning-01", difficulty: "standard" });
      q.freeze();
      q.advanceTo(startTick);
      q.setFocus(scene);
    },
    { scene, startTick },
  );
  await shot(`${name}-page-start`);
  await page.evaluate(
    ({ name, scene, actorId, startTick, durationMs }) => {
      const q = window.__proctor;
      const source = document.querySelector(`canvas[data-camera="${scene}"]`);
      const card = source.closest(".camera-card");
      const output = document.createElement("canvas");
      output.width = 1280;
      output.height = 760;
      const context = output.getContext("2d");
      const stream = output.captureStream(30);
      const mimeType = [
        "video/webm;codecs=vp8",
        "video/webm;codecs=vp9",
        "video/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("浏览器不支持WebM录像");
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 4_000_000,
      });
      const chunks = [],
        intervals = [],
        samples = [],
        snapshots = [];
      const started = performance.now();
      let previous,
        raf,
        lastTick = -1,
        middle = false;
      const capture = (window.__rigCapture = {
        name,
        output,
        recorder,
        stream,
        chunks,
        intervals,
        samples,
        snapshots,
        started,
        done: false,
        startTick,
        durationMs,
      });
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.start(1000);
      const paint = (now) => {
        const elapsed = Math.min(durationMs, now - started);
        const tick = startTick + Math.floor(elapsed / 50);
        if (tick > q.game.tick) q.advanceTo(tick);
        if (previous !== undefined) intervals.push(now - previous);
        previous = now;
        context.fillStyle = "#172026";
        context.fillRect(0, 0, output.width, output.height);
        const factor = Math.min(1280 / source.width, 710 / source.height);
        context.drawImage(
          source,
          (1280 - source.width * factor) / 2,
          26 + (710 - source.height * factor) / 2,
          source.width * factor,
          source.height * factor,
        );
        context.fillStyle = "#d3dddc";
        context.font = "16px sans-serif";
        context.fillText(
          card.querySelector(".camera-code")?.textContent ||
            `机位 ${scene + 1}`,
          14,
          20,
        );
        context.font = "15px monospace";
        context.fillText(
          card.querySelector("time")?.textContent || "",
          14,
          752,
        );
        context.fillStyle = "#c87c73";
        context.fillText("REC", 1226, 20);
        if (tick !== lastTick) {
          const state = q.rig(scene).find((actor) => actor.id === actorId);
          samples.push({
            elapsedMs: now - started,
            tick: q.game.tick,
            actor: state || null,
          });
          lastTick = tick;
        }
        if (snapshots.length === 0)
          snapshots.push({
            point: "first",
            tick,
            png: output.toDataURL("image/png").split(",")[1],
          });
        if (!middle && elapsed >= durationMs / 2) {
          middle = true;
          snapshots.push({
            point: "middle",
            tick,
            png: output.toDataURL("image/png").split(",")[1],
          });
        }
        if (elapsed >= durationMs) {
          snapshots.push({
            point: "last",
            tick,
            png: output.toDataURL("image/png").split(",")[1],
          });
          capture.finished = performance.now();
          capture.endTick = q.game.tick;
          capture.done = true;
          return;
        }
        raf = requestAnimationFrame(paint);
      };
      capture.cancel = () => cancelAnimationFrame(raf);
      raf = requestAnimationFrame(paint);
    },
    { name, scene, actorId, startTick, durationMs },
  );
  await page.waitForFunction(() => window.__rigCapture?.done === true, null, {
    timeout: durationMs + 30_000,
  });
  const result = await page.evaluate(async () => {
    const capture = window.__rigCapture;
    const blob = await new Promise((resolve) => {
      capture.recorder.onstop = () =>
        resolve(new Blob(capture.chunks, { type: capture.recorder.mimeType }));
      capture.recorder.stop();
    });
    capture.cancel();
    capture.stream.getTracks().forEach((track) => track.stop());
    const data = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.readAsDataURL(blob);
    });
    const sorted = [...capture.intervals].sort((a, b) => a - b);
    const percentile = (p) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
    return {
      name: capture.name,
      data,
      bytes: blob.size,
      mimeType: blob.type,
      durationMs: capture.finished - capture.started,
      startTick: capture.startTick,
      endTick: capture.endTick,
      samples: capture.samples,
      snapshots: capture.snapshots,
      raf: {
        samples: sorted.length,
        medianMs: percentile(0.5),
        p95Ms: percentile(0.95),
        maxMs: sorted.at(-1) ?? 0,
        over100Ms: sorted.filter((value) => value > 100).length,
      },
    };
  });
  await writeFile(
    path.join(artifacts, `${name}.webm`),
    Buffer.from(result.data, "base64"),
  );
  delete result.data;
  for (const snapshot of result.snapshots) {
    await writeFile(
      path.join(artifacts, `${name}-${snapshot.point}.png`),
      Buffer.from(snapshot.png, "base64"),
    );
    delete snapshot.png;
  }
  result.specification = specification;
  assert.ok(result.bytes > 50_000, "录像缺少有效视频数据");
  assert.ok(
    result.durationMs >= minimumSeconds * 1000 - 100,
    "实际录像时长不足",
  );
  assert.ok(
    result.endTick - result.startTick >= ticks,
    "墙钟推进未达到要求的模拟时钟",
  );
  report.recordings.push(result);
  await shot(`${name}-page-end`);
  console.log(
    `录像完成：${name}，实际${Math.round(result.durationMs)}ms，${result.bytes}字节`,
  );
  return result;
}

function diagnoseRecording(recording) {
  const actors = recording.samples
    .map((sample) => sample.actor)
    .filter(Boolean);
  assert.ok(actors.length > 20, `${recording.name}骨骼诊断采样不足`);
  for (const actor of actors) {
    for (const key of [
      "x",
      "y",
      "z",
      "heading",
      "rootHeading",
      "stand",
      "walkSpeed",
      "walkDistance",
      "walkPhase",
    ])
      assert.ok(Number.isFinite(actor[key]), `${recording.name}/${key}非有限`);
    for (const key of ["head", "leftFoot", "rightFoot"])
      for (const axis of ["x", "y", "z"])
        assert.ok(
          Number.isFinite(actor[key]?.[axis]),
          `${recording.name}/${key}.${axis}非有限`,
        );
  }
  const moving = actors.filter((actor) => actor.walkSpeed > 0.15);
  assert.ok(moving.length > 12, `${recording.name}缺少实际行走采样`);
  const differences = moving.map(
    (actor) => actor.leftFoot.y - actor.rightFoot.y,
  );
  assert.ok(
    Math.max(...differences) >= 0.03 && Math.min(...differences) <= -0.03,
    `${recording.name}左右脚没有交替抬起至少0.03米`,
  );
  const directions = new Set(
    moving.map((actor) =>
      Math.round(
        Math.atan2(Math.sin(actor.rootHeading), Math.cos(actor.rootHeading)) /
          (Math.PI / 6),
      ),
    ),
  );
  assert.ok(
    directions.size > 2,
    `${recording.name}真实人物根朝向没有超过两个方向`,
  );
  const phases = [...new Set(actors.map((actor) => actor.journeyPhase))];
  recording.diagnostics = {
    samples: actors.length,
    walkingSamples: moving.length,
    leftRightFootDifferenceMin: Math.min(...differences),
    leftRightFootDifferenceMax: Math.max(...differences),
    rootDirectionBins: [...directions],
    journeyPhases: phases,
    interpretation:
      "脚点与头点来自实际骨架；RAF间隔只描述本机录制采样，不等同游戏帧率或跨平台性能保证。",
  };
}

async function motionChecks() {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(address(true));
  await ready(page);
  assert.equal(
    await page.evaluate(() => typeof window.__proctor.rig),
    "function",
    "尚未接入q.rig实际骨骼诊断",
  );
  const journey = await chooseJourney();
  report.journey = journey;
  const { visit, person, publicVisit } = journey;
  const departure = await recordJourney({
    name: "rig-departure",
    label: "离座、走向门口、开门离场",
    scene: person.room,
    actorId: person.id,
    startTick: Math.max(0, visit.depart - 20),
    endTick: visit.arrive + 10,
    minimumSeconds: 18,
  });
  diagnoseRecording(departure);
  assert.ok(departure.diagnostics.journeyPhases.includes("standing-up"));
  assert.ok(departure.diagnostics.journeyPhases.includes("opening-door"));
  assert.ok(departure.diagnostics.journeyPhases.includes("crossing-out"));
  const returning = await recordJourney({
    name: "rig-return",
    label: "反向回门、穿门、走回座位落座",
    scene: person.room,
    actorId: person.id,
    startTick: visit.exit + 10,
    endTick: visit.returned + 24,
    minimumSeconds: 17,
  });
  diagnoseRecording(returning);
  assert.ok(returning.diagnostics.journeyPhases.includes("crossing-in"));
  assert.ok(returning.diagnostics.journeyPhases.includes("sitting-down"));
  const publicWalk = await recordJourney({
    name: "rig-public-walk",
    label: "公共区正侧背行走与自然转向",
    scene: publicVisit.scene,
    actorId: publicVisit.actorId,
    startTick: Math.max(0, publicVisit.arrive - 10),
    endTick: publicVisit.exit + 10,
    minimumSeconds: 16,
  });
  diagnoseRecording(publicWalk);
  assert.ok(publicWalk.diagnostics.journeyPhases.includes("public-in"));
  assert.ok(publicWalk.diagnostics.journeyPhases.includes("public-out"));
  check(
    "三段真实Canvas录像和实际骨骼诊断：交替脚步、多方向转身、完整离场与回座",
    {
      recordings: report.recordings.map((recording) => ({
        name: recording.name,
        durationMs: recording.durationMs,
        bytes: recording.bytes,
        diagnostics: recording.diagnostics,
      })),
    },
  );
}

try {
  if (!process.env.PROCTOR_TEST_URL) {
    server = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
      ],
      { stdio: "ignore" },
    );
    let online = false;
    for (let i = 0; i < 100; i++) {
      try {
        online = (await fetch(base)).ok;
      } catch {
        /* 等待本地生产预览。 */
      }
      if (online) break;
      await wait(100);
    }
    assert.ok(online, "4205生产预览未能启动");
  }
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PROCTOR_BROWSER_PATH
      ? { executablePath: process.env.PROCTOR_BROWSER_PATH }
      : existsSync(chrome)
        ? { executablePath: chrome }
        : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      report.failedResponses.push({
        status: response.status(),
        url: response.url(),
      });
  });
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText;
    if (error !== "net::ERR_ABORTED")
      report.networkErrors.push({ url: request.url(), error });
  });
  if (!recordingsOnly) {
    await loadingChecks();
    await productionChecks();
    await pointerChecks();
    await tutorialChecks();
    await compatibilityChecks(await fullRunChecks());
  }
  if (!flowsOnly) await motionChecks();
  assert.deepEqual(report.errors, [], "页面出现控制台异常");
  assert.deepEqual(report.failedResponses, [], "页面出现4xx/5xx资源");
  assert.deepEqual(report.networkErrors, [], "页面出现加载失败");
  check("验收页面无控制台异常、资源错误或失败请求");
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack || error);
  if (page) await shot("rig-browser-failure").catch(() => {});
  console.error(report.failure);
  if (page)
    console.error(
      "失败时页面：",
      (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(-1800),
    );
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(
      artifacts,
      flowsOnly
        ? "rig-flows-report.json"
        : recordingsOnly
          ? "rig-recordings-report.json"
          : "rig-browser-report.json",
    ),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server?.kill("SIGTERM");
}
