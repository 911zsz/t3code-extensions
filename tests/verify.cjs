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
const glow = require("../extensions/edge-glow/logic.js");
const pets = require("../extensions/desk-pets/logic.js");
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
  assert.throws(() => pure.t3xCheckManifest({ ...ok, apiVersion: 2 }), /apiVersion/);
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
    const dir = path.join(ROOT, e.manifest.split("/")[1], e.id);
    for (const [p, hash] of Object.entries(e.sha256)) assert.equal(sha256(fs.readFileSync(path.join(dir, p))), hash, `${e.id}/${p}`);
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

test("边缘光状态", () => {
  assert.equal(glow.attentionState({ awaiting: "approval", error: true }), "approval");
  assert.equal(glow.attentionState({ error: true, done: true }), "error");
  assert.equal(glow.attentionState({ done: true, working: true }), null);
  const prev = { key: "a", working: true };
  assert.deepEqual(glow.backgroundFinish(false, prev, { key: "a", runStatus: "completed" }, false), { pending: false, done: true });
  assert.deepEqual(glow.backgroundFinish(false, prev, { key: "a", runStatus: "completed" }, true), { pending: false, done: false });
  assert.deepEqual(glow.backgroundFinish(false, prev, { key: "a", runStatus: "running" }, false), { pending: true, done: false });
  assert.deepEqual(glow.backgroundFinish(true, { key: "a" }, { key: "a", runStatus: "failed" }, false), { pending: false, done: false });
});

test("桌宠：agent → 宠物", () => {
  const has = (id) => ["codex", "claude"].includes(id);
  const map = { ...pets.DEFAULT_MAP };
  assert.equal(pets.petFor("claudeAgent", "", map, has), "claude");
  assert.equal(pets.petFor("antigravity", "", map, has), "codex"); // gemini 不在库里，退回 codex
  assert.equal(pets.petFor("opencode", "claude-sonnet-5", map, has), "claude"); // 未知 harness 按模型名
  assert.equal(pets.petFor("opencode", "gpt", map, has), "codex");
  assert.equal(pets.petFor("cursor", "", { ...map, cursor: "none" }, has), null);
  assert.equal(pets.petFor("cursor", "", { ...map, "*": "none" }, has), null);
  assert.equal(pets.petFor("claudeAgent", "gpt", { ...map, claudeAgent: "auto" }, has), "codex"); // 明确选“按模型名”不回到默认
  const { events } = pets.subagentEvents(new Map(), [{ id: 1, status: "running", driver: "cursor" }, { id: 2, status: "running", driver: "codex" }], false, (d) =>
    pets.petFor(d, "", { ...map, cursor: "none" }, has),
  );
  assert.deepEqual(events.map((e) => [e.id, e.petId]), [[2, "codex"]]);
  // 回到看过的会话：a 原样落座后补播收工，b 是离开期间新派出的，跑进来
  const seen = new Map([["a", { petId: "codex", status: "running" }]]);
  const back = pets.resumeSubagents(seen, [{ id: "a", status: "completed" }, { id: "b", status: "running", driver: "codex" }], () => "codex");
  assert.deepEqual(back.events.map((e) => `${e.type}:${e.id}`), ["seat:a", "finish:a", "arrive:b"]);
  assert.deepEqual([...back.next.keys()], ["b"]);

  // 离开期间既启动又完成的子代理也要补播进场与收工，但不能重播上次已见的历史终态
  const firstVisit = pets.subagentEvents(
    new Map(),
    [{ id: "old", status: "completed", driver: "codex" }, { id: "a", status: "running", driver: "codex" }],
    true,
    () => "codex",
  );
  assert.deepEqual(firstVisit.events.map((e) => `${e.type}:${e.id}`), ["seat:a"]);
  assert(firstVisit.done.has("old"));
  const backWithShort = pets.resumeSubagents(
    firstVisit.next,
    [
      { id: "old", status: "completed", driver: "codex" },
      { id: "a", status: "completed", driver: "codex" },
      { id: "x", status: "completed", driver: "codex" },
      { id: "y", status: "failed", driver: "codex" },
      { id: "skip", status: "completed", driver: "cursor" },
    ],
    (d) => (d === "cursor" ? null : "codex"),
    firstVisit.done,
  );
  assert.deepEqual(
    backWithShort.events.map((e) => `${e.type}:${e.id}:${e.ok ?? ""}`),
    ["seat:a:", "finish:a:true", "arrive:x:", "finish:x:true", "arrive:y:", "finish:y:false"],
  );
  // 再次切回时不重播任何已见终态
  const backAgain = pets.resumeSubagents(
    backWithShort.next,
    [
      { id: "old", status: "completed", driver: "codex" },
      { id: "a", status: "completed", driver: "codex" },
      { id: "x", status: "completed", driver: "codex" },
    ],
    () => "codex",
    backWithShort.done,
  );
  assert.deepEqual(backAgain.events, []);

  // 座位计算：窄舞台满座、加宽腾座、离场占名额、拖动腾座
  assert.equal(pets.findFreeSeat({ mainX: 126, span: 140, occupied: [76, 26], total: 2 }), undefined);
  assert.equal(pets.findFreeSeat({ mainX: 482, span: 536, occupied: [76, 26], total: 2 }), 532);
  assert.equal(pets.findFreeSeat({ mainX: 300, span: 600, occupied: [350, 250], total: 3 }), undefined);
  assert.equal(pets.findFreeSeat({ mainX: 126, span: 140, occupied: [10, 26], total: 2 }), 76);
});

