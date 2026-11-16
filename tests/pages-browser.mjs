import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

// REQ-20261116130906：验证组合 Pages 的入口、两版交互及同源存档隔离。
const port = 4196;
const base = new URL(process.env.PROCTOR_TEST_URL || `http://127.0.0.1:${port}/`);
base.search = "";
base.hash = "";
if (!base.pathname.endsWith("/")) base.pathname += "/";
const artifacts = process.env.PROCTOR_ARTIFACT_DIR ||
  fileURLToPath(new URL("../artifacts/dual-pages/", import.meta.url));
const variants = ["illustrated", "realistic"];
const expectedKeys = {
  illustrated: "gamex-proctor-illustrated-v1",
  realistic: "gamex-proctor-v1",
};
const results = [];
const errors = [];
const failedResponses = [];
const networkErrors = [];
const report = { date: new Date().toISOString(), base: base.href, results, errors, failedResponses, networkErrors };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const address = (relative, search = "") => {
  const url = new URL(relative, base);
  url.search = search;
  return url.href;
};
const check = (name, detail) => {
  results.push({ name, detail, passed: true });
  console.log(`通过：${name}`);
};
let server;
let browser;
let page;
await mkdir(artifacts, { recursive: true });

const shot = async (name) => {
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: false });
};
const ready = async () => {
  await page.locator("#start-button").waitFor();
  await page.waitForFunction(() => document.querySelector("#start-button")?.disabled === false);
};
async function navigateGame(variant, debug = false) {
  const response = await page.goto(address(`${variant}/`, debug ? "?debug=1" : ""));
  assert.equal(response?.status(), 200, `${variant} 页面不是 200`);
  await ready();
  assert.equal(await page.locator("canvas[data-camera]").count(), 6);
}
async function worldClick(scene, x, y) {
  const canvas = page.locator(`canvas[data-camera="${scene}"]`);
  const box = await canvas.boundingBox();
  assert.ok(box, "目标机位没有实际尺寸");
  const scale = Math.min(box.width / 600, box.height / 350);
  await canvas.click({ position: {
    x: (box.width - 600 * scale) / 2 + x * scale,
    y: (box.height - 350 * scale) / 2 + y * scale,
  } });
}
async function saveCompletedRun(variant, seed) {
  await navigateGame(variant, true);
  const result = await page.evaluate((seed) => {
    const q = window.__proctor;
    q.start({ seed });
    q.freeze();
    q.advanceTo(q.game.plan.config.duration);
    const run = q.store.data.recent[0];
    return run && {
      id: run.id,
      seed: run.config.seed,
      visualVersion: run.config.visualVersion ?? null,
      events: run.eventCount,
      inputs: run.inputs.length,
    };
  }, seed);
  assert.ok(result, `${variant} 没有保存完整局`);
  assert.equal(result.seed, seed);
  assert.ok(result.events > 0);
  await page.locator(".results-heading").waitFor();
  return result;
}

