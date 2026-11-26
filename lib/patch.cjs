"use strict";
// T3 Code 0.1.12 的补丁：只开几个口子，功能全部在扩展里。
//   1. ThreadRouteView 模块（聊天视图所在，_chat 静态导入它）：聊天视图把会话状态交给 chat.overlay；推理档位列表交给 composer.effort；末尾追加宿主。
//   2. 设置里新增“扩展”页：路由表、导航分组和名字、导航图标各改一处，页面组件放在外观设置页模块里（顶部沿用 T3 的项目/环境作用域选择）。
//   3. （仅独立数据模式）Electron userData 目录改名，和官方版各用各的单实例锁。
//   4. 后台扩展：preload、主进程、T3 后台各加一段，见 patch-server.cjs。
// 支持 0.1.11 的是 v0.1.0 这个 Release。
const assert = require("node:assert/strict");
const { MARKER, runtime } = require("./build.cjs");

const { t3Version: T3_VERSION } = require("../package.json"); // 补丁针对的官方版本；自动更新也按它下载官方安装包

function replaceOnce(text, anchor, replacement, label) {
  const parts = text.split(anchor);
  assert.equal(parts.length, 2, `找不到唯一的${label}位置（需要 T3 Code ${T3_VERSION}）`);
  return parts[0] + replacement + parts[1];
}

