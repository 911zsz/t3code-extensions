"use strict";
// 后台扩展（apiVersion 4）的三处补丁，针对 T3 Code 0.1.12：
//   preload：给主窗口一个只能领一次的入口 t3xServerBridge，窗口里的宿主先领走（background.js）；apiVersion 5 起也用它读扩展的输出目录，6 起转发 host.server.call。
//   主进程：收下启用的后台脚本写到 <T3 数据目录>/t3x-server，并用 T3X_SERVER_DIR 告诉后台（server-main.cjs）。
//         另有宿主自己的更新：下载新版、退出 app 交给更新器（update-main.cjs），preload 的 update.* 转发过去。
//   T3 后台：加载后台扩展（server.mjs）；创建 Antigravity 额度读取的地方先问有没有扩展接手。
const fs = require("node:fs");
const path = require("node:path");
const { replaceOnce, stripMap } = require("./patch.cjs");

const HOST = path.join(__dirname, "..", "host");
const nodeOnly = (text) => text.split("// @node-only")[0];

const PRELOAD_MARKER = "/* T3X_SERVER_BRIDGE_V1 */";
const PRELOAD_CODE = `${PRELOAD_MARKER}
;(() => {
  const { contextBridge, ipcRenderer } = require("electron");
  let claimed = false; // 窗口里的 t3x 宿主模块加载时先领走，之后再领（界面扩展）拿到 null
  contextBridge.exposeInMainWorld("t3xServerBridge", {
    claim() {
      if (claimed) return null;
      claimed = true;
      return {
        sync: (payload) => ipcRenderer.invoke("t3x:server:sync", payload),
        status: () => ipcRenderer.invoke("t3x:server:status"),
        outDir: (id) => ipcRenderer.invoke("t3x:out:dir", id),
        outRead: (id, rel) => ipcRenderer.invoke("t3x:out:read", id, rel),
        call: (id, name, data) => ipcRenderer.invoke("t3x:server:call", id, name, data),
        update: {
          start: (release) => ipcRenderer.invoke("t3x:update:start", release),
          status: () => ipcRenderer.invoke("t3x:update:status"),
          result: () => ipcRenderer.invoke("t3x:update:result"),
        },
      };
    },
  });
})();
`;

const preloadPatch = {
  id: "server-preload",
  label: "Electron preload",
  targetRegex: /^apps\/desktop\/dist-electron\/preload\.cjs$/,
  originalHash: "b16e220e5a5a984d30b200e2a6b540bba974908bc0cee71a3841d40339534dca",
  marker: PRELOAD_MARKER,
  module: "commonjs",
  apply: (text) => `${stripMap(text)}\n${PRELOAD_CODE}`,
};

const mainServerPatch = {
  id: "server-main",
  label: "Electron 主进程",
  targetRegex: /^apps\/desktop\/dist-electron\/main\.cjs$/,
  originalHash: "3767e3a14ef66756b8e404e11a2a472bb22c1993f710b932653f24bd29f50cdd",
  marker: "/* T3X_SERVER_MAIN_V1 */",
  module: "commonjs",
  apply: (text) => [stripMap(text), ...["server-main.cjs", "update-main.cjs"].map((f) => nodeOnly(fs.readFileSync(path.join(HOST, f), "utf8")))].join("\n"),
};

// 包住 T3 的 Antigravity 额度读取（usage.probe）。gen / promise / option 是这个模块从 Effect 导入的名字；
// installation、settings、processEnvironment、instanceId、profileDirectory、auth 是 Antigravity driver 里的局部变量。
const ANTIGRAVITY_PROBE = `gen(function* () {
\t\t\tconst t3x = globalThis.__t3xServer;
\t\t\tif (!t3x || !String(auth.authMethod).startsWith("oauth-") || !(yield* promise(() => t3x.hasSource("antigravity")))) return yield* usage.probe;
\t\t\tconst t3xInstallation = yield* installation.resolve(settings.binaryPath, processEnvironment).pipe(option);
\t\t\treturn yield* promise(() => t3x.readUsage("antigravity", {
\t\t\t\tinstanceId,
\t\t\t\tprofileDirectory,
\t\t\t\tauthMethod: auth.authMethod,
\t\t\t\texecutablePath: t3xInstallation._tag === "Some" ? t3xInstallation.value.executablePath : void 0,
\t\t\t\tenvironment: { ...processEnvironment }
\t\t\t}));
\t\t})`;

const SERVER_MARKER = "/* T3X_SERVER_HOST_V1 */";
function serverHostSource() {
  const src = fs.readFileSync(path.join(HOST, "server.mjs"), "utf8");
  return replaceOnce(src, "export function t3xCreateServerHost", "function t3xCreateServerHost", "后台宿主入口");
}

const serverPatch = {
  id: "server-host",
  label: "T3 后台主模块",
  targetRegex: /^apps\/server\/dist\/server-[\w-]{8}\.mjs$/,
  originalHash: "b9adf0ff1927aeab159b16b1d123eb41d71bf093f8f4bec860e17b0c087888e5",
  marker: SERVER_MARKER,
  apply(text) {
    let out = replaceOnce(
      text,
      "const provider = yield* makeAntigravityProvider(settings, {",
      `const t3xUsageProbe = ${ANTIGRAVITY_PROBE};\n\t\tconst provider = yield* makeAntigravityProvider(settings, {`,
      "Antigravity provider",
    );
    out = replaceOnce(out, "probeUsage: usage.probe,", "probeUsage: t3xUsageProbe,", "Antigravity 额度读取");
    out = replaceOnce(
      out,
      "export { runServer };",
      `${serverHostSource()}\nglobalThis.__t3xServer ??= process.env.T3X_SERVER_DIR ? t3xCreateServerHost({ dir: process.env.T3X_SERVER_DIR }) : void 0;\nglobalThis.__t3xServer?.start();\nexport { runServer };`,
      "后台模块导出",
    );
    return stripMap(out);
  },
};

module.exports = { preloadPatch, mainServerPatch, serverPatch, PRELOAD_CODE };
