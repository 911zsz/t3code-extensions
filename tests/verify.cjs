#!/usr/bin/env node
"use strict";
// 自检：纯函数、示例扩展能在宿主的包装里编译并激活、补丁能打到官方 T3 Code（版本见 lib/patch.cjs 的 T3_VERSION）上、asar 写出来能读回、注册表哈希一致。
// 用法：node tests/verify.cjs [官方 T3 Code.app]（没有官方 app 时跳过补丁相关检查）
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const pure = require("../host/pure.js");
const { registry, runtime, readExtension, EXAMPLES, MARKER } = require("../lib/build.cjs");
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
  for (const apiVersion of [0, 7, 2.5, "2"]) assert.throws(() => pure.t3xCheckManifest({ ...ok, apiVersion }), /apiVersion/, String(apiVersion));
  for (const apiVersion of [2, 3, 4, 5, 6]) pure.t3xCheckManifest({ ...ok, apiVersion }, { "web.js": "" }); // 2 加了 Input / Select、openSettings、contextMenu；3 加了 dom、confirm；4 加了后台扩展；5 加了 agent、outputs；6 加了 server.call、t3x.handle / lang
  // agent 权限只有 apiVersion 5 起的宿主认识：旧版本声明了也拒绝，免得旧宿主装上后没有 host.agent
  assert.throws(() => pure.t3xCheckManifest({ ...ok, apiVersion: 4, permissions: ["ui", "agent"] }, { "web.js": "" }), /apiVersion 5/);
  pure.t3xCheckManifest({ ...ok, apiVersion: 5, permissions: ["ui", "agent"] }, { "web.js": "" });
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
  assert.deepEqual(reg.extensions.map((e) => e.id), ["hello-badge"]);
  for (const e of reg.extensions) {
    const dir = path.join(ROOT, "registry", path.dirname(e.manifest));
    for (const [p, hash] of Object.entries(e.sha256)) assert.equal(sha256(fs.readFileSync(path.join(dir, p))), hash, `${e.id}/${p}`);
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

test("示例扩展在宿主包装里编译并激活", () => {
  for (const ext of EXAMPLES.map((id) => readExtension(path.join(ROOT, "examples", id)))) {
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
    if (cleanup) cleanup();
  }
});

test("宿主设置页：无嵌套弹窗、对接 openSettings、appearancePatch 暴露完整 t3xUi", () => {
  const SETTINGS_FILES = ["settings.js", "settings-installed.js", "settings-browse.js"];
  const settingsSrc = SETTINGS_FILES.map((f) => fs.readFileSync(path.join(ROOT, "host", f), "utf8")).join("\n");
  const cssSrc = fs.readFileSync(path.join(ROOT, "host/host.css"), "utf8");
  assert(!settingsSrc.includes("ExtensionSettingsDialog"), "不应保留嵌套设置弹窗组件");
  assert(!cssSrc.includes(".t3x-dialog-backdrop"), "不应保留嵌套设置弹窗样式");
  assert(settingsSrc.includes("takeSettingsRequest("), "设置页应调用 takeSettingsRequest()");
  assert(settingsSrc.includes("subscribeSettingsRequest("), "设置页应订阅 subscribeSettingsRequest()");
  assert(!/window\.(confirm|alert|prompt)\(/.test(settingsSrc), "设置页的确认框要用 T3 自己的（showConfirm），不用浏览器原生弹窗");

  const { appearancePatch } = require("../lib/patch.cjs");
  const patched = appearancePatch.apply("/* dummy */");
  for (const key of ["Section:me", "Row:X", "Switch:re", "Button:_", "Input:d", "Select:be", "SelectTrigger:ye", "SelectValue:ge", "SelectPopup:ve", "SelectItem:he",
    "InputGroup:wt", "InputGroupAddon:St", "InputGroupInput:Ct", "Alert:ft", "AlertDescription:dt", "AlertAction:t3xAlertAction", "toast:ct", "Badge:t3xBadge", "Skeleton:t3xSkeleton",
    "Empty:t3xEmpty", "EmptyHeader:t3xEmptyHeader", "EmptyTitle:t3xEmptyTitle", "EmptyDescription:t3xEmptyDescription", "EmptyContent:t3xEmptyContent"]) {
    assert(patched.includes(key), `appearancePatch 缺少 ${key}`);
  }
  const uiKeys = new Set(/const t3xUi=\{([^}]*)\}/.exec(patched)[1].split(",").map((s) => s.split(":")[0]));
  const hostSrc = ["community.js", ...SETTINGS_FILES].map((f) => fs.readFileSync(path.join(ROOT, "host", f), "utf8")).join("\n");
  for (const [, k] of hostSrc.matchAll(/\bui\.(\w+)/g)) assert(uiKeys.has(k), `宿主用了 ui.${k}，t3xUi 里没有`);
});

test("宿主运行时能在 ES 模块里编译", () => {
  const code = runtime();
  assert(code.startsWith(MARKER));
  // 宿主追加在 T3 的模块末尾，依赖模块里的 Z / $ / Fn；这里给替身，只检查语法和顶层不出错。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3x-rt-"));
  try {
    const file = path.join(dir, "rt.mjs");
    fs.writeFileSync(file, `const Z={Component:class{}},$={},Fn=()=>[];\n${code}\nexport {};`);
    const r = require("node:child_process").spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// appearancePatch 补导入的组件各自的 data-slot（作用域 hook 没有，靠导出名核对）
const ADDED_SLOTS = {
  t3xBadge: "badge", t3xSkeleton: "skeleton", t3xAlertAction: "alert-action", t3xEmpty: "empty",
  t3xEmptyHeader: "empty-header", t3xEmptyTitle: "empty-title", t3xEmptyDescription: "empty-description", t3xEmptyContent: "empty-content",
};
const official = process.argv[2] ?? "/Applications/T3 Code (Beta).app";
const asarFile = path.join(official, "Contents", "Resources", "app.asar");
const { T3_VERSION } = require("../lib/patch.cjs");
const officialVersion = fs.existsSync(asarFile)
  ? require("node:child_process").execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", path.join(official, "Contents", "Info.plist")], { encoding: "utf8" }).trim()
  : null;
if (officialVersion === T3_VERSION) {
  test(`补丁打到官方 ${T3_VERSION}，asar 写出后能读回`, () => {
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
      // host.contextMenu 动态引入 T3 自己的右键菜单模块：文件要在宿主所在模块同目录，导出名 r 是 show(items, position[, 第三个可选参数])
      const menuName = /CONTEXT_MENU_MODULE = "\.\/([\w.-]+)"/.exec(fs.readFileSync(path.join(__dirname, "..", "host", "core.js"), "utf8"))[1];
      const menu = before.read(`apps/server/dist/client/assets/${menuName}`).toString("utf8");
      assert(menu.includes("export{c as n,u as r,l as t}") && /function u\(n,r,c\)\{return l\(\),new Promise/.test(menu), "右键菜单模块的导出变了");
      // showConfirm 动态引入 T3 的确认框：导出名 D 是 confirm(message, { variant })，没有确认框挂载时返回 undefined
      const confirmName = /CONFIRM_MODULE = "\.\/([\w.-]+)"/.exec(fs.readFileSync(path.join(__dirname, "..", "host", "core.js"), "utf8"))[1];
      const toast = before.read(`apps/server/dist/client/assets/${confirmName}`).toString("utf8");
      assert(/Nt as D[,}]/.test(toast) && toast.includes("function Nt(e,t){if(Ot.size!==0)return new Promise"), "确认框模块的导出变了");
      // t3xUi 借用外观页已导入的别名，要确认它们来自对应模块；补的 import 要在目标模块的导出里
      const { appearancePatch } = require("../lib/patch.cjs");
      const appearance = before.read(findOne(before, appearancePatch.targetRegex, appearancePatch.label)).toString("utf8");
      for (const [file, names] of [
        ["settingsLayout-", ["i as de", "s as me", "a as X"]],
        ["main-", ["gi as re"]],
        ["utils-Bng1kvMW", ["Vi as _", "Di as d"]],
        ["select-", ["t as be", "s as ye", "c as ge", "o as ve", "a as he"]],
        ["input-group-", ["t as wt", "n as St", "r as Ct"]],
        ["alert-", ["t as ft", "r as dt"]],
        ["toast-", ["i as ct"]],
      ]) {
        // 以 - 结尾的是“名字-8 位哈希.js”，免得 alert- 撞上 alert-dialog-；否则是完整文件名
        const src = file.endsWith("-") ? `${file}[\\w-]{8}\\.js` : `${file}\\.js`;
        const imported = [...appearance.matchAll(new RegExp(`import\\{([^}]*)\\}from"\\./${src}"`, "g"))].flatMap((m) => m[1].split(","));
        for (const n of names) assert(imported.includes(n), `外观页没有从 ${file}* 导入 ${n}`);
      }
      // showToast 用确认框模块的导出 i：要和外观页当 toast 管理器（ct）导入的是同一个文件
      assert(new RegExp(`import\\{[^}]*\\bi as ct\\b[^}]*\\}from"\\./${confirmName}"`).test(appearance), "toast 管理器不是确认框模块的导出 i");
      // 聊天补丁：working / awaiting 和 T3 传给原生时间线的是同一个东西（变量名写错时语法照样通过，扩展会拿到别的值）
      const { chatPatch } = require("../lib/patch.cjs");
      const chatSrc = before.read(findOne(before, chatPatch.targetRegex, chatPatch.label)).toString("utf8");
      const state = /t3xHost\.ChatOverlay,\{state:\{(.*?)\}\}\)/.exec(chatPatch.apply(chatSrc))[1];
      const field = (k) => new RegExp(`(?:^|,)${k}:(.*?)(?=,[a-zA-Z]+:|$)`).exec(state)?.[1];
      assert.equal(field("working"), /isWorking:([\w$]+),runlessWorkActive:/.exec(chatSrc)?.[1], "working 要和原生时间线的 isWorking 是同一个变量");
      assert.equal(field("awaiting"), /awaitingUser:(.*?),awaitingRequestId:/.exec(chatSrc)?.[1], "awaiting 要照抄原生时间线的 awaitingUser");
      assert.equal(field("compacting"), /isCompacting:([\w$]+),awaitingUser:/.exec(chatSrc)?.[1], "compacting 要是原生时间线的 isCompacting");
      assert.equal(field("context"), /sources:[^,]+,contextWindow:([\w$]+)\}\}\)/.exec(chatSrc)?.[1], "context 要是输入框 Context 一栏用的 contextWindow");
      // 后台补丁包住 Antigravity 的 usage.probe：用到的 Effect 函数要是这个模块按这些名字导入的，局部变量要在 driver 里先声明
      const { serverPatch } = require("../lib/patch-server.cjs");
      const serverSrc = before.read(findOne(before, serverPatch.targetRegex, serverPatch.label)).toString("utf8");
      const effectNames = [...serverSrc.matchAll(/import \{([^}]*)\} from "\.\/Schema-[\w-]+\.mjs"/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(" as ").pop()));
      for (const n of ["gen", "promise", "option"]) assert(effectNames.includes(n), `T3 后台模块没有从 Effect 导入 ${n}`);
      const driver = serverSrc.slice(serverSrc.indexOf("const installation = yield* AntigravityInstallation;"), serverSrc.indexOf("const provider = yield* makeAntigravityProvider(settings, {"));
      assert(driver.length > 0 && driver.length < 20000, "Antigravity driver 的范围变了");
      for (const decl of ["const usage = yield* makeAntigravityUsageProbe({", "installation.resolve(settings.binaryPath, processEnvironment)", "auth.authMethod"]) assert(driver.includes(decl), `Antigravity driver 里没有 ${decl}`);
      // 宿主运行时绑定的 React / jsx / 档位选项函数，要是这个模块顶层真有的名字（未声明的名字到启动时才报 ReferenceError）
      const bind = /\}\)\(\{React:([\w$]+),jsx:([\w$]+),choices:([\w$]+),agent:\{commands:([\w$]+),useCommand:([\w$]+),useThreads:([\w$]+),useProjects:([\w$]+)\},version:"[\d.]+"\}/.exec(runtime());
      assert(bind, "找不到宿主运行时的 bind");
      for (const name of bind.slice(1)) {
        const n = name.replace(/\$/g, "\\$");
        const declared = new RegExp(`import\\{[^}]*(?:\\bas |[{,])${n}[,}]`).test(chatSrc) || new RegExp(`(?:^|[;}\\n])var (?:[^;]*?,)?${n}=`).test(chatSrc);
        assert(declared, `宿主绑定的 ${name} 不是 ${chatPatch.label}顶层的名字`);
      }
      // 名字存在还不够：档位选项函数要是 T3 档位列表组件自己调用的那个（let e=Fn(i.descriptor)）
      const effortFn = chatSrc.slice(chatSrc.indexOf("function zz(e){"));
      assert.equal(bind[3], /=([\w$]+)\(i\.descriptor\)/.exec(effortFn)?.[1], "choices 要是档位列表组件里取选项的那个函数");
      // agent.js 用的四个名字：要从预期的模块按预期的导出名导入，而且导出的东西是我们以为的那个
      const importsOf = new Map([...chatSrc.matchAll(/import\{([^}]*)\}from"\.\/([^"]+)"/g)].flatMap(([, names, file]) => names.split(",").map((s) => { const [exp, alias = exp] = s.split(" as "); return [alias, { exp, file }]; })));
      const exportBody = (file, exp) => {
        const mod = before.read(`apps/server/dist/client/assets/${file}`).toString("utf8");
        const local = new Map([...mod.matchAll(/export\{([^}]*)\}/g)].flatMap((m) => m[1].split(",").map((s) => { const [l, e = l] = s.split(" as "); return [e, l]; }))).get(exp);
        const at = local ? mod.search(new RegExp(`function ${local.replace(/\$/g, "\\$")}\\(`)) : -1;
        // 只取这个函数本身：压缩后相邻函数紧挨着（比如 projectsAtom 的后面就是 visibleThreadShellsAtom 的），截固定长度会把邻居算进来
        const end = at < 0 ? -1 : mod.indexOf("}function ", at);
        return at < 0 ? "" : mod.slice(at, end < 0 ? at + 400 : Math.min(end + 1, at + 2000));
      };
      const [, , , , commands, useCommand, useThreads, useProjects] = bind;
      assert(chatSrc.includes(`${commands}.startTurn`), "commands 要是带 startTurn 的会话命令（输入框发送用的那个）");
      assert.match(importsOf.get(commands)?.file ?? "", /^entities-/, "commands 要从 entities 模块导入");
      assert.match(importsOf.get(useCommand)?.file ?? "", /^composerDraftUploads-/, "useCommand 要从 composerDraftUploads 模块导入");
      assert.match(exportBody(importsOf.get(useCommand).file, importsOf.get(useCommand).exp), /requiredScope/, "useCommand 要是带权限检查的命令 hook");
      assert.match(exportBody(importsOf.get(useThreads).file, importsOf.get(useThreads).exp), /visibleThreadShellsAtom/, "useThreads 要读 visibleThreadShellsAtom");
      assert.match(exportBody(importsOf.get(useProjects).file, importsOf.get(useProjects).exp), /projectsAtom/, "useProjects 要读 projectsAtom");
      const added = [...appearancePatch.apply("").matchAll(/import\{([^}]*)\}from"\.\/([^"]+)"/g)];
      for (const want of ["utils-", "skeleton-", "alert-", "empty-", "settingsLayout-"]) assert(added.some((m) => m[2].startsWith(want)), `appearancePatch 没有从 ${want}* 导入`);
      for (const [, names, file] of added) {
        const mod = before.read(`apps/server/dist/client/assets/${file}`).toString("utf8");
        const exported = new Set([...mod.matchAll(/export\{([^}]*)\}/g)].flatMap((m) => m[1].split(",").map((s) => s.split(" as ").pop())));
        for (const n of names.split(",")) assert(exported.has(n.split(" as ")[0]), `${file} 没有导出 ${n}`);
        // 按组件自己的 data-slot 认：导出名在别的模块里也可能存在（比如 alert-dialog 也导出 n）
        const localOf = new Map([...mod.matchAll(/export\{([^}]*)\}/g)].flatMap((m) => m[1].split(",").map((s) => { const [l, e = l] = s.split(" as "); return [e, l]; })));
        for (const n of names.split(",")) {
          const [exp, alias] = n.split(" as ");
          const want = ADDED_SLOTS[alias];
          if (!want) continue;
          const at = mod.indexOf(`"data-slot":\`${want}\``);
          const fn = at < 0 ? null : [...mod.slice(0, at).matchAll(/function ([\w$]+)\(/g)].at(-1)?.[1];
          assert.equal(fn, localOf.get(exp), `${file} 的 ${exp} 不是 data-slot=${want} 的组件`);
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
} else {
  console.log(officialVersion ? `- 跳过补丁检查：${official} 是 ${officialVersion}，补丁针对 ${T3_VERSION}（可以把 ${T3_VERSION} 的 app 路径作为参数传进来）` : `- 跳过补丁检查：没有 ${asarFile}`);
}

test("作用域键、按作用域启用", () => {
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

test("社区卡片：从仓库的 plugin.json 取各语言简介（模拟网络）", async () => {
  const src = ["pure.js", "install.js", "github.js"].map((f) => fs.readFileSync(path.join(__dirname, "..", "host", f), "utf8").split("// @node-only")[0]).join("\n");
  const urls = [];
  const resp = (status, body) => ({
    ok: status < 400, status, url: "", headers: new Headers(),
    body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body))); c.close(); } }),
  });
  const fetch = async (u) => {
    const url = String(u);
    urls.push(url);
    if (url.toLowerCase().includes("/ow/pets/")) return resp(200, { description: "桌宠", locales: { en: { description: "Desk pets", name: "x" }, zh: { description: "  " } }, entries: {} });
    if (url.includes("/ow/broken/")) return resp(200, "not json");
    return resp(404, {});
  };
  const ctx = vm.createContext({ fetch, Headers, ReadableStream, TextDecoder, TextEncoder, URL, Date, crypto, console });
  vm.runInContext(`${src}\nthis.repoMeta = repoMeta;`, ctx);
  const meta = await ctx.repoMeta({ owner: "Ow", repo: "pets" });
  assert.equal(urls[0], "https://raw.githubusercontent.com/Ow/pets/HEAD/plugin.json");
  assert.deepEqual(JSON.parse(JSON.stringify(meta)), { description: "桌宠", locales: { zh: {}, en: { description: "Desk pets" } } }, "只留简介，空白的不要");
  await ctx.repoMeta({ owner: "ow", repo: "PETS" });
  assert.equal(urls.length, 1, "同一个仓库只读一次");
  assert.equal(await ctx.repoMeta({ owner: "ow", repo: "broken" }), null);
  assert.equal(await ctx.repoMeta({ owner: "ow", repo: "missing" }), null);
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