// 改过的模块和原 source map 对不上了，去掉引用。
const stripMap = (text) => text.replace(/\n?\/\/# sourceMappingURL=.*$/m, "");
const asset = (name) => new RegExp(`^apps/server/dist/client/assets/${name}-[\\w-]+\\.js$`);

// 聊天视图（eK）的返回值。会话状态的变量名来自 0.1.12 的压缩代码：
//   awaiting 照抄 T3 传给时间线的 awaitingUser；bl=正在运行；Ui=当前会话错误；da=会话 key；q.runs 末项=最后一次运行；
//   provider：线程开始后 tc 锁定为正在运行的实例，可 handoff（li）时跟随选择器里的显式选择 _s；hs=provider 列表；g=side chat 里的嵌入视图。
const CHAT_VIEW_RETURN = "return(0,$.jsx)(ix,{threadRef:la,cwd:yd,checkpoints:q?.checkpoints,checkpointScopes:q?.checkpointScopes,children:hy})";
const CHAT_STATE = [
  "threadKey:da",
  "awaiting:bc===null?Sc!==null||ha?.hasPendingUserInput===!0?`input`:null:`approval`",
  "working:bl",
  // 上下文用量（T3 输入框里 Context 一栏用的同一个对象，可能为 null）和正在压缩历史。
  "context:xl",
  "compacting:gl",
  "error:Ui",
  "runStatus:q?.runs?.at(-1)?.status??null",
  "providerInstanceId:li&&_s||tc",
  "providers:hs",
  "model:Kr?.modelSelection?.model??null",
  "subagents:q?.subagents",
  "embedded:g",
  // 会话所在的环境和项目：扩展可以按项目、按环境启用。la=会话引用，Kr=会话（草稿时为草稿），ho=当前项目。
  "environmentId:la?.environmentId??null",
  "projectId:Kr?.projectId??ho?.id??null",
].join(",");

const chatPatch = {
  id: "chat",
  label: "聊天视图模块",
  targetRegex: asset("ThreadRouteView"),
  originalHash: "d54743d08ba7971a22d5dc50a422f1974e3db92b1c277b3e72645fbe2e5b74ce",
  marker: MARKER,
  apply(text) {
    let out = replaceOnce(
      text,
      "function zz(e){",
      "function zz(e){return(0,$.jsx)(t3xHost.EffortSlot,{props:e,Default:t3xNativeEffort})}function t3xNativeEffort(e){",
      "推理档位列表",
    );
    out = replaceOnce(
      out,
      CHAT_VIEW_RETURN,
      `return(0,$.jsxs)($.Fragment,{children:[(0,$.jsx)(t3xHost.ChatOverlay,{state:{${CHAT_STATE}}}),${CHAT_VIEW_RETURN.slice("return".length)}]})`,
      "聊天视图",
    );
    return `${stripMap(out)}\n${runtime()}\n`;
  },
};

// 扩展页组件放在外观设置页模块里：要用的原生组件它都在模块顶层导入了
// （de=设置页容器，me=Section，X=Row，re=Switch，_=Button，d=Input，
//   be=Select，ye=SelectTrigger，ge=SelectValue，ve=SelectPopup，he=SelectItem，
//   wt/St/Ct=InputGroup/Addon/Input，ft/dt=Alert/AlertDescription，ct=toast 管理器；
//   页面组件里有同名局部变量，所以只能在模块顶层取）。
// 再从设置布局模块导入作用域 hook（导出名 b，即 wt：读 SettingsScopeProvider，可能为 null），把顶部“Applying settings for …”选中的项目和环境交给扩展页。
const appearancePatch = {
  id: "appearance",
  label: "外观设置页模块",
  targetRegex: asset("_chat\\.settings\\.appearance"),
  originalHash: "3b0f5fed350a143ec0d61abcfd3dc9219aa6143d6bc3d1db8dc0a6ec7ed054fc",
  marker: "export{t3xExtensionsPage as t3xExtensions}",
  // 宿主没加载时页面不能是空白：给一句提示。
  apply: (text) =>
    // 外观页已经导入的 T3 组件直接用；Badge、Empty、Skeleton、AlertAction 它没导入，补几行 import（测试会核对这些导出名还在）。
    `${stripMap(text)}\nconst t3xUi={Section:me,Row:X,Switch:re,Button:_,Input:d,Select:be,SelectTrigger:ye,SelectValue:ge,SelectPopup:ve,SelectItem:he,` +
    "InputGroup:wt,InputGroupAddon:St,InputGroupInput:Ct,Alert:ft,AlertDescription:dt,AlertAction:t3xAlertAction,toast:ct,Badge:t3xBadge,Skeleton:t3xSkeleton," +
    "Empty:t3xEmpty,EmptyHeader:t3xEmptyHeader,EmptyTitle:t3xEmptyTitle,EmptyDescription:t3xEmptyDescription,EmptyContent:t3xEmptyContent};" +
    'import{oi as t3xBadge}from"./utils-Bng1kvMW.js";import{t as t3xSkeleton}from"./skeleton-jSA70IyH.js";import{n as t3xAlertAction}from"./alert-C-Tzj-d7.js";' +
    'import{t as t3xEmpty,i as t3xEmptyHeader,o as t3xEmptyTitle,r as t3xEmptyDescription,n as t3xEmptyContent}from"./empty-y2DAReMX.js";' +
    "function t3xNoExtensions(){return(0,$.jsx)(`p`,{className:`text-sm text-muted-foreground`,children:/^zh\\b/i.test(document.documentElement.lang)?`扩展宿主没有加载，看不到扩展设置。`:`The extension host did not load, so extension settings are unavailable.`})}" +
    "function t3xExtensionsPage(){let s=t3xUseScope();return(0,$.jsx)(de,{children:(0,$.jsx)(globalThis.t3xHost?.SettingsPage??t3xNoExtensions,{ui:t3xUi,scope:s})})}" +
    'import{b as t3xUseScope}from"./settingsLayout-CA7NnBx-.js";' +
    "export{t3xExtensionsPage as t3xExtensions};\n",
};

// 路由表：照抄外观页路由的懒加载写法（同一个模块、同一组预加载依赖），只换路径和导出名。V3=设置布局路由。
const routePatch = {
  id: "route",
  label: "路由表",
  targetRegex: asset("main"),
  originalHash: "588d75b88444f9852ce6a07e2a8f7ae66cccd5532497e7ca9fb2fe2be0806e4b",
  marker: "ChatSettingsT3xExtensionsRoute:",
  apply(text) {
    const lazy = text.match(
      /w3=Xp\(`\/_chat\/settings\/appearance`\)\(\{component:(Qp\(\(\)=>t_\(\(\)=>import\(`\.\/_chat\.settings\.appearance-[\w-]+\.js`\),__vite__mapDeps\(\[[\d,]+\]\)\),)`component`\)\}\)/,
    );
    assert(lazy, `找不到外观页路由（需要 T3 Code ${T3_VERSION}）`);
    const route = `Xp(\`/_chat/settings/extensions\`)({component:${lazy[1]}\`t3xExtensions\`)}).update({id:\`/extensions\`,path:\`/extensions\`,getParentRoute:()=>V3})`;
    return stripMap(
      replaceOnce(text, "S6={ChatSettingsAboutRoute:v6,", `S6={ChatSettingsT3xExtensionsRoute:${route},ChatSettingsAboutRoute:v6,`, "设置路由表"),
    );
  },
};

// 导航分组（放在“外观”后面）、导航名字、设置搜索和命令面板的条目（跳到页面里两个区块），作用域登记为本机（null）。
// 名字写英文原文，中文由 i18nPatch 补进 T3 的翻译函数。
const navPatch = {
  id: "nav",
  label: "设置导航",
  targetRegex: asset("settingsSearch"),
  originalHash: "5c30e02fa1c4b2276f5e3ded419fddf4d1feaad9bdae77ab10d24a7255c98bfd",
  marker: '"/settings/extensions":m(`Extensions`)',
  apply(text) {
    const group = "paths:[`/settings/general`,`/settings/appearance`,";
    let out = replaceOnce(text, group, `${group}\`/settings/extensions\`,`, "设置导航分组");
    const names = '"/settings/archived":m(`Archive`)}';
    out = replaceOnce(out, `${names},be={...W,`, `${names.slice(0, -1)},"/settings/extensions":m(\`Extensions\`)},be={...W,`, "设置导航名字");
    const items =
      "{id:`t3x-installed`,title:`Extensions`,to:`/settings/extensions`,searchTerms:[`extensions plugins pets edge glow effort slider 扩展 插件 桌宠 边缘光 推理强度滑条`]}," +
      "{id:`t3x-market`,title:`Extension marketplace`,to:`/settings/extensions`,searchTerms:[`extension marketplace registry install 扩展市场 安装扩展 添加扩展`]},";
    out = replaceOnce(out, "{id:`color-scheme`", `${items}{id:\`color-scheme\``, "设置搜索条目");
    const scopes = 'Oe={"/settings/diagnostics":`environment`,';
    out = replaceOnce(out, scopes, scopes.replace("Oe={", 'Oe={"/settings/extensions":null,'), "设置搜索作用域");
    return stripMap(out);
  },
};

// T3 的界面原文是英文，渲染时用 gt 的翻译函数按当前语言查表；中文表是冻结的模块，加不进条目。
// 在翻译函数入口认出补丁加的几条英文原文：中文界面返回中文，其他语言返回原文。导航、设置搜索、命令面板都走这里。
const T3X_MESSAGES = { Extensions: "扩展", "Extension marketplace": "扩展市场" };
const i18nPatch = {
  id: "i18n",
  label: "翻译函数",
  targetRegex: /^apps\/server\/dist\/client\/assets\/utils-Bng1kvMW\.js$/,
  originalHash: "2c855c329eb0054a3a65ae73d8fa459835af581832b8a7a9ab9f8270be0938fe",
  marker: "t3xMessages",
  apply(text) {
    const anchor = "return(0,J.useCallback)((e,a={})=>{let o=N(a.$locale??t,a,`ICU`);";
    // n=shouldTranslate：T3 关掉翻译时走原路径，和其他文案保持一致。
    const hook = "if(n&&typeof e==`string`&&Object.hasOwn(t3xMessages,e))return/^zh\\b/i.test(a.$locale??t)?t3xMessages[e]:e;";
    const out = replaceOnce(text, anchor, anchor.replace("{let o=", `{${hook}let o=`), "翻译函数");
    return `${stripMap(out)}\nconst t3xMessages=${JSON.stringify(T3X_MESSAGES)};\n`;
  },
};

// 导航图标：每个导航项都必须有图标组件，否则整个设置导航渲染失败。U=jsx 运行时。
const navIconPatch = {
  id: "nav-icon",
  label: "设置布局模块",
  targetRegex: asset("_chat\\.settings"),
  originalHash: "67f1b909bd2118b80f89aebf49e26ac5ed9c442d185ce9beec0b61361dff2367",
  marker: "function t3xExtensionsIcon(",
  apply: (text) =>
    `${stripMap(replaceOnce(text, 'ze={"/settings/general":N,', 'ze={"/settings/extensions":t3xExtensionsIcon,"/settings/general":N,', "设置导航图标"))}\n` +
    'function t3xExtensionsIcon(e){return(0,U.jsxs)(`svg`,{xmlns:`http://www.w3.org/2000/svg`,width:24,height:24,viewBox:`0 0 24 24`,fill:`none`,stroke:`currentColor`,strokeWidth:2,strokeLinecap:`round`,strokeLinejoin:`round`,"aria-hidden":!0,...e,' +
    "children:[(0,U.jsx)(`rect`,{x:3,y:3,width:8,height:8,rx:1.5}),(0,U.jsx)(`rect`,{x:3,y:13,width:8,height:8,rx:1.5}),(0,U.jsx)(`rect`,{x:13,y:13,width:8,height:8,rx:1.5}),(0,U.jsx)(`path`,{d:`M17 3v8M13 7h8`})]})}\n",
};

const PROFILE_NAME = "t3-extensions-profile";
const userDataPatch = {
  id: "user-data",
  label: "Electron 用户数据目录",
  targetRegex: /^apps\/desktop\/dist-electron\/main\.cjs$/,
  originalHash: "3767e3a14ef66756b8e404e11a2a472bb22c1993f710b932653f24bd29f50cdd",
  marker: `"${PROFILE_NAME}/electron"`,
  module: "commonjs",
  apply: (text) => replaceOnce(text, 'current: "t3code-v2",', `current: "${PROFILE_NAME}/electron",`, "userData 目录名"),
};

module.exports = { T3_VERSION, PROFILE_NAME, chatPatch, appearancePatch, routePatch, navPatch, navIconPatch, i18nPatch, userDataPatch, replaceOnce, stripMap };
