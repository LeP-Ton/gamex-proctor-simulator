import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const realtime = process.argv.includes("--realtime");
const capture = process.argv.includes("--capture");
const port = capture ? 4193 : realtime ? 4183 : 4173;
const base = process.env.PROCTOR_TEST_URL || `http://127.0.0.1:${port}`;
const artifacts = fileURLToPath(new URL("../artifacts/", import.meta.url));
await mkdir(artifacts, { recursive: true });
const results = [];
const errors = [];
let server;
let browser;
let activePage;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name, detail) => {
  results.push({ name, detail, passed: true });
  console.log(`通过：${name}${detail ? ` · ${detail}` : ""}`);
};
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        ready = (await fetch(base)).ok;
      } catch {
        /* 等待测试服务器就绪。 */
      }
      if (ready) break;
      await wait(100);
    }
    assert.ok(ready, "生产预览服务器未能启动");
  }
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
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  activePage = page;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const shot = async (name) =>
    page.screenshot({ path: `${artifacts}${name}.png`, fullPage: true });
  const worldClick = async (scene, x, y) => {
    const canvas = page.locator(`canvas[data-camera="${scene}"]`);
    const box = await canvas.boundingBox();
    assert.ok(box);
    const scale = Math.min(box.width / 600, box.height / 350);
    await canvas.click({
      position: {
        x: (box.width - 600 * scale) / 2 + x * scale,
        y: (box.height - 350 * scale) / 2 + y * scale,
      },
    });
  };

  if (capture) {
    await page.goto(base);
    assert.equal(
      await page.evaluate(() => typeof window.__proctor),
      "undefined",
    );
    await shot("start-desktop");
    await page.getByRole("button", { name: "开始巡查", exact: true }).click();
    await page.waitForTimeout(12000);
    await shot("gameplay-desktop");
    await page.setViewportSize({ width: 1280, height: 720 });
    await shot("gameplay-1280");
    check("普通生产入口无调试接口，六屏实机截图已保存");
    await page.goto(`${base}/?debug=1`);
    await page.evaluate(() => window.__proctor.start({ debug: false }));
    assert.equal(
      await page.evaluate(() => window.__proctor.game.plan.config.debug),
      true,
    );
    await page.evaluate(() => window.__proctor.fixture("device", 0));
    assert.equal(
      await page.evaluate(() => window.__proctor.game.plan.config.debug),
      true,
    );
    const tick = await page.evaluate(() => window.__proctor.game.tick);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__proctor.game.tick), tick);
    check("调试 API 强制辅助标记，固定场景时钟冻结");
  } else if (realtime) {
    await page.goto(base);
    await page.bringToFront();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "开始巡查", exact: true }).click();
    const start = Date.now();
    await page.waitForTimeout(12000);
    console.log(
      "首个事件前状态：",
      await page.locator("#time-value").textContent(),
      await page.locator("#session-state").textContent(),
      await page.locator("#pause-title").textContent(),
    );
    await worldClick(3, 254, 254);
    assert.equal(await page.locator("#caught-value").textContent(), "01");
    check("真实时钟首个事件直接举报", "正式模式，没有时间快进或目标提示");
    const interval = setInterval(async () => {
      try {
        console.log(
          `真实考试进行中：剩余 ${await page.locator("#time-value").textContent()}`,
        );
      } catch {
        /* 页面收尾后忽略进度读取。 */
      }
    }, 45000);
    try {
      await page.locator(".results-heading").waitFor({ timeout: 390000 });
    } finally {
      clearInterval(interval);
    }
    const elapsedMs = Date.now() - start;
    assert.ok(
      elapsedMs >= 359000 && elapsedMs < 380000,
      `真实时长异常：${elapsedMs}`,
    );
    const run = await page.evaluate(
      () => JSON.parse(localStorage.getItem("gamex-proctor-v1")).recent[0],
    );
    assert.equal(run.config.debug, false);
    assert.equal(run.config.duration, 7200);
    assert.equal(run.score.caught, 1);
    assert.equal(run.score.missed, 47);
    assert.equal(run.score.false, 0);
    assert.equal(run.score.total, -4600);
    assert.equal(run.pauses.length, 0);
    check(
      "完整真实六分钟正式考试自动结算",
      `${elapsedMs} ms，抓到 1 / 漏查 47 / 误报 0 / 得分 −4600`,
    );
    await shot("realtime-six-minute-results");
  } else {
    await page.goto(`${base}/?debug=1`);
    assert.equal(await page.locator("canvas[data-camera]").count(), 6);
    await page.getByRole("button", { name: "开始巡查", exact: true }).click();
    const choose = async (kind, variant) => {
      await page.getByLabel("动作类型", { exact: true }).selectOption(kind);
      await page
        .getByLabel("动作变体", { exact: true })
        .selectOption(String(variant));
      await page
        .getByRole("button", { name: "固定动作场景", exact: true })
        .click();
      return page.evaluate(
        ({ kind, variant }) => {
          const q = window.__proctor,
            e = q.game.plan.events.find(
              (e) => e.kind === kind && e.variant === variant,
            );
          const head = q
            .geometry(e.scene)
            .ops.find(
              (o) =>
                o.actorId === e.actors[0] &&
                o.shape.kind === "ellipse" &&
                o.shape.rx === 12,
            ).shape;
          return { ...e, head };
        },
        { kind, variant },
      );
    };
    const seek = async (tick) => {
      await page.getByLabel("目标模拟 tick").fill(String(tick));
      await page.getByRole("button", { name: "定位时刻", exact: true }).click();
    };
    const headClick = async (scene, actorId) => {
      const p = await page.evaluate(
        ({ scene, actorId }) =>
          window.__proctor
            .geometry(scene)
            .ops.find(
              (o) =>
                o.actorId === actorId &&
                o.shape.kind === "ellipse" &&
                o.shape.rx === 12,
            ).shape,
        { scene, actorId },
      );
      await worldClick(scene, p.x, p.y);
    };
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(size);
      for (const kind of ["device", "notes", "peeking", "passing", "restroom"])
        for (const variant of [0, 1]) {
          const e = await choose(kind, variant);
          const positions = await page
            .locator(".camera-card")
            .evaluateAll((els) =>
              els.map((el) => {
                const r = el.getBoundingClientRect();
                return { right: r.right, bottom: r.bottom, x: r.x, y: r.y };
              }),
            );
          assert.ok(
            positions.every(
              (r) => r.right <= size.width && r.bottom <= size.height,
            ),
          );
          await shot(`${size.width}-${kind}-${variant}-final`);
          await worldClick(e.scene, e.head.x, e.head.y);
          await worldClick(e.scene, e.head.x, e.head.y);
          assert.equal(await page.locator("#caught-value").textContent(), "01");
          assert.equal(await page.locator("#false-value").textContent(), "00");
        }
      check(
        `${size.width}×${size.height}：五类 × 两变体，六屏直接举报与重复保护`,
      );
    }
    const e = await choose("device", 0);
    await seek(e.start - 1);
    await headClick(e.scene, e.actors[0]);
    assert.equal(await page.locator("#false-value").textContent(), "01");
    assert.match(
      await page.evaluate(() => window.__proctor.game.records.at(-1).reason),
      /过早/,
    );
    await worldClick(e.scene, 590, 320);
    assert.equal(await page.locator("#false-value").textContent(), "01");
    await worldClick((e.scene + 1) % 6, 590, 320);
    assert.equal(await page.locator("#false-value").textContent(), "02");
    check("准备阶段误报与机位独立冷却");
    await choose("device", 0);
    await seek(e.end);
    await headClick(e.scene, e.actors[0]);
    assert.equal(await page.locator("#caught-value").textContent(), "00");
    assert.equal(await page.locator("#false-value").textContent(), "01");
    check("结束边界不再接受有效举报");

    await choose("peeking", 1);
    const overlaps = await page.evaluate(() =>
      window.__proctor.game.plan.events.filter(
        (e) =>
          e.start <= window.__proctor.game.tick &&
          window.__proctor.game.tick < e.end,
      ),
    );
    assert.ok(overlaps.length === 2);
    await page.keyboard.press(String(overlaps[0].scene + 1));
    assert.equal(await page.locator(".featured").count(), 1);
    await headClick(overlaps[1].scene, overlaps[1].actors[0]);
    assert.equal(await page.locator("#caught-value").textContent(), "01");
    const tickBefore = await page.evaluate(() => window.__proctor.game.tick);
    await page.getByRole("button", { name: "继续模拟", exact: true }).click();
    await page.waitForTimeout(600);
    assert.ok(
      (await page.evaluate(() => window.__proctor.game.tick)) > tickBefore,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".featured").count(), 0);
    check("放大后五路缩略图可举报，时钟和动作持续运行，Esc 返回");
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    const pauseTick = await page.evaluate(() => window.__proctor.game.tick);
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(() => window.__proctor.game.tick),
      pauseTick,
    );
    assert.equal(
      await page
        .locator("#camera-grid")
        .evaluate((el) => getComputedStyle(el).visibility),
      "hidden",
    );
    assert.ok(
      await page
        .getByRole("button", { name: "继续巡查", exact: true })
        .isVisible(),
    );
    await shot("pause-opaque");
    await page.getByRole("button", { name: "继续巡查", exact: true }).click();
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await page.evaluate(() => window.__proctor.paused), true);
    const backgroundTick = await page.evaluate(
      () => window.__proctor.game.tick,
    );
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(() => window.__proctor.game.tick),
      backgroundTick,
    );
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    check("暂停完全遮住场景；浏览器后台事件注入后安全暂停且不补时");

    await page.getByRole("button", { name: "返回准备页", exact: true }).click();
    await page.getByRole("button", { name: "新手教学", exact: true }).click();
    for (const [tick, inactive] of [
      [400, 4],
      [1100, 2],
      [1960, 0],
    ]) {
      await seek(tick);
      assert.equal(
        await page.locator(".camera-card.inactive").count(),
        inactive,
      );
    }
    await page.getByRole("button", { name: "走完本局", exact: true }).click();
    assert.match(
      await page.locator(".results-heading").innerText(),
      /教学完成/,
    );
    assert.equal(
      await page.evaluate(() => window.__proctor.store.data.recent.length),
      0,
    );
    await shot("tutorial-complete");
    await page
      .getByRole("button", { name: "开始正式巡查", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => window.__proctor.game.plan.config.difficulty),
      "beginner",
    );
    check("渐进教学 2→4→6 路、教学结算与正式考试入口");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() =>
      window.__proctor.start({
        seed: "morning-01",
        difficulty: "standard",
        debug: true,
      }),
    );
    await page.getByRole("button", { name: "冻结模拟", exact: true }).click();
    const plan = await page.evaluate(() => window.__proctor.game.plan);
    await worldClick(0, 590, 320);
    for (let i = 0; i < plan.events.length; i++) {
      const event = plan.events[i];
      await page.evaluate(
        (tick) => window.__proctor.advanceTo(tick),
        event.start + 1,
      );
      if (i % 3 !== 0) await headClick(event.scene, event.actors[0]);
    }
    await page.getByRole("button", { name: "走完本局", exact: true }).click();
    await page.locator(".results-heading").waitFor();
    const run = await page.evaluate(
      () => window.__proctor.store.data.recent[0],
    );
    assert.equal(run.score.caught, 32);
    assert.equal(run.score.missed, 16);
    assert.equal(run.score.false, 1);
    assert.equal(run.eventCount, 48);
    assert.equal(run.config.duration, 7200);
    assert.equal(await page.locator(".event-row").count(), 49);
    await shot("complete-six-minute-flow");
    const savedBefore = await page.evaluate(() =>
      JSON.stringify(window.__proctor.store.data),
    );
    await page.locator('[data-filter="false"]').click();
    assert.equal(await page.locator(".event-row").count(), 1);
    await page.locator(".event-row").click();
    await page.locator("#review-slider").press("End");
    await page
      .getByRole("button", { name: "播放或暂停复盘", exact: true })
      .click();
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.__proctor.store.data)),
      savedBefore,
    );
    assert.match(
      await page.locator("#review-explanation").textContent(),
      /空白|家具/,
    );
    check("360 秒完整流程：抓到 32、漏查 16、误报 1；真实复盘只读且不修改成绩");
    await page
      .getByRole("button", { name: "同种子再挑战", exact: true })
      .click();
    assert.deepEqual(
      await page.evaluate(() => window.__proctor.game.plan.events),
      plan.events,
    );
    await page.getByRole("button", { name: "走完本局", exact: true }).click();
    await page.getByRole("button", { name: "新种子开始", exact: true }).click();
    assert.notEqual(
      await page.evaluate(() => window.__proctor.game.plan.config.seed),
      "morning-01",
    );
    await page.reload();
    await page.getByRole("button", { name: "最近十局", exact: true }).click();
    assert.equal(await page.locator(".history-row").count(), 2);
    await page.locator(".history-row").first().click();
    assert.ok(await page.locator("#review-canvas").isVisible());
    check("同种子机会一致、新种子重赛、本地记录刷新恢复和历史复盘");
    await page.getByRole("button", { name: "返回准备", exact: true }).click();
    await page.getByRole("button", { name: /常规难度/ }).click();
    await page.locator('[data-difficulty="pressure"]').click();
    await page
      .getByLabel("自定义种子", { exact: false })
      .fill("边界测试-中文种子");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await page.getByRole("button", { name: "开始巡查", exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.__proctor.game.plan.events.length),
      66,
    );
    assert.equal(
      await page.evaluate(() => window.__proctor.game.plan.config.seed),
      "边界测试-中文种子",
    );
    check("高压难度与自定义中文种子可启动");
    await page.setViewportSize({ width: 600, height: 900 });
    assert.equal(
      await page.evaluate(() => window.__proctor.game.plan.config.layout),
      "practice",
    );
    check("窄屏自动独立标记为练习成绩");
  }
  assert.deepEqual(errors, []);
  check("无阻断性控制台错误");
  await writeFile(
    `${artifacts}${capture ? "capture" : realtime ? "realtime" : "browser"}-report.json`,
    JSON.stringify(
      { date: new Date().toISOString(), results, errors },
      null,
      2,
    ),
  );
} catch (error) {
  if (activePage) {
    await activePage
      .screenshot({
        path: `${artifacts}${realtime ? "realtime" : "browser"}-failure.png`,
        fullPage: true,
      })
      .catch(() => {});
    console.error(
      "失败时页面：",
      (
        await activePage
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(-2200),
    );
  }
  throw error;
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
}
