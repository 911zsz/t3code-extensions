"use strict";
// Electron ASAR 读写：只替换已有文件的内容，其他条目（含 unpacked、符号链接）原样保留。
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BLOCK_SIZE = 4 * 1024 * 1024;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** 读取 ASAR，返回头部、文件列表和文件内容读取函数。 */
function readAsar(file) {
  const archive = fs.readFileSync(file);
  assert.equal(archive.readUInt32LE(0), 4, `${file} 不是 ASAR 文件`);
  const headerSize = archive.readUInt32LE(4);
  const jsonSize = archive.readUInt32LE(12);
  assert.equal(archive.readUInt32LE(8), headerSize - 4, "ASAR 头部长度不一致");
  assert.equal(headerSize, 8 + Math.ceil(jsonSize / 4) * 4, "ASAR 头部填充不一致");
  const headerJson = archive.subarray(16, 16 + jsonSize);
  const header = JSON.parse(headerJson.toString("utf8"));
  const body = archive.subarray(8 + headerSize);
  const files = new Map();
  (function walk(node, prefix) {
    for (const [name, entry] of Object.entries(node.files)) {
      const key = prefix + name;
      if (entry.files) walk(entry, `${key}/`);
      else if (entry.offset !== undefined && !entry.unpacked) files.set(key, entry);
    }
  })(header, "");
  const read = (key) => {
    const entry = files.get(key);
    assert(entry, `ASAR 中没有 ${key}`);
    const start = Number(entry.offset);
    const ok = Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= body.length - start;
    assert(ok, `ASAR 条目越界：${key}`);
    return body.subarray(start, start + entry.size);
  };
  return { header, headerJson, files, read };
}

/** 按正则找唯一的文件；找不到或不唯一都说明 T3 Code 版本不对。 */
function findOne(asar, regex, label) {
  const keys = [...asar.files.keys()].filter((key) => regex.test(key));
  assert.equal(keys.length, 1, `无法唯一定位 ${label}（匹配到 ${keys.length} 个）`);
  return keys[0];
}

function integrity(bytes) {
  const blocks = [];
  for (let i = 0; i < bytes.length; i += BLOCK_SIZE) blocks.push(sha256(bytes.subarray(i, i + BLOCK_SIZE)));
  return { algorithm: "SHA256", hash: sha256(bytes), blockSize: BLOCK_SIZE, blocks };
}

/**
 * 写出新的 ASAR：replacements 是 key -> Buffer，被替换的文件重算 integrity。
 * 返回头部 JSON 的 SHA-256（写进 Info.plist 的 ElectronAsarIntegrity）。
 */
function writeAsar(asar, replacements, outFile) {
  for (const key of replacements.keys()) assert(asar.files.has(key), `ASAR 中没有 ${key}`);
  const header = structuredClone(asar.header);
  const chunks = [];
  let offset = 0;
  (function walk(node, prefix) {
    for (const [name, entry] of Object.entries(node.files)) {
      const key = prefix + name;
      if (entry.files) {
        walk(entry, `${key}/`);
        continue;
      }
      if (entry.offset === undefined || entry.unpacked) continue;
      const replaced = replacements.get(key);
      const bytes = replaced ?? asar.read(key);
      entry.offset = String(offset);
      entry.size = bytes.length;
      if (replaced) entry.integrity = integrity(bytes);
      chunks.push(bytes);
      offset += bytes.length;
    }
  })(header, "");
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const padded = Math.ceil(json.length / 4) * 4;
  const prefix = Buffer.alloc(16 + padded);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(8 + padded, 4);
  prefix.writeUInt32LE(4 + padded, 8);
  prefix.writeUInt32LE(json.length, 12);
  json.copy(prefix, 16);
  const fd = fs.openSync(outFile, "w");
  const writeAll = (buf) => {
    for (let at = 0; at < buf.length; ) at += fs.writeSync(fd, buf, at, buf.length - at);
  };
  try {
    writeAll(prefix);
    for (const chunk of chunks) writeAll(chunk);
  } finally {
    fs.closeSync(fd);
  }
  return sha256(json);
}

/** 用 node --check 校验补丁后的语法（ES 模块用 .mjs，主进程用 .cjs），避免装出一个白屏的应用。 */
function checkModuleSyntax(bytes, label, ext = ".mjs") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3x-check-"));
  try {
    const file = path.join(dir, `chunk${ext}`);
    fs.writeFileSync(file, bytes);
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${label} 补丁后语法错误：\n${result.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { sha256, readAsar, findOne, writeAsar, checkModuleSyntax };
