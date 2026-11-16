import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 此脚本只采集实际页面 Canvas；不重建人物、场景或动作。
const port = 4203;
const base = process.env.PROCTOR_TEST_URL || `http://127.0.0.1:${port}`;
const artifacts =
  process.env.PROCTOR_ARTIFACT_DIR ||
  fileURLToPath(new URL("../artifacts/motion-4/", import.meta.url));
const smoke = process.argv.includes("--smoke");
const storyboardOnly = process.argv.includes("--storyboards");
const errors = [];
const report = {
  date: new Date().toISOString(),
  base,
  recordings: [],
  boundaries: [],
  errors,
};
let browser, server, page;
await mkdir(artifacts, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shot = async (name) => {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
};
const ready = () =>
  page.waitForFunction(
    () => !document.querySelector("#start-button")?.disabled,
  );

// 合成层逐帧复制游戏已渲染的 Canvas，并从 DOM 读取通道名和 OSD。
async function beginRecording(name, scenes) {
  return page.evaluate(
    ({ name, scenes }) => {
      const surfaces = scenes.map((scene) => {
        const canvas = document.querySelector(`canvas[data-camera="${scene}"]`);
        const card = canvas.closest(".camera-card");
        return { scene, canvas, card };
      });
      const single = scenes.length === 1;
      const width = single ? 1280 : 1440;
      const cellW = single ? width : width / 3;
      const cellH = single ? 760 : 310;
      const output = document.createElement("canvas");
      output.width = width;
      output.height = single ? cellH : cellH * 2;
      const ctx = output.getContext("2d");
      const intervals = [],
        snapshots = [];
      let previous,
        raf,
        active = true,
        frames = 0;
      const state = () => {
        const q = window.__proctor;
        const osd = surfaces[0].card.querySelector("time").textContent;
        const clock = osd.match(/09:(\d+):(\d+)/);
        const lower = clock
          ? (Number(clock[1]) * 60 + Number(clock[2])) * 20
          : null;
        return {
          now: performance.now(),
          osd,
          remaining: document.querySelector("#time-value").textContent,
          // 正式入口没有调试接口：只记录 OSD 能证实的 tick 区间，不伪造精确值。
          tick: q?.game.tick ?? null,
          tickRange: lower === null ? null : [lower, lower + 19],
          paused:
            q?.paused ??
            document.querySelector("#board").classList.contains("is-paused"),
        };
      };
      const paint = (now) => {
        if (!active) return;
        if (previous !== undefined) intervals.push(now - previous);
        previous = now;
        ctx.fillStyle = "#182126";
        ctx.fillRect(0, 0, output.width, output.height);
        surfaces.forEach(({ canvas, card }, i) => {
          const x = single ? 0 : (i % 3) * cellW;
          const y = single ? 0 : Math.floor(i / 3) * cellH;
          const header = 26,
            footer = 24;
          const available = cellH - header - footer;
          const scale = Math.min(
            cellW / canvas.width,
            available / canvas.height,
          );
          const dw = canvas.width * scale,
            dh = canvas.height * scale;
          ctx.drawImage(
            canvas,
            x + (cellW - dw) / 2,
            y + header + (available - dh) / 2,
            dw,
            dh,
          );
          ctx.fillStyle = "#d8e1e3";
          ctx.font = "14px sans-serif";
          ctx.fillText(
            card.querySelector(".camera-code").textContent,
            x + 10,
            y + 19,
          );
          ctx.font = "13px monospace";
          ctx.fillText(
            card.querySelector("time").textContent,
            x + 10,
            y + cellH - 8,
          );
          ctx.fillStyle = "#dd7770";
          ctx.fillText("REC", x + cellW - 42, y + 19);
        });
        if (frames % 30 === 0) snapshots.push(state());
        frames++;
        raf = requestAnimationFrame(paint);
      };
      paint(performance.now());
      const stream = output.captureStream(30);
      const mimeType = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("浏览器没有 WebM MediaRecorder 编码器");
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
      });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const start = state();
      recorder.start(1000);
      window.__motionCapture = {
        name,
        output,
        recorder,
        chunks,
        intervals,
        snapshots,
        start,
        state,
        finish: () => {
          active = false;
          cancelAnimationFrame(raf);
          stream.getTracks().forEach((track) => track.stop());
        },
      };
      return {
        name,
        width: output.width,
        height: output.height,
        mimeType,
        start,
      };
    },
    { name, scenes },
  );
}

