#!/usr/bin/env node
"use strict";
// macOS：把官方 T3 Code（版本见 lib/patch.cjs 的 T3_VERSION）复制一份到 ~/Applications，打上扩展宿主补丁，本机重新签名。官方版不动。
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readAsar, findOne, writeAsar, checkModuleSyntax, sha256 } = require("./lib/asar.cjs");
const { T3_VERSION, PROFILE_NAME, chatPatch, appearancePatch, routePatch, navPatch, navIconPatch, i18nPatch, userDataPatch } = require("./lib/patch.cjs");

const DEFAULT_SOURCE = "/Applications/T3 Code (Beta).app";
const T3_TEAM_ID = "ARK85ZXQ4Z";
const APP_NAME = "T3 Code Extensions";
const BUNDLE_ID = "local.t3-extensions.app";
const APP_ASAR = path.join("Contents", "Resources", "app.asar");
const INFO_PLIST = path.join("Contents", "Info.plist");
const APPS_DIR = path.join(os.homedir(), "Applications");
const INSTALL_DIR = path.join(APPS_DIR, `${APP_NAME}.app`);
const PROFILE_DIR = path.join(os.homedir(), "Library", "Application Support", PROFILE_NAME);
const ISOLATED_PORT = "3775";

const UI_PATCHES = [chatPatch, appearancePatch, routePatch, navPatch, navIconPatch, i18nPatch];
const patchesFor = (isolated) => (isolated ? [...UI_PATCHES, userDataPatch] : UI_PATCHES);

function plist(app, key, format = "raw") {
  const out = execFileSync("plutil", ["-extract", key, format, "-o", "-", path.join(app, INFO_PLIST)], { encoding: "utf8" });
  return format === "json" ? JSON.parse(out) : out.trim();
}

function setPlist(app, key, value) {
  execFileSync("plutil", ["-replace", key, "-json", JSON.stringify(value), path.join(app, INFO_PLIST)]);
}

function isOurs() {
  if (!fs.existsSync(path.join(INSTALL_DIR, INFO_PLIST))) return false;
  return plist(INSTALL_DIR, "CFBundleIdentifier") === BUNDLE_ID;
}

const isIsolated = () => "T3CODE_HOME" in plist(INSTALL_DIR, "LSEnvironment", "json");

