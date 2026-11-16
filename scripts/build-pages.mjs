import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const versions = {
  illustrated: {
    name: "插画首版", sourceRepository: "LeP-Ton/gamex-proctor-simulator", sourceBranch: "codex/illustrated",
    deploymentRepository: "LeP-Ton/gamex-proctor-illustrated", url: "https://lep-ton.github.io/gamex-proctor-illustrated/",
    provenanceUrl: "https://lep-ton.github.io/gamex-proctor-illustrated/deployment.json", storageKey: "gamex-proctor-illustrated-v1",
  },
  realistic: {
    name: "写实新版", sourceRepository: "LeP-Ton/gamex-proctor-simulator", sourceBranch: "codex/realistic",
    deploymentRepository: "LeP-Ton/gamex-proctor-realistic", url: "https://lep-ton.github.io/gamex-proctor-realistic/",
    provenanceUrl: "https://lep-ton.github.io/gamex-proctor-realistic/deployment.json", storageKey: "gamex-proctor-v1",
  },
};
function inside(parent, child) {
  const value = path.relative(parent, child);
  return value === "" || (!value.startsWith(`..${path.sep}`) && value !== ".." && !path.isAbsolute(value));
}
async function info(file) {
  try { return await lstat(file); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}
async function regularFile(file) {
  const value = await info(file);
  if (!value?.isFile() || value.isSymbolicLink()) throw new Error(`缺少普通源文件，或源文件为符号链接：${file}`);
  return readFile(file);
}
async function canonical(file) {
  const tail = [];
  let cursor = file;
  while (!(await info(cursor))) { tail.unshift(path.basename(cursor)); cursor = path.dirname(cursor); }
  return path.resolve(await realpath(cursor), ...tail);
}
function validateResources(html) {
  for (const [, reference] of html.matchAll(/<(?:script|link|img|source|video)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const clean = reference.split(/[?#]/, 1)[0];
    if (!["./style.css", "./favicon.svg"].includes(clean)) throw new Error(`选择页资源必须限定在已打包的相对地址：${reference}`);
  }
  for (const version of Object.values(versions)) if (!html.includes(`href="${version.url}"`)) throw new Error(`选择页缺少独立站点入口：${version.url}`);
}
function redirect(version) {
  const target = versions[version];
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${target.name} · 独立站点</title><link rel="icon" href="../favicon.svg"><link rel="stylesheet" href="../style.css"><script>
// 兼容原子目录书签，查询参数与复盘片段完整带到独立站点。
const target = new URL(${JSON.stringify(target.url)});
target.search = location.search;
target.hash = location.hash;
location.replace(target.href);
</script></head><body><main><header class="page-heading"><h1>${target.name}已独立部署</h1><p>正在前往独立试玩站点。</p></header><a class="play" href="${target.url}">继续访问${target.name}</a></main></body></html>\n`;
}

/** main 只生成选择页与旧地址跳转，不检出、测试或打包两个游戏。 */
export async function buildPages(options) {
  const output = path.resolve(options.output);
  const siteDir = path.resolve(options.siteDir ?? path.join(root, "sites"));
  const faviconSource = path.resolve(options.faviconSource ?? path.join(root, "public/favicon.svg"));
  const existing = await info(output);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error("输出必须是普通目录，不能是文件或符号链接。");
  const [actualOutput, actualSite, actualFavicon] = await Promise.all([canonical(output), canonical(siteDir), canonical(faviconSource)]);
  if (path.dirname(actualOutput) === actualOutput) throw new Error("不能把文件系统根目录作为输出目录。");
  if (inside(actualSite, actualOutput) || inside(actualOutput, actualSite) || inside(actualOutput, actualFavicon)) throw new Error("选择页来源、图标与输出目录不能互相包含。");
  const [html, css, favicon] = await Promise.all([
    regularFile(path.join(siteDir, "index.html")), regularFile(path.join(siteDir, "style.css")), regularFile(faviconSource),
  ]);
  validateResources(html.toString("utf8"));
  const manifest = {
    schemaVersion: 2, mode: "independent-sites", portalUrl: "https://lep-ton.github.io/gamex-proctor-simulator/", versions,
    legacyPaths: { "illustrated/": versions.illustrated.url, "realistic/": versions.realistic.url },
  };
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const staged = await mkdtemp(path.join(parent, ".pages-build-"));
  const backup = path.join(parent, `.pages-backup-${randomUUID()}`);
  let backedUp = false;
  try {
    await Promise.all([
      writeFile(path.join(staged, "index.html"), html), writeFile(path.join(staged, "style.css"), css),
      writeFile(path.join(staged, "favicon.svg"), favicon), writeFile(path.join(staged, ".nojekyll"), ""),
      writeFile(path.join(staged, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
    ]);
    for (const version of Object.keys(versions)) { await mkdir(path.join(staged, version)); await writeFile(path.join(staged, version, "index.html"), redirect(version)); }
    if (await info(output)) { await rename(output, backup); backedUp = true; }
    try { await rename(staged, output); }
    catch (error) { if (backedUp) { await rename(backup, output); backedUp = false; } throw error; }
    if (backedUp) await rm(backup, { recursive: true, force: true });
    return manifest;
  } finally { await rm(staged, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--output" || !args[1] || args[1].startsWith("--")) throw new Error("只接受 --output <选择页输出目录>。");
    const manifest = await buildPages({ output: args[1] });
    console.log(`已生成版本选择页：${path.resolve(args[1])}`);
    for (const version of Object.values(manifest.versions)) console.log(`${version.name}独立站点：${version.url}`);
  } catch (error) { console.error(`选择页构建失败：${error.message}`); process.exitCode = 1; }
}