async function stopRecording() {
  const result = await page.evaluate(async () => {
    const c = window.__motionCapture;
    const end = c.state();
    const blob = await new Promise((resolve) => {
      c.recorder.onstop = () =>
        resolve(new Blob(c.chunks, { type: c.recorder.mimeType }));
      c.recorder.stop();
    });
    const data = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.readAsDataURL(blob);
    });
    const png = c.output.toDataURL("image/png").split(",")[1];
    c.finish();
    const sorted = [...c.intervals].sort((a, b) => a - b);
    const percentile = (n) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * n))];
    return {
      data,
      png,
      name: c.name,
      start: c.start,
      end,
      durationMs: end.now - c.start.now,
      bytes: blob.size,
      mimeType: blob.type,
      raf: {
        frames: sorted.length,
        medianMs: percentile(0.5),
        p95Ms: percentile(0.95),
        maxMs: Math.max(...sorted),
        over100Ms: sorted.filter((n) => n > 100).length,
      },
      snapshots: c.snapshots,
    };
  });
  await writeFile(
    path.join(artifacts, `${result.name}.webm`),
    Buffer.from(result.data, "base64"),
  );
  await writeFile(
    path.join(artifacts, `${result.name}-last.png`),
    Buffer.from(result.png, "base64"),
  );
  delete result.data;
  delete result.png;
  report.recordings.push(result);
  assert.ok(result.bytes > 50_000, "录像没有有效视频正文");
  assert.ok(result.durationMs >= 19_500, "录像未达到真实20秒");
  assert.equal(result.end.paused, false, "录像期间游戏被暂停");
  if (result.start.tick !== null) {
    const ticks = result.end.tick - result.start.tick;
    assert.ok(
      ticks >= 380 && ticks <= 430,
      `真实20秒模拟时钟推进异常：${ticks} ticks`,
    );
  }
  console.log(
    `完成录像：${result.name}，${Math.round(result.durationMs)}ms，${result.bytes}字节，RAF P95 ${result.raf.p95Ms.toFixed(1)}ms`,
  );
}

async function debugStart(target, scene) {
  await page.evaluate(
    ({ target, scene }) => {
      const q = window.__proctor;
      q.start({ seed: "morning-01" });
      q.freeze();
      q.advanceTo(target);
      q.setFocus(scene);
    },
    { target, scene },
  );
  await shot(`focused-scene-${scene}-start`);
}