try {
  if (!process.env.PROCTOR_TEST_URL) {
    server = spawn(process.execPath, [
      "node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1",
      "--port", String(port), "--strictPort",
    ], { stdio: "ignore" });
    let online = false;
    for (let i = 0; i < 100; i++) {
      try { online = (await fetch(base)).ok; } catch { /* 等待组合生产预览。 */ }
      if (online) break;
      await wait(100);
    }
    assert.ok(online, "4196 组合生产预览未能启动");
  }
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({ headless: true,
    ...(process.env.PROCTOR_BROWSER_PATH
      ? { executablePath: process.env.PROCTOR_BROWSER_PATH }
      : existsSync(chrome) ? { executablePath: chrome } : {}),
  });
  // 全部版本在同一个临时浏览器 context 中，真实共享 origin，但不影响用户存档。
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
  });
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "未知网络错误";
    // 页面导航引起的正常取消不视作资源加载失败。
    if (error !== "net::ERR_ABORTED") networkErrors.push({ url: request.url(), error });
  });

  const rootResponse = await page.goto(base.href);
  assert.equal(rootResponse?.status(), 200);
  await page.getByRole("heading", { name: "选择画面版本", exact: true }).waitFor();
  const manifestResult = await page.evaluate(async () => {
    const response = await fetch(new URL("manifest.json", location.href));
    return { status: response.status, body: await response.json() };
  });
  assert.equal(manifestResult.status, 200);
  const manifest = manifestResult.body;
  assert.equal(manifest.schemaVersion, 1);
  for (const variant of variants) {
    const entry = manifest.versions?.[variant];
    assert.ok(entry, `manifest 缺少 ${variant}`);
    assert.equal(entry.branch, `codex/${variant}`);
    assert.match(entry.commit, /^[a-f0-9]{40}$/i);
    assert.equal(entry.path, `${variant}/`);
    assert.equal(entry.storageKey, expectedKeys[variant]);
    const url = new URL(entry.path, base);
    assert.equal(url.origin, base.origin);
    assert.equal(url.href, address(`${variant}/`));
  }
  assert.notEqual(manifest.versions.illustrated.commit, manifest.versions.realistic.commit);
  assert.notEqual(manifest.versions.illustrated.storageKey, manifest.versions.realistic.storageKey);
  report.manifest = manifest;
  await shot("version-selector");
  check("选择页与 manifest 标明两个独立分支、提交和存档空间");

  for (const variant of variants) {
    await page.goto(base.href);
    const link = page.getByRole("link", { name: variant === "illustrated" ? "开始插画版" : "开始写实版", exact: true });
    assert.equal(new URL(await link.getAttribute("href"), base).href, address(`${variant}/`));
    await link.click();
    await page.waitForURL((url) => url.pathname === new URL(address(`${variant}/`)).pathname);
    await ready();
    assert.equal(await page.evaluate(() => typeof window.__proctor), "undefined");
    assert.equal(await page.locator("canvas[data-camera]").count(), 6);
    await page.getByRole("button", { name: "开始巡查", exact: true }).click();
    assert.equal(await page.locator("#pause-button").isDisabled(), false);
    const before = await page.locator("#time-value").textContent();
    await page.waitForTimeout(1200);
    assert.notEqual(await page.locator("#time-value").textContent(), before, "正式入口时钟没有运行");
    await shot(`${variant}-gameplay-1440`);
    await page.setViewportSize({ width: 1280, height: 720 });
    await shot(`${variant}-gameplay-1280`);
    await page.setViewportSize({ width: 1440, height: 900 });
    check(`${variant} 普通入口可从选择页进入、无调试接口且实际运行`);
  }

  for (const variant of variants) {
    await navigateGame(variant, true);
    for (const kind of ["device", "notes", "peeking", "passing", "restroom"]) {
      for (const visualVariant of [0, 1]) {
        const fixture = await page.evaluate(({ variant, kind, visualVariant }) => {
          const q = window.__proctor;
          const event = q.fixture(kind, visualVariant);
          const ops = q.geometry(event.scene).ops;
          const head = ops.find((op) => op.actorId === event.actors[0] &&
            (variant === "realistic"
              ? op.shape.kind === "image" && op.shape.role === "person" && op.shape.head
              : op.shape.kind === "ellipse" && op.shape.rx === 12));
          if (!head) throw new Error(`${variant}/${kind}/${visualVariant} 没有真实头部点`);
          const point = variant === "realistic" ? head.shape.head : { x: head.shape.x, y: head.shape.y };
          return { id: event.id, scene: event.scene, x: point.x, y: point.y,
            caught: q.game.score.caught, false: q.game.score.false };
        }, { variant, kind, visualVariant });
        assert.equal(fixture.caught, 0);
        assert.equal(fixture.false, 0);
        await shot(`${variant}-${kind}-${visualVariant}`);
        await worldClick(fixture.scene, fixture.x, fixture.y);
        const score = await page.evaluate(() => ({ caught: window.__proctor.game.score.caught, false: window.__proctor.game.score.false }));
        assert.deepEqual(score, { caught: 1, false: 0 }, `${variant}/${kind}/${visualVariant} 实际指针举报失败`);
      }
    }
    check(`${variant} 五类×两变体均可用真实指针直接举报`, { scenes: 10 });
  }

  const modernSeed = "dual-pages-realistic-storage";
  const classicSeed = "dual-pages-illustrated-storage";
  const modernRun = await saveCompletedRun("realistic", modernSeed);
  const modernRaw = await page.evaluate((key) => localStorage.getItem(key), expectedKeys.realistic);
  assert.ok(modernRaw);
  assert.ok(JSON.parse(modernRaw).recent.some((run) => run.id === modernRun.id));
  const classicRun = await saveCompletedRun("illustrated", classicSeed);
  const isolated = await page.evaluate((keys) => ({
    modern: localStorage.getItem(keys.realistic), classic: localStorage.getItem(keys.illustrated),
  }), expectedKeys);
  assert.equal(isolated.modern, modernRaw, "插画版覆盖了写实版的原存档");
  assert.ok(isolated.classic, "插画版没有独立存档键");
  const classicData = JSON.parse(isolated.classic);
  assert.ok(classicData.recent.some((run) => run.id === classicRun.id));
  assert.ok(!classicData.recent.some((run) => run.id === modernRun.id), "插画版混入了写实版记录");
  await shot("illustrated-independent-save");
  await navigateGame("realistic", true);
  assert.equal(await page.evaluate((id) => window.__proctor.store.data.recent.some((run) => run.id === id), modernRun.id), true);
  await page.getByRole("button", { name: "最近十局", exact: true }).click();
  await page.locator(".history-row").filter({ hasText: modernSeed }).click();
  assert.ok(await page.locator("#review-canvas").isVisible());
  await page.locator("#review-slider").press("End");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), expectedKeys.realistic), modernRaw, "只读复盘修改了原存档");
  await shot("realistic-original-history");
  check("同一 origin 下两版实际完成局分别保存，写实原档逐字节不变且可只读复盘", {
    modernRun: modernRun.id, classicRun: classicRun.id,
    modernStorageSha256: createHash("sha256").update(modernRaw).digest("hex"),
  });

  await page.goto(address("", "?v=motion-4&debug=1"));
  await page.waitForURL((url) => url.pathname === new URL(address("realistic/")).pathname &&
    url.searchParams.get("v") === "motion-4" && url.searchParams.get("debug") === "1");
  await ready();
  assert.equal(await page.evaluate(() => typeof window.__proctor), "object");
  await page.getByRole("button", { name: "开始巡查", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__proctor.game.plan.config.debug), true);
  assert.match(await page.locator("#condition-label").textContent(), /辅助调试/);
  await shot("legacy-query-redirect");
  check("旧根目录 v 参数跳到写实版并保留 debug=1，成绩明确标记为辅助");

  assert.deepEqual(errors, []);
  assert.deepEqual(failedResponses, []);
  assert.deepEqual(networkErrors, []);
  check("两版无控制台异常、失败请求或资源 404");
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = String(error?.stack || error);
  if (page) {
    await shot("pages-failure").catch(() => {});
    console.error("失败时页面：", (await page.locator("body").innerText().catch(() => "")).slice(-1800));
  }
  throw error;
} finally {
  await writeFile(path.join(artifacts, "pages-browser-report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser?.close();
  server?.kill("SIGTERM");
}
