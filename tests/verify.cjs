#!/usr/bin/env node
"use strict";
// 自检：纯函数、内置扩展能在宿主的包装里编译并激活、补丁能打到官方 0.1.11 上、asar 写出来能读回、注册表哈希一致。
// 用法：node tests/verify.cjs [官方 T3 Code.app]（没有官方 app 时跳过补丁相关检查）
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const pure = require("../host/pure.js");
const { builtins, registry, runtime, readExtension, EXAMPLES, MARKER } = require("../lib/build.cjs");
const { readAsar, findOne, sha256 } = require("../lib/asar.cjs");

// 测试按登记顺序在文件末尾依次执行，支持 async。
let passed = 0;
const queue = [];
function test(name, fn) {
  queue.push([name, fn]);
}

test("plugin.json 校验", () => {
  const ok = { id: "demo", apiVersion: 1, name: "Demo", version: "1.0.0", entries: { web: "web.js" } };
  assert.deepEqual(pure.t3xCheckManifest(ok, { "web.js": "" }).web, ["web.js"]);
  assert.throws(() => pure.t3xCheckManifest({ ...ok, id: "Bad Id" }), /id/);
  assert.throws(() => pure.t3xCheckManifest({ ...ok, apiVersion: 3 }), /apiVersion/);
  pure.t3xCheckManifest({ ...ok, apiVersion: 2 }); // 2 用到设置面板的 Input / Select 和 openSettings
  assert.throws(() => pure.t3xCheckManifest({ ...ok, entries: { web: "../x.js" } }), /路径/);
  assert.throws(() => pure.t3xCheckManifest({ ...ok, entries: { web: ["a.js", "a.js"] } }), /两次/);
  assert.deepEqual(pure.t3xCheckManifest({ ...ok, locales: { en: { name: "Demo", description: "d" } } }, { "web.js": "" }).web, ["web.js"]);
  for (const locales of [[], { en: [] }, { en: { name: "" } }, { en: { name: "x".repeat(61) } }, { en: { name: {} } }, { "../x": {} }]) {
    assert.throws(() => pure.t3xCheckManifest({ ...ok, locales }), /locales/, JSON.stringify(locales));
    assert(pure.t3xLocalesError(locales), JSON.stringify(locales)); // 注册表条目走同一套规则
  }
  assert.throws(() => pure.t3xCheckManifest({ ...ok, assets: Array.from({ length: 64 }, (_, i) => `${i}.png`) }), /超过 64/);
  assert.throws(() => pure.t3xCheckManifest({ ...ok, entries: { web: "/abs.js" } }), /路径/);
  assert.throws(() => pure.t3xCheckManifest(ok, {}), /缺少文件/);
  assert.throws(() => pure.t3xCheckManifest({ ...ok, entries: {} }), /至少/);
  // 显示在设置页的字段类型不对会让整个区块渲染失败
  assert.throws(() => pure.t3xCheckManifest({ ...ok, description: { a: 1 } }), /description/);
  assert.throws(() => pure.t3xCheckManifest({ ...ok, entries: { web: "web.js", styles: "a.css" } }), /styles/);
});

