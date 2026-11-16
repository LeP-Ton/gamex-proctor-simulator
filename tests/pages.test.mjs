import test from "node:test";
import assert from "node:assert/strict";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { buildPages } from "../scripts/build-pages.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "proctor-portal-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const siteDir = path.join(directory, "source");
  await mkdir(siteDir);
  await copyFile(new URL("../sites/index.html", import.meta.url), path.join(siteDir, "index.html"));
  await copyFile(new URL("../sites/style.css", import.meta.url), path.join(siteDir, "style.css"));
  const faviconSource = path.join(directory, "favicon.svg");
  await writeFile(faviconSource, '<svg xmlns="http://www.w3.org/2000/svg"><title>版本选择页</title></svg>');
  return { output: path.join(directory, "output"), siteDir, faviconSource, directory };
}
function runRedirect(html, search, hash = "#复盘片段") {
  let result;
  const location = { href: `https://example.test/old/${search}${hash}`, search, hash, replace(value) { result = value; } };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { location, URL, URLSearchParams });
  return result;
}

test("只发布选择页与独立站点清单，不需要游戏构建或固定游戏提交", async t => {
  const options = await fixture(t);
  const manifest = await buildPages(options);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.mode, "independent-sites");
  assert.deepEqual(JSON.parse(await readFile(path.join(options.output, "manifest.json"), "utf8")), manifest);
  const html = await readFile(path.join(options.output, "index.html"), "utf8");
  for (const version of ["illustrated", "realistic"]) {
    const entry = manifest.versions[version];
    assert.equal(entry.sourceRepository, "LeP-Ton/gamex-proctor-simulator");
    assert.equal(entry.sourceBranch, `codex/${version}`);
    assert.equal(entry.deploymentRepository, `LeP-Ton/gamex-proctor-${version}`);
    assert.equal(entry.url, `https://lep-ton.github.io/gamex-proctor-${version}/`);
    assert.equal(entry.provenanceUrl, `${entry.url}deployment.json`);
    assert.equal(entry.sourceCommit, undefined, "选择页不固化或虚构独立站点的当前提交");
    assert.ok(html.includes(`href="${entry.url}"`));
  }
  assert.notEqual(manifest.versions.illustrated.deploymentRepository, manifest.versions.realistic.deploymentRepository);
  assert.notEqual(manifest.versions.illustrated.storageKey, manifest.versions.realistic.storageKey);
  await access(path.join(options.output, ".nojekyll"));
  assert.equal(await readFile(path.join(options.output, "style.css"), "utf8"), await readFile(path.join(options.siteDir, "style.css"), "utf8"));
  assert.equal(await readFile(path.join(options.output, "favicon.svg"), "utf8"), await readFile(options.faviconSource, "utf8"));
  await assert.rejects(access(path.join(options.output, "realistic/assets")), { code: "ENOENT" });
  await assert.rejects(access(path.join(options.output, "illustrated/assets")), { code: "ENOENT" });
});

test("旧根查询和两子目录书签转独立站点，完整保留查询与片段", async t => {
  const options = await fixture(t);
  const manifest = await buildPages(options);
  const root = await readFile(path.join(options.output, "index.html"), "utf8");
  for (const query of ["?v=motion-4", "?debug=1&seed=%E8%80%83%E5%9C%BA", "?v=rig-5&debug=1&x=a%26b"]) {
    assert.equal(runRedirect(root, query), new URL(`${manifest.versions.realistic.url}${query}#复盘片段`).href);
  }
  assert.equal(runRedirect(root, ""), undefined);
  assert.equal(runRedirect(root, "?from=bookmark"), undefined);
  for (const version of ["illustrated", "realistic"]) {
    const html = await readFile(path.join(options.output, version, "index.html"), "utf8");
    for (const query of ["", "?debug=1", "?v=photo-3&seed=%E4%B8%AD%E6%96%87"]) assert.equal(runRedirect(html, query), new URL(`${manifest.versions[version].url}${query}#复盘片段`).href);
    assert.ok(html.includes(`href="${manifest.versions[version].url}"`), "禁用脚本时仍有明确的继续访问链接");
  }
});

test("缺少选择页资源或存在越界资源时，保留已有完整输出", async t => {
  const options = await fixture(t);
  await buildPages(options);
  const previous = await readFile(path.join(options.output, "manifest.json"), "utf8");
  await writeFile(path.join(options.output, "保留.txt"), "上一份完整产物");
  await rm(path.join(options.siteDir, "style.css"));
  await assert.rejects(buildPages(options), /普通源文件/);
  assert.equal(await readFile(path.join(options.output, "保留.txt"), "utf8"), "上一份完整产物");
  await writeFile(path.join(options.siteDir, "style.css"), "body{color:#123}");
  const html = await readFile(path.join(options.siteDir, "index.html"), "utf8");
  await writeFile(path.join(options.siteDir, "index.html"), html.replace("./style.css", "../private.css"));
  await assert.rejects(buildPages(options), /限定.*相对地址/);
  assert.equal(await readFile(path.join(options.output, "manifest.json"), "utf8"), previous);
  await writeFile(path.join(options.siteDir, "index.html"), html);
  await buildPages(options);
  await assert.rejects(access(path.join(options.output, "保留.txt")), { code: "ENOENT" });
});

test("拒绝覆盖源目录、根目录及符号链接输出，防止路径别名绕过边界", async t => {
  const options = await fixture(t);
  for (const output of [path.parse(options.directory).root, options.siteDir, path.join(options.siteDir, "dist"), options.directory]) await assert.rejects(buildPages({ ...options, output }), /根目录|不能互相包含/);
  const alias = path.join(options.directory, "alias");
  await symlink(options.siteDir, alias, "dir");
  await assert.rejects(buildPages({ ...options, output: path.join(alias, "nested") }), /不能互相包含/);
  const outputLink = path.join(options.directory, "output-link");
  await symlink(options.siteDir, outputLink, "dir");
  await assert.rejects(buildPages({ ...options, output: outputLink }), /不能是文件或符号链接/);
  assert.ok((await readFile(path.join(options.siteDir, "index.html"), "utf8")).includes("监考模拟器"));
});