test("确认框是异步的：标题不被换行拆坏，确认期间扩展被换掉就作废", async () => {
  const { hostSource } = require("../lib/build.cjs");
  const ctx = vm.createContext({ bind: { React: { Component: class {} }, jsx: {}, choices: () => [] }, console, URL, TextDecoder, TextEncoder });
  vm.runInContext(`${hostSource()}\nthis.api = { records, updates, consent, remove, applyUpdate };`, ctx);
  const { records, updates, consent, remove, applyUpdate } = ctx.api;
  const seen = [];
  let during = () => {};
  ctx.showConfirm = async (message, options) => (seen.push([message, options]), during(), true);
  const rec = (version) => ({ manifest: { id: "demo", name: "D", version }, source: { kind: "zip", file: "a.zip" } });

  await consent({ ...rec("1.0.0"), manifest: { id: "x", name: "A\nB", version: "1.0.0" } });
  assert.equal(seen[0][0].split("\n")[0], "安装“A B” 1.0.0？"); // T3 取第一行带问号的当标题

  const old = rec("1.0.0");
  records.set("demo", old);
  during = () => records.set("demo", rec("1.1.0"));
  await assert.rejects(consent(rec("2.0.0")), /确认期间/);

  records.set("demo", old);
  await assert.rejects(remove(old.manifest), /确认期间/);
  assert.equal(seen.at(-1)[1].variant, "destructive");
  assert(records.has("demo"), "确认期间被换掉的扩展不能被删");

  const confirmed = { state: "available", item: rec("2.0.0"), rec: records.get("demo") };
  updates.set("demo", { ...confirmed }); // 确认期间又刷新过一次
  await assert.rejects(applyUpdate("demo", confirmed), /重新检查/);
});