test("注册表校验", () => {
  assert.throws(() => pure.t3xCheckRegistry({ apiVersion: 1 }), /注册表/);
  assert.throws(() => pure.t3xCheckRegistry({ apiVersion: 1, extensions: [{ id: "x1", manifest: "a" }] }), /条目无效/);
  assert.throws(() => pure.t3xCheckRegistry({ apiVersion: 1, extensions: [{ id: "x1", manifest: "a", sha256: { "a": "x" } }] }), /条目无效/);
  assert.throws(() => pure.t3xCheckRegistry({ apiVersion: 1, extensions: [{ id: "x1", name: { a: 1 }, manifest: "a", sha256: {} }] }), /条目无效/);
  const reg = registry();
  pure.t3xCheckRegistry(reg);
  for (const e of reg.extensions) {
    // 示例扩展按本仓库文件核对；内置扩展按地址里那个提交核对（用户下载到的就是它）
    const pin = /\/([0-9a-f]{40})\/plugin\.json$/.exec(e.manifest)?.[1];
    const dir = pin ? path.join(ROOT, "extensions", e.id) : path.join(ROOT, e.manifest.split("/")[1], e.id);
    const bytes = (p) => (pin ? require("node:child_process").execFileSync("git", ["-C", dir, "show", `${pin}:${p}`]) : fs.readFileSync(path.join(dir, p)));
    for (const [p, hash] of Object.entries(e.sha256)) assert.equal(sha256(bytes(p)), hash, `${e.id}/${p}`);
    assert(!Object.keys(e.sha256).some((p) => p.startsWith("local/")), "注册表不能带本机桌宠");
  }
  const onDisk = path.join(ROOT, "registry", "index.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(onDisk, "utf8")), reg, "registry/index.json 过期，运行 node lib/build.cjs");
});

test("推理档位整理", () => {
  const calls = [];
  const traits = { selectValue: () => "high", changeSelect: (d, id) => calls.push(id), changeBoolean: (id, v) => calls.push(v) };
  const choices = () => [{ id: "low", label: "Low" }, { id: "high", label: "High", isDefault: true }, { id: "max", label: "Max" }];
  const m = pure.t3xEffortModel({ control: { kind: "select", descriptor: { id: "effort", label: "Effort" } }, traits }, choices);
  assert.deepEqual([m.activeIndex, m.defaultIndex, m.steps.length], [1, 1, 3]);
  m.select(1); // 当前档不重复提交
  m.select(2);
  const b = pure.t3xEffortModel({ control: { kind: "boolean", descriptor: { id: "thinking", currentValue: true } }, traits, locked: true }, choices);
  assert.deepEqual([b.activeIndex, b.disabled], [1, true]);
  b.select(0);
  assert.deepEqual(calls, ["max", false]);
  assert.equal(pure.t3xEffortModel({ control: { kind: "select", descriptor: {} }, traits }, () => []), null);
});

// 三个内置扩展各自的测试在它们的仓库里（npm test 会一并跑）；这里只管宿主这边并入的本机桌宠素材。
test("本机桌宠素材：定义清洗后变量一个不少", () => {
  const pets = require("../extensions/desk-pets/logic.js"); // 放在这里：没初始化 submodule 时先由前面的测试报出提示
  const dir = path.join(ROOT, "local-pets");
  const ids = fs.existsSync(dir) ? fs.readdirSync(dir).filter((id) => fs.existsSync(path.join(dir, id, "pet.json"))) : [];
  for (const id of ids) {
    const def = JSON.parse(fs.readFileSync(path.join(dir, id, "pet.json"), "utf8"));
    const clean = pets.cleanPet({ ...def, id, sheet: "data:image/webp;base64,AAAA" });
    assert.equal(Object.keys(clean.vars).length, Object.keys(def.vars ?? {}).length, id);
    assert.equal(Object.keys(clean.darkVars).length, Object.keys(def.darkVars ?? {}).length, id);
  }
});

// 宿主用 function(host){"use strict"; …} 包住扩展代码；这里在 vm 里做同样的事，并给最少的 DOM 替身。
function fakeHost(ext, calls) {
  const storage = new Map();
  return {
    id: ext.manifest.id,
    React: { useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect() {}, useReducer: () => [] },
    h: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    register: (slot, c) => calls.push(["register", slot, typeof c]),
    settings: (c) => calls.push(["settings", typeof c, c]),
    storage: { get: (k, f) => (storage.has(k) ? storage.get(k) : f), set: (k, v) => storage.set(k, v), subscribe: () => () => {}, use: (k, f) => f },
    files: { list: () => Object.keys(ext.files), text: (p) => ext.files[p], url: (p) => (ext.files[p]?.startsWith("data:") ? ext.files[p] : null) },
    style: (css) => (calls.push(["style", css.length]), () => {}),
    onDispose() {},
    chat: { last: () => null },
    lang: () => "zh",
    useLang: () => "zh",
    t: (zh) => zh,
  };
}

function makeFakeUi() {
  const mk = (name) => Object.assign(function FakeUiComponent() {}, { uiName: name });
  return {
    Section: mk("Section"),
    Row: mk("Row"),
    Switch: mk("Switch"),
    Button: mk("Button"),
    Input: mk("Input"),
    Select: mk("Select"),
    SelectTrigger: mk("SelectTrigger"),
    SelectValue: mk("SelectValue"),
    SelectPopup: mk("SelectPopup"),
    SelectItem: mk("SelectItem"),
  };
}

function walkTree(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkTree(item, visit);
    return;
  }
  visit(node);
  if (node.props?.control) walkTree(node.props.control, visit);
  if (node.props?.headerAction) walkTree(node.props.headerAction, visit);
  if (node.children) walkTree(node.children, visit);
}

