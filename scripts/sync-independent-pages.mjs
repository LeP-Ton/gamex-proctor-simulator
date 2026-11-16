import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 只同步这三个已授权的公开部署仓库，保留远端提交历史，不存储凭据。
const specifications = {
  illustrated: { repo: 'LeP-Ton/gamex-proctor-illustrated', branch: 'codex/illustrated', name: '插画首版' },
  photo: { repo: 'LeP-Ton/gamex-proctor-photo', branch: 'codex/photo', name: '照片版' },
  realistic: { repo: 'LeP-Ton/gamex-proctor-realistic', branch: 'codex/realistic', name: '写实版' },
};
const version = process.argv[2];
const spec = specifications[version];
assert.ok(Object.hasOwn(specifications, version), '参数只允许 illustrated、photo 或 realistic');
const cwd = process.env.PROCTOR_SOURCE_DIRECTORY || fileURLToPath(new URL('..', import.meta.url));
const requestedSource = process.argv[3] || spec.branch;
const sourceRepo = 'LeP-Ton/gamex-proctor-simulator';
const stateDirectory = process.env.PROCTOR_PAGES_STATE_DIRECTORY || path.join(cwd, 'artifacts/independent-pages');
await mkdir(stateDirectory, { recursive: true });
const run = promisify(execFile);
const git = (...args) => execFileSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
const gitText = (...args) => git(...args).toString('utf8');
const sourceHead = gitText('rev-parse', `${requestedSource}^{commit}`).trim();
assert.match(sourceHead, /^[0-9a-f]{40}$/);
assert.equal(gitText('merge-base', '--is-ancestor', sourceHead, spec.branch), '', '提交须属于对应的本地版本分支');
const sourceTree = gitText('rev-parse', `${sourceHead}^{tree}`).trim();
// 先验证照片版部署保护，再访问远端；另外两版继续使用原发布模板。
let photoWorkflow;
if (version === 'photo') {
  photoWorkflow = gitText('show', `${sourceHead}:.github/workflows/pages.yml`);
  assert.ok(photoWorkflow.includes('branches: [codex/photo]'), '照片版工作流须只监听本版本分支');
  assert.match(photoWorkflow, /^  deploy:\r?\n    if: github\.repository == 'LeP-Ton\/gamex-proctor-photo' && github\.ref == 'refs\/heads\/codex\/photo'\r?\n/m, '照片版部署须限定独立仓库和版本分支');
}
const api = async (method, endpoint, body) => {
  if (body === undefined) {
    const result = await run('gh', ['api', '--method', method, endpoint], { cwd, maxBuffer: 16e6 });
    return result.stdout.trim() ? JSON.parse(result.stdout) : null;
  }
  return new Promise((resolve, reject) => {
    const child = execFile('gh', ['api', '--method', method, endpoint, '--input', '-'], { cwd, maxBuffer: 16e6 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${method} ${endpoint}: ${stderr || stdout}`));
      else resolve(stdout.trim() ? JSON.parse(stdout) : null);
    });
    child.stdin.end(JSON.stringify(body));
  });
};
let repository;
try { repository = await api('GET', `repos/${spec.repo}`); }
catch (error) {
  if (!String(error).includes('404')) throw error;
  repository = await api('POST', 'user/repos', {
    name: spec.repo.split('/')[1], private: false, auto_init: true,
    description: `GameX 监考模拟器${spec.name}，独立测试、构建与 GitHub Pages 部署。`,
    homepage: `https://lep-ton.github.io/${spec.repo.split('/')[1]}/`,
  });
}
assert.equal(repository.full_name, spec.repo);
assert.equal(repository.owner.login, 'LeP-Ton');
assert.equal(repository.private, false);
assert.equal(repository.fork, false);
const statePath = path.join(stateDirectory, `${version}-state.json`);
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch { state = { repo: spec.repo, lastRemoteHead: null, blobs: [] }; }
assert.equal(state.repo, spec.repo);
const save = () => writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
let reference;
try { reference = await api('GET', `repos/${spec.repo}/git/ref/heads/${spec.branch}`); }
catch (error) {
  if (!String(error).includes('404')) throw error;
  const initial = await api('GET', `repos/${spec.repo}/git/ref/heads/${repository.default_branch}`);
  reference = await api('POST', `repos/${spec.repo}/git/refs`, { ref: `refs/heads/${spec.branch}`, sha: initial.object.sha });
  state.lastRemoteHead = initial.object.sha;
  await save();
}
assert.equal(reference.object.sha, state.lastRemoteHead, '远端含未纳入本次同步的提交，停止覆盖');
await api('PATCH', `repos/${spec.repo}`, { default_branch: spec.branch });
try { await api('GET', `repos/${spec.repo}/pages`); }
catch (error) {
  if (!String(error).includes('404')) throw error;
  await api('POST', `repos/${spec.repo}/pages`, { build_type: 'workflow' });
}
// 部署环境只允许本仓库该版本分支，不依赖另一站点或原仓库 main。
await api('PUT', `repos/${spec.repo}/environments/github-pages`, { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });
const policies = await api('GET', `repos/${spec.repo}/environments/github-pages/deployment-branch-policies`);
if (!policies.branch_policies.some(item => item.name === spec.branch && item.type === 'branch')) {
  await api('POST', `repos/${spec.repo}/environments/github-pages/deployment-branch-policies`, { name: spec.branch, type: 'branch' });
}

const provenance = { schemaVersion: 1, version, sourceRepository: sourceRepo, sourceBranch: spec.branch, sourceCommit: sourceHead, sourceTree, deploymentRepository: spec.repo, deploymentBranch: spec.branch };
const generatedWorkflow = `name: 独立发布${spec.name}到 Pages

on:
  push:
    branches: [${spec.branch}]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: github-pages
  cancel-in-progress: false

jobs:
  build:
    if: github.repository == '${spec.repo}' && github.ref == 'refs/heads/${spec.branch}'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: "22"
          cache: npm
      - name: 安装锁定依赖
        run: npm ci
      - name: 运行本版本核心测试
        run: npm test
      - name: 构建本版本
        run: npm run build
      - name: 记录源分支与固定提交
        run: cat public/deployment.json >> "$GITHUB_STEP_SUMMARY"
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with:
          path: dist
  deploy:
    if: github.repository == '${spec.repo}' && github.ref == 'refs/heads/${spec.branch}'
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: __PAGE_URL__
    steps:
      - name: 部署本版本独立站点
        id: deployment
        uses: actions/deploy-pages@v5
`.replace('__PAGE_URL__', '$' + '{{ steps.deployment.outputs.page_url }}');
const workflow = photoWorkflow ?? generatedWorkflow;
const overrides = new Map([
 ['.github/workflows/pages.yml', Buffer.from(workflow)],
 ['public/deployment.json', Buffer.from(JSON.stringify(provenance, null, 2) + '\n')],
 ['README.md', Buffer.from(`# GameX · 监考模拟器${spec.name}\n\n本仓库是${spec.name}的独立部署仓库，只测试、构建和发布本版本。\n\n- 试玩：https://lep-ton.github.io/${spec.repo.split('/')[1]}/\n- 权威源码：[${sourceRepo} 的 ${spec.branch} 分支](https://github.com/${sourceRepo}/tree/${spec.branch})。\n- 本次固定源码：\`${sourceHead}\`。\n- 运行时文件与上述源码一致；独立工作流、本文及发布来源说明属于部署适配。\n- 发布来源详见 [deployment.json](public/deployment.json)。源码与需求文档在原仓库维护，本仓库历史提交保留同步记录。\n\nNode.js 20.19+：\`npm ci\`、\`npm test\`、\`npm run build\`。本版本分支推送后自动在独立 \`github-pages\` 环境部署，另一版本不参与构建。\n`)],
 ['AGENTS.md', Buffer.from(`# 独立部署仓库约定\n\n- 这里是 GameX 监考模拟器${spec.name}的发布镜像；权威源码在 https://github.com/${sourceRepo}/tree/${spec.branch} 。\n- 不直接修改游戏实现；在原仓库的对应版本分支开发、验证并更新需求记录，再同步固定提交。\n- 本仓库仅部署自己的版本，不请求原仓库 main，不组合或覆盖另一版本。\n- 来源追溯见 public/deployment.json；部署专用工作流与 README 属于镜像适配。\n- npm ci 安装，npm test 核心测试，npm run build 生产构建；.github/workflows/pages.yml 完成本仓库独立 Pages 发布。\n- 沟通、文档和新增注释使用中文。\n`)],
]);
const entries = gitText('ls-tree', '-r', '-z', sourceHead).split('\0').filter(Boolean).map(line => {
  const at = line.indexOf('\t');
  const [mode, type, sha] = line.slice(0, at).split(' ');
  assert.equal(type, 'blob');
  return { path: line.slice(at + 1), mode, type, sha };
});
const payloads = new Map();
for (const entry of entries) payloads.set(entry.sha, git('cat-file', 'blob', entry.sha));
for (const [file, bytes] of overrides) {
  const sha = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  payloads.set(sha, bytes);
  const prior = entries.find(item => item.path === file);
  if (prior) prior.sha = sha;
  else entries.push({ path: file, mode: '100644', type: 'blob', sha });
}
const needed = [...new Set(entries.map(entry => entry.sha))].filter(sha => !state.blobs.includes(sha));
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < needed.length) {
    const sha = needed[cursor++];
    const uploaded = await api('POST', `repos/${spec.repo}/git/blobs`, { content: payloads.get(sha).toString('base64'), encoding: 'base64' });
    assert.equal(uploaded.sha, sha);
    state.blobs.push(sha);
  }
}));
await save();
const tree = await api('POST', `repos/${spec.repo}/git/trees`, { tree: entries });
const current = await api('GET', `repos/${spec.repo}/git/ref/heads/${spec.branch}`);
assert.equal(current.object.sha, state.lastRemoteHead, '上传期间远端分支变化，停止更新');
const previous = await api('GET', `repos/${spec.repo}/git/commits/${current.object.sha}`);
let deploymentCommit = current.object.sha;
if (previous.tree.sha !== tree.sha) {
  const commit = await api('POST', `repos/${spec.repo}/git/commits`, { tree: tree.sha, parents: [current.object.sha], message: `独立发布${spec.name}，来源 ${sourceRepo}@${sourceHead}` });
  await api('PATCH', `repos/${spec.repo}/git/refs/heads/${spec.branch}`, { sha: commit.sha, force: false });
  deploymentCommit = commit.sha;
  state.lastRemoteHead = commit.sha;
  await save();
}
const pages = await api('GET', `repos/${spec.repo}/pages`);
const result = { ...provenance, deploymentCommit, deploymentTree: tree.sha, pagesUrl: pages.html_url, workflow: '.github/workflows/pages.yml' };
await writeFile(path.join(stateDirectory, `${version}-deployment.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
