"use strict";
// T3 Code 0.1.11 的补丁：只开三个口子，功能全部在扩展里。
//   1. _chat 模块：聊天视图把会话状态交给 chat.overlay；推理档位列表交给 composer.effort；末尾追加宿主。
//   2. 设置里新增“扩展”页：路由表、导航分组和名字、导航图标各改一处，页面组件放在外观设置页模块里（顶部沿用 T3 的项目/环境作用域选择）。
//   3. （仅独立数据模式）Electron userData 目录改名，和官方版各用各的单实例锁。
const assert = require("node:assert/strict");
const { MARKER, runtime } = require("./build.cjs");

const T3_VERSION = "0.1.11";

function replaceOnce(text, anchor, replacement, label) {
  const parts = text.split(anchor);
  assert.equal(parts.length, 2, `找不到唯一的${label}位置（需要 T3 Code ${T3_VERSION}）`);
  return parts[0] + replacement + parts[1];
}

// 改过的模块和原 source map 对不上了，去掉引用。
const stripMap = (text) => text.replace(/\n?\/\/# sourceMappingURL=.*$/m, "");
const asset = (name) => new RegExp(`^apps/server/dist/client/assets/${name}-[\\w-]+\\.js$`);

// 聊天视图的返回值。会话状态的变量名来自 0.1.11 的压缩代码：
//   awaiting 照抄 T3 传给时间线的 awaitingUser；Ec=正在运行；Pi=当前会话错误；Qi=会话 key；Y.runs 末项=最后一次运行；
//   provider：线程开始后 vs 锁定为正在运行的实例，可 handoff（ni）时跟随选择器里的显式选择 Jo；Ko=provider 列表；g=side chat 里的嵌入视图。
const CHAT_VIEW_RETURN = "return(0,$.jsx)(Ug,{threadRef:Xi,cwd:xu,checkpoints:Y?.checkpoints,children:bv})";
const CHAT_STATE = [
  "threadKey:Qi",
  "awaiting:js===null?Ms!==null||na?.hasPendingUserInput===!0?`input`:null:`approval`",
  "working:Ec",
  "error:Pi",
  "runStatus:Y?.runs?.at(-1)?.status??null",
  "providerInstanceId:ni&&Jo||vs",
  "providers:Ko",
  "model:Wr?.modelSelection?.model??null",
  "subagents:Y?.subagents",
  "embedded:g",
  // 会话所在的环境和项目：扩展可以按项目、按环境启用。Xi=会话引用，Wr=会话（草稿时为空），Za=当前项目。
  "environmentId:Xi?.environmentId??null",
  "projectId:Wr?.projectId??Za?.id??null",
].join(",");

const chatPatch = {
  id: "chat",
  label: "聊天模块",
  targetRegex: asset("_chat"),
  originalHash: "e5f61017c214605ad2251948b0e53af63901b7337dd0b22c36feebb404b85654",
  marker: MARKER,
  apply(text) {
    let out = replaceOnce(
      text,
      "function uz(e){",
      "function uz(e){return(0,$.jsx)(t3xHost.EffortSlot,{props:e,Default:t3xNativeEffort})}function t3xNativeEffort(e){",
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
// （an=设置页容器，cn=Section，nn=Row，qt=Switch，p=Button；页面组件里有同名局部变量，所以只能在模块顶层取）。
// 再从设置布局模块导入作用域 hook（导出名 b，即 wt：读 SettingsScopeProvider，可能为 null），把顶部“Applying settings for …”选中的项目和环境交给扩展页。
const appearancePatch = {
  id: "appearance",
  label: "外观设置页模块",
  targetRegex: asset("_chat\\.settings\\.appearance"),
  originalHash: "e025aeaaf50e353d1198fb6cca0ff6cc3ec8ffaf0ff9b734afd5a0b4d5d3f0fe",
  marker: "export{t3xExtensionsPage as t3xExtensions}",
  // 宿主没加载时页面不能是空白：给一句提示。
  apply: (text) =>
    `${stripMap(text)}\nconst t3xUi={Section:cn,Row:nn,Switch:qt,Button:p};` +
    "function t3xNoExtensions(){return(0,$.jsx)(`p`,{className:`text-sm text-muted-foreground`,children:/^zh\\b/i.test(document.documentElement.lang)?`扩展宿主没有加载，看不到扩展设置。`:`The extension host did not load, so extension settings are unavailable.`})}" +
    "function t3xExtensionsPage(){let s=t3xUseScope();return(0,$.jsx)(an,{children:(0,$.jsx)(globalThis.t3xHost?.SettingsPage??t3xNoExtensions,{ui:t3xUi,scope:s})})}" +
    'import{b as t3xUseScope}from"./settingsLayout-D212Gsp0.js";' +
    "export{t3xExtensionsPage as t3xExtensions};\n",
};

// 路由表：照抄外观页路由的懒加载写法（同一个模块、同一组预加载依赖），只换路径和导出名。A9=设置布局路由。
const routePatch = {
  id: "route",
  label: "路由表",
  targetRegex: asset("main"),
  originalHash: "341fd2f65a4484a4f306778419d7a81832ba61e3a988eefafbd3f4fd897733b4",
  marker: "ChatSettingsT3xExtensionsRoute:",
  apply(text) {
    const lazy = text.match(
      /Jse=ff\(`\/_chat\/settings\/appearance`\)\(\{component:(mf\(\(\)=>n\(\(\)=>import\(`\.\/_chat\.settings\.appearance-[\w-]+\.js`\),__vite__mapDeps\(\[[\d,]+\]\)\),)`component`\)\}\)/,
    );
    assert(lazy, `找不到外观页路由（需要 T3 Code ${T3_VERSION}）`);
    const route = `ff(\`/_chat/settings/extensions\`)({component:${lazy[1]}\`t3xExtensions\`)}).update({id:\`/extensions\`,path:\`/extensions\`,getParentRoute:()=>A9})`;
    return stripMap(
      replaceOnce(text, "Vce={ChatSettingsAboutRoute:Rce,", `Vce={ChatSettingsT3xExtensionsRoute:${route},ChatSettingsAboutRoute:Rce,`, "设置路由表"),
    );
  },
};

// 导航分组（放在“外观”后面）、导航名字、设置搜索和命令面板的条目（跳到页面里两个区块），作用域登记为本机（null）。
// 名字写英文原文，中文由 i18nPatch 补进 T3 的翻译函数。
const navPatch = {
  id: "nav",
  label: "设置导航",
  targetRegex: asset("settingsSearch"),
  originalHash: "bc88c05784b6f654507579a75f82d27134d10723a32524bb069328f01431b583",
  marker: '"/settings/extensions":t(`Extensions`)',
  apply(text) {
    const group = "paths:[`/settings/general`,`/settings/appearance`,";
    let out = replaceOnce(text, group, `${group}\`/settings/extensions\`,`, "设置导航分组");
    const names = '"/settings/archived":t(`Archive`)}';
    out = replaceOnce(out, `${names},_e={...G,`, `${names.slice(0, -1)},"/settings/extensions":t(\`Extensions\`)},_e={...G,`, "设置导航名字");
    const items =
      "{id:`t3x-installed`,title:`Extensions`,to:`/settings/extensions`,searchTerms:[`extensions plugins pets edge glow effort slider 扩展 插件 桌宠 边缘光 推理强度滑条`]}," +
      "{id:`t3x-market`,title:`Extension marketplace`,to:`/settings/extensions`,searchTerms:[`extension marketplace registry install 扩展市场 安装扩展 添加扩展`]},";
    out = replaceOnce(out, "{id:`color-scheme`", `${items}{id:\`color-scheme\``, "设置搜索条目");
    out = replaceOnce(out, "we={", 'we={"/settings/extensions":null,', "设置搜索作用域");
    return stripMap(out);
  },
};

// T3 的界面原文是英文，渲染时用 gt 的翻译函数（tp）按当前语言查表；中文表是冻结的模块，加不进条目。
// 在翻译函数入口认出补丁加的几条英文原文：中文界面返回中文，其他语言返回原文。导航、设置搜索、命令面板都走这里。
const T3X_MESSAGES = { Extensions: "扩展", "Extension marketplace": "扩展市场" };
const i18nPatch = {
  id: "i18n",
  label: "翻译函数",
  targetRegex: /^apps\/server\/dist\/client\/assets\/utils-CfAhq9cy\.js$/,
  originalHash: "8486f641e99c4e08dbc043379960470ea72e221fc119c1f8c19b743a9904ac6f",
  marker: "t3xMessages",
  apply(text) {
    const anchor = "return(0,J.useCallback)((e,a={})=>{let o=v(a.$locale??t,a,`ICU`);";
    // n=shouldTranslate：T3 关掉翻译时走原路径，和其他文案保持一致。
    const hook = "if(n&&typeof e==`string`&&Object.hasOwn(t3xMessages,e))return/^zh\\b/i.test(a.$locale??t)?t3xMessages[e]:e;";
    const out = replaceOnce(text, anchor, anchor.replace("{let o=", `{${hook}let o=`), "翻译函数");
    return `${stripMap(out)}\nconst t3xMessages=${JSON.stringify(T3X_MESSAGES)};\n`;
  },
};

// 导航图标：每个导航项都必须有图标组件，否则整个设置导航渲染失败。q=jsx 运行时。
const navIconPatch = {
  id: "nav-icon",
  label: "设置布局模块",
  targetRegex: asset("_chat\\.settings"),
  originalHash: "aa31f1060af6d64e041198e27ca7880267ea2edea13118fcc0fdc97fcfb90d5c",
  marker: "function t3xExtensionsIcon(",
  apply: (text) =>
    `${stripMap(replaceOnce(text, 'Pe={"/settings/general":k,', 'Pe={"/settings/extensions":t3xExtensionsIcon,"/settings/general":k,', "设置导航图标"))}\n` +
    'function t3xExtensionsIcon(e){return(0,q.jsxs)(`svg`,{xmlns:`http://www.w3.org/2000/svg`,width:24,height:24,viewBox:`0 0 24 24`,fill:`none`,stroke:`currentColor`,strokeWidth:2,strokeLinecap:`round`,strokeLinejoin:`round`,"aria-hidden":!0,...e,' +
    "children:[(0,q.jsx)(`rect`,{x:3,y:3,width:8,height:8,rx:1.5}),(0,q.jsx)(`rect`,{x:3,y:13,width:8,height:8,rx:1.5}),(0,q.jsx)(`rect`,{x:13,y:13,width:8,height:8,rx:1.5}),(0,q.jsx)(`path`,{d:`M17 3v8M13 7h8`})]})}\n",
};

const PROFILE_NAME = "t3-extensions-profile";
const userDataPatch = {
  id: "user-data",
  label: "Electron 用户数据目录",
  targetRegex: /^apps\/desktop\/dist-electron\/main\.cjs$/,
  originalHash: "873697d72e3daf3388b16ff8b0ca68bb2cbe15327005b8404b755b53228ebcc6",
  marker: `"${PROFILE_NAME}/electron"`,
  module: "commonjs",
  apply: (text) => replaceOnce(text, 'current: "t3code-v2",', `current: "${PROFILE_NAME}/electron",`, "userData 目录名"),
};

module.exports = { T3_VERSION, PROFILE_NAME, chatPatch, appearancePatch, routePatch, navPatch, navIconPatch, i18nPatch, userDataPatch };
