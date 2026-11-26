"use strict";
// apiVersion 5：主进程读扩展输出目录（server-main.cjs），以及 host.agent 发消息时拼给 T3 的参数（agent.js）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const serverMain = require("../host/server-main.cjs");

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** 单独求值 agent.js：宿主里它和 core.js 等拼在同一个函数里，这里把用到的外部名字换成桩。 */
function loadAgent({ chat, threads = [], projects = [], bridge = null } = {}) {
  const src = fs.readFileSync(path.join(__dirname, "..", "host", "agent.js"), "utf8");
  const React = { useMemo: (fn) => fn(), useRef: (v) => ({ current: v }), useCallback: (fn) => fn };
  const sent = [];
  const bind = {
    agent: {
      commands: { startTurn: "startTurn" },
      useCommand: (atom) => async (args) => (sent.push({ atom, ...args }), bind.agent.reply ?? { _tag: "Success" }),
      useThreads: () => threads,
      useProjects: () => projects,
    },
  };
  const L = (zh) => zh;
  const state = { chat };
  const api = new Function("bind", "React", "L", "state", "serverBridge", `${src.replace(/\blastChat\b/g, "state.chat")}\nreturn { agentApi, outputsApi, agentImages, agentProviders };`)(bind, React, L, state, bridge);
  return { ...api, bind, sent, state };
}

const PNG = `data:image/png;base64,${Buffer.from("fake png bytes").toString("base64")}`;
const chat = {
  environmentId: "env-1",
  providers: [
    { instanceId: "codex", driver: "codex", displayName: "Codex", enabled: true, status: "ready", supportedRuntimeModes: ["approval-required", "auto-accept-edits", "auto", "full-access"], models: [{ slug: "gpt-6.2-sol", name: "GPT-6.2 Sol", isDefault: true }] },
    { instanceId: "cursor", driver: "cursor", enabled: false, models: [] },
    { instanceId: "careful", driver: "codex", enabled: true, supportedRuntimeModes: ["approval-required"], models: [{ slug: "m" }] },
  ],
};
const rec = (permissions) => ({ manifest: { id: "desk-pets", permissions } });
const alive = () => ({ alive: true });