async function extractStoryboards() {
  report.storyboards = [];
  for (const [name, times] of [
    ["motion-six-screen", [0.1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 19, 19.8]],
    [
      "motion-peeking-event",
      [8.5, 9, 10.3, 10.55, 10.8, 11.4, 13, 14.8, 15.4, 15.6, 16, 17],
    ],
    [
      "motion-public-exchange",
      [0.2, 1.1, 2.6, 4.7, 6.8, 7.2, 9, 11.5, 12.7, 13, 15.2, 18],
    ],
  ]) {
    const data = (
      await readFile(path.join(artifacts, `${name}.webm`))
    ).toString("base64");
    const result = await page.evaluate(
      async ({ data, times }) => {
        const video = document.createElement("video");
        video.muted = true;
        const loaded = new Promise((resolve, reject) => {
          video.onloadeddata = resolve;
          video.onerror = () => reject(new Error("实际WebM视频解码失败"));
        });
        video.src = `data:video/webm;base64,${data}`;
        await loaded;
        const cellW = 480,
          cellH = 315;
        const output = document.createElement("canvas");
        output.width = cellW * 4;
        output.height = cellH * Math.ceil(times.length / 4);
        const ctx = output.getContext("2d");
        ctx.fillStyle = "#10191e";
        ctx.fillRect(0, 0, output.width, output.height);
        for (let i = 0; i < times.length; i++) {
          const time = times[i];
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error(`实际录像${time}秒采帧超时`)),
              5000,
            );
            video.onseeked = () => {
              clearTimeout(timeout);
              resolve();
            };
            video.currentTime = time;
          });
          const x = (i % 4) * cellW,
            y = Math.floor(i / 4) * cellH;
          const scale = Math.min(
            cellW / video.videoWidth,
            (cellH - 24) / video.videoHeight,
          );
          const w = video.videoWidth * scale,
            h = video.videoHeight * scale;
          ctx.drawImage(
            video,
            x + (cellW - w) / 2,
            y + 24 + (cellH - 24 - h) / 2,
            w,
            h,
          );
          ctx.fillStyle = "#e2e9e9";
          ctx.font = "16px monospace";
          ctx.fillText(`实际录像 ${time.toFixed(2)} s`, x + 10, y + 18);
        }
        return {
          png: output.toDataURL("image/png").split(",")[1],
          width: video.videoWidth,
          height: video.videoHeight,
          times,
        };
      },
      { data, times },
    );
    await writeFile(
      path.join(artifacts, `${name}-storyboard.png`),
      Buffer.from(result.png, "base64"),
    );
    delete result.png;
    report.storyboards.push({ name, ...result });
    console.log(`实际录像解码采帧完成：${name}`);
  }
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
        /* 等待本地预览。 */
      }
      if (online) break;
      await wait(100);
    }
    assert.ok(online, "4203生产预览未能启动");
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
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  if (storyboardOnly) {
    await extractStoryboards();
  } else {
    await page.goto(base);
    await ready();
    assert.equal(
      await page.evaluate(() => typeof window.__proctor),
      "undefined",
    );
    report.bundle = await page
      .locator('script[type="module"]')
      .getAttribute("src");
    await page.getByRole("button", { name: "开始巡查", exact: true }).click();
    await shot("motion-initial-six-screen");
    console.log("初始六屏截图已保存");
    if (!smoke) {
      await beginRecording("motion-six-screen", [0, 1, 2, 3, 4, 5]);
      await page.waitForTimeout(20_000);
      await stopRecording();
      await shot("motion-six-screen-end");
    }
    await page.goto(`${base}/?debug=1`);
    await ready();
    await debugStart(0, 3);
    console.log("初始放大截图已保存");
    if (!smoke) {
      await beginRecording("motion-peeking-event", [3]);
      await page.evaluate(() => window.__proctor.unfreeze());
      await page.waitForTimeout(20_000);
      await stopRecording();
      await page.evaluate(() => window.__proctor.freeze());
      await debugStart(800, 5);
      await beginRecording("motion-public-exchange", [5]);
      await page.evaluate(() => window.__proctor.unfreeze());
      await page.waitForTimeout(20_000);
      await stopRecording();
      await page.evaluate(() => window.__proctor.freeze());
      // 边界采样只定位真实游戏时钟；图片仍由正式渲染器绘制。
      for (const boundary of [
        21, 65, 70, 174, 211, 309, 822, 852, 894, 942, 1054, 1104, 1134,
      ]) {
        const scene = boundary < 800 ? 3 : 5;
        const samples = [];
        for (const delta of [-4, -1, 0, 1, 4, 10]) {
          const tick = Math.max(0, boundary + delta);
          await debugStart(tick, scene);
          const heads = await page.evaluate((scene) => {
            const g = window.__proctor.geometry(scene);
            return g.ops
              .filter((op) => op.shape.role === "person")
              .map((op) => ({
                actorId: op.actorId,
                head: op.shape.head,
                frame: op.shape.frame,
                mesh: op.shape.mesh
                  ? { uv: op.shape.mesh.uv, xy: op.shape.mesh.xy }
                  : null,
              }));
          }, scene);
          samples.push({ tick, heads });
          if (delta >= -1 && delta <= 1)
            await shot(`boundary-${boundary}-${tick}`);
        }
        report.boundaries.push({ boundary, scene, samples });
      }
      await extractStoryboards();
    }
  }
  assert.deepEqual(errors, [], "浏览器出现错误");
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack || String(error);
  if (page) await shot("motion-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(
      artifacts,
      storyboardOnly ? "motion-storyboards-report.json" : "motion-report.json",
    ),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  server?.kill();
}