function isRunning() {
  const exe = path.join(INSTALL_DIR, "Contents", "MacOS", plist(INSTALL_DIR, "CFBundleExecutable"));
  assert(fs.existsSync(exe), `找不到可执行文件：${exe}`);
  try {
    return execFileSync("lsof", ["-t", exe], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== "";
  } catch (error) {
    if (error.status === 1) return false; // lsof 没找到进程
    throw error;
  }
}

/** 给 asar 打补丁写到 outFile；每个目标文件先核对 T3_VERSION 的原始哈希。返回头部哈希。 */
function patchArchive(asarFile, patches, outFile) {
  const asar = readAsar(asarFile);
  const replacements = new Map();
  for (const p of patches) {
    const key = findOne(asar, p.targetRegex, p.label);
    const original = asar.read(key);
    assert.equal(sha256(original), p.originalHash, `${key} 和 T3 Code ${T3_VERSION} 不一致`);
    const patched = Buffer.from(p.apply(original.toString("utf8")), "utf8");
    checkModuleSyntax(patched, key, p.module === "commonjs" ? ".cjs" : ".mjs");
    replacements.set(key, patched);
  }
  return writeAsar(asar, replacements, outFile);
}

function verifyOfficial(app) {
  try {
    execFileSync("codesign", ["--verify", "--deep", "--strict", "--test-requirement", `=anchor apple generic and certificate leaf[subject.OU] = "${T3_TEAM_ID}"`, app], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    throw new Error(`官方签名校验失败，请重新安装官方 T3 Code ${T3_VERSION}：${error.stderr?.toString().trim()}`);
  }
}

function status() {
  if (!fs.existsSync(INSTALL_DIR)) return console.log("尚未安装。");
  assert(isOurs(), `安装位置被其他应用占用：${INSTALL_DIR}`);
  const installed = plist(INSTALL_DIR, "CFBundleShortVersionString");
  assert.equal(installed, T3_VERSION, `已安装的是基于 T3 Code ${installed} 的版本，这一版针对 ${T3_VERSION}：先退出应用，运行 node install.cjs uninstall，再 install`);
  const isolated = isIsolated();
  const asar = readAsar(path.join(INSTALL_DIR, APP_ASAR));
  for (const p of patchesFor(isolated)) {
    const text = asar.read(findOne(asar, p.targetRegex, p.label)).toString("utf8");
    assert(text.includes(p.marker), `${p.label}的补丁不完整，请卸载后重装`);
  }
  console.log(`${APP_NAME}（T3 Code ${T3_VERSION}）已安装，${isRunning() ? "运行中" : "未运行"}。`);
  console.log(`启动：open "${INSTALL_DIR}"`);
  console.log(isolated ? `独立数据：${PROFILE_DIR}（端口 ${ISOLATED_PORT}，可与官方版同时运行）` : "数据：与官方版共用 ~/.t3，两者不能同时运行");
}

function install(source = DEFAULT_SOURCE, isolated = false) {
  if (fs.existsSync(INSTALL_DIR)) return status();
  const from = path.resolve(source);
  assert.equal(plist(from, "CFBundleShortVersionString"), T3_VERSION, `需要官方 T3 Code ${T3_VERSION}`);
  fs.mkdirSync(APPS_DIR, { recursive: true });
  const staging = fs.mkdtempSync(path.join(APPS_DIR, ".t3-extensions-"));
  try {
    const app = path.join(staging, `${APP_NAME}.app`);
    console.log("复制并校验官方签名…");
    execFileSync("ditto", [from, app]);
    verifyOfficial(app); // 校验复制出来的这份，保证补丁打在官方签名覆盖的文件上
    execFileSync("xattr", ["-dr", "com.apple.quarantine", app]);
    console.log("打补丁…");
    const target = path.join(app, APP_ASAR);
    const headerHash = patchArchive(target, patchesFor(isolated), `${target}.patched`);
    fs.chmodSync(`${target}.patched`, fs.statSync(target).mode & 0o777);
    fs.renameSync(`${target}.patched`, target);
    setPlist(app, "ElectronAsarIntegrity", { "Resources/app.asar": { algorithm: "SHA256", hash: headerHash } });
    setPlist(app, "CFBundleIdentifier", BUNDLE_ID);
    setPlist(app, "CFBundleDisplayName", APP_NAME);
    setPlist(app, "LSEnvironment", {
      ...plist(app, "LSEnvironment", "json"),
      ...(isolated ? { T3CODE_HOME: path.join(PROFILE_DIR, "t3-home"), T3CODE_PORT: ISOLATED_PORT } : {}),
      T3CODE_DISABLE_AUTO_UPDATE: "1", // 自动更新会换掉打过补丁的文件
    });
    console.log("本机重新签名…");
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "pipe" });
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" });
    fs.renameSync(app, INSTALL_DIR);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  status();
}

function uninstall() {
  if (!fs.existsSync(INSTALL_DIR)) return status();
  assert(isOurs(), `无法确认是本工具安装的应用：${INSTALL_DIR}`);
  assert(!isRunning(), `请先退出 ${APP_NAME}`);
  const isolated = isIsolated();
  fs.rmSync(INSTALL_DIR, { recursive: true });
  console.log(isolated ? `已卸载。独立数据保留在 ${PROFILE_DIR}` : "已卸载。会话和项目仍在 ~/.t3");
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const isolated = args.includes("--isolated");
    const [command, source, ...extra] = args.filter((a) => a !== "--isolated");
    if (!command || command === "--help") {
      console.log(`用法：node install.cjs install [--isolated] [官方 T3 Code.app，默认 ${DEFAULT_SOURCE}] | status | uninstall`);
    } else {
      assert(process.platform === "darwin", "目前只支持 macOS");
      assert(process.getuid() !== 0, "请用桌面用户运行，不要 sudo");
      assert(extra.length === 0 && (command === "install" || (source === undefined && !isolated)), "参数不正确");
      if (command === "install") install(source, isolated);
      else if (command === "status") status();
      else if (command === "uninstall") uninstall();
      else throw new Error(`未知命令：${command}`);
    }
  } catch (error) {
    console.error("错误：", error.message);
    process.exitCode = 1;
  }
}

module.exports = { patchArchive, patchesFor };