test("host.dom：只认主输入框和它的模型选择器，不认 side chat", () => {
  const { hostSource } = require("../lib/build.cjs");
  class El {
    constructor(attrs, parent = null) {
      Object.assign(this, { attrs, parent });
    }
    closest(sel) {
      for (let e = this; e; e = e.parent) if (e.attrs.includes(sel)) return e;
      return null;
    }
  }
  const HOST = '[data-slot="composer-host"]';
  const PICKER = "[data-chat-provider-model-picker]";
  const sideHost = new El([HOST], new El(["[data-side-chat-pane]"]));
  const mainHost = new El([HOST]);
  const mainPicker = new El([PICKER], mainHost);
  const document = { querySelectorAll: (sel) => (sel === HOST ? [sideHost, mainHost] : []) };
  const ctx = vm.createContext({ bind: { React: { Component: class {} }, jsx: {}, choices: () => [] }, Element: El, document, console, URL, TextDecoder, TextEncoder });
  vm.runInContext(`${hostSource()}\nthis.api = { dom };`, ctx);
  const { dom } = ctx.api;
  assert.equal(dom.composer(), mainHost);
  assert.equal(dom.modelPicker(new El(["span"], mainPicker)), mainPicker);
  assert.equal(dom.modelPicker(new El([PICKER], sideHost)), null, "side chat 里的模型选择器不算");
  assert.equal(dom.modelPicker(new El([PICKER])), null, "不在输入框里的不算");
  assert.equal(dom.modelPicker(null), null);
  document.querySelectorAll = () => [sideHost];
  assert.equal(dom.composer(), null);
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

require("./server-tests.cjs")(test);
require("./agent-tests.cjs")(test);
require("./update-tests.cjs")(test);

// 某个测试的 Promise 永远不结束时事件循环会排空，进程照样以 0 退出：没跑完就算失败
process.on("exit", (code) => {
  if (code === 0 && passed < queue.length) {
    console.error(`\n没跑完，卡在：${queue[passed][0]}（${passed}/${queue.length}）`);
    process.exitCode = 1;
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
