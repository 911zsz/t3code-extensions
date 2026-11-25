# T3 Code Extensions

给 [T3 Code](https://github.com/pingdotgg/t3code) 加一个**扩展宿主**和**扩展市场**：设置导航里“外观”下面多出一个“扩展”页，可以开关、配置、从市场或链接安装扩展。

> 非官方项目，和 T3 Code 及其团队没有关系。它把你已安装的官方 T3 Code 复制一份再打补丁，官方版本身不动。目前只支持 **macOS 上的 T3 Code (Beta)**，每个版本只认一个 T3 版本：
>
> | T3 Code | 用这个版本 |
> |---|---|
> | 0.1.12 | 最新的 `main` |
> | 0.1.11 | [v0.1.0](https://github.com/ZiHao256/t3code-extensions/releases/tag/v0.1.0)（`git clone --branch v0.1.0 …`） |

## 扩展

宿主本身不带扩展。作者维护的三个扩展各在自己的仓库里，装好后在 设置 → 扩展 →“浏览”里安装（或把仓库地址粘贴到那里的链接框）：

| 扩展 | 作用 |
|---|---|
| 边缘光 [`t3x-edge-glow`](https://github.com/ZiHao256/t3x-edge-glow) | 需要审批（琥珀）、等你回答（蓝）、出错（红）、后台跑完（绿）时窗口边缘亮光。动效档位：省电 / 混合 / 30fps |
| 推理强度滑条 [`t3x-effort-slider`](https://github.com/ZiHao256/t3x-effort-slider) | 把模型面板里“推理强度”的档位列表换成竖向分档滑条（最高档在上，档名写在刻度旁边），档位越高星点越亮越快，最高档流动星云。星点动效：跟随档位 / 静态 / 关闭 |
| 桌宠 [`t3x-desk-pets`](https://github.com/ZiHao256/t3x-desk-pets) | 输入框上沿站着当前 agent 的像素宠物，跟会话状态动；子代理各派一只到旁边干活、收工击掌；每只都能单独拖，拖到另一只身上会互动；窗口不在前台或切到别的会话时错过的进出场，回来补播。右键宠物有菜单（T3 样式）：换一只、打个招呼、安静模式、桌宠设置、隐藏；隐藏后右键输入框里的模型选择器叫回。每个 agent 用哪只、宠物库（增删改）在设置里 |

另有示例扩展 `examples/hello-badge`（右下角显示 agent 和会话状态），放在市场里演示安装流程，也是写扩展的模板。

## 安装

需要：`/Applications/T3 Code (Beta).app` 是官方 0.1.12（其他版本看上面的对照表），Node.js 22 以上。

```sh
node install.cjs install             # 和官方版共用 ~/.t3（会话、项目、设置），两者不能同时开
node install.cjs install --isolated  # 独立数据和端口 3775，可以和官方版同时开
node install.cjs status
node install.cjs uninstall           # 先退出应用
```

装好的应用在 `~/Applications/T3 Code Extensions.app`。安装过程：校验官方签名 → 复制 → 打补丁（每个目标文件先核对 0.1.12 的原始哈希，补丁后用 `node --check` 检查语法）→ 更新 asar 完整性值 → 本机重新签名。自动更新会被关掉（否则会换掉打过补丁的文件）。

**从带内置扩展的旧版升级**：退出应用，`node install.cjs uninstall` 后重新 `install`（原来用 `--isolated` 的照样加上；卸载不删数据）。边缘光、推理强度滑条、桌宠不再随宿主分发：
- 以前点“检查更新”装过新版的，还在“已安装”里，版本旧的话点刷新更新；
- 其余的到“浏览”里重新安装，原来的设置和数据还在（别先点“移除”，移除会删掉数据）；
- 以前放在 `local-pets/` 的本机宠物不再并入，到桌宠设置里“添加桌宠”重新上传。

**从 T3 Code Enhancer 切换**：退出 Enhancer 后在旧仓库运行 `node macos.cjs uninstall`（会话在 `~/.t3`，不受影响），再在这里 `node install.cjs install`。两者可以并存，只是共用数据时同一时间只能开一个。

## 使用

设置 → 扩展：

- 顶部 “Applying settings for [项目] on [环境]” 是 T3 自己的作用域选择。选了具体项目或环境后，开关只影响那里的会话（项目 > 环境 > 全局，没单独设的显示“沿用上一级”，可以“重置”）。只管显示与否：扩展代码只要在任一作用域开着就会加载，扩展自己的设置全局共用。
- **已安装**：装好的扩展。开关、设置、移除、刷新（GitHub 来源检查更新；本地扩展重新读取文件夹）。
- **浏览**：
  - 社区扩展：GitHub 上带 `t3code-extension` 话题的仓库，按 star 排序，默认列出前 30 个，其余靠搜索。标着“社区”，安装时固定到某个提交。
  - 也可以填 GitHub 仓库地址、`plugin.json` 链接或第三方市场的 `index.json` 链接，或者上传 zip。
  - 安装前都会弹窗确认来源。
- **添加本地扩展**：选一个扩展文件夹，之后改了代码点卡片上的刷新就重新读取（开发用；不支持记住文件夹的环境退回一次性导入）。
- **刷新**：依次检查所有能更新的扩展，并刷新社区列表。打开页面时不自动检查：不登录 GitHub 时，每个出口 IP 每小时只能调 60 次接口（检查一次约 3 次），搜索每分钟约 10 次；共用的代理出口常被别人用光，这时会提示多久后恢复。

## 写扩展

```
my-ext/
  plugin.json
  web.js          # 可以是多个文件，按顺序拼接
  styles.css
  assets/…        # 图片等二进制素材
```

```json
{
  "id": "my-ext",
  "apiVersion": 1,
  "name": "我的扩展",
  "version": "1.0.0",
  "description": "…",
  "author": "…",
  "locales": { "en": { "name": "My extension", "description": "…" } },
  "repository": "https://github.com/me/my-ext",
  "permissions": ["ui"],
  "entries": { "web": ["web.js"], "styles": ["styles.css"] },
  "assets": ["assets/icon.webp"]
}
```

`apiVersion`：用到 `host.dom` 或 `host.confirm()` 写 `3`；用到设置面板的 `Input` / `Select` 系列、`host.openSettings()` 或 `host.contextMenu()` 写 `2`；只用其余接口写 `1`。宿主会拒绝安装 apiVersion 比自己新的扩展。

`repository` 可选：扩展的 GitHub 仓库，卡片上的“详情”链接到这里。

`locales` 可选：`name`、`description` 在另一种语言下的版本（`en` 或 `zh`），设置页按 T3 的界面语言显示。

字段尽量和 T3 官方插件草案（[#40222](https://github.com/pingdotgg/t3code/pull/40222) 的 `plugin.json`）对齐，方便以后迁移。不同点：`web.js` 不是 ES 模块，而是作为 `function (host) { … }` 的函数体执行（T3 的 CSP 允许内联脚本，不允许 `eval` 和 `blob:` 模块）；顶层可以 `return` 一个清理函数，停用时调用。

`host` 提供：

| API | 说明 |
|---|---|
| `host.React`、`host.h` | T3 自己的 React 和 `createElement` |
| `host.register(slot, Component)` | 挂到挂载点，返回取消函数 |
| `host.settings(Component)` | 扩展设置面板；props 里的 `ui` 是 T3 原生的 `Section` / `Row` / `Switch` / `Button` / `Input` / `Select` / `SelectTrigger` / `SelectValue` / `SelectPopup` / `SelectItem` |
| `host.storage.get/set/subscribe/use(key, fallback)` | 扩展自己的持久化存储（IndexedDB），`use` 是 React hook |
| `host.files.list/text/url(path)` | 扩展包里的文件；`url` 给素材的 data URL |
| `host.style(css)` | 追加样式，停用时自动移除 |
| `host.openSettings()` | 跳到 设置 → 扩展，打开本扩展的设置 |
| `host.contextMenu(items, { x, y })` | 弹出 T3 样式的右键菜单，返回选中项的 `id`（没选是 `null`）。项：`{ id, label, detail?, icon?, checked?, disabled?, separatorBefore?, children? }`，`icon` 只能用 T3 内置的几个名字（如 `settings`） |
| `host.confirm(message, { variant? })` | 弹出 T3 自己的确认框，返回 `Promise<boolean>`（用 `if (await host.confirm(…))`）。`message` 里以问号结尾的那行是标题，其余行是说明；`variant: "destructive"` 时确认按钮是红色 |
| `host.dom.composer()`、`host.dom.modelPicker(target)` | 主聊天视图的输入框外壳；`target` 在主输入框的模型选择器里时返回那个选择器（side chat 里的都不算），否则 `null`。需要找 T3 页面元素时用这里，别自己查 T3 的 DOM：T3 改版时宿主跟着改，扩展不用动 |
| `host.chat.last()` | 最近一次聊天视图的会话状态（设置页里也能拿到 provider 列表） |
| `host.lang()`、`host.useLang()` | 当前界面语言：T3 是中文时为 `"zh"`，其他语言都是 `"en"`。`useLang` 是 React hook，切语言时触发重绘 |
| `host.t(中文, 英文)` | 按当前界面语言二选一；在渲染时调用，组件里先调一次 `host.useLang()` |
| `host.onDispose(fn)` | 停用时调用 |

挂载点：

| slot | 方式 | 组件收到的 props |
|---|---|---|
| `chat.overlay` | 所有扩展都渲染 | `threadKey`、`awaiting`（`"approval"`/`"input"`/`null`）、`working`、`error`、`runStatus`、`providerInstanceId`、`driver`、`providers`、`model`、`subagents`、`embedded`（side chat 里为真） |
| `composer.effort` | 最后启用的替换原生档位列表 | `label`、`steps[{id,label,description,isDefault}]`、`activeIndex`、`defaultIndex`、`disabled`、`select(index)` |

扩展组件出错只影响它自己：overlay 不渲染，`composer.effort` 退回原生列表，错误显示在扩展那一行。颜色请用 T3 的主题变量（`var(--foreground)`、`var(--muted-foreground)`、`var(--border)` 等），`html.dark` 是暗色模式。

## 发布扩展

不需要向任何人提交，在自己的 GitHub 仓库里完成：

1. `plugin.json` 和代码放在仓库根目录。社区列表里的“安装”按钮只装根目录的扩展。
2. 给仓库加话题 `t3code-extension`，GitHub 建好索引后就能搜到（默认列表只显示 star 最多的 30 个）。
3. 发新版本：改 `plugin.json` 的 `version`，打 tag 并发一个 Release。

“检查更新”沿用安装时的地址：

| 安装时填的地址 | 检查更新时取 |
|---|---|
| `https://github.com/作者/仓库` 或社区列表 | 最新 Release；没有 Release 就取默认分支的最新提交 |
| `…/tree/分支名[/子目录]` | 这个分支的最新提交 |
| `…/tree/标签名[/子目录]` | 一直是这个标签，不会自动换到新标签 |

一个仓库放多个扩展时放子目录，用户填 `https://github.com/作者/仓库/tree/分支或标签/子目录` 安装；想让子目录扩展也能更新，让用户填分支地址。名字里带 `/` 的分支或标签（比如 `release/1.0`）解析不了，地址里也不能直接填提交号。

用户装的是某一个提交的文件（`raw.githubusercontent.com/作者/仓库/提交/…`），作者之后再推代码不会影响已经装上的那份。安装时会记下仓库 ID：仓库改名没关系，但如果旧名字被别的仓库占用，“检查更新”会拒绝。

## 第三方市场（注册表）

想做一个经过审核的精选列表，可以托管一个注册表 JSON。市场就是一个 JSON 文件，`registry/index.json` 是本仓库的市场：

```json
{
  "name": "T3 扩展市场",
  "apiVersion": 1,
  "extensions": [
    { "id": "…", "name": "…", "version": "…", "description": "…", "author": "…",
      "manifest": "../examples/…/plugin.json",
      "sha256": { "plugin.json": "…", "web.js": "…" } }
  ]
}
```

`manifest` 相对 index.json 解析，也可以是完整地址；安装时每个文件都必须有 `sha256` 且一致，否则拒绝。改了扩展后运行 `node lib/build.cjs` 重新生成。托管的地方要允许跨域（GitHub raw 默认允许）。

SHA-256 只保证下载到的就是注册表写的那份，**不代表代码安全**：扩展以完整权限运行在 T3 里，能读你的对话、调用本机 T3 服务。只装你信任的。

## 原理与限制

- 补丁只开三个口子：聊天视图把会话状态交给 `chat.overlay`；推理档位列表交给 `composer.effort`；设置里加一个“扩展”页（路由表、导航分组和名字、导航图标各改一处，页面组件追加在外观设置页模块里，顶部沿用 T3 的项目/环境作用域选择）。宿主运行时追加在 T3 的 `ThreadRouteView` 模块末尾（聊天视图所在，`_chat` 静态导入它；见 `lib/patch.cjs`、`host/`）。
- 界面语言跟着 T3：T3 的原文是英文，中文由它的翻译函数在渲染时查表。导航和搜索里的“Extensions / 扩展”靠在这个翻译函数入口补了一处；扩展页和扩展自己按 `<html lang>` 选中文或英文，其他语言显示英文。
- 依赖 0.1.12 压缩代码里的变量名，T3 一更新就要重新适配（扩展不用改，只改这个仓库）；补丁前会核对原始文件哈希，对不上直接拒绝安装，不会装出一个坏掉的应用。
- 本机 ad-hoc 签名，没有官方签名和公证，也没有 Hardened Runtime：官方的 entitlements 依赖官方描述文件，ad-hoc 签名带上它们反而启动不了。
- `--isolated` 副本和官方版注册的是同一个 `t3code://` 链接。两者同时开着时，T3 Connect 等网页登录的回调可能被另一个应用接走，这时先关掉另一个再登录。
- T3 官方正在做插件系统（实验 PR，尚未合并）。合并后计划把三个扩展迁成官方插件，这个宿主就可以退役。

## 开发

```sh
npm test               # 纯函数、示例扩展在宿主包装里编译激活、补丁打到官方 0.1.12、asar 读回、注册表哈希
node tests/verify.cjs "/path/to/T3 Code (Beta).app"  # 本机官方版不是 0.1.12 时，指定一个 0.1.12 的 app 跑补丁检查
node lib/build.cjs     # 重新生成 registry/index.json
```

本仓库只有宿主（补丁、`host` 接口、设置页、市场）和示例扩展。扩展各自在自己的仓库里开发、测试和发版，按上面“发布扩展”的流程走，宿主这边不用跟着改。

改宿主接口：先在本仓库加接口、提高 `host/pure.js` 的 `API_VERSION` 并发布，再让用到新接口的扩展把 `apiVersion` 改成新值。

## 许可

MIT。T3 Code 是 T3 Tools Inc. 的项目；本仓库不分发 T3 Code（安装时复制你本机的官方版），只在 `lib/patch.cjs` 里留了几段用于定位的压缩代码片段。