test("内置扩展和示例扩展在宿主包装里编译并激活", () => {
  const list = builtins();
  const ui = makeFakeUi();
  assert.deepEqual(list.map((b) => b.manifest.id), ["edge-glow", "effort-slider", "desk-pets"]);
  for (const ext of [...list, ...EXAMPLES.map((id) => readExtension(path.join(ROOT, "examples", id)))]) {
    const web = pure.t3xCheckManifest(ext.manifest, ext.files).web;
    const code = web.map((p) => ext.files[p]).join("\n;\n");
    const ctx = vm.createContext({
      window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} },
      document: { createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, remove() {} }), body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      setTimeout,
      clearTimeout,
      requestAnimationFrame: () => 0,
      cancelAnimationFrame() {},
      console,
    });
    const run = vm.runInContext(`(function(host){"use strict";\n${code}\n})`, ctx, { filename: `${ext.manifest.id}/web.js` });
    const calls = [];
    const cleanup = run(fakeHost(ext, calls));
    assert(calls.some((c) => c[0] === "register"), `${ext.manifest.id} 没有注册挂载点`);
    const settingsCall = calls.find((c) => c[0] === "settings");
    assert(settingsCall, `${ext.manifest.id} 没有设置面板`);
    // 三个内置扩展的设置面板都能用新版 t3xUi 正常渲染，且不使用原生 <select> 或 checkbox
    if (["edge-glow", "effort-slider", "desk-pets"].includes(ext.manifest.id)) {
      const tree = settingsCall[2]({ ui });
      const used = new Set();
      walkTree(tree, (n) => {
        if (typeof n.type === "string") used.add(n.type);
        else if (n.type?.uiName) used.add(n.type.uiName);
      });
      assert(used.has("Section") && used.has("Row") && used.has("Select"), `${ext.manifest.id} 设置面板应使用 Section/Row/Select`);
      assert(!used.has("select"), `${ext.manifest.id} 设置面板不应使用原生 <select>`);
    }
    if (cleanup) cleanup();
  }
  const deskPetsSettings = fs.readFileSync(path.join(ROOT, "extensions/desk-pets/settings.js"), "utf8");
  assert(!deskPetsSettings.includes("controller.unhide"), "desk-pets/settings.js 不应再调用 controller.unhide()");
});

