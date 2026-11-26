/* T3X_SERVER_HOST_V1 */
// 注入 T3 后台主模块（server-*.mjs）：从 T3X_SERVER_DIR 加载后台扩展，给它们 t3x 接口。
// T3 读 Antigravity 额度的地方（补丁）通过 globalThis.__t3xServer 问这里有没有扩展接手。
// 目录由 Electron 主进程写（server-main.cjs）：index.json 列出启用的扩展，code/<id>/<sha256>.mjs 是代码，data/<id>/ 归扩展自己用。
export function t3xCreateServerHost({ dir, log = console, importModule = (href) => import(href), rpcRetryMs = 5000 } = {}) {
  const ID_RE = /^[a-z0-9][a-z0-9.-]{1,63}$/;
  const DRIVERS = new Set(["antigravity"]); // 目前只有这一处读取接上了扩展
  const KIND_ORDER = { session: 0, weekly: 1, monthly: 2, other: 3 }; // 和 T3 的 WINDOW_KIND_ORDER 一致
  const READ_TIMEOUT_MS = 60_000;
  const ACTIVATE_TIMEOUT_MS = 10_000; // 一个扩展的 import / activate 卡住时，别挡住整个重载队列
  const CALL_NAME_RE = /^[A-Za-z][\w.-]{0,63}$/; // 和 server-main.cjs 一致
  const CALL_TIMEOUT_MS = 50_000; // 比主进程的 60 秒短：超时说明从这里出，带上调用名
  const CALL_MAX = 256 << 10; // 请求、结果都按 UTF-8 字节算，和 server-main.cjs 一致
  const RESULT_MAX = 4 << 20;
  const REQUEST_DEADLINE_MS = 10_000; // 连上以后这么久还没收到完整请求就断开
  const sources = new Map(); // driver -> { id, read }
  const loaded = new Map(); // id -> { sha256, version, alive, disposers }
  const status = {}; // id -> { state: "running" | "error", error?, sha256, version }
  let uiLang = "en"; // 窗口同步时带来的界面语言
  let indexGen = null; // 已经应用的 index.json 的 SHA-256：主进程转来的调用带着它写过的那份，对不上就先重载
  let node = null;
  let started = null;
  let chain = Promise.resolve();
  let timer = null;

  const builtins = async () =>
    (node ??= {
      fs: await import("node:fs/promises"),
      fsSync: await import("node:fs"),
      path: await import("node:path"),
      url: await import("node:url"),
      crypto: await import("node:crypto"),
      net: await import("node:net"),
    });

  function unload(id) {
    const mod = loaded.get(id);
    if (!mod) return;
    loaded.delete(id);
    mod.alive = false;
    for (const fn of mod.disposers.splice(0).reverse()) {
      try {
        fn();
      } catch (error) {
        log.error(`[t3x] 后台扩展 ${id} 停用时出错`, error);
      }
    }
  }

  function makeApi(id, mod, path) {
    return Object.freeze({
      id,
      version: mod.version,
      /** 扩展自己的数据目录（不保证已存在）；卸载扩展时整个删掉。 */
      dataDir: path.join(dir, "data", id),
      log: (...args) => log.info(`[t3x:${id}]`, ...args),
      /** 界面语言（"zh" | "en"），切换后下一次读取就是新值（apiVersion 6）。 */
      lang: () => uiLang,
      /** 处理窗口里 host.server.call(name, data)：fn(data) 的返回值（可以是 Promise）要能转成 JSON（apiVersion 6）。 */
      handle(name, fn) {
        if (!mod.alive) throw new Error("扩展已停用");
        if (typeof name !== "string" || !CALL_NAME_RE.test(name)) throw new Error(`调用名无效：${String(name).slice(0, 80)}`);
        if (typeof fn !== "function") throw new Error("handle 需要处理函数");
        mod.handlers.set(name, fn);
        const off = () => {
          if (mod.handlers.get(name) === fn) mod.handlers.delete(name);
        };
        mod.disposers.push(off);
        return off;
      },
      usage: Object.freeze({
        /** 接手某个 provider 的额度读取。read(ctx) 返回 { windows: [{ id, label, kind, usedPercent, resetsAt?, windowDurationMins? }] }，出错就抛。 */
        registerSource({ driver, read } = {}) {
          if (!mod.alive) throw new Error("扩展已停用");
          if (!DRIVERS.has(driver)) throw new Error(`不支持的额度来源：${driver}`);
          if (typeof read !== "function") throw new Error("registerSource 需要 read 函数");
          const owner = sources.get(driver);
          if (owner && owner.id !== id) throw new Error(`${driver} 的额度已经由 ${owner.id} 接手`);
          const entry = { id, read };
          sources.set(driver, entry);
          const off = () => {
            if (sources.get(driver) === entry) sources.delete(driver);
          };
          mod.disposers.push(off);
          return off;
        },
      }),
    });
  }

  async function writeStatus() {
    const { fs, path, crypto } = await builtins();
    const file = path.join(dir, "status.json");
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify({ updatedAt: new Date().toISOString(), extensions: status }, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  async function loadOnce() {
    const { fs, path, url, crypto } = await builtins();
    let index;
    try {
      const text = await fs.readFile(path.join(dir, "index.json"), "utf8");
      indexGen = crypto.createHash("sha256").update(text).digest("hex");
      index = JSON.parse(text);
    } catch (error) {
      if (error.code !== "ENOENT") return log.error("[t3x] 读取后台扩展索引失败", error); // 半截的索引不当成“全部停用”
      index = { extensions: [] };
    }
    if (!Array.isArray(index?.extensions)) return log.error("[t3x] 后台扩展索引格式不对，保持现状"); // 只有明确的空数组才是“全部停用”
    uiLang = index.lang === "zh" ? "zh" : "en";
    const wanted = new Map();
    for (const e of index.extensions) {
      const ok = typeof e?.id === "string" && ID_RE.test(e.id) && typeof e.sha256 === "string" && /^[0-9a-f]{64}$/.test(e.sha256) && e.file === `code/${e.id}/${e.sha256}.mjs`;
      if (ok) wanted.set(e.id, e);
      else log.error("[t3x] 忽略无效的后台扩展条目", e?.id);
    }
    for (const [id, mod] of [...loaded]) if (wanted.get(id)?.sha256 !== mod.sha256) unload(id);
    for (const id of Object.keys(status)) if (!wanted.has(id)) delete status[id];
    for (const [id, e] of wanted) {
      if (loaded.has(id)) continue;
      const file = path.join(dir, e.file);
      const mod = { sha256: e.sha256, version: typeof e.version === "string" ? e.version : "", alive: true, disposers: [], handlers: new Map() };
      try {
        const code = await fs.readFile(file);
        if (crypto.createHash("sha256").update(code).digest("hex") !== e.sha256) throw new Error("文件和索引里的 SHA-256 不一致");
        loaded.set(id, mod);
        // 超时后 unload 会把 mod.alive 置 false：晚到的 activate 再登记来源会被拒绝，返回的清理函数也会马上调用。
        const off = await withTimeout(
          (async () => {
            const exported = await importModule(url.pathToFileURL(file).href);
            if (typeof exported?.activate !== "function") throw new Error("后台脚本没有导出 activate(t3x)");
            const off = await exported.activate(makeApi(id, mod, path));
            if (typeof off === "function" && !mod.alive) off();
            return off;
          })(),
          ACTIVATE_TIMEOUT_MS,
          `加载超过 ${ACTIVATE_TIMEOUT_MS / 1000} 秒`,
        );
        if (typeof off === "function") mod.disposers.push(off);
        status[id] = { state: "running", sha256: e.sha256, version: mod.version };
      } catch (error) {
        unload(id);
        status[id] = { state: "error", error: describe(error, 500), sha256: e.sha256, version: mod.version };
        log.error(`[t3x] 后台扩展 ${id} 加载失败`, error);
      }
    }
    await writeStatus();
  }

  /** 串行重载：主进程连写几次时不会两次加载交错。 */
  function reload() {
    chain = chain.then(loadOnce).catch((error) => log.error("[t3x] 加载后台扩展失败", error));
    return chain;
  }

  // 主进程转来的 host.server.call：一条连接一次调用，读一行 {ext, name, data}，回一行 {ok, result | error}。
  // 能连上 socket 的只有这个用户（目录 0700），和能改 code/ 目录的是同一批人，所以不再另做认证。
  function serve(conn) {
    let buf = "";
    let size = 0;
    conn.setEncoding("utf8");
    conn.setTimeout(REQUEST_DEADLINE_MS, () => conn.destroy());
    conn.on("error", () => {}); // 主进程超时后先断开：写回复时的 EPIPE 不用管
    conn.on("data", (chunk) => {
      buf += chunk;
      size += Buffer.byteLength(chunk);
      if (size > CALL_MAX + 1024) return conn.destroy();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      conn.removeAllListeners("data");
      conn.setTimeout(0); // 处理函数自己有超时
      answer(buf.slice(0, nl)).then((reply) => conn.end(`${reply}\n`));
    });
  }

  async function answer(line) {
    try {
      const { ext, name, data, gen } = JSON.parse(line);
      // 窗口刚同步完（换版本、切语言）时文件监视还没触发重载：按主进程写的那份索引先重载，否则等正在进行的重载
      if (typeof gen === "string" && gen !== indexGen) await reload();
      else await chain;
      const mod = loaded.get(ext);
      const fn = mod?.alive ? mod.handlers.get(name) : undefined;
      if (!fn) throw new Error(mod?.alive ? `${ext} 没有登记 ${name}` : `后台扩展 ${ext} 没有在运行`);
      const result = await withTimeout(
        Promise.resolve().then(() => fn(data)),
        CALL_TIMEOUT_MS,
        `${name} 超过 ${CALL_TIMEOUT_MS / 1000} 秒没有结果`,
      );
      const reply = JSON.stringify({ ok: true, result: result ?? null });
      if (Buffer.byteLength(reply) > RESULT_MAX) throw new Error(`${name} 的结果超过 4 MB`);
      return reply;
    } catch (error) {
      return JSON.stringify({ ok: false, error: describe(error, 500) });
    }
  }

  const answering = (net, sock) =>
    new Promise((resolve) => {
      const c = net.connect(sock);
      c.once("connect", () => (c.destroy(), resolve(true)));
      c.once("error", () => resolve(false));
    });

  // 另一个后台还在用这个 socket（T3 重启后台的空档、多起了一个后台）就不抢，过一会儿再看，它退了再接手。
  // 同名的不是 socket（文件、符号链接）不删也不用。
  async function listen() {
    const { fs, path, net } = await builtins();
    const sock = path.join(dir, "rpc.sock");
    const st = await fs.lstat(sock).catch((error) => (error.code === "ENOENT" ? null : Promise.reject(error)));
    if (st && !st.isSocket()) throw new Error(`${sock} 不是 socket，不删也不用`);
    if (st && !(await answering(net, sock))) await fs.rm(sock, { force: true }); // 上次的后台留下的
    const server = net.createServer(serve);
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(sock, resolve);
      });
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      setTimeout(() => listen().catch((e) => log.error("[t3x] 开不了后台调用通道", e)), rpcRetryMs).unref?.();
      return;
    }
    await fs.chmod(sock, 0o600);
    server.on("error", (error) => log.error("[t3x] 后台调用通道出错", error));
    server.unref();
  }

  /** T3 后台启动时开始（补丁里调用；hasSource 也会兜底调用），之后盯着目录变化。先开监视再首次加载：加载期间窗口改了索引也不会漏。 */
  function start() {
    if (!dir) return Promise.resolve();
    started ??= (async () => {
      const { fs, fsSync } = await builtins();
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      // 代码和 socket 都在这里：必须是自己的真目录（不是符号链接），别人进不来
      const st = await fs.lstat(dir);
      if (!st.isDirectory() || (process.getuid && st.uid !== process.getuid())) throw new Error(`${dir} 不是自己的目录（可能是符号链接），不加载后台扩展`);
      if (st.mode & 0o077) await fs.chmod(dir, 0o700);
      // 调用通道开不起来不挡加载：额度读取照常，只是 host.server.call 会报“还没准备好”
      await listen().catch((error) => log.error("[t3x] 开不了后台调用通道", error));
      const watcher = fsSync.watch(dir, (_event, name) => {
        if (name && name !== "index.json") return; // 自己写的 status.json、rpc.sock 不触发
        clearTimeout(timer);
        timer = setTimeout(reload, 300);
      });
      watcher.on("error", (error) => log.error("[t3x] 监视后台扩展目录失败", error));
      watcher.unref?.();
      await reload();
    })().catch((error) => {
      started = null; // 下次用到时重试
      log.error("[t3x] 启动后台扩展失败", error);
    });
    return started;
  }

  function normalizeWindows(windows) {
    if (!Array.isArray(windows)) return [];
    const out = new Map();
    for (const w of windows.slice(0, 32)) {
      if (!w || typeof w.id !== "string" || !/^[\w.:-]{1,80}$/.test(w.id) || typeof w.label !== "string" || !w.label.trim()) continue;
      if (typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) continue;
      const resetsAt = typeof w.resetsAt === "string" && Number.isFinite(Date.parse(w.resetsAt)) ? new Date(w.resetsAt).toISOString() : undefined;
      const mins = Number.isSafeInteger(w.windowDurationMins) && w.windowDurationMins > 0 ? w.windowDurationMins : undefined; // T3 的 schema 要整数
      out.set(w.id, {
        id: w.id,
        label: w.label.trim().slice(0, 80),
        kind: Object.hasOwn(KIND_ORDER, w.kind) ? w.kind : "other",
        usedPercent: Math.max(0, Math.min(100, w.usedPercent)),
        ...(resetsAt ? { resetsAt } : {}),
        ...(mins ? { windowDurationMins: mins } : {}),
      });
    }
    return [...out.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id));
  }

  /** 扩展抛出的东西可能是任何值（getter 会抛、toString 会抛），取说明时不能再抛。 */
  function describe(error, max) {
    try {
      return String(error?.message ?? error).slice(0, max) || "未知错误";
    } catch {
      return "未知错误";
    }
  }

  function withTimeout(promise, ms, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))]).finally(() => clearTimeout(timer));
  }

  const unavailable = (checkedAt, message) => ({ checkedAt, windows: [], unavailable: { reason: "probeFailed", message } });

  // 启用了却没加载起来的后台扩展：可能就是接手额度的那个，这时不能悄悄退回 T3 自己的读取。
  // shortcut: 不知道失败的扩展原本要接手哪个 provider，就当它都接手；以后支持多个 provider 时让清单声明。
  const failed = () => Object.entries(status).find(([, s]) => s.state === "error");

  return {
    /** 有没有启用的扩展接手这个 provider 的额度（包括启用了但加载失败的）。 */
    async hasSource(driver) {
      await start();
      await chain; // 等正在进行的重载结束：换版本的空档里别退回 T3 自己的读取
      return sources.has(driver) || (DRIVERS.has(driver) && failed() !== undefined);
    },
    /** 交给扩展读额度，转成 T3 的 usageLimits；从不 reject（T3 那边按 Effect.promise 调用）。 */
    async readUsage(driver, ctx) {
      const checkedAt = new Date().toISOString();
      const src = sources.get(driver);
      if (!src) {
        const bad = failed();
        return unavailable(checkedAt, bad ? `后台扩展 ${bad[0]} 没有加载起来：${bad[1].error}` : "接手额度读取的扩展已停用");
      }
      let timeout;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => src.read(Object.freeze({ ...ctx }))),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error(`超过 ${READ_TIMEOUT_MS / 1000} 秒没有结果`)), READ_TIMEOUT_MS);
          }),
        ]);
        const windows = normalizeWindows(result?.windows);
        return windows.length ? { checkedAt, windows } : unavailable(checkedAt, `${src.id}：没有返回额度`);
      } catch (error) {
        return unavailable(checkedAt, `${src.id}：${describe(error, 300)}`);
      } finally {
        clearTimeout(timeout);
      }
    },
    reload,
    start,
    status: () => structuredClone(status),
  };
}