module.exports = (test) => {
  test("输出目录：只读扩展自己目录里的普通文件", () => {
    const base = tmp("t3x-out-");
    try {
      const root = serverMain.outputRoot(path.join(base, "userdata", "t3x-server"));
      assert.equal(root, path.join(base, "userdata", "t3x-out"));
      assert.equal(serverMain.readOutput(root, "pets", "a.png"), null, "目录还没建：当作不存在");
      const dir = serverMain.outputDir(root, "pets");
      assert.equal(dir, path.join(root, "pets"));
      fs.mkdirSync(path.join(dir, "job1"));
      fs.writeFileSync(path.join(dir, "job1", "sheet.png"), "PNG!");
      const got = serverMain.readOutput(root, "pets", "job1/sheet.png");
      assert.equal(Buffer.from(got.bytes).toString(), "PNG!");
      assert.equal(got.size, 4);
      assert.equal(serverMain.readOutput(root, "pets", "job1/missing.json"), null);
      fs.writeFileSync(path.join(dir, "job1", "empty.json"), "");
      assert.equal(serverMain.readOutput(root, "pets", "job1/empty.json").size, 0);
      for (const bad of ["../x", "job1/../../x", "/etc/passwd", "job1//sheet.png", ".hidden", "a\\b", "", "job1/", 42, "a/".repeat(9) + "b"]) {
        assert.throws(() => serverMain.readOutput(root, "pets", bad), /t3x:/, String(bad));
      }
      for (const badId of ["../pets", "Pets", "", null]) assert.throws(() => serverMain.readOutput(root, badId, "job1/sheet.png"), /t3x:/, String(badId));
      assert.throws(() => serverMain.readOutput(root, "pets", "job1"), /不是文件/);
      // 符号链接一律不跟：文件、中间目录都不行
      fs.writeFileSync(path.join(base, "secret.txt"), "secret");
      fs.symlinkSync(path.join(base, "secret.txt"), path.join(dir, "job1", "link.png"));
      assert.throws(() => serverMain.readOutput(root, "pets", "job1/link.png"), /符号链接/);
      fs.symlinkSync(base, path.join(dir, "up"));
      assert.throws(() => serverMain.readOutput(root, "pets", "up/secret.txt"), /符号链接/);
      // 命名管道：不是普通文件，不打开（打开会卡住主进程）
      require("node:child_process").execFileSync("mkfifo", [path.join(dir, "job1", "pipe.png")]);
      assert.throws(() => serverMain.readOutput(root, "pets", "job1/pipe.png"), /不是文件/);
      // 扩展目录本身是链接：建目录和读都拒绝
      fs.symlinkSync(base, path.join(root, "evil"));
      assert.throws(() => serverMain.outputDir(root, "evil"), /不是目录/);
      assert.throws(() => serverMain.readOutput(root, "evil", "secret.txt"), /符号链接/);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("输出目录：读的时候文件还在写，报错让调用方稍后再读", () => {
    const base = tmp("t3x-out-grow-");
    const readSync = fs.readSync;
    try {
      const root = serverMain.outputRoot(path.join(base, "userdata", "t3x-server"));
      const file = path.join(serverMain.outputDir(root, "pets"), "sheet.png");
      for (const [label, change] of [["变长", () => fs.appendFileSync(file, "MORE")], ["变短", () => fs.truncateSync(file, 2)]]) {
        fs.writeFileSync(file, "PNG!");
        let once = true;
        // 在 fstat 之后、第一次读之前改文件：模拟 agent 还在写
        fs.readSync = (...args) => (once && ((once = false), change()), readSync(...args));
        assert.throws(() => serverMain.readOutput(root, "pets", "sheet.png"), /还在写/, label);
        fs.readSync = readSync;
      }
      assert.equal(serverMain.readOutput(root, "pets", "sheet.png").size, 2, "写完了就能读");
      // 读到文件末尾以后、最后一次检查之前又写了：也算还在写
      let atEof = true;
      fs.readSync = (...args) => {
        const n = readSync(...args);
        if (n === 0 && atEof) (atEof = false), fs.appendFileSync(file, "MORE");
        return n;
      };
      assert.throws(() => serverMain.readOutput(root, "pets", "sheet.png"), /还在写/, "读完后变长");
      fs.readSync = readSync;
      // 硬链接可能指向输出目录外的文件
      fs.linkSync(file, path.join(base, "outside.png"));
      assert.throws(() => serverMain.readOutput(root, "pets", "sheet.png"), /硬链接/);
    } finally {
      fs.readSync = readSync;
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("host.agent：大图、空图和运行模式列表", () => {
    const { agentImages, agentProviders, state } = loadAgent({ chat });
    const big = Buffer.alloc(8_300_000, 0x5a);
    assert.equal(agentImages([{ dataUrl: `data:image/png;base64,${big.toString("base64")}` }])[0].sizeBytes, big.length, "几 MB 的图不能把正则撑爆");
    assert.deepEqual(["AA==", "AAA=", "AAAA"].map((b) => agentImages([{ dataUrl: `data:image/gif;base64,${b}` }])[0].sizeBytes), [1, 2, 3]);
    for (const b of ["", "A===", "====", "AAAA AAA"]) assert.throws(() => agentImages([{ dataUrl: `data:image/png;base64,${b}` }]), /data URL/, JSON.stringify(b));
    assert.throws(() => agentImages([{ dataUrl: `data:image/png;base64,${Buffer.alloc((10 << 20) + 1).toString("base64")}` }]), /10 MB/);

    state.chat = { ...chat, providers: [{ instanceId: "a", models: [] }, { instanceId: "b", supportedRuntimeModes: [], models: [] }] };
    const [a, b] = agentProviders();
    assert.ok(a.runtimeModes.length > 0);
    assert.deepEqual(b.runtimeModes, a.runtimeModes, "声明为空和没声明一样，给全部模式");
    const all = [...a.runtimeModes];
    a.runtimeModes.length = 0;
    assert.deepEqual(agentProviders()[0].runtimeModes, all, "调用方改了拿到的数组，不影响宿主");
  });

  test("输出目录：卸载的扩展连输出一起删，装着的（包括停用的）留着", () => {
    const base = tmp("t3x-out-sync-");
    try {
      const dir = path.join(base, "userdata", "t3x-server");
      const root = serverMain.outputRoot(dir);
      for (const id of ["kept", "gone"]) fs.writeFileSync(path.join(serverMain.outputDir(root, id), "a.png"), "x");
      serverMain.sync(dir, { installed: ["kept"], extensions: [] });
      assert.deepEqual(fs.readdirSync(root), ["kept"]);
      assert.equal(fs.readFileSync(path.join(root, "kept", "a.png"), "utf8"), "x");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("host.agent：权限、会话状态、新会话和已有会话的参数", async () => {
    // 字段结构照 T3 0.1.12 的 visibleThreadShellsAtom：运行状态在 runtime / latestRun 里
    const shell = (over) => ({ environmentId: "env-1", projectId: "p-1", providerInstanceId: "codex", modelSelection: { instanceId: "codex", model: "gpt-6.2-sol" }, runtimeMode: "auto", interactionMode: "default", runtime: null, latestRun: null, archivedAt: null, ...over });
    const threads = [
      shell({ id: "t-1", title: "Old", interactionMode: "plan", runtime: { status: "running", activeRunId: "r-1", lastError: null } }),
      shell({ id: "t-2", title: "Broken", runtime: { status: "failed", activeRunId: null, lastError: "provider crashed" }, latestRun: { runId: "r-2", status: "failed", completedAt: "2026-11-25T10:00:00.000Z" } }),
      shell({ id: "t-3", title: "Done", latestRun: { runId: "r-3", status: "completed", completedAt: "2026-11-25T11:00:00.000Z" } }),
    ];
    const other = [shell({ environmentId: "env-2", id: "t-9", title: "Elsewhere" })];
    const projects = [{ environmentId: "env-1", id: "p-1", title: "Scratch", isScratch: true }, { environmentId: "env-2", id: "p-9", title: "Other env" }];
    const { agentApi, sent, bind, state } = loadAgent({ chat, threads: [...threads, ...other], projects });

    assert.throws(() => agentApi(rec(["ui"]), alive()).providers(), /agent/, "没声明 agent 权限就不给用");
    const life = alive();
    const agent = agentApi(rec(["ui", "agent"]), life);
    assert.deepEqual(agent.providers().map((p) => [p.instanceId, p.enabled, p.models.map((m) => m.id)]), [["codex", true, ["gpt-6.2-sol"]], ["cursor", false, []], ["careful", true, ["m"]]]);
    assert.deepEqual(
      agent.useThreads().map((t) => [t.threadId, t.running, t.lastError, t.lastRunCompletedAt, t.interactionMode]),
      [
        ["t-1", true, null, null, "plan"],
        ["t-2", false, "provider crashed", "2026-11-25T10:00:00.000Z", "default"],
        ["t-3", false, null, "2026-11-25T11:00:00.000Z", "default"],
      ],
      "只列当前环境的会话，运行中 / 出错 / 完成时间从 runtime、latestRun 读",
    );
    assert.deepEqual(agent.useProjects().map((p) => [p.projectId, p.scratch]), [["p-1", true]]);

    const send = agent.useSend();
    const fresh = await send({ target: { newThread: { projectId: "p-1", title: "生成桌宠" } }, instanceId: "codex", model: "gpt-6.2-sol", runtimeMode: "full-access", text: "draw a pet", images: [{ name: "../ref.png", dataUrl: PNG }] });
    assert.equal(fresh.environmentId, "env-1");
    const first = sent.at(-1);
    assert.equal(first.atom, "startTurn");
    assert.equal(first.input.threadId, fresh.threadId);
    assert.deepEqual(first.input.bootstrap.createThread.projectId, "p-1");
    assert.equal(first.input.bootstrap.createThread.title, "生成桌宠");
    assert.deepEqual(first.input.modelSelection, { instanceId: "codex", model: "gpt-6.2-sol" });
    assert.equal(first.input.runtimeMode, "full-access");
    const [img] = first.input.message.attachments;
    assert.deepEqual([img.type, img.name, img.mimeType, img.sizeBytes], ["image", ".._ref.png", "image/png", Buffer.from("fake png bytes").length]);

    // 已有会话：用它自己的 harness、运行模式和交互模式，排在正在跑的那轮后面
    await send({ target: { threadId: "t-1" }, instanceId: "cursor", model: "gpt-6.2-sol", runtimeMode: "full-access", text: "redo row 3" });
    const second = sent.at(-1).input;
    assert.equal(second.threadId, "t-1");
    assert.equal(second.bootstrap, undefined);
    assert.deepEqual([second.modelSelection.instanceId, second.runtimeMode, second.interactionMode, second.dispatchMode], ["codex", "auto", "plan", "queue"]);

    const bad = (req, re, msg) => assert.rejects(send({ instanceId: "codex", model: "gpt-6.2-sol", runtimeMode: "auto", text: "x", target: { newThread: { projectId: "p-1" } }, ...req }), re, msg);
    await bad({ text: "  " }, /不能为空/);
    await bad({ model: "" }, /模型/);
    await bad({ instanceId: "cursor" }, /不可用/);
    await bad({ runtimeMode: "yolo" }, /运行模式/);
    await bad({ instanceId: "careful", model: "m", runtimeMode: "full-access" }, /运行模式/, "provider 没公布的运行模式不行");
    await bad({ target: { threadId: "t-9" } }, /找不到/, "别的环境的会话不能发");
    await bad({ target: { newThread: { projectId: "p-9" } } }, /找不到这个项目/, "别的环境的项目不能用");
    await bad({ target: {} }, /项目/);
    await bad({ images: [{ dataUrl: "data:text/html;base64,PGI+" }] }, /data URL/);
    await bad({ images: [{ dataUrl: "data:image/png;base64,AAA" }] }, /data URL/, "长度不对的 Base64");
    await bad({ images: [{ dataUrl: "data:image/png;base64,AA=A" }] }, /data URL/, "填充在中间");
    await bad({ images: Array.from({ length: 9 }, () => ({ dataUrl: PNG })) }, /最多/);
    // T3 0.1.12 的 Effect Cause：原因在 reasons[] 里
    bind.agent.reply = { _tag: "Failure", cause: { _id: "Cause", reasons: [{ _tag: "Fail", error: { _tag: "PermissionError", message: "provider offline" } }] } };
    await bad({}, /provider offline/);
    bind.agent.reply = { _tag: "Failure", cause: { reasons: [] } };
    await bad({}, /没有接受/);
    bind.agent.reply = undefined;

    // 渲染之后切到别的环境：拿着旧列表发会被拒绝，不会把 env-1 的会话 id 发到 env-2
    state.chat = { ...chat, environmentId: "env-2" };
    await bad({ target: { threadId: "t-1" } }, /当前环境里找不到这个会话/);
    await bad({ target: { newThread: { projectId: "p-1" } } }, /当前环境里找不到这个项目/);
    state.chat = chat;

    // 停用以后，之前拿到的 send 也不能再发
    life.alive = false;
    const count = sent.length;
    await bad({}, /已停用/);
    assert.equal(sent.length, count);
    assert.throws(() => agent.providers(), /已停用/);

    const noChat = loadAgent({ chat: null }).agentApi(rec(["agent"]), alive()).useSend();
    await assert.rejects(noChat({ instanceId: "codex", model: "m", runtimeMode: "auto", text: "x", target: { newThread: { projectId: "p" } } }), /先打开一个会话/);
  });

  test("host.outputs：按扩展 id 走主进程，桌面版以外和停用后报错", async () => {
    const calls = [];
    const bridge = { outDir: async (id) => (calls.push(["dir", id]), `/out/${id}`), outRead: async (id, rel) => (calls.push(["read", id, rel]), null) };
    const { outputsApi } = loadAgent({ chat, bridge });
    const life = alive();
    const out = outputsApi(rec([]), life);
    assert.equal(await out.dir(), "/out/desk-pets");
    assert.equal(await out.read("job/result.json"), null);
    assert.deepEqual(calls, [["dir", "desk-pets"], ["read", "desk-pets", "job/result.json"]]);
    life.alive = false;
    await assert.rejects(out.read("job/result.json"), /已停用/);
    await assert.rejects(loadAgent({ chat }).outputsApi(rec([]), alive()).dir(), /桌面版/);
  });
};