test("宿主设置页：无嵌套弹窗、对接 openSettings、appearancePatch 暴露完整 t3xUi", () => {
  const settingsSrc = fs.readFileSync(path.join(ROOT, "host/settings.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "host/host.css"), "utf8");
  assert(!settingsSrc.includes("ExtensionSettingsDialog"), "不应保留嵌套设置弹窗组件");
  assert(!cssSrc.includes(".t3x-dialog-backdrop"), "不应保留嵌套设置弹窗样式");
  assert(settingsSrc.includes("takeSettingsRequest("), "设置页应调用 takeSettingsRequest()");
  assert(settingsSrc.includes("subscribeSettingsRequest("), "设置页应订阅 subscribeSettingsRequest()");

  const { appearancePatch } = require("../lib/patch.cjs");
  const patched = appearancePatch.apply("/* dummy */");
  for (const key of ["Section:cn", "Row:nn", "Switch:qt", "Button:p", "Input:h", "Select:Fe", "SelectTrigger:Pe", "SelectValue:je", "SelectPopup:Ne", "SelectItem:Ae"]) {
    assert(patched.includes(key), `appearancePatch 缺少 ${key}`);
  }
});

test("宿主运行时能在 ES 模块里编译", () => {
  const code = runtime();
  assert(code.startsWith(MARKER));
  // 宿主追加在 T3 的模块末尾，依赖模块里的 Z / $ / Jr；这里给替身，只检查语法和顶层不出错。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3x-rt-"));
  try {
    const file = path.join(dir, "rt.mjs");
    fs.writeFileSync(file, `const Z={Component:class{}},$={},Jr=()=>[];\n${code}\nexport {};`);
    const r = require("node:child_process").spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const official = process.argv[2] ?? "/Applications/T3 Code (Beta).app";
const asarFile = path.join(official, "Contents", "Resources", "app.asar");
if (fs.existsSync(asarFile)) {
  test("补丁打到官方 0.1.11，asar 写出后能读回", () => {
    const { patchArchive, patchesFor } = require("../install.cjs");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3x-asar-"));
    try {
      const out = path.join(dir, "app.asar");
      const headerHash = patchArchive(asarFile, patchesFor(true), out);
      const before = readAsar(asarFile);
      const after = readAsar(out);
      assert.equal(sha256(after.headerJson), headerHash);
      assert.deepEqual([...after.files.keys()], [...before.files.keys()]);
      for (const p of patchesFor(true)) {
        const key = findOne(after, p.targetRegex, p.label);
        const bytes = after.read(key);
        assert(bytes.toString("utf8").includes(p.marker), `${key} 缺少标记`);
        assert.equal(after.files.get(key).integrity.hash, sha256(bytes), `${key} integrity`);
      }
      let same = 0;
      for (const key of [...before.files.keys()].filter((_, i) => i % 50 === 0)) {
        if (patchesFor(true).some((p) => p.targetRegex.test(key))) continue;
        assert(before.read(key).equals(after.read(key)), key);
        same += 1;
      }
      assert(same > 10);
      // host.contextMenu 动态引入 T3 自己的右键菜单模块：文件要在 _chat 同目录，导出名 r 是 show(items, position)
      const menuName = /CONTEXT_MENU_MODULE = "\.\/([\w.-]+)"/.exec(fs.readFileSync(path.join(__dirname, "..", "host", "core.js"), "utf8"))[1];
      const menu = before.read(`apps/server/dist/client/assets/${menuName}`).toString("utf8");
      assert(menu.includes("export{c as n,u as r,l as t}") && /function u\(n,r\)\{return l\(\),new Promise/.test(menu), "右键菜单模块的导出变了");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
} else {
  console.log(`- 跳过补丁检查：没有 ${asarFile}`);
}

test("版本比较、作用域键、按作用域启用", () => {
  assert.equal(pure.t3xNewer("1.10.0", "1.9.9"), true);
  assert.equal(pure.t3xNewer("1.0.0", "1.0.0"), false);
  assert.equal(pure.t3xNewer("0.9.0", "1.0.0"), false);
  assert.equal(pure.t3xScopeKeys({ search: {} }), null);
  assert.deepEqual(pure.t3xScopeKeys({ search: { machine: "m1" } }), ["env:m1"]);
  const members = [{ environmentId: "m1", projectId: "p1" }, { environmentId: "m2", id: "p2" }, { environmentId: "m1", projectId: "p1" }];
  assert.deepEqual(pure.t3xScopeKeys({ search: { project: "k" }, scope: { members } }), ["proj:m1:p1", "proj:m2:p2"]);
  const scoped = { "env:m1": false, "proj:m1:p1": true };
  assert.equal(pure.t3xEnabledAt(true, scoped, { environmentId: "m1", projectId: "p1" }), true); // 项目优先
  assert.equal(pure.t3xEnabledAt(true, scoped, { environmentId: "m1", projectId: "p9" }), false); // 其次环境
  assert.equal(pure.t3xEnabledAt(true, scoped, { environmentId: "m2", projectId: "p2" }), true); // 最后全局
  assert.equal(pure.t3xEnabledAt(false, {}, null), false);
});

test("GitHub 仓库地址解析", () => {
  assert.deepEqual(pure.t3xParseGithub("https://github.com/a-b/c.d.git"), { owner: "a-b", repo: "c.d", ref: null, path: "" });
  assert.deepEqual(pure.t3xParseGithub("https://github.com/a/b/tree/v1.0/pkg/ext"), { owner: "a", repo: "b", ref: "v1.0", path: "pkg/ext" });
  for (const bad of ["http://github.com/a/b", "https://gitlab.com/a/b", "https://github.com/a/b/blob/main/x", "https://github.com/-a/b", "https://github.com/a", "not a url", "https://github.com/a/b/tree/%E0%A4%A"]) {
    assert.equal(pure.t3xParseGithub(bad), null, bad);
  }
  assert.equal(pure.t3xRawUrl({ owner: "a", repo: "b", path: "pkg" }, "f".repeat(40), "plugin.json"), `https://raw.githubusercontent.com/a/b/${"f".repeat(40)}/pkg/plugin.json`);
});

test("GitHub 来源：ref 限制、仓库 ID、限流提示（模拟网络）", async () => {
  const src = ["pure.js", "install.js", "github.js"].map((f) => fs.readFileSync(path.join(__dirname, "..", "host", f), "utf8").split("// @node-only")[0]).join("\n");
  let repoId = 7;
  let fail = null;
  const resp = (status, body, headers = {}) => ({
    ok: status < 400, status, url: "", headers: new Headers(headers),
    body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body))); c.close(); } }),
  });
  const fetch = async (u, opt) => {
    const url = String(u);
    if (fail) return resp(fail.status, {}, fail.headers);
    if (/\/repos\/ow\/re$/i.test(url)) return resp(200, { id: repoId, full_name: "Ow/Re" });
    if (url.endsWith("/releases/latest")) return resp(404, {});
    if (url.includes("/commits/")) return resp(200, opt.headers.Accept === "application/vnd.github.sha" ? `${"a".repeat(40)}\n` : "{}");
    if (url.endsWith("plugin.json")) return resp(200, { id: "demo", apiVersion: 1, name: "D", version: "1.0.0", entries: { web: "web.js" } });
    if (url.endsWith("web.js")) return resp(200, "1");
    throw new TypeError("offline");
  };
  const ctx = vm.createContext({ fetch, Headers, ReadableStream, TextDecoder, TextEncoder, URL, Date, crypto, console });
  vm.runInContext(`${src}\nthis.api = { resolveGithub, fetchGithubExtension, checkGithubUpdate, sourceKey };`, ctx);
  const { api } = ctx;
  const t = { owner: "ow", repo: "re", ref: null, path: "" };
  const item = await api.fetchGithubExtension(t);
  assert.equal(item.source.repoId, 7);
  assert.equal(item.source.url, "https://github.com/Ow/Re"); // 用 GitHub 返回的规范名字
  for (const ref of ["deadbeef1", "refs/pull/5/head", "main~1"]) await assert.rejects(api.resolveGithub({ ...t, ref }), /不带 \//, ref);
  await assert.rejects(api.resolveGithub({ ...t, repoId: 8 }), /不是原来那个仓库/);
  assert.equal(await api.checkGithubUpdate(item.source), null);
  await assert.rejects(api.checkGithubUpdate({ ...item.source, repoId: undefined }), /没有记录仓库身份/);
  repoId = 8;
  await assert.rejects(api.checkGithubUpdate(item.source), /不是原来那个仓库/);
  assert.equal(api.sourceKey({ kind: "zip", file: "a.zip" }), null);
  fail = { status: 403, headers: { "x-ratelimit-remaining": "15", "retry-after": "90" } };
  await assert.rejects(api.resolveGithub(t), /约 2 分钟后恢复/);
  fail = { status: 403, headers: { "x-ratelimit-remaining": "15" } };
  await assert.rejects(api.resolveGithub(t), /拒绝/);
});

test("zip 解包：存储和 deflate、外壳目录、大小上限", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3x-zip-"));
  try {
    const ext = path.join(dir, "my-ext");
    fs.mkdirSync(ext);
    fs.writeFileSync(path.join(ext, "plugin.json"), '{"id":"demo"}');
    fs.writeFileSync(path.join(ext, "web.js"), "x".repeat(5000)); // 能压缩，走 deflate
    const zip = (name, args) => {
      const r = require("node:child_process").spawnSync("zip", ["-q", "-r", ...args, path.join(dir, name), "my-ext"], { cwd: dir });
      assert.equal(r.status, 0, String(r.stderr));
      return new Uint8Array(fs.readFileSync(path.join(dir, name)));
    };
    for (const [name, args] of [["deflate.zip", []], ["store.zip", ["-0"]]]) {
      const files = await pure.t3xUnzip(zip(name, args));
      assert.deepEqual([...files.keys()].sort(), ["plugin.json", "web.js"], name); // 去掉了外壳目录 my-ext/
      assert.equal(new TextDecoder().decode(files.get("plugin.json")), '{"id":"demo"}');
      assert.equal(files.get("web.js").length, 5000);
    }
    await assert.rejects(pure.t3xUnzip(zip("big.zip", []), { maxFile: 1000 }), /上限/);
    await assert.rejects(pure.t3xUnzip(new Uint8Array(100)), /目录区/);
    const broken = zip("broken.zip", ["-0"]);
    const at = Buffer.from(broken).indexOf("xxxxxxxx");
    broken[at] = 0x79; // 存储模式里改一个字节：仍能解出，但校验和不符
    await assert.rejects(pure.t3xUnzip(broken), /校验和/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

(async () => {
  for (const [name, fn] of queue) {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  }
  console.log(`\n全部通过（${passed} 项）`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
