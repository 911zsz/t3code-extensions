// 后台扩展（apiVersion 4 的 entries.server）：把该运行的后台脚本交给 Electron 主进程写盘，T3 后台从那里加载（见 server.mjs）。
// 入口 t3xServerBridge.claim() 只能领一次：宿主模块加载时先领走，之后才启用扩展，界面扩展拿不到它。

const serverBridge = typeof window === "undefined" ? null : (window.t3xServerBridge?.claim?.() ?? null);
let serverSent = null; // 上次交给主进程的集合签名
let serverQueued = false;
let serverStatus = {}; // T3 后台写的状态：id -> { state, error, sha256 }
let serverSha = {}; // 主进程收下的版本：id -> sha256，用来认出状态是不是当前这份代码的
let serverSyncError = null;
const serverKeep = new Set(); // 正在卸载、还没写完盘的 id：写盘成功前不让主进程删它的数据
let statusTimers = [];

const hasServer = (rec) => t3xEntryList(rec.manifest).server.length > 0;
const serverCode = (rec) => rec.files[t3xEntryList(rec.manifest).server[0]];

// 签名只用来判断集合变没变，长度 + FNV-1a 就够；完整性由主进程算 SHA-256。记录换新时缓存跟着丢。
function serverKey(rec) {
  if (rec.serverKey) return rec.serverKey;
  const code = serverCode(rec) ?? "";
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 16777619);
  rec.serverKey = `${rec.manifest.id}@${rec.manifest.version}:${code.length}:${(h >>> 0).toString(16)}`;
  return rec.serverKey;
}

function queueServerSync() {
  // 扩展数据没读出来时 records 是空的：这时同步会让主进程把所有后台扩展当成已卸载、删掉数据。
  if (!serverBridge || !ready || !persistent || serverQueued) return;
  serverQueued = true;
  queueMicrotask(() => {
    serverQueued = false;
    syncServer();
  });
}

async function syncServer() {
  // installed 列出所有装着的扩展（不只带后台的）：升级成纯界面版本时不删它的后台数据，只有卸载才删。
  const installed = [...new Set([...records.keys(), ...serverKeep])].sort();
  const running = [...records.values()].filter((r) => hasServer(r) && shouldRun(r));
  const lang = isZh() ? "zh" : "en"; // 后台扩展的 t3x.lang()
  const sig = JSON.stringify([installed, running.map(serverKey).sort(), lang]);
  if (sig === serverSent) return;
  serverSent = sig; // 失败了也不清：同一份内容不反复重试，集合变化时再发
  try {
    const result = await serverBridge.sync({
      installed,
      lang,
      extensions: running.map((r) => ({ id: r.manifest.id, version: r.manifest.version, code: serverCode(r) })),
    });
    serverSha = Object.fromEntries((result?.extensions ?? []).map((e) => [e.id, e.sha256]));
    serverSyncError = null;
  } catch (error) {
    serverSyncError = String(error?.message ?? error);
    console.error(TAG, "后台扩展同步失败", error);
  }
  refreshServerStatus();
  bump();
}

if (serverBridge) subscribeLang(queueServerSync); // 切语言时告诉后台

/** apiVersion 6：host.server.call(name, data) 调用扩展自己的后台用 t3x.handle 登记的函数；没有后台入口的扩展没有这个接口。 */
function serverApi(rec, life) {
  if (!hasServer(rec)) return undefined;
  return Object.freeze({
    async call(name, data) {
      if (!life.alive) throw new Error(L("扩展已停用", "The extension is disabled"));
      if (!serverBridge?.call) throw new Error(L("后台代码只能在 T3 Code Extensions 桌面版里运行", "Background code runs only in the T3 Code Extensions desktop app."));
      try {
        return await serverBridge.call(rec.manifest.id, name, data);
      } catch (error) {
        // ipcRenderer.invoke 会给主进程的错误加上前缀，扩展拿到的只留说明
        throw new Error(String(error?.message ?? error).replace(/^Error invoking remote method '[^']*': (?:Error: )?(?:t3x: )?/, ""));
      }
    },
  });
}

/** T3 后台发现目录变化后才加载，过一会儿再读几次状态。设置页打开时也调用。 */
function refreshServerStatus() {
  if (!serverBridge) return;
  for (const t of statusTimers) clearTimeout(t);
  statusTimers = [0, 1500, 5000].map((ms) => setTimeout(readServerStatus, ms));
}

async function readServerStatus() {
  try {
    const next = (await serverBridge.status())?.extensions ?? {};
    if (JSON.stringify(next) === JSON.stringify(serverStatus)) return;
    serverStatus = next;
    bump();
  } catch (error) {
    console.error(TAG, "读取后台扩展状态失败", error);
  }
}

/** 卡片上显示的后台问题；没有问题或还没加载完时返回 null。 */
function serverErrorOf(rec) {
  if (!hasServer(rec) || !shouldRun(rec)) return null;
  if (!serverBridge) return L("后台代码只能在 T3 Code Extensions 桌面版里运行", "Background code runs only in the T3 Code Extensions desktop app.");
  if (serverSyncError) return L(`后台代码没能交给 T3：${serverSyncError}`, `Couldn’t hand the background code to T3: ${serverSyncError}`);
  const s = serverStatus[rec.manifest.id];
  if (!s || s.sha256 !== serverSha[rec.manifest.id]) return null;
  return s.state === "error" ? L(`后台代码出错：${s.error}`, `Background code error: ${s.error}`) : null;
}