test("桌宠：拖动碰头判定与分开站位", () => {
  const list = [{ id: "a", x: 100 }, { id: "b", x: 220 }];
  assert.equal(pets.findBumpTarget(120, list)?.id, "a");
  assert.equal(pets.findBumpTarget(146, list)?.id, "a");
  assert.equal(pets.findBumpTarget(160, list), null);
  assert.equal(pets.findBumpTarget(190, [{ id: "a", x: 160 }, { id: "b", x: 205 }])?.id, "b"); // 多只命中选最近

  // 普通从左侧拖来：贴近到 30px，结束后退开到 50px 不重叠
  const normal = pets.resolveBumpPositions({ moverX: 295, moverFromX: 120, targetX: 300, span: 600 });
  assert.deepEqual([normal.meetMoverX, normal.meetTargetX, normal.afterMoverX, normal.afterTargetX, normal.side], [270, 300, 250, 300, -1]);

  // 完全重合时按起拖方向决定左右
  const overlap = pets.resolveBumpPositions({ moverX: 300, moverFromX: 420, targetX: 300, span: 600 });
  assert.equal(overlap.side, 1);
  assert.equal(overlap.meetMoverX, 330);
  assert.equal(overlap.afterMoverX, 350);

  // 靠左边缘不够站：自动翻到右侧，保证都在边界内且不重叠
  const edge = pets.resolveBumpPositions({ moverX: 10, moverFromX: 0, targetX: 20, span: 600 });
  assert.equal(edge.side, 1);
  assert.equal(edge.meetMoverX, 50);
  assert.equal(edge.afterMoverX, 70);

  // 避让第三只宠物：左侧 250 被占时改退到右侧 350
  const third = pets.resolveBumpPositions({ moverX: 290, moverFromX: 200, targetX: 300, span: 600, others: [250] });
  assert.equal(third.afterTargetX, 300);
  assert.equal(third.afterMoverX, 350);
  assert(Math.abs(third.afterMoverX - 250) >= 50);

  // 极窄舞台不越界
  const narrow = pets.resolveBumpPositions({ moverX: 10, moverFromX: 0, targetX: 20, span: 40 });
  assert(narrow.meetMoverX >= 0 && narrow.meetMoverX <= 40);
  assert(narrow.afterMoverX >= 0 && narrow.afterMoverX <= 40);
  assert(narrow.afterTargetX >= 0 && narrow.afterTargetX <= 40);
  assert.equal(Math.abs(narrow.afterMoverX - narrow.afterTargetX), 40);
});

