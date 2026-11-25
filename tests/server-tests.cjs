"use strict";
// 后台扩展（apiVersion 4）：清单、主进程落盘、后台宿主加载与额度读取、T3 后台补丁的锚点。
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const pure = require("../host/pure.js");
const serverMain = require("../host/server-main.cjs");

const ROOT = path.join(__dirname, "..");
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const quiet = { info() {}, error() {} };

module.exports = (test) => {
  test("后台扩展清单", () => {
    const ok = { id: "bg", apiVersion: 4, name: "Bg", version: "1.0.0", permissions: ["server"], entries: { server: "server.mjs" } };
    assert.deepEqual(pure.t3xCheckManifest(ok, { "server.mjs": "" }).server, ["server.mjs"]); // 只有后台脚本也算有入口
    assert.throws(() => pure.t3xCheckManifest({ ...ok, apiVersion: 3 }), /apiVersion 4/);
    assert.throws(() => pure.t3xCheckManifest({ ...ok, permissions: [] }), /server/);
    assert.throws(() => pure.t3xCheckManifest({ ...ok, entries: { server: "server.js" } }), /\.mjs/);
    assert.throws(() => pure.t3xCheckManifest({ ...ok, entries: { server: ["a.mjs"] } }), /\.mjs/);
    assert.throws(() => pure.t3xCheckManifest({ ...ok, entries: { server: "../x.mjs" } }), /路径/);
    assert.throws(() => pure.t3xCheckManifest(ok, {}), /缺少文件/);
    assert.throws(() => pure.t3xCheckManifest({ ...ok, entries: { web: "x.mjs", server: "x.mjs" } }, { "x.mjs": "" }), /两次/);
  });

  test("主进程落盘：校验输入、按内容命名、清理旧版本、卸载删数据", () => {
    assert.equal(serverMain.serverDir({}, "/Users/u", false), "/Users/u/.t3/userdata/t3x-server");
    assert.equal(serverMain.serverDir({}, "/Users/u", true), "/Users/u/.t3/dev/t3x-server");
    assert.equal(serverMain.serverDir({ T3CODE_HOME: " /tmp/h " }, "/Users/u", true), "/tmp/h/userdata/t3x-server"); // 和 T3 一样：设了 T3CODE_HOME 就不用 dev
    const dir = tmp("t3x-main-");
    try {
      for (const bad of [null, { installed: ["../x"], extensions: [] }, { installed: ["a1"], extensions: [{ id: "b1", version: "1", code: "" }] }, { installed: ["a1"], extensions: [{ id: "a1", version: "1", code: 1 }] }, { installed: ["a1"], extensions: [{ id: "a1", version: "1", code: "x".repeat((5 << 20) + 1) }] }]) {
        assert.throws(() => serverMain.sync(dir, bad), /t3x:/, JSON.stringify(bad)?.slice(0, 80));
      }
      const v1 = "export function activate(){}";
      const r1 = serverMain.sync(dir, { installed: ["a1", "b1"], extensions: [{ id: "a1", version: "1.0.0", code: v1 }] });
      assert.deepEqual(r1, { extensions: [{ id: "a1", sha256: sha(v1) }] });
      const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
      assert.deepEqual(index.extensions, [{ id: "a1", version: "1.0.0", file: `code/a1/${sha(v1)}.mjs`, sha256: sha(v1) }]);
      assert.equal(fs.readFileSync(path.join(dir, index.extensions[0].file), "utf8"), v1);
      fs.mkdirSync(path.join(dir, "data", "a1"), { recursive: true });
      fs.mkdirSync(path.join(dir, "data", "b1"), { recursive: true });
      const outside = tmp("t3x-outside-");
      fs.writeFileSync(path.join(outside, "keep.txt"), "x");
      fs.symlinkSync(outside, path.join(dir, "data", "b1", "link"));
      const v2 = "export function activate(){ return () => {}; }";
      serverMain.sync(dir, { installed: ["a1"], extensions: [{ id: "a1", version: "1.1.0", code: v2 }] });
      assert.deepEqual(fs.readdirSync(path.join(dir, "code", "a1")), [`${sha(v2)}.mjs`], "旧版本要删掉");
      assert(fs.existsSync(path.join(dir, "data", "a1")), "停用、升级不删数据");
      assert(!fs.existsSync(path.join(dir, "data", "b1")), "卸载了的扩展删数据");
      assert(fs.existsSync(path.join(outside, "keep.txt")), "删数据目录不能跟着符号链接删到外面");
      fs.rmSync(outside, { recursive: true, force: true });
      serverMain.sync(dir, { installed: ["a1"], extensions: [] }); // 停用
      assert(!fs.existsSync(path.join(dir, "code", "a1")) && fs.existsSync(path.join(dir, "data", "a1")), "停用：删代码、留数据");
      assert.deepEqual(serverMain.status(dir), { extensions: {} });

      // data / code 被换成指向别处的符号链接：拒绝同步，不碰链接指向的目录
      const elsewhere = tmp("t3x-elsewhere-");
      fs.mkdirSync(path.join(elsewhere, "victim"));
      fs.rmSync(path.join(dir, "data"), { recursive: true, force: true });
      fs.symlinkSync(elsewhere, path.join(dir, "data"));
      assert.throws(() => serverMain.sync(dir, { installed: [], extensions: [] }), /不是目录/);
      assert(fs.existsSync(path.join(elsewhere, "victim")), "不能删到 data 链接指向的目录里");
      fs.rmSync(path.join(dir, "data"));
      const indexText = fs.readFileSync(path.join(dir, "index.json"), "utf8");
      fs.rmSync(path.join(dir, "code"), { recursive: true, force: true });
      fs.symlinkSync(elsewhere, path.join(dir, "code"));
      assert.throws(() => serverMain.sync(dir, { installed: ["a1"], extensions: [{ id: "a1", version: "1", code: v1 }] }), /不是目录/);
      assert(fs.existsSync(path.join(elsewhere, "victim")) && !fs.existsSync(path.join(elsewhere, "a1")), "不能写到、删到 code 链接指向的目录里");
      assert.equal(fs.readFileSync(path.join(dir, "index.json"), "utf8"), indexText, "检查不过时索引不动");
      fs.rmSync(elsewhere, { recursive: true, force: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("后台宿主：加载扩展、接手额度、规整窗口、出错和哈希不符", async () => {
    const { t3xCreateServerHost } = await import(path.join(ROOT, "host", "server.mjs"));
    const dir = tmp("t3x-host-");
    try {
      const good = `export function activate(t3x) {
        return t3x.usage.registerSource({ driver: "antigravity", read: async (ctx) => {
          if (ctx.instanceId === "boom") throw new Error("agy 说不行");
          return { windows: [
            { id: "w", label: " Gemini · Weekly ", kind: "weekly", usedPercent: 34.1, resetsAt: "2026-12-01T07:52:02Z", windowDurationMins: 10080 },
            { id: "s", label: "Gemini · 5-hour", kind: "session", usedPercent: 120 },
            { id: "bad", label: "", kind: "weekly", usedPercent: 1 },
            { id: "x", label: "Other", kind: "nope", usedPercent: 0, resetsAt: "not a date" },
            { id: "y", label: "Proto", kind: "toString", usedPercent: 5, windowDurationMins: 1.5 },
          ] };
        } });
      }`;
      serverMain.sync(dir, { installed: ["good"], extensions: [{ id: "good", version: "1.0.0", code: good }] });
      const host = t3xCreateServerHost({ dir, log: quiet });
      assert.equal(await host.hasSource("antigravity"), true);
      assert.equal(host.status().good.state, "running");
      const usage = await host.readUsage("antigravity", { instanceId: "a" });
      assert.deepEqual(usage.windows, [
        { id: "s", label: "Gemini · 5-hour", kind: "session", usedPercent: 100 },
        { id: "w", label: "Gemini · Weekly", kind: "weekly", usedPercent: 34.1, resetsAt: "2026-12-01T07:52:02.000Z", windowDurationMins: 10080 },
        { id: "x", label: "Other", kind: "other", usedPercent: 0 },
        { id: "y", label: "Proto", kind: "other", usedPercent: 5 },
      ]);
      const failed = await host.readUsage("antigravity", { instanceId: "boom" });
      assert.deepEqual([failed.windows, failed.unavailable], [[], { reason: "probeFailed", message: "good：agy 说不行" }]);

      // 第二个扩展抢同一个来源：加载失败，不影响第一个
      const rival = `export function activate(t3x) { t3x.usage.registerSource({ driver: "antigravity", read: () => ({ windows: [] }) }); }`;
      serverMain.sync(dir, { installed: ["good", "rival"], extensions: [{ id: "good", version: "1.0.0", code: good }, { id: "rival", version: "1.0.0", code: rival }] });
      await host.reload();
      assert.match(host.status().rival.error, /已经由 good 接手/);
      assert.equal((await host.readUsage("antigravity", { instanceId: "a" })).windows.length, 4);

      // 文件被改过（和索引里的哈希对不上）就不加载
      serverMain.sync(dir, { installed: ["good"], extensions: [] });
      await host.reload();
      assert.equal(await host.hasSource("antigravity"), false, "停用后要撤掉来源");
      assert.equal((await host.readUsage("antigravity", {})).unavailable.reason, "probeFailed");
      const evil = `export function activate(t3x) { t3x.usage.registerSource({ driver: "antigravity", read: () => ({ windows: [] }) }); }`;
      const { extensions } = serverMain.sync(dir, { installed: ["good"], extensions: [{ id: "good", version: "1.0.1", code: evil }] });
      fs.writeFileSync(path.join(dir, "code", "good", `${extensions[0].sha256}.mjs`), good);
      await host.reload();
      assert.match(host.status().good.error, /SHA-256/);
      const written = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"));
      assert.equal(written.extensions.good.state, "error", "状态写给主进程读");
      assert.equal(await host.hasSource("antigravity"), true, "启用了却没加载起来：不退回 T3 自己的读取");
      assert.match((await host.readUsage("antigravity", {})).unavailable.message, /后台扩展 good 没有加载起来：.*SHA-256/);

      // 能解析但格式不对的索引不当成“全部停用”
      serverMain.sync(dir, { installed: ["good"], extensions: [{ id: "good", version: "1.0.0", code: good }] });
      await host.reload();
      fs.writeFileSync(path.join(dir, "index.json"), "{}");
      await host.reload();
      assert.equal(host.status().good.state, "running");
      assert.equal((await host.readUsage("antigravity", { instanceId: "a" })).windows.length, 4);

      // 扩展抛出的东西取不出说明时也不能让 readUsage reject
      const weird = `export function activate(t3x) { t3x.usage.registerSource({ driver: "antigravity", read: () => { throw { get message() { throw new Error("x"); } }; } }); }`;
      serverMain.sync(dir, { installed: ["good"], extensions: [{ id: "good", version: "1.0.3", code: weird }] });
      await host.reload();
      assert.equal((await host.readUsage("antigravity", {})).unavailable.message, "good：未知错误");

      // 不支持的 provider、读取超时之外的普通异常都变成错误状态
      const odd = `export function activate(t3x) { t3x.usage.registerSource({ driver: "codex", read: () => ({}) }); }`;
      serverMain.sync(dir, { installed: ["good"], extensions: [{ id: "good", version: "1.0.2", code: odd }] });
      await host.reload();
      assert.match(host.status().good.error, /不支持的额度来源/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const none = t3xCreateServerHost({ dir: undefined, log: quiet });
    assert.equal(await none.hasSource("antigravity"), false, "没有 T3X_SERVER_DIR（官方 app 启动的后台）时什么都不加载");
  });
};
