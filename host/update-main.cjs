/* T3X_UPDATE_MAIN_V1 */
// 追加到 T3 Electron 主进程（main.cjs）末尾，接在 server-main.cjs 后面：宿主自己的更新（设置 → 扩展 顶部的“更新”）。
// 下载都在主进程里做（Electron 的 net 走系统代理）：本项目这个 tag 的源码包；「应用程序」里的官方版不是新版针对的 T3 版本时，再下官方安装包。
// 下载出错用户还在 app 里。都下好了，用 app 自带的 Electron 当 Node 跑新版的 install.cjs update（脱离本进程），然后退出 app；
// 更新器等 app 完全退出后重装、重新打开，结果写到 update-result.json，下次启动时窗口里的宿主读出来提示（见 self-update.js）。
const t3xUpdateMain = (() => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const { execFile, execFileSync, spawn } = require("node:child_process");
  const { promisify } = require("node:util");
  const { Readable } = require("node:stream");
  const { pipeline } = require("node:stream/promises");

  // 按仓库 ID 下载（和 self-update.js 的 HOST_REPO_ID 一致）：仓库或账号改名、旧名字被别人占用时也不会下到别人的代码
  const REPO_ID = 1471226568;
  const OFFICIAL_APP = "/Applications/T3 Code (Beta).app"; // 和 install.cjs 的 DEFAULT_SOURCE 一致
  const TAG_RE = /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/;
  const SHA_RE = /^[0-9a-f]{40}$/;
  const STALE_MS = 60 * 60 * 1000;
  const PREVIOUS_APP = "T3 Code Extensions.app"; // install.cjs update 换包时把旧版挪到下载目录里的名字
  const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
  const MAX = { source: 32 << 20, official: 1 << 30 };
  const cacheDir = (home) => path.join(home, "Library", "Caches", "t3code-extensions");
  const fail = (msg) => {
    throw new Error(`t3x: ${msg}`);
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** 下载到文件；超过上限、没下完都报错。onProgress(已下载, 总大小或 0)。 */
  async function download(fetch, url, file, max, onProgress) {
    const res = await fetch(url);
    if (!res.ok) fail(`下载失败（HTTP ${res.status}）：${url}`);
    const total = Number(res.headers.get("content-length")) || 0;
    if (total > max) fail(`${url} 超过 ${max >> 20} MB`);
    let got = 0;
    onProgress(0, total);
    await pipeline(
      Readable.fromWeb(res.body),
      async function* (src) {
        for await (const chunk of src) {
          got += chunk.length;
          if (got > max) fail(`${url} 超过 ${max >> 20} MB`);
          onProgress(got, total);
          yield chunk;
        }
      },
      fs.createWriteStream(file, { mode: 0o600 }),
    );
    if (total && got !== total) fail(`没有下载完整：${url}`);
  }

  /** 官方版的版本号；没装或那里放的不是官方 T3（Bundle ID 不对）返回 null，这时要下官方包。 */
  function officialVersion(app = OFFICIAL_APP) {
    const read = (key) => execFileSync("plutil", ["-extract", key, "raw", "-o", "-", path.join(app, "Contents", "Info.plist")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    try {
      return read("CFBundleIdentifier") === "com.t3tools.t3code" ? read("CFBundleShortVersionString") : null;
    } catch {
      return null;
    }
  }

  /**
   * 下载并解开这一版，返回下载目录和更新器的命令行参数。release 来自窗口：{ tag: "vX.Y.Z", sha: tag 指向的提交 }，
   * 窗口确认时读的就是这个提交的 package.json；这里按同一个提交下载，下载地址都在这里拼。
   * deps：fetch、home、arch、official（「应用程序」里官方版的版本号）、progress({ step, got, total })。
   */
  async function prepare(release, { fetch, home, arch, official, progress }) {
    const { tag, sha } = release ?? {};
    if (typeof tag !== "string" || !TAG_RE.test(tag)) fail(`版本号无效：${String(tag).slice(0, 40)}`);
    if (typeof sha !== "string" || !SHA_RE.test(sha)) fail("提交号无效");
    const root = cacheDir(home);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    // 上次没走完的下载目录：一小时以上没动的才清，免得删到还在跑的更新器手里的；
    // 里面有旧版 app 的是回滚失败时留下的唯一一份（install.cjs update 会报出路径），永远不清
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      if (!name.startsWith("work-") || fs.existsSync(path.join(dir, PREVIOUS_APP))) continue;
      if (Date.now() - fs.statSync(dir).mtimeMs > STALE_MS) fs.rmSync(dir, { recursive: true, force: true });
    }
    const work = fs.mkdtempSync(path.join(root, "work-"));
    const tgz = path.join(work, "source.tar.gz");
    await download(fetch, `https://api.github.com/repositories/${REPO_ID}/tarball/${sha}`, tgz, MAX.source, (got, total) => progress({ step: "source", got, total }));
    const src = path.join(work, "source");
    fs.mkdirSync(src);
    await promisify(execFile)("/usr/bin/tar", ["-xzf", tgz, "-C", src, "--strip-components=1"]); // bsdtar 默认拒绝绝对路径和 ..；异步，不卡主进程
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
    } catch {
      fail(`${tag} 里没有可读的 package.json`);
    }
    // 更新器起来以后 app 就退出了：脚本不对就在这里停下，用户还在 app 里
    if (pkg?.version !== tag.slice(1) || !VERSION_RE.test(pkg?.t3Version ?? "") || !fs.existsSync(path.join(src, "install.cjs"))) fail(`${tag} 不是能自动更新的版本`);
    if (official !== pkg.t3Version) {
      const v = pkg.t3Version;
      const file = `T3-Code-${v}-${arch === "arm64" ? "arm64" : "x64"}.zip`;
      await download(fetch, `https://github.com/pingdotgg/t3code/releases/download/v${v}/${file}`, path.join(work, "official.zip"), MAX.official, (got, total) => progress({ step: "official", version: v, got, total }));
    }
    return { work, args: [path.join(src, "install.cjs"), "update", work] };
  }

  let state = { phase: "idle" }; // idle | downloading { step, got, total } | restarting | error { error }

  /** 开始更新，立刻返回；进度用 status() 读。deps 见 prepare，另有 execPath、spawn、quit、readyTimeout。 */
  function start(release, deps) {
    if (state.phase === "downloading" || state.phase === "restarting") fail("已经在更新了");
    state = { phase: "downloading", step: "source", got: 0, total: 0 };
    run(release, deps).catch((error) => {
      state = { phase: "error", error: String(error?.message ?? error).replace(/^t3x: /, "") };
    });
    return true;
  }

  async function run(release, deps) {
    const { work, args } = await prepare(release, { ...deps, progress: (p) => (state = { phase: "downloading", ...p }) });
    const logFile = path.join(cacheDir(deps.home), "update.log");
    const log = fs.openSync(logFile, "w");
    let child;
    try {
      // ELECTRON_RUN_AS_NODE：用 app 自带的 Electron 当 Node（T3 自己的子进程也这样起），不依赖装没装 Node。
      // ELECTRON_NO_ASAR：不然 fs 会把 app.asar 当目录读，更新器要把它当普通文件读写
      const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", ELECTRON_NO_ASAR: "1" };
      child = deps.spawn(deps.execPath, args, { detached: true, stdio: ["ignore", log, log], env });
    } finally {
      fs.closeSync(log);
    }
    // 等更新器写出 ready（参数校验完、自己的代码加载完）再退出 app：它起不来时用户还在 app 里，而不是 app 关了没人重新打开
    let exited = null;
    let spawnError = null;
    child.once("exit", (code, signal) => (exited = code ?? signal));
    child.once("error", (error) => (spawnError = error));
    // 报到以后它只剩等 app 退出这一件事，不会自己退出：报到前后退出了都算没起来
    const alive = () => {
      if (spawnError) fail(`更新器没有起来：${spawnError.message}`);
      if (exited !== null) fail(`更新器没有起来（${exited}），详见 ${logFile}`);
    };
    for (const end = Date.now() + (deps.readyTimeout ?? 20_000); (alive(), !fs.existsSync(path.join(work, "ready"))); await sleep(100)) {
      if (Date.now() > end) {
        child.kill();
        fail(`更新器没有响应，详见 ${logFile}`);
      }
    }
    await sleep(300); // 写完 ready 马上出错退出的，exit 事件这时也到了
    alive();
    child.unref();
    state = { phase: "restarting" };
    deps.quit();
  }

  /** 上次更新的结果（更新器写的），读一次就删；没有返回 null。 */
  function takeResult(home) {
    const file = path.join(cacheDir(home), "update-result.json");
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    fs.rmSync(file, { force: true });
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: "更新结果文件损坏" };
    }
  }

  function install(electron, guard) {
    const home = os.homedir();
    const deps = () => ({
      fetch: (url) => electron.net.fetch(url),
      home,
      arch: process.arch,
      official: officialVersion(),
      execPath: process.execPath,
      spawn,
      quit: () => electron.app.quit(),
    });
    electron.ipcMain.handle("t3x:update:start", guard((release) => start(release, deps())));
    electron.ipcMain.handle("t3x:update:status", guard(() => state));
    electron.ipcMain.handle("t3x:update:result", guard(() => takeResult(home)));
  }

  return { cacheDir, prepare, start, status: () => state, takeResult, install };
})();
if (process.versions.electron && process.type === "browser") t3xUpdateMain.install(require("electron"), t3xServerMain.guard);
// @node-only
module.exports = t3xUpdateMain;
