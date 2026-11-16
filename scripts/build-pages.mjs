import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const defaultSite = fileURLToPath(new URL("../sites/", import.meta.url));
const branches = { illustrated: "codex/illustrated", realistic: "codex/realistic" };
const names = { illustrated: "插画首版", realistic: "写实新版" };
const storageKeys = { illustrated: "gamex-proctor-illustrated-v1", realistic: "gamex-proctor-v1" };

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function rejectSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`构建产物不能包含符号链接：${file}`);
    if (entry.isDirectory()) await rejectSymlinks(file);
  }
}

async function validateDist(directory, label) {
  let html;
  try { html = await readFile(path.join(directory, "index.html"), "utf8"); }
  catch { throw new Error(`${label}构建目录缺少可读取的 index.html：${directory}`); }
  await rejectSymlinks(directory);
  // 两个应用将位于子路径；根路径资源会误取选择页或另一版本的文件。
  const resources = [...html.matchAll(/<(?:script|link|img|source|video)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)];
  for (const [, reference] of resources) {
    if (reference.startsWith("/")) throw new Error(`${label}资源必须使用相对地址：${reference}`);
    if (/^(?:https?:|data:|blob:|#)/i.test(reference)) continue;
    if (/^[a-z][a-z\d+.-]*:/i.test(reference)) throw new Error(`${label}不支持此资源地址：${reference}`);
    const clean = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
    if (!clean) continue;
    const file = path.resolve(directory, clean);
    if (!inside(directory, file)) throw new Error(`${label}资源越出本版本目录：${reference}`);
    let info;
    try { info = await stat(file); } catch { throw new Error(`${label}缺少实际资源：${reference}`); }
    if (!info.isFile()) throw new Error(`${label}资源不是文件：${reference}`);
  }
}

/** 只有两版都验证并完整组装后才替换输出目录，失败不破坏已生成站点。 */
export async function buildPages(options) {
  const output = path.resolve(options.output);
  const siteDir = path.resolve(options.siteDir ?? defaultSite);
  const versions = {
    illustrated: { directory: path.resolve(options.illustratedDist), commit: options.illustratedSha },
    realistic: { directory: path.resolve(options.realisticDist), commit: options.realisticSha },
  };
  if (path.dirname(output) === output) throw new Error("不能把文件系统根目录作为输出目录。");
  for (const [version, source] of Object.entries(versions)) {
    if (!/^[a-f\d]{40}$/i.test(source.commit ?? "")) throw new Error(`${names[version]}必须传入已锁定的完整提交 SHA。`);
    source.commit = source.commit.toLowerCase();
    if (inside(source.directory, output) || inside(output, source.directory)) throw new Error("构建来源和输出目录不能互相包含。");
    await validateDist(source.directory, names[version]);
  }
  if (inside(siteDir, output) || inside(output, siteDir)) throw new Error("选择页来源和输出目录不能互相包含。");
  await readFile(path.join(siteDir, "index.html"), "utf8");
  await readFile(path.join(siteDir, "style.css"), "utf8");
  const favicons = [versions.realistic.directory, versions.illustrated.directory].map(directory => path.join(directory, "favicon.svg"));
  let favicon;
  for (const file of favicons) if (await exists(file)) { favicon = file; break; }
  if (!favicon) throw new Error("两版构建产物均缺少 favicon.svg。");

  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const staged = await mkdtemp(path.join(parent, ".pages-build-"));
  const backup = path.join(parent, `.pages-backup-${randomUUID()}`);
  let backedUp = false;
  try {
    for (const [version, source] of Object.entries(versions)) {
      await cp(source.directory, path.join(staged, version), { recursive: true });
    }
    await cp(path.join(siteDir, "index.html"), path.join(staged, "index.html"));
    await cp(path.join(siteDir, "style.css"), path.join(staged, "style.css"));
    await cp(favicon, path.join(staged, "favicon.svg"));
    if (await exists(path.join(siteDir, "assets"))) await cp(path.join(siteDir, "assets"), path.join(staged, "assets"), { recursive: true });
    const manifest = {
      schemaVersion: 1,
      versions: Object.fromEntries(Object.entries(versions).map(([version, source]) => [version, {
        name: names[version], branch: branches[version], commit: source.commit, path: `${version}/`, storageKey: storageKeys[version],
      }])),
    };
    await writeFile(path.join(staged, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(staged, ".nojekyll"), "");
    if (await exists(output)) { await rename(output, backup); backedUp = true; }
    try { await rename(staged, output); }
    catch (error) {
      if (backedUp) { await rename(backup, output); backedUp = false; }
      throw error;
    }
    if (backedUp) await rm(backup, { recursive: true, force: true });
    return manifest;
  } finally { await rm(staged, { recursive: true, force: true }); }
}

function argumentsFromCLI(args) {
  const known = new Map([
    ["--illustrated-dist", "illustratedDist"], ["--realistic-dist", "realisticDist"],
    ["--output", "output"], ["--illustrated-sha", "illustratedSha"], ["--realistic-sha", "realisticSha"],
  ]);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = known.get(args[i]);
    if (!key || !args[i + 1] || args[i + 1].startsWith("--") || values[key]) throw new Error(`无效或重复参数：${args[i]}`);
    values[key] = args[i + 1];
  }
  if ([...known.values()].some(key => !values[key])) throw new Error("须提供 --illustrated-dist、--realistic-dist、--output、--illustrated-sha、--realistic-sha。");
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = argumentsFromCLI(process.argv.slice(2));
    const manifest = await buildPages(options);
    console.log(`已生成双版本 Pages：${path.resolve(options.output)}`);
    for (const item of Object.values(manifest.versions)) console.log(`${item.name}：${item.branch} @ ${item.commit}`);
  } catch (error) { console.error(`Pages 组装失败：${error.message}`); process.exitCode = 1; }
}