// 最小 DOM + 可控时钟替身，用于回归桌宠状态机（离场、碰头、指针、补播、布局读取、rAF 清理）。
function createPetsHarness({ stageWidth = 600, focused = true, hidden = false } = {}) {
  let now = 0;
  let nextTimerId = 1;
  let nextRafId = 1;
  const timers = new Map();
  const rafs = new Map();
  const storageMap = new Map();
  const storageSubs = new Map();
  const sessionMap = new Map();
  const docListeners = new Map();
  const winListeners = new Map();
  let resizeCb = null;
  let offsetWidthReads = 0;
  let captureShouldThrow = false;

  const addL = (map, type, fn) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
  };
  const rmL = (map, type, fn) => map.get(type)?.delete(fn);
  const fireL = (map, type, ev = {}) => {
    for (const fn of [...(map.get(type) ?? [])]) fn(ev);
  };

  class FakeEl {
    constructor(tag = "div") {
      this.tag = tag;
      this.className = "";
      this.dataset = {};
      this.style = {
        setProperty(k, v) {
          this[k] = v;
        },
      };
      this.children = [];
      this.parentElement = null;
      this.listeners = new Map();
      this.captured = new Set();
      this.textContent = "";
      this._connected = false;
    }
    get isConnected() {
      return this._connected;
    }
    get clientWidth() {
      return this.className === "t3x-pet-stage" ? stageWidth : 64;
    }
    get offsetWidth() {
      if (this.className === "t3x-pet") offsetWidthReads += 1;
      return 64;
    }
    setAttribute() {}
    closest() {
      return null;
    }
    getBoundingClientRect() {
      return { left: Number.parseFloat(this.style.left) || 0, top: 0, width: 64, height: 69 };
    }
    _setConnected(v) {
      this._connected = v;
      for (const c of this.children) c._setConnected(v);
    }
    appendChild(child) {
      if (child.parentElement) child.parentElement.removeChild(child);
      child.parentElement = this;
      this.children.push(child);
      child._setConnected(this._connected);
      return child;
    }
    append(...nodes) {
      for (const n of nodes) this.appendChild(n);
    }
    prepend(child) {
      if (child.parentElement) child.parentElement.removeChild(child);
      child.parentElement = this;
      this.children.unshift(child);
      child._setConnected(this._connected);
      return child;
    }
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentElement = null;
      child._setConnected(false);
    }
    remove() {
      if (this.parentElement) this.parentElement.removeChild(this);
    }
    addEventListener(type, fn) {
      addL(this.listeners, type, fn);
    }
    removeEventListener(type, fn) {
      rmL(this.listeners, type, fn);
    }
    dispatch(type, ev = {}) {
      fireL(this.listeners, type, { target: this, preventDefault() {}, button: 0, pointerId: 1, clientX: 0, ...ev });
    }
    setPointerCapture(id) {
      if (captureShouldThrow) throw new Error("capture failed");
      this.captured.add(id);
    }
    hasPointerCapture(id) {
      return this.captured.has(id);
    }
    releasePointerCapture(id) {
      this.captured.delete(id);
    }
  }

  const hostEl = new FakeEl("div");
  hostEl._connected = true;
  const doc = {
    get hidden() {
      return hidden;
    },
    hasFocus: () => focused,
    createElement: (tag) => new FakeEl(tag),
    querySelectorAll: (sel) => (sel === '[data-slot="composer-host"]' ? [hostEl] : []),
    addEventListener: (t, fn) => addL(docListeners, t, fn),
    removeEventListener: (t, fn) => rmL(docListeners, t, fn),
  };
  const win = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (t, fn) => addL(winListeners, t, fn),
    removeEventListener: (t, fn) => rmL(winListeners, t, fn),
    dispatchEvent: (ev) => fireL(winListeners, ev.type, ev),
  };

  const ctx = vm.createContext({
    window: win,
    document: doc,
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    getComputedStyle: () => ({ position: "relative" }),
    ResizeObserver: class ResizeObserver {
      constructor(cb) {
        resizeCb = cb;
      }
      observe() {}
      disconnect() {
        resizeCb = null;
      }
    },
    sessionStorage: {
      getItem: (k) => (sessionMap.has(k) ? sessionMap.get(k) : null),
      setItem: (k, v) => sessionMap.set(k, String(v)),
      removeItem: (k) => sessionMap.delete(k),
    },
    performance: { now: () => now },
    setTimeout: (fn, ms = 0) => {
      const id = nextTimerId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => {
      const id = nextRafId++;
      rafs.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => rafs.delete(id),
    console,
  });

  const dir = path.join(ROOT, "extensions", "desk-pets");
  const code = ["logic.js", "subpets.js", "controller.js"].map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n;\n");
  const createPetController = vm.runInContext(`(function(){"use strict";\n${code}\nreturn createPetController;})()`, ctx);
  const catalog = {
    get: (id) => ({ id, sheet: "data:image/webp;base64,AA", badgeBottom: 54 }),
  };
  let posVal = 0.9;
  const ctrl = createPetController({
    catalog,
    position: { get: () => posVal, set: (v) => (posVal = v) },
  });

  const stage = () => hostEl.children.find((c) => c.className === "t3x-pet-stage") ?? null;
  const petEls = () => (stage()?.children ?? []).filter((c) => c.className === "t3x-pet");
  const mainEls = () => petEls().filter((c) => c.dataset.role !== "sub");
  const subEls = () => petEls().filter((c) => c.dataset.role === "sub");
  const badgeEl = () => (stage()?.children ?? []).find((c) => c.className === "t3x-pet-badge") ?? null;

  function stepRaf(dt = 16) {
    now += dt;
    const batch = [...rafs.entries()];
    rafs.clear();
    for (const [, fn] of batch) fn(now);
  }
  function advance(ms) {
    const end = now + ms;
    while (true) {
      let nextId = null;
      let nextAt = Infinity;
      for (const [id, t] of timers) {
        if (t.at <= end && t.at < nextAt) {
          nextAt = t.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      now = nextAt;
      const t = timers.get(nextId);
      timers.delete(nextId);
      t.fn();
    }
    now = end;
  }
  function finishAnim(el) {
    const body = el.children.find((c) => c.className === "t3x-pet-body");
    body.dispatch("animationend", { target: body, animationName: `t3x-pet-${el.dataset.motion}` });
  }

  return {
    ctrl,
    timers,
    rafs,
    stage,
    petEls,
    mainEls,
    subEls,
    badgeEl,
    stepRaf,
    advance,
    finishAnim,
    setFocus(v) {
      focused = v;
      if (v) fireL(winListeners, "focus");
    },
    setHidden(v) {
      hidden = v;
      if (!v) fireL(docListeners, "visibilitychange");
    },
    setStageWidth(w) {
      stageWidth = w;
      resizeCb?.();
    },
    setCaptureThrow(v) {
      captureShouldThrow = v;
    },
    resetOffsetReads() {
      offsetWidthReads = 0;
    },
    getOffsetReads: () => offsetWidthReads,
    storageMap,
    storageSubs,
  };
}

test("桌宠：离场、碰头、指针、补播、布局与 rAF 回归", () => {
  // 1. 拖动中切换主宠，松手不会复活旧主宠，dispose 后计时器清零
  {
    const h = createPetsHarness();
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    const oldMain = h.mainEls()[0];
    h.finishAnim(oldMain);
    oldMain.dispatch("pointerdown", { pointerId: 1, clientX: 500 });
    oldMain.dispatch("pointermove", { pointerId: 1, clientX: 460 });
    h.ctrl.update({ petId: "claude", mood: "idle" }); // 旧主宠开始离场
    oldMain.dispatch("pointerup", { pointerId: 1, clientX: 460 });
    assert.match(oldMain.dataset.motion, /^exit-/);
    h.ctrl.dispose();
    assert.equal(h.timers.size, 0, "dispose 后不应残留计时器");
    assert.equal(h.rafs.size, 0, "dispose 后不应残留 rAF");
  }

  // 1b. 拖动子宠物期间代理消失（quiet），松手不会复活或泄漏 exiting 名额
  {
    const h = createPetsHarness();
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    h.finishAnim(h.mainEls()[0]);
    h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
    const sub = h.subEls()[0];
    h.finishAnim(sub);
    sub.dispatch("pointerdown", { pointerId: 2, clientX: 400 });
    sub.dispatch("pointermove", { pointerId: 2, clientX: 360 });
    h.ctrl.subagents([{ type: "finish", id: "s1", ok: true, quiet: true }], false);
    assert.equal(sub.dataset.motion, "exit-blink");
    sub.dispatch("pointerup", { pointerId: 2, clientX: 360 });
    assert.equal(sub.dataset.motion, "exit-blink");
    h.finishAnim(sub);
    assert.equal(h.subEls().length, 0);
    h.ctrl.dispose();
  }

  // 2. 碰头期间右键隐藏，主宠正常离场销毁，不留屏幕也不留计时器
  {
    const h = createPetsHarness();
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    const main = h.mainEls()[0];
    h.finishAnim(main);
    h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
    const sub = h.subEls()[0];
    h.finishAnim(sub);
    const subX = Number.parseFloat(sub.style.left);
    const mainX = Number.parseFloat(main.style.left);
    sub.dispatch("pointerdown", { pointerId: 3, clientX: subX });
    sub.dispatch("pointermove", { pointerId: 3, clientX: mainX });
    sub.dispatch("pointerup", { pointerId: 3, clientX: mainX });
    assert.equal(main.dataset.motion, "bump");
    assert.equal(sub.dataset.motion, "bump");
    main.dispatch("contextmenu", {});
    assert.match(main.dataset.motion, /^exit-/);
    h.advance(1600);
    assert.equal(h.petEls().length, 0);
    h.ctrl.dispose();
    assert.equal(h.timers.size, 0);
  }

  // 3. lostpointercapture 恢复待播告别；pointercancel 不触发碰头；捕获失败回滚
  {
    const h = createPetsHarness();
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    const main = h.mainEls()[0];
    h.finishAnim(main);
    h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
    const sub = h.subEls()[0];
    h.finishAnim(sub);

    // 捕获抛错时回滚，不残留 dragging
    h.setCaptureThrow(true);
    sub.dispatch("pointerdown", { pointerId: 10, clientX: 400 });
    h.setCaptureThrow(false);
    sub.dispatch("pointermove", { pointerId: 10, clientX: 350 });
    assert.equal(sub.dataset.motion, "idle");

    // 拖到主宠上方触发 pointercancel：绝不进入 bump
    const subX = Number.parseFloat(sub.style.left);
    const mainX = Number.parseFloat(main.style.left);
    sub.dispatch("pointerdown", { pointerId: 11, clientX: subX });
    sub.dispatch("pointermove", { pointerId: 11, clientX: mainX });
    sub.dispatch("pointercancel", { pointerId: 11, clientX: mainX });
    assert.notEqual(sub.dataset.motion, "bump");
    assert.notEqual(main.dataset.motion, "bump");
    h.finishAnim(sub);

    // 拖动中收工后丢失捕获：接续告别离场
    sub.dispatch("pointerdown", { pointerId: 12, clientX: subX });
    sub.dispatch("pointermove", { pointerId: 12, clientX: subX - 20 });
    h.ctrl.subagents([{ type: "finish", id: "s1", ok: true }], false);
    assert.equal(sub.dataset.motion, "drag");
    sub.dispatch("lostpointercapture", { pointerId: 12 });
    assert(["highfive", "greet"].includes(sub.dataset.motion), `丢失捕获后应接续告别，实际 ${sub.dataset.motion}`);
    h.ctrl.dispose();
  }

  // 4. 已经按住的主宠不能被另一只当成碰头目标
  {
    const h = createPetsHarness();
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    const main = h.mainEls()[0];
    h.finishAnim(main);
    h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
    const sub = h.subEls()[0];
    h.finishAnim(sub);
    const subX = Number.parseFloat(sub.style.left);
    const mainX = Number.parseFloat(main.style.left);
    main.dispatch("pointerdown", { pointerId: 1, clientX: mainX }); // 只按住未移动
    sub.dispatch("pointerdown", { pointerId: 2, clientX: subX });
    sub.dispatch("pointermove", { pointerId: 2, clientX: mainX });
    sub.dispatch("pointerup", { pointerId: 2, clientX: mainX });
    assert.notEqual(main.dataset.motion, "bump");
    assert.notEqual(sub.dataset.motion, "bump");
    main.dispatch("pointerup", { pointerId: 1, clientX: mainX });
    h.ctrl.dispose();
  }

  // 5. 后台依次完成四只子代理，回前台后四只全部依次出现并完成告别
  {
    const h = createPetsHarness();
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    h.finishAnim(h.mainEls()[0]);
    h.setFocus(false);
    let spawned = 0;
    const stageEl = h.stage();
    const origAppend = stageEl.appendChild.bind(stageEl);
    stageEl.appendChild = (c) => {
      if (c.className === "t3x-pet" && c.dataset.role === "sub") spawned += 1;
      return origAppend(c);
    };
    for (const id of ["a", "b", "c", "d"]) {
      h.ctrl.subagents([{ type: "arrive", id, petId: "codex", status: "running" }], false);
      h.ctrl.subagents([{ type: "finish", id, ok: true }], false);
    }
    assert.equal(spawned, 0);
    h.setFocus(true);
    assert.equal(spawned, 3);
    for (let i = 0; i < 120; i++) {
      h.stepRaf(20);
      h.advance(100);
    }
    assert.equal(spawned, 4, "第四只子代理应在腾出座位后补播");
    assert.equal(h.subEls().length, 0);
    h.ctrl.dispose();
  }

  // 6. 后台完成任务，回到前台时主宠仍在入场动画中：庆祝不能丢失，入场结束后播放跳跃
  {
    const h = createPetsHarness();
    h.setFocus(false);
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    const main = h.mainEls()[0];
    assert.match(main.dataset.motion, /^enter-/);
    h.ctrl.celebrate();
    h.setFocus(true); // 主宠还在入场中
    const sprite = main.children.find((c) => c.className === "t3x-pet-body").children[0];
    h.finishAnim(main); // 入场结束 -> settle 应立刻消费 missedCheer 播放 jumping（第 4 行）
    assert.equal(sprite.style.backgroundPosition, "0% 40%", "入场结束后应播放积攒的庆祝跳跃");
    h.ctrl.dispose();
  }

  // 9. 输入框从 204px 加宽到 600px 后，+1 中的子宠物自动补入座位
  {
    const h = createPetsHarness({ stageWidth: 204 });
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    h.finishAnim(h.mainEls()[0]);
    h.ctrl.subagents(
      [
        { type: "seat", id: "a", petId: "codex", status: "running" },
        { type: "seat", id: "b", petId: "codex", status: "running" },
        { type: "seat", id: "c", petId: "codex", status: "running" },
      ],
      true,
    );
    assert.equal(h.subEls().length, 2);
    assert.equal(h.badgeEl()?.textContent, "+1");
    h.setStageWidth(600);
    assert.equal(h.subEls().length, 3);
    assert.equal(h.badgeEl(), null);
    h.ctrl.dispose();
  }

  // 10. 三只子宠落座时，一次主宠 pointermove 只读一次主宠 offsetWidth；碰头分开动画期间不读布局
  {
    const h = createPetsHarness({ stageWidth: 600 });
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    const main = h.mainEls()[0];
    h.finishAnim(main);
    h.ctrl.subagents(
      [
        { type: "seat", id: "a", petId: "codex", status: "running" },
        { type: "seat", id: "b", petId: "codex", status: "running" },
        { type: "seat", id: "c", petId: "codex", status: "running" },
      ],
      true,
    );
    for (const s of h.subEls()) h.finishAnim(s);
    const mx = Number.parseFloat(main.style.left);
    main.dispatch("pointerdown", { pointerId: 1, clientX: mx });
    h.resetOffsetReads();
    main.dispatch("pointermove", { pointerId: 1, clientX: mx - 20 });
    assert.equal(h.getOffsetReads(), 1, "单次主宠移动只应读取一次 offsetWidth");
    main.dispatch("pointerup", { pointerId: 1, clientX: mx - 20 });
    h.finishAnim(main);

    // 碰头分开 rAF 期间不读 offsetWidth
    const sub = h.subEls()[0];
    const sx = Number.parseFloat(sub.style.left);
    const curMx = Number.parseFloat(main.style.left);
    sub.dispatch("pointerdown", { pointerId: 2, clientX: sx });
    sub.dispatch("pointermove", { pointerId: 2, clientX: curMx });
    sub.dispatch("pointerup", { pointerId: 2, clientX: curMx });
    h.finishAnim(main);
    h.finishAnim(sub);
    h.resetOffsetReads();
    h.stepRaf(50);
    h.stepRaf(50);
    assert.equal(h.getOffsetReads(), 0, "碰头分开过渡帧不应读取 offsetWidth");
    h.ctrl.dispose();
  }

  // 11. 子宠入场 rAF 在 dispose 时被主动取消
  {
    const h = createPetsHarness({ stageWidth: 600 });
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    h.finishAnim(h.mainEls()[0]);
    h.ctrl.subagents(
      [
        { type: "arrive", id: "a", petId: "codex", status: "running" },
        { type: "arrive", id: "b", petId: "codex", status: "running" },
      ],
      false,
    );
    assert.equal(h.rafs.size, 2);
    h.ctrl.dispose();
    assert.equal(h.rafs.size, 0, "dispose 后子宠入场 rAF 应全部取消");
  }
});

test("桌宠：卸载聊天视图期间改映射会使 seenSubs 失效", () => {
  const ext = readExtension(path.join(ROOT, "extensions", "desk-pets"));
  const web = pure.t3xCheckManifest(ext.manifest, ext.files).web;
  const code = web.map((p) => ext.files[p]).join("\n;\n");
  const storage = new Map();
  const subs = new Map();
  const dispatched = [];
  let Overlay = null;

  function makeReact() {
    let states = [];
    let refs = [];
    let effects = [];
    let si = 0;
    let ri = 0;
    return {
      begin() {
        si = 0;
        ri = 0;
        effects = [];
      },
      flush() {
        for (const fn of effects) fn();
      },
      useState(init) {
        const idx = si++;
        if (states.length <= idx) states.push(typeof init === "function" ? init() : init);
        return [states[idx], (v) => (states[idx] = typeof v === "function" ? v(states[idx]) : v)];
      },
      useRef(init) {
        const idx = ri++;
        if (refs.length <= idx) refs.push({ current: init });
        return refs[idx];
      },
      useEffect(fn) {
        effects.push(fn);
      },
      useReducer: () => [],
      reset() {
        states = [];
        refs = [];
        effects = [];
      },
    };
  }
  const react = makeReact();
  const ctx = vm.createContext({
    window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
    document: {
      hidden: false,
      hasFocus: () => true,
      createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, remove() {} }),
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    console,
  });
  const hostObj = {
    id: "desk-pets",
    React: react,
    h: () => null,
    register: (slot, c) => {
      if (slot === "chat.overlay") Overlay = c;
    },
    settings() {},
    storage: {
      get: (k, f) => (storage.has(k) ? storage.get(k) : f),
      set: (k, v) => {
        storage.set(k, v);
        for (const fn of subs.get(k) ?? []) fn();
      },
      subscribe: (k, fn) => {
        if (!subs.has(k)) subs.set(k, new Set());
        subs.get(k).add(fn);
        return () => subs.get(k).delete(fn);
      },
      use: (k, f) => (storage.has(k) ? storage.get(k) : f),
    },
    files: { list: () => Object.keys(ext.files), text: (p) => ext.files[p], url: (p) => (ext.files[p]?.startsWith("data:") ? ext.files[p] : null) },
    style: () => () => {},
    onDispose() {},
    chat: { last: () => null },
  };
  const cleanup = vm.runInContext(
    `(function(host){"use strict";\n${code.replace('host.register("chat.overlay", PetsOverlay);', 'host.register("chat.overlay", PetsOverlay); globalThis.__ctrl = controller;')}\n})`,
    ctx,
  )(hostObj);
  ctx.__ctrl.subagents = (events, fresh) => dispatched.push({ events, fresh });

  const renderOverlay = (props) => {
    react.begin();
    Overlay(props);
    react.flush();
  };
  const props = { embedded: false, driver: "codex", model: "", threadKey: "t1", awaiting: false, working: false, error: false, runStatus: "idle", subagents: [{ id: "c1", status: "running", driver: "cursor" }] };
  renderOverlay(props);
  assert.deepEqual(Array.from(dispatched.at(-1).events, (e) => `${e.type}:${e.id}`), ["seat:c1"]);
  // 卸载聊天视图（重置组件 state/ref），在设置页把 cursor 设为不显示，再重挂
  react.reset();
  hostObj.storage.set("map", { cursor: "none" });
  renderOverlay(props);
  assert.equal(dispatched.at(-1).events.length, 0, "改映射后重挂不应复用旧 seenSubs 发出 seat");
  cleanup();
});

test("桌宠：导入的宠物定义要清洗", () => {
  const sheet = "data:image/webp;base64,AAAA";
  const p = pets.cleanPet({ id: "my-1", name: "x", sheet, scale: 1.2, vars: { "--t3x-pet-sink": "4px", "--evil": "1", "--t3x-pet-fx-beam": "red;}body{display:none" } });
  assert.deepEqual(p.vars, { "--t3x-pet-sink": "4px", "--t3x-pet-scale": "1.2" });
  const fetchy = pets.cleanPet({ id: "x2", sheet, vars: { "--t3x-pet-fx-beam": "url(//evil.example/a.png)", "--t3x-pet-fx-sparks": "image-set(a 1x)" } });
  assert.deepEqual(fetchy.vars, {}, "变量里不能引用外部图片");
  assert.throws(() => pets.cleanPet({ id: 'x"]{', sheet }), /id/);
  assert.throws(() => pets.cleanPet({ id: "ok", sheet: "javascript:alert(1)" }), /精灵图/);
  assert.throws(() => pets.cleanPet({ id: "ok", sheet: "data:image/png;base64,AA)\"" }), /精灵图/);
  assert.match(pets.petCss(p), /^\.t3x-pet\[data-pet="my-1"\]\{--t3x-pet-sink:4px;--t3x-pet-scale:1\.2\}html\.dark/);
  // 本机桌宠的变量全部是合法值，清洗后一个不少
  for (const id of fs.existsSync(path.join(ROOT, "local-pets")) ? fs.readdirSync(path.join(ROOT, "local-pets")) : []) {
    const def = JSON.parse(fs.readFileSync(path.join(ROOT, "local-pets", id, "pet.json"), "utf8"));
    const clean = pets.cleanPet({ ...def, sheet });
    assert.equal(Object.keys(clean.vars).length, Object.keys(def.vars).length, id);
    assert.equal(Object.keys(clean.darkVars).length, Object.keys(def.darkVars ?? {}).length, id);
  }
});

// 宿主用 function(host){"use strict"; …} 包住扩展代码；这里在 vm 里做同样的事，并给最少的 DOM 替身。
function fakeHost(ext, calls) {
  const storage = new Map();
  return {
    id: ext.manifest.id,
    React: { useState: () => [], useRef: () => ({}), useEffect() {}, useReducer: () => [] },
    h: () => null,
    register: (slot, c) => calls.push(["register", slot, typeof c]),
    settings: (c) => calls.push(["settings", typeof c]),
    storage: { get: (k, f) => (storage.has(k) ? storage.get(k) : f), set: (k, v) => storage.set(k, v), subscribe: () => () => {}, use: (k, f) => f },
    files: { list: () => Object.keys(ext.files), text: (p) => ext.files[p], url: (p) => (ext.files[p]?.startsWith("data:") ? ext.files[p] : null) },
    style: (css) => (calls.push(["style", css.length]), () => {}),
    onDispose() {},
    chat: { last: () => null },
  };
}

test("内置扩展和示例扩展在宿主包装里编译并激活", () => {
  const list = builtins();
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
    assert(calls.some((c) => c[0] === "settings"), `${ext.manifest.id} 没有设置面板`);
    if (cleanup) cleanup();
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
