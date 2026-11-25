"use strict";
// 把宿主和内置扩展拼成一段运行时代码；也负责生成扩展市场的 registry/index.json。
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { sha256 } = require("./asar.cjs");
const { t3xCheckManifest, t3xEntryList, t3xParseGithub, t3xRawUrl } = require("../host/pure.js");

const ROOT = path.join(__dirname, "..");
const HOST_FILES = ["pure.js", "core.js", "install.js", "github.js", "community.js", "settings.js"];
const BUILTINS = ["edge-glow", "effort-slider", "desk-pets"];
// 本机桌宠素材：local-pets/<id>/pet.json + sheet.webp，构建时并入 desk-pets（自己加的、不公开的宠物；不进任何仓库）。
const LOCAL_PETS = path.join(ROOT, "local-pets");
const MARKER = "/* T3X_HOST_V1 */";

const MIME = { ".webp": "image/webp", ".png": "image/png", ".gif": "image/gif" };
const dataUrl = (file) => `data:${MIME[path.extname(file)] ?? "application/octet-stream"};base64,${fs.readFileSync(file).toString("base64")}`;

function hostSource() {
  // @node-only 之后是给 Node 测试用的导出，浏览器里没有 module。
  return HOST_FILES.map((f) => fs.readFileSync(path.join(ROOT, "host", f), "utf8").split("// @node-only")[0]).join("\n");
}

function readExtension(dir) {
  const manifestText = fs.readFileSync(path.join(dir, "plugin.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  const list = t3xEntryList(manifest);
  const files = { "plugin.json": manifestText };
  for (const p of [...list.web, ...list.styles]) files[p] = fs.readFileSync(path.join(dir, p), "utf8");
  for (const p of list.assets) files[p] = dataUrl(path.join(dir, p));
  t3xCheckManifest(manifest, files);
  return { manifest, files };
}

function localPets() {
  if (!fs.existsSync(LOCAL_PETS)) return [];
  return fs
    .readdirSync(LOCAL_PETS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(LOCAL_PETS, d.name, "pet.json")))
    .map((d) => d.name);
}

// 内置扩展是 git submodule：克隆时没带 --recursive 这里是空目录
function builtinDir(id) {
  const dir = path.join(ROOT, "extensions", id);
  if (!fs.existsSync(path.join(dir, "plugin.json"))) throw new Error(`缺少内置扩展 ${id}：先运行 git submodule update --init`);
  return dir;
}

function builtins() {
  return BUILTINS.map((id) => {
    const ext = readExtension(builtinDir(id));
    if (id !== "desk-pets") return ext;
    const assets = [...(ext.manifest.assets ?? [])];
    for (const pet of localPets()) {
      ext.files[`local/${pet}/pet.json`] = fs.readFileSync(path.join(LOCAL_PETS, pet, "pet.json"), "utf8");
      ext.files[`local/${pet}/sheet.webp`] = dataUrl(path.join(LOCAL_PETS, pet, "sheet.webp"));
      assets.push(`local/${pet}/sheet.webp`);
    }
    // pet.json 是数据文件，不在 entries 里；登记到 assets 只为通过“声明的文件都在”的校验。
    return { manifest: { ...ext.manifest, assets }, files: ext.files };
  });
}

/** 追加到 T3 _chat 模块末尾的代码。bind 里的 Z / $ / Jr 是 0.1.11 这个模块里 React、jsx 运行时和档位选项函数的名字。 */
function runtime() {
  const css = fs.readFileSync(path.join(ROOT, "host", "host.css"), "utf8");
  return [
    MARKER,
    'const t3xHost=(function(bind,builtins,hostCss){"use strict";',
    hostSource(),
    'if(typeof document!=="undefined")addStyle(hostCss,"t3x-host");',
    "boot();",
    "return{ChatOverlay,EffortSlot,SettingsPage};",
    `})({React:Z,jsx:$,choices:Jr},${JSON.stringify(builtins())},${JSON.stringify(css)});`,
    "globalThis.t3xHost=t3xHost;",
  ].join("\n");
}

// 市场里除了内置扩展，还有给扩展作者参考的示例（不内置，从市场安装）。
const EXAMPLES = ["hello-badge"];

/** 扩展市场索引：每个文件的 SHA-256，安装时逐个校验。只收仓库里的文件，不含本机桌宠。 */
// 内置扩展是 submodule，GitHub raw 取不到 submodule 里的文件：注册表指向扩展仓库在 submodule 当前提交下的文件，
// 清单和哈希也从这个提交读（不读工作区），没提交的改动不会让地址和哈希对不上。
function pinnedFiles(dir) {
  const sha = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { sha, read: (p) => execFileSync("git", ["-C", dir, "show", `${sha}:${p}`], { maxBuffer: 64 * 1024 * 1024 }) };
}

function registry() {
  const sources = [...BUILTINS.map((id) => ["extensions", id]), ...EXAMPLES.map((id) => ["examples", id])];
  const extensions = sources.map(([folder, id]) => {
    const pinned = folder === "extensions" ? pinnedFiles(builtinDir(id)) : null;
    const dir = path.join(ROOT, folder, id);
    const read = pinned ? pinned.read : (p) => fs.readFileSync(path.join(dir, p));
    const manifest = JSON.parse(read("plugin.json"));
    if (!pinned) readExtension(dir); // 示例扩展顺带校验；内置扩展的校验在宿主激活测试里
    const list = t3xEntryList(manifest);
    const hashes = {};
    for (const p of ["plugin.json", ...list.web, ...list.styles, ...list.assets]) hashes[p] = sha256(read(p));
    const url = pinned ? t3xRawUrl(t3xParseGithub(manifest.repository), pinned.sha, "plugin.json") : `../${folder}/${id}/plugin.json`;
    const { name, version, description, author, locales } = manifest;
    return { id, name, version, description, author, locales, manifest: url, sha256: hashes };
  });
  return { name: "T3 Code Extensions", apiVersion: 1, extensions };
}

if (require.main === module) {
  const out = path.join(ROOT, "registry", "index.json");
  fs.writeFileSync(out, `${JSON.stringify(registry(), null, 2)}\n`);
  console.log(`已写入 ${path.relative(ROOT, out)}`);
}

module.exports = { MARKER, EXAMPLES, runtime, registry, builtins, readExtension, hostSource, localPets };
