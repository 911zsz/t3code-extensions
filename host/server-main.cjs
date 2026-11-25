/* T3X_SERVER_MAIN_V1 */
// 追加到 T3 Electron 主进程（main.cjs）末尾：后台扩展的落盘。
// 窗口里的宿主（background.js）交来该运行的后台脚本，写到 <T3 数据目录>/t3x-server，T3 后台从那里加载（server.mjs）。
// 主进程把这个目录放进 T3X_SERVER_DIR：T3 启动后台时继承主进程环境，所以只有我们的 app 启动的后台会加载后台扩展。
const t3xServerMain = (() => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const crypto = require("node:crypto");
  const ID_RE = /^[a-z0-9][a-z0-9.-]{1,63}$/;
  const LIMIT = { extensions: 64, installed: 256, code: 5 << 20, version: 40 }; // code 和窗口里单个文件的上限（install.js LIMITS.file）一致
  const fail = (msg) => {
    throw new Error(`t3x: ${msg}`);
  };

  /** 和 T3 主进程同一套规则（resolveDesktopBaseDir / resolveDesktopStateDir）：T3CODE_HOME 或 ~/.t3 下的 userdata。 */
  function serverDir(env, homedir, isDevelopment) {
    const configured = env.T3CODE_HOME?.trim();
    const base = configured || path.join(homedir, ".t3");
    return path.join(base, isDevelopment && !configured ? "dev" : "userdata", "t3x-server");
  }

  function writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  // 窗口传来的内容按不可信处理：id 会拼进路径，代码有大小上限。
  function check(payload) {
    if (!payload || typeof payload !== "object") fail("同步内容无效");
    const { extensions, installed } = payload;
    if (!Array.isArray(installed) || installed.length > LIMIT.installed || !installed.every((id) => typeof id === "string" && ID_RE.test(id))) fail("installed 无效");
    if (!Array.isArray(extensions) || extensions.length > LIMIT.extensions) fail("extensions 无效");
    const seen = new Set();
    for (const e of extensions) {
      if (!e || typeof e.id !== "string" || !ID_RE.test(e.id) || seen.has(e.id) || !installed.includes(e.id)) fail(`扩展 id 无效：${e?.id}`);
      if (typeof e.version !== "string" || e.version.length > LIMIT.version) fail(`${e.id} 的版本号无效`);
      if (typeof e.code !== "string" || e.code.length > LIMIT.code) fail(`${e.id} 的后台脚本无效或超过 5 MB`);
      seen.add(e.id);
    }
  }

  // 要往里写或者在里面删东西的目录必须是真目录：是符号链接（或文件）就停下，免得写到、删到链接指向的地方。
  function realDir(p) {
    fs.mkdirSync(p, { recursive: true, mode: 0o700 });
    if (!fs.lstatSync(p).isDirectory()) fail(`${p} 不是目录（可能是符号链接），不往里写也不清理`);
  }

  /** 写入启用的后台脚本和索引，清掉旧版本；卸载了的扩展连同数据目录一起删。返回每个扩展收下的 sha256。 */
  function sync(dir, payload) {
    check(payload);
    const codeRoot = path.join(dir, "code");
    const dataRoot = path.join(dir, "data");
    realDir(codeRoot); // 先查完再动手：任何一步不对都不写索引、不删东西
    realDir(dataRoot);
    for (const e of payload.extensions) realDir(path.join(codeRoot, e.id));
    const entries = payload.extensions.map((e) => {
      const sha256 = crypto.createHash("sha256").update(e.code, "utf8").digest("hex");
      const file = `code/${e.id}/${sha256}.mjs`; // 按内容命名：后台按文件 URL 导入，换版本就是换文件，不会撞上 ESM 缓存
      const abs = path.join(dir, file);
      if (!fs.existsSync(abs)) writeAtomic(abs, e.code);
      return { id: e.id, version: e.version, file, sha256 };
    });
    writeAtomic(path.join(dir, "index.json"), `${JSON.stringify({ version: 1, extensions: entries }, null, 2)}\n`);
    const current = new Map(entries.map((e) => [e.id, path.basename(e.file)]));
    for (const id of fs.readdirSync(codeRoot)) {
      const sub = path.join(codeRoot, id);
      if (!current.has(id)) fs.rmSync(sub, { recursive: true, force: true });
      else for (const f of fs.readdirSync(sub)) if (f !== current.get(id)) fs.rmSync(path.join(sub, f), { recursive: true, force: true });
    }
    // rmSync 不跟随符号链接：扩展在数据目录里建的链接只删链接本身。
    for (const id of fs.readdirSync(dataRoot)) if (!payload.installed.includes(id)) fs.rmSync(path.join(dataRoot, id), { recursive: true, force: true });
    return { extensions: entries.map(({ id, sha256 }) => ({ id, sha256 })) };
  }

  /** T3 后台写的加载结果；还没加载过时是空的。 */
  function status(dir) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return { extensions: {} };
      throw error;
    }
  }

  function install(electron) {
    const dir = serverDir(process.env, os.homedir(), !electron.app.isPackaged);
    process.env.T3X_SERVER_DIR = dir;
    // 和 T3 自己的 isMainFrameEvent 一样：只认窗口主框架发来的请求。
    const trusted = ({ sender, senderFrame }) => sender.getType() === "window" && Boolean(senderFrame) && senderFrame === sender.mainFrame;
    const guard = (fn) => (event, ...args) => {
      if (!trusted(event)) fail("只接受主窗口的请求");
      return fn(...args);
    };
    electron.ipcMain.handle("t3x:server:sync", guard((payload) => sync(dir, payload)));
    electron.ipcMain.handle("t3x:server:status", guard(() => status(dir)));
  }

  return { serverDir, sync, status, install };
})();
if (process.versions.electron && process.type === "browser") t3xServerMain.install(require("electron"));
// @node-only
module.exports = t3xServerMain;
