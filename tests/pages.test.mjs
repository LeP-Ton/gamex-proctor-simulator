import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { buildPages } from "../scripts/build-pages.mjs";

const illustratedSha = "1".repeat(40), realisticSha = "2".repeat(40);

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "proctor-pages-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const illustratedDist = path.join(root, "illustrated-dist"), realisticDist = path.join(root, "realistic-dist");
  for (const [directory, text] of [[illustratedDist, "插画首版"], [realisticDist, "写实新版"]]) {
    await mkdir(path.join(directory, "assets"), { recursive: true });
    await writeFile(path.join(directory, "index.html"), `<title>${text}</title><link href="./assets/app.css" rel="stylesheet"><script type="module" src="./assets/app.js"></script>`);
    await writeFile(path.join(directory, "assets/app.js"), `document.title=${JSON.stringify(text)};`);
    await writeFile(path.join(directory, "assets/app.css"), "body{color:#123}");
    await writeFile(path.join(directory, "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg"><title>${text}</title></svg>`);
  }
  return { illustratedDist, realisticDist, output: path.join(root, "site"), illustratedSha, realisticSha };
}

test("双版本完整组装、源目录独立，清单准确标记各自分支与固定提交", async t => {
  const options = await fixture(t);
  const manifest = await buildPages(options);
  for (const version of ["illustrated", "realistic"]) {
    const source = options[`${version}Dist`];
    for (const file of ["index.html", "assets/app.js", "assets/app.css", "favicon.svg"])
      assert.equal(await readFile(path.join(options.output, version, file), "utf8"), await readFile(path.join(source, file), "utf8"));
    assert.equal(manifest.versions[version].branch, `codex/${version}`);
    assert.equal(manifest.versions[version].commit, options[`${version}Sha`]);
    assert.equal(manifest.versions[version].path, `${version}/`);
    assert.equal(manifest.versions[version].storageKey, version === "illustrated" ? "gamex-proctor-illustrated-v1" : "gamex-proctor-v1");
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(options.output, "manifest.json"), "utf8")), manifest);
  await access(path.join(options.output, ".nojekyll"));
  const portal = await readFile(path.join(options.output, "index.html"), "utf8");
  assert.match(portal, /href="\.\/illustrated\/"/);
  assert.match(portal, /href="\.\/realistic\/"/);
  assert.match(portal, /href="\.\/style\.css"/);
  await access(path.join(options.output, "style.css"));
  assert.match(portal, /href="\.\/favicon\.svg"/);
  assert.equal(await readFile(path.join(options.output, "favicon.svg"), "utf8"), await readFile(path.join(options.realisticDist, "favicon.svg"), "utf8"));
});

test("任一版缺失或地址不适用于子路径时，保留已有完整输出", async t => {
  const options = await fixture(t);
  await buildPages(options);
  const previous = await readFile(path.join(options.output, "manifest.json"), "utf8");
  await writeFile(path.join(options.output, "保留.txt"), "仍是上一份发布");
  await rm(path.join(options.realisticDist, "index.html"));
  await assert.rejects(buildPages(options), /写实新版.*index\.html/);
  assert.equal(await readFile(path.join(options.output, "manifest.json"), "utf8"), previous);
  assert.equal(await readFile(path.join(options.output, "保留.txt"), "utf8"), "仍是上一份发布");
  await writeFile(path.join(options.realisticDist, "index.html"), '<script src="/assets/app.js"></script>');
  await assert.rejects(buildPages(options), /相对地址/);
  assert.equal(await readFile(path.join(options.output, "保留.txt"), "utf8"), "仍是上一份发布");
});

test("拒绝未锁定分支名和越出版本目录的资源，正常重建一次替换两版", async t => {
  const options = await fixture(t);
  await assert.rejects(buildPages({ ...options, illustratedSha: "codex/illustrated" }), /完整提交 SHA/);
  await buildPages(options);
  await writeFile(path.join(options.output, "旧文件.txt"), "应在成功重建后移除");
  await writeFile(path.join(options.illustratedDist, "index.html"), '<script src="../other.js"></script>');
  await assert.rejects(buildPages(options), /越出/);
  await access(path.join(options.output, "旧文件.txt"));
  await writeFile(path.join(options.illustratedDist, "index.html"), '<script src="./assets/app.js"></script>');
  await buildPages({ ...options, realisticSha: "3".repeat(40) });
  await assert.rejects(access(path.join(options.output, "旧文件.txt")), { code: "ENOENT" });
  assert.equal(JSON.parse(await readFile(path.join(options.output, "manifest.json"))).versions.realistic.commit, "3".repeat(40));
});

test("旧根目录书签跳写实版并完整保留查询与片段，普通首页停留选择页", async () => {
  const html = await readFile(new URL("../sites/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const search of ["?v=motion-4", "?debug=1&seed=%E8%80%83%E5%9C%BA", "?v=photo-3&debug=1"]) {
    let result;
    const location = { href: `https://example.test/repo/${search}#复盘`, search, hash: "#复盘", replace(url) { result = url; } };
    vm.runInNewContext(script, { location, URL, URLSearchParams });
    const expected = new URL(`https://example.test/repo/realistic/${search}#复盘`).href;
    assert.equal(result, expected);
  }
  let replaced = false;
  vm.runInNewContext(script, { location: { href: "https://example.test/repo/", search: "", hash: "", replace() { replaced = true; } }, URL, URLSearchParams });
  assert.equal(replaced, false);
});
