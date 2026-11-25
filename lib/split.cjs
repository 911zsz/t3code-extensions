"use strict";
// 把内置扩展拆成各自独立的仓库目录：node lib/split.cjs <输出目录>
// 每个仓库根目录就是扩展本身（plugin.json 在根上），外加 README 和 LICENSE。只复制清单声明的文件，local-pets/ 里不公开的本机宠物不会带出。内置扩展按 plugin.json 的 repository 从这些仓库检查更新。
const fs = require("node:fs");
const path = require("node:path");
const { readExtension } = require("./build.cjs");
const { t3xEntryList } = require("../host/pure.js");

const ROOT = path.join(__dirname, "..");
const BUILTINS = ["edge-glow", "effort-slider", "desk-pets"];

function readme(manifest) {
  const en = manifest.locales?.en ?? {};
  return `# ${en.name ?? manifest.name}（${manifest.name}）

${en.description ?? ""}

${manifest.description}

A built-in extension of [T3 Code Extensions](https://github.com/ZiHao256/t3code-extensions), an unofficial extension host for [T3 Code](https://github.com/pingdotgg/t3code).
T3 Code Extensions ships this extension and checks this repository's latest release for updates
(Settings → Extensions → Built-in → refresh).

[T3 Code Extensions](https://github.com/ZiHao256/t3code-extensions) 的内置扩展。T3 Code Extensions 自带这个扩展，并从本仓库的最新 Release 检查更新（设置 → 扩展 → 内置 → 刷新）。

## Release / 发版

1. Bump \`version\` in \`plugin.json\`. 改 \`plugin.json\` 的 \`version\`。
2. Tag \`v<version>\` and publish a GitHub release. 打 \`v<version>\` 标签并发布 Release。

## License

MIT${manifest.id === "desk-pets" ? "\n\nThe Clawd and Moffy sprites are the author's own non-commercial fan pixel art; the characters belong to their respective owners (Clawd is Anthropic's Claude mascot) and are not covered by the MIT license. Open an issue to request removal.\n\nClawd、Moffy 精灵图是作者自己绘制的同人像素形象，仅供非商业使用；角色形象归原权利方所有（Clawd 是 Anthropic 的 Claude 吉祥物），不在 MIT 授权范围内。如有异议请开 issue，会撤下。" : ""}
`;
}

// 清单之外也要发布的开发工具（按扩展 id）。
const EXTRA = { "desk-pets": ["tools/codex_atlas.py"] };

/** 只写清单声明的文件、EXTRA、README 和 LICENSE；目标仓库里其他文件（.git、.github、文档）不动。 */
function split(outDir) {
  for (const id of BUILTINS) {
    const src = path.join(ROOT, "extensions", id);
    const { manifest } = readExtension(src); // 顺带校验 plugin.json
    const list = t3xEntryList(manifest);
    const dest = path.join(outDir, `t3x-${id}`);
    for (const rel of ["plugin.json", ...list.web, ...list.styles, ...list.assets, ...(EXTRA[id] ?? [])]) {
      fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
      fs.copyFileSync(path.join(src, rel), path.join(dest, rel));
    }
    fs.copyFileSync(path.join(ROOT, "LICENSE"), path.join(dest, "LICENSE"));
    fs.writeFileSync(path.join(dest, "README.md"), readme(manifest));
    console.log(`${dest}  v${manifest.version}`);
  }
}

if (require.main === module) {
  const out = process.argv[2];
  if (!out) {
    console.error("用法：node lib/split.cjs <输出目录>");
    process.exit(1);
  }
  split(path.resolve(out));
}

module.exports = { split };
