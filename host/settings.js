// 设置 → 扩展 页。ui 是 T3 原生的 Section / Row / Switch / Button / Input / Select 系列，scope 是当前选中的项目/环境作用域。

const h = React.createElement;
const sourceLabelFor = (kind) =>
  ({ registry: L("市场", "Marketplace"), url: L("链接", "Link"), local: L("本地", "Local"), zip: "ZIP", github: "GitHub" })[kind] ?? "";

// T3 的确认框按换行拆标题和说明：插进去的名字、版本、来源压成一行。
const oneLine = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const changedWhileConfirming = () => new Error(L("确认期间这个扩展有变化，请重试", "The extension changed while you were confirming. Try again."));

/** 安装确认。确认框是异步的：确认期间同 id 的扩展被换掉的话，作废这次确认。 */
async function consent(item) {
  const { manifest } = item;
  const before = records.get(manifest.id);
  const name = oneLine(localized(manifest, "name"));
  const version = oneLine(manifest.version);
  const old = replacing(item);
  const replace = !old
    ? ""
    : old.sameSource
      ? L(`\n从 ${oneLine(old.version)} 升级到 ${version}。`, `\nUpgrades ${oneLine(old.version)} to ${version}.`)
      : L(`\n会替换已安装的“${oneLine(old.name)}” ${oneLine(old.version)}（${oneLine(old.from)}），沿用它的设置。`, `\nReplaces the installed “${oneLine(old.name)}” ${oneLine(old.version)} (${oneLine(old.from)}) and keeps its settings.`);
  const ok = await showConfirm(
    L(`安装“${name}” ${version}？`, `Install “${name}” ${version}?`) +
      L(`\n来源：${oneLine(sourceText(item.source))}`, `\nSource: ${oneLine(sourceText(item.source))}`) +
      replace +
      L("\n扩展在 T3 Code 里运行，可以读取会话内容。", "\nExtensions run inside T3 Code and can read your threads."),
  );
  if (ok && records.get(manifest.id) !== before) throw changedWhileConfirming();
  return ok;
}

async function remove(manifest) {
  const before = records.get(manifest.id);
  const name = oneLine(localized(manifest, "name"));
  const ok = await showConfirm(L(`移除“${name}”？\n它的设置和数据会一起删除。`, `Remove “${name}”?\nIts settings and data will be deleted too.`), { variant: "destructive" });
  if (!ok) return false;
  if (records.get(manifest.id) !== before) throw changedWhileConfirming();
  await uninstall(manifest.id);
  return true;
}

// 整个区块也包一层：宿主自己出错时只显示一行提示，不连累 T3 的设置页。
const HOST_REC = { manifest: { id: "t3x-host" } };

const isGithubUrl = (url) => typeof url === "string" && /^https:\/\/github\.com\//i.test(url);

function detailsUrlFor(rec) {
  if (typeof rec.manifest?.repository === "string" && rec.manifest.repository) return rec.manifest.repository;
  if (typeof rec.source?.url === "string" && /^https?:\/\//i.test(rec.source.url)) return rec.source.url;
  return null;
}

function matchesSearch(rec, q) {
  if (!q) return true;
  const { manifest, source } = rec;
  const fields = [
    manifest.id,
    manifest.name,
    manifest.description,
    manifest.author,
    localized(manifest, "name"),
    localized(manifest, "description"),
    source?.folder,
    source?.file,
    source?.owner,
    source?.repo,
    sourceLabelFor(source?.kind),
  ];
  return fields.some((v) => typeof v === "string" && v.toLowerCase().includes(q));
}

function StatusBanner({ message, onDismiss }) {
  if (!message) return null;
  const cls = message.kind === "error" ? "t3x-banner t3x-error" : message.kind === "ok" ? "t3x-banner t3x-ok" : "t3x-banner t3x-info";
  const icon = message.kind === "error" ? "alert" : "check";
  return h(
    "div",
    {
      className: cls,
      role: message.kind === "error" ? "alert" : "status",
      "aria-live": "polite",
    },
    t3xIcon(icon, 14, "t3x-banner-icon"),
    h("span", { className: "t3x-banner-text" }, message.text),
    onDismiss
      ? h(
          "button",
          {
            type: "button",
            className: "t3x-banner-close",
            "aria-label": L("关闭提示", "Dismiss notification"),
            onClick: onDismiss,
          },
          t3xIcon("x", 12),
        )
      : null,
  );
}

/** 卡片渲染失败时的降级展示，保留移除入口。 */
function CardFallback({ ui, rec, onMessage }) {
  return h(
    "article",
    { className: "t3x-card t3x-card-fallback" },
    h("p", { className: "t3x-error" }, L(`${rec.manifest.id}：这张卡片显示不了`, `Couldn’t display the card for ${rec.manifest.id}`)),
    h(ui.Button, { size: "xs", variant: "outline", onClick: () => remove(rec.manifest).catch((error) => onMessage?.({ kind: "error", text: L(`移除失败：${error?.message ?? error}`, `Couldn’t remove the extension: ${error?.message ?? error}`) })) }, L("移除", "Remove")),
  );
}

/** 已安装页的扩展卡片。 */
function ExtensionCard({ ui, rec, scopeKeys, onOpenSettings, onMessage }) {
  const { manifest } = rec;
  const id = manifest.id;
  const name = localized(manifest, "name");
  const summary = localized(manifest, "description");
  const isGlobal = scopeKeys === null;
  const scopeUnavailable = Array.isArray(scopeKeys) && scopeKeys.length === 0;
  const state = scopeState(rec, scopeKeys);
  const updateInfo = updates.get(id);
  const detailsUrl = detailsUrlFor(rec);
  const reloadable = canReload(rec);
  const checkable = canCheckUpdate(rec);
  const [reloading, setReloading] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [localStatus, setLocalStatus] = React.useState(null);

  React.useEffect(() => {
    if (!localStatus || localStatus.kind === "error") return;
    const timer = setTimeout(() => setLocalStatus(null), 3500);
    return () => clearTimeout(timer);
  }, [localStatus]);

  const sourceTextLabel = sourceLabelFor(rec.source?.kind);
  const statusText =
    rec.status === "error"
      ? L("出错", "Error")
      : state.on
        ? L("已启用", "Enabled")
        : L("已停用", "Disabled");

  const handleReload = () => {
    if (reloading) return;
    setReloading(true);
    setLocalStatus(null);
    // 必须在点击事件里直接调用 reloadLocal：可能需要向浏览器重新申请读取权限。
    reloadLocal(rec).then(
      () => {
        setReloading(false);
        setLocalStatus({ kind: "ok", text: L("已重新加载本地文件", "Reloaded from local folder") });
      },
      (error) => {
        setReloading(false);
        setLocalStatus({ kind: "error", text: String(error?.message ?? error) });
      },
    );
  };

  const handleCheckUpdate = () => {
    if (updateInfo?.state === "checking") return;
    refreshUpdate(rec);
  };

  const handleApplyUpdate = async () => {
    if (applying || updateInfo?.state !== "available") return;
    setApplying(true);
    try {
      const confirmed = updateInfo; // 装的必须是确认框里展示的那份
      const next = confirmed.item;
      if (!(await consent(next))) {
        onMessage?.({ kind: "info", text: L("已取消更新", "Update canceled") });
        return;
      }
      await applyUpdate(id, confirmed);
      onMessage?.({ kind: "ok", text: L(`已更新“${name}”至 v${next.manifest.version}`, `Updated “${name}” to v${next.manifest.version}`) });
    } catch (error) {
      onMessage?.({ kind: "error", text: L(`更新失败：${error?.message ?? error}`, `Update failed: ${error?.message ?? error}`) });
    } finally {
      setApplying(false);
    }
  };

  const handleRemove = async () => {
    try {
      if (await remove(manifest)) onMessage?.({ kind: "ok", text: L(`已移除“${name}”`, `Removed “${name}”`) });
    } catch (error) {
      onMessage?.({ kind: "error", text: L(`移除失败：${error?.message ?? error}`, `Couldn’t remove the extension: ${error?.message ?? error}`) });
    }
  };

  const handleSwitch = (checked) => {
    if (scopeUnavailable) return;
    setEnabledIn(id, scopeKeys, !!checked).catch((error) => {
      onMessage?.({ kind: "error", text: String(error?.message ?? error) });
    });
  };

  const handleResetScope = () => {
    if (isGlobal || scopeUnavailable) return;
    setEnabledIn(id, scopeKeys, null).catch((error) => {
      onMessage?.({ kind: "error", text: String(error?.message ?? error) });
    });
  };

  const isChecking = updateInfo?.state === "checking";
  const canConfigure = state.on && rec.status === "on" && !!rec.settings;
  const showRefreshBtn = reloadable || checkable;

  return h(
    "article",
    { className: "t3x-card", "data-extension-id": id, "data-enabled": state.on ? "true" : "false" },
    h(
      "div",
      { className: "t3x-card-head" },
      h("div", { className: "t3x-card-icon", "aria-hidden": true }, t3xIcon("plugin", 17)),
      h(
        "div",
        { className: "t3x-card-id" },
        h(
          "div",
          { className: "t3x-card-title-row" },
          h("h3", { className: "t3x-card-name", title: name }, name),
          h("span", { className: "t3x-ver" }, `v${manifest.version}`),
        ),
        h(
          "div",
          { className: "t3x-card-sub" },
          h("span", { className: "t3x-card-sub-text" }, sourceTextLabel ? `${sourceTextLabel} · ${statusText}` : statusText),
          !isGlobal && state.mixed
            ? h("span", { className: "t3x-scope-pill", title: L("这个项目在不同环境里开关不一致；切换会统一设置", "Enabled in some environments of this project but not others; toggling sets them all") }, L("部分启用", "Partially enabled"))
            : !isGlobal && state.inherited
            ? h("span", { className: "t3x-scope-pill", title: L("当前作用域未单独设置，沿用上一级开关", "No override in this scope; inheriting from parent scope") }, L("沿用上一级", "Inherited"))
            : null,
        ),
      ),
    ),
    h(
      "p",
      {
        className: summary ? "t3x-card-desc" : "t3x-card-desc t3x-card-desc-empty",
        title: summary || undefined,
      },
      summary || L("暂无简介", "No description"),
    ),
    rec.error
      ? h(
          "div",
          { className: "t3x-card-notice t3x-card-notice-error", role: "alert", title: rec.error },
          t3xIcon("alert", 13, "t3x-notice-icon"),
          h("span", { className: "t3x-notice-text" }, rec.error),
        )
      : null,
    localStatus
      ? h(
          "div",
          {
            className: localStatus.kind === "error" ? "t3x-card-notice t3x-card-notice-error" : "t3x-card-notice t3x-card-notice-ok",
            role: localStatus.kind === "error" ? "alert" : "status",
            title: localStatus.text,
          },
          t3xIcon(localStatus.kind === "error" ? "alert" : "check", 13, "t3x-notice-icon"),
          h("span", { className: "t3x-notice-text" }, localStatus.text),
        )
      : null,
    updateInfo
      ? updateInfo.state === "available"
        ? h(
            "div",
            { className: "t3x-card-update-bar", role: "status" },
            h("span", { className: "t3x-notice-text" }, L(`发现新版本 v${updateInfo.item.manifest.version}`, `New version v${updateInfo.item.manifest.version}`)),
            h(
              ui.Button,
              { size: "xs", variant: "default", disabled: applying, onClick: handleApplyUpdate },
              applying
                ? L("更新中…", "Updating…")
                : L(`更新至 v${updateInfo.item.manifest.version}`, `Update to v${updateInfo.item.manifest.version}`),
            ),
          )
        : h(
            "div",
            {
              className:
                updateInfo.state === "error"
                  ? "t3x-card-notice t3x-card-notice-error"
                  : updateInfo.state === "latest"
                    ? "t3x-card-notice t3x-card-notice-ok"
                    : "t3x-card-notice",
              role: updateInfo.state === "error" ? "alert" : "status",
              title: updateInfo.error || undefined,
            },
            t3xIcon(
              updateInfo.state === "error" ? "alert" : updateInfo.state === "latest" ? "check" : "refresh",
              13,
              updateInfo.state === "checking" ? "t3x-notice-icon t3x-spin" : "t3x-notice-icon",
            ),
            h(
              "span",
              { className: "t3x-notice-text" },
              updateInfo.state === "checking"
                ? L("正在检查更新…", "Checking for updates…")
                : updateInfo.state === "latest"
                  ? L("已是最新版本", "Up to date")
                  : updateInfo.error,
            ),
          )
      : null,
    h(
      "div",
      { className: "t3x-card-foot" },
      h(
        "div",
        { className: "t3x-card-foot-left" },
        detailsUrl
          ? h(
              "a",
              {
                className: "t3x-details-link",
                href: detailsUrl,
                target: "_blank",
                rel: "noreferrer",
                title: detailsUrl,
              },
              t3xIcon(isGithubUrl(detailsUrl) ? "github" : "external", 13),
              h("span", null, L("详情", "Details")),
            )
          : rec.source?.folder || rec.source?.file
            ? h("span", { className: "t3x-foot-meta", title: rec.source.folder || rec.source.file }, rec.source.folder || rec.source.file)
            : null,
        canConfigure
          ? h(
              ui.Button,
              {
                size: "xs",
                variant: "ghost",
                className: "t3x-foot-btn",
                onClick: () => onOpenSettings(id),
              },
              t3xIcon("settings", 12),
              L("设置", "Settings"),
            )
          : null,
        h(
          ui.Button,
          {
            size: "xs",
            variant: "ghost",
            className: "t3x-foot-btn t3x-btn-danger",
            "aria-label": L(`移除 ${name}`, `Remove ${name}`),
            onClick: handleRemove,
          },
          L("移除", "Remove"),
        ),
      ),
      h(
        "div",
        { className: "t3x-card-foot-right" },
        !isGlobal && !scopeUnavailable && !state.inherited
          ? h(
              ui.Button,
              {
                size: "xs",
                variant: "ghost",
                className: "t3x-foot-btn",
                "aria-label": L(`重置 ${name} 的作用域设置`, `Reset scope override for ${name}`),
                onClick: handleResetScope,
              },
              L("重置", "Reset"),
            )
          : null,
        showRefreshBtn
          ? h(
              ui.Button,
              {
                size: "xs",
                variant: "ghost",
                className: "t3x-icon-btn",
                disabled: reloadable ? reloading : isChecking,
                "aria-label": reloadable ? L(`重新加载 ${name}`, `Reload ${name}`) : L(`检查 ${name} 更新`, `Check for updates to ${name}`),
                title: reloadable ? L("重新加载本地扩展", "Reload local extension") : L("检查更新", "Check for updates"),
                onClick: reloadable ? handleReload : handleCheckUpdate,
              },
              t3xIcon("refresh", 13, reloading || isChecking ? "t3x-spin" : ""),
            )
          : null,
        h(
          "span",
          { className: "t3x-switch-wrap" },
          h(ui.Switch, {
            checked: state.on,
            disabled: scopeUnavailable,
            onCheckedChange: handleSwitch,
            "aria-label": L(`启用 ${name}`, `Enable ${name}`),
          }),
        ),
      ),
    ),
  );
}

/** 第三方注册表卡片（Browse 标签页）。 */
function MarketCard({ ui, entry, onInstall, busy, installing }) {
  const installed = records.get(entry.id);
  // 只有从这个市场的这个条目装的才算“已安装”；别处装的同 id 扩展照常可装（弹窗会提示替换）。
  const upToDate = installed?.source?.url === entry.manifestUrl && installed.manifest.version === entry.version;
  const label = installed ? (upToDate ? L("已安装", "Installed") : L("更新", "Update")) : L("安装", "Install");
  const name = localized(entry, "name") ?? entry.id;
  const description = localized(entry, "description");
  return h(
    "article",
    { className: "t3x-card" },
    h(
      "div",
      { className: "t3x-card-head" },
      h("div", { className: "t3x-card-icon", "aria-hidden": true }, t3xIcon("plugin", 17)),
      h(
        "div",
        { className: "t3x-card-id" },
        h(
          "div",
          { className: "t3x-card-title-row" },
          h("h3", { className: "t3x-card-name", title: name }, name),
          entry.version ? h("span", { className: "t3x-ver" }, `v${entry.version}`) : null,
          h("span", { className: "t3x-badge t3x-badge-ok", title: L("安装时按注册表逐个文件校验 SHA-256", "Each file is verified against the registry’s SHA-256 checksum during installation") }, L("已校验", "Verified")),
        ),
        h(
          "div",
          { className: "t3x-card-sub" },
          h("span", { className: "t3x-card-sub-text" }, entry.author ? `${entry.author} · ${L("市场", "Marketplace")}` : L("市场", "Marketplace")),
          installed && !upToDate ? h("span", { className: "t3x-dot", "aria-hidden": true }, "·") : null,
          installed && !upToDate ? h("span", { className: "t3x-stat" }, L(`当前 v${installed.manifest.version}`, `Current v${installed.manifest.version}`)) : null,
        ),
      ),
    ),
    h(
      "p",
      {
        className: description ? "t3x-card-desc" : "t3x-card-desc t3x-card-desc-empty",
        title: description || undefined,
      },
      description || L("暂无简介", "No description"),
    ),
    h(
      "div",
      { className: "t3x-card-foot" },
      h(
        "div",
        { className: "t3x-card-foot-left" },
        h("span", { className: "t3x-foot-meta" }, entry.id),
      ),
      h(
        "div",
        { className: "t3x-card-foot-right" },
        upToDate
          ? h("span", { className: "t3x-status-pill t3x-status-installed" }, t3xIcon("check", 12), L("已安装", "Installed"))
          : h(
              ui.Button,
              {
                size: "xs",
                variant: "outline",
                disabled: busy,
                "aria-label": `${label} ${name}`,
                onClick: () => onInstall(entry),
              },
              installing ? L("安装中…", "Installing…") : label,
            ),
      ),
    ),
  );
}

/** 扩展设置内联视图：在扩展页内直接进入详情与设置，不再在设置浮层上叠加弹窗。 */
function ExtensionSettingsView({ ui, rec, onBack }) {
  const { manifest } = rec;
  const name = localized(manifest, "name");
  const summary = localized(manifest, "description");
  const detailsUrl = detailsUrlFor(rec);
  const sourceTextLabel = sourceLabelFor(rec.source?.kind);

  const titleRef = React.useRef(null);
  React.useEffect(() => {
    const scroller = document.querySelector("[data-settings-page-scroll]");
    if (scroller) scroller.scrollTop = 0;
    titleRef.current?.focus({ preventScroll: true }); // 点“设置”的按钮已经卸载，焦点交给标题
  }, [manifest.id]);

  return h(
    "div",
    { className: "t3x-detail", "data-extension-settings": manifest.id },
    h(
      "div",
      { className: "t3x-detail-nav" },
      h(
        ui.Button,
        {
          size: "xs",
          variant: "ghost",
          className: "t3x-back-btn",
          onClick: onBack,
        },
        t3xIcon("arrowLeft", 14),
        L("返回扩展", "Back to extensions"),
      ),
    ),
    h(
      "header",
      { className: "t3x-detail-head" },
      h(
        "div",
        { className: "t3x-detail-id" },
        h("div", { className: "t3x-card-icon t3x-detail-icon", "aria-hidden": true }, t3xIcon("plugin", 19)),
        h(
          "div",
          { className: "t3x-detail-meta" },
          h(
            "div",
            { className: "t3x-detail-title-row" },
            h("h1", { ref: titleRef, tabIndex: -1, className: "t3x-detail-title" }, name),
            h("span", { className: "t3x-ver" }, `v${manifest.version}`),
            sourceTextLabel ? h("span", { className: "t3x-badge" }, sourceTextLabel) : null,
          ),
          summary ? h("p", { className: "t3x-detail-desc" }, summary) : null,
        ),
      ),
      detailsUrl
        ? h(
            "a",
            {
              className: "t3x-details-link t3x-detail-ext-link",
              href: detailsUrl,
              target: "_blank",
              rel: "noreferrer",
              title: detailsUrl,
            },
            t3xIcon(isGithubUrl(detailsUrl) ? "github" : "external", 14),
            h("span", null, L("详情", "Details")),
          )
        : null,
    ),
    h(
      "div",
      { className: "t3x-detail-body" },
      h(
        Guard,
        { rec, fallback: h("p", { className: "t3x-error" }, L("设置面板出错", "The settings panel encountered an error")) },
        h(rec.settings, { ui }),
      ),
    ),
  );
}

function SettingsPage(props) {
  useLang();
  return h(
    Guard,
    { rec: HOST_REC, fallback: h("p", { className: "t3x-error" }, L("扩展设置出错，详见开发者工具控制台", "Extension settings encountered an error. See the developer console for details.")) },
    h(ExtensionsPage, props),
  );
}

const TABS = [
  { id: "installed", label: () => L("已安装", "Installed") },
  { id: "browse", label: () => L("浏览", "Browse") },
];

// 切换顶部作用域时 T3 可能重挂页面组件，记住上次选中的标签页避免跳走。
let lastActiveTab = "installed";

function ExtensionsPage({ ui, scope }) {
  useHostVersion();
  useLang();
  // setEnabledIn 在扩展运行状态未变时不触发 bump()，订阅这两个存储键确保作用域开关和重置即时刷新。
  useStored("t3x:enabled", {});
  useStored("t3x:scoped", {});
  const scopeKeys = t3xScopeKeys(scope);
  const registryUrls = useStored("t3x:registries", []);

  const [activeTab, setActiveTabState] = React.useState(lastActiveTab);
  const setActiveTab = React.useCallback((tab) => {
    lastActiveTab = tab;
    setActiveTabState(tab);
  }, []);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [browseSubmit, setBrowseSubmit] = React.useState({ seq: 0, query: "" });
  const [browseRefreshSeq, setBrowseRefreshSeq] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const [settingsId, setSettingsId] = React.useState(null);

  const [markets, setMarkets] = React.useState({});
  const [urlInput, setUrlInput] = React.useState("");
  const [busyKey, setBusyKey] = React.useState(null);
  const [message, setMessage] = React.useState(null);

  const folderRef = React.useRef(null);
  const zipRef = React.useRef(null);
  const tabRefs = React.useRef({});
  const busy = busyKey !== null;

  const openRequested = React.useCallback(() => {
    const reqId = takeSettingsRequest();
    if (!reqId) return;
    setActiveTab("installed"); // 返回时落在“已安装”
    setSettingsId(reqId);
  }, [setActiveTab]);

  React.useEffect(() => {
    openRequested();
    return subscribeSettingsRequest(openRequested);
  }, [openRequested]);

  const loadRegistry = (u) => {
    setMarkets((all) => ({ ...all, [u]: { loading: true } }));
    fetchRegistry(u)
      .then((m) => setMarkets((all) => ({ ...all, [u]: m })))
      .catch((error) => setMarkets((all) => ({ ...all, [u]: { url: u, error: String(error?.message ?? error) } })));
  };

  React.useEffect(() => {
    if (activeTab !== "browse") return;
    for (const u of registryUrls) {
      if (markets[u]) continue;
      loadRegistry(u);
    }
  }, [activeTab, registryUrls]);

  // 打开的设置视图对应扩展被停用或卸载时自动回到列表；冷启动尚未就绪时等待加载完成。
  const settingsRec = settingsId ? records.get(settingsId) : null;
  const settingsActive = settingsRec && settingsRec.status === "on" && !!settingsRec.settings;
  React.useEffect(() => {
    if (ready && settingsId && !settingsActive) setSettingsId(null);
  }, [ready, settingsId, settingsActive]);

  const run = async (key, task) => {
    setBusyKey(key);
    setMessage(null);
    try {
      const res = await task();
      if (res && typeof res === "object") setMessage(res);
      else if (res) setMessage({ kind: "ok", text: String(res) });
    } catch (error) {
      setMessage({ kind: "error", text: String(error?.message ?? error) });
    } finally {
      setBusyKey(null);
    }
  };

  const installEntry = (entry) =>
    run(`reg:${entry.manifestUrl}`, async () => {
      const item = await fetchExtension(entry.manifestUrl, entry.sha256);
      if (item.manifest.id !== entry.id) {
        throw new Error(L(`注册表写的是 ${entry.id}，下载到的是 ${item.manifest.id}`, `The registry lists ${entry.id}, but the download contains ${item.manifest.id}`));
      }
      if (entry.version && item.manifest.version !== entry.version) {
        throw new Error(L(`注册表写的版本是 ${entry.version}，下载到的是 ${item.manifest.version}`, `The registry lists version ${entry.version}, but the download contains ${item.manifest.version}`));
      }
      if (!(await consent(item))) return { kind: "info", text: L("已取消安装", "Installation canceled") };
      await install(item);
      setActiveTab("installed");
      return { kind: "ok", text: L(`已安装“${localized(item.manifest, "name")}”`, `Installed “${localized(item.manifest, "name")}”`) };
    });

  // 本地文件夹、zip、GitHub 仓库都走同一个“确认 → 安装”流程。
  const installItem = (key, load) =>
    run(key, async () => {
      const item = await load();
      if (!item) return null;
      if (!(await consent(item))) return { kind: "info", text: L("已取消安装", "Installation canceled") };
      await install(item);
      setActiveTab("installed");
      return { kind: "ok", text: L(`已安装“${localized(item.manifest, "name")}”`, `Installed “${localized(item.manifest, "name")}”`) };
    });

  const installGithub = (target, key = `gh:${target.owner}/${target.repo}`) => installItem(key, () => fetchGithubExtension(target));

  const handleAddLocal = () => {
    if (busy || !ready) return;
    if (canPickFolder()) {
      return installItem("local", () => pickLocalFolder());
    }
    folderRef.current?.click();
  };

  const addUrl = (ev) => {
    ev?.preventDefault?.();
    if (busy || !ready || !urlInput.trim()) return;
    const github = t3xParseGithub(urlInput);
    if (github) {
      setUrlInput("");
      return installGithub(github, "url");
    }
    return run("url", async () => {
      const target = httpUrl(urlInput).href;
      const probe = JSON.parse(new TextDecoder().decode(await fetchBytes(target, LIMITS.index)));
      if (Array.isArray(probe?.extensions)) {
        const market = await fetchRegistry(target);
        setMarkets((all) => ({ ...all, [market.url]: market }));
        const latest = store.get("t3x:registries", []);
        if (!latest.includes(market.url)) await store.set("t3x:registries", [...latest, market.url]);
        setUrlInput("");
        return {
          kind: "ok",
          text: L(
            `已添加扩展市场“${market.name}”，共 ${market.extensions.length} 个扩展`,
            `Added marketplace “${market.name}” (${market.extensions.length} ${market.extensions.length === 1 ? "extension" : "extensions"})`,
          ),
        };
      }
      const item = await fetchExtension(target, null);
      if (!(await consent(item))) return { kind: "info", text: L("已取消安装", "Installation canceled") };
      await install(item);
      setUrlInput("");
      setActiveTab("installed");
      return { kind: "ok", text: L(`已安装“${localized(item.manifest, "name")}”`, `Installed “${localized(item.manifest, "name")}”`) };
    });
  };

  const removeMarket = (u) =>
    store.set(
      "t3x:registries",
      registryUrls.filter((x) => x !== u),
    );

  const handleRefreshAll = async () => {
    if (refreshing || !ready) return;
    setRefreshing(true);
    setMessage(null);
    if (typeof searchCache !== "undefined") searchCache.clear();
    setBrowseRefreshSeq((n) => n + 1);
    if (activeTab === "browse") {
      for (const u of registryUrls) loadRegistry(u);
    }
    try {
      await refreshAllUpdates();
      const checked = [...records.values()].filter((r) => canCheckUpdate(r));
      const results = checked.map((r) => updates.get(r.manifest.id)).filter(Boolean);
      const avail = results.filter((u) => u.state === "available").length;
      const errs = results.filter((u) => u.state === "error");
      if (avail > 0) {
        setMessage({
          kind: "ok",
          text: L(`发现 ${avail} 个可用更新`, `${avail} ${avail === 1 ? "update" : "updates"} available`),
        });
      } else if (errs.length > 0) {
        const firstErr = errs[0].error;
        setMessage({
          kind: "error",
          text:
            errs.length === results.length
              ? L(`检查更新失败：${firstErr}`, `Couldn’t check for updates: ${firstErr}`)
              : L(`部分扩展检查更新失败：${firstErr}`, `Couldn’t check some extensions for updates: ${firstErr}`),
        });
      } else if (checked.length > 0) {
        setMessage({ kind: "info", text: L("所有扩展均已是最新版本", "All extensions are up to date") });
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleTabKeyDown = (ev, idx) => {
    let next = idx;
    if (ev.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (ev.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = TABS.length - 1;
    else return;
    ev.preventDefault();
    const tabId = TABS[next].id;
    setActiveTab(tabId);
    tabRefs.current[tabId]?.focus();
  };

  const allRecords = [...records.values()];
  const installedList = allRecords;
  const q = searchQuery.trim().toLowerCase();
  const filteredInstalled = installedList.filter((rec) => matchesSearch(rec, q));

  const tabCounts = {
    installed: ready ? installedList.length : null,
    browse: null,
  };

  const searchPlaceholder =
    activeTab === "browse"
      ? L("搜索社区扩展或已添加的市场…", "Search community extensions or marketplaces…")
      : L("搜索已安装扩展…", "Search installed extensions…");

  const renderCardGrid = (items) =>
    h(
      "div",
      { className: "t3x-grid" },
      items.map((rec) =>
        h(
          Guard,
          { key: rec.manifest.id, rec: HOST_REC, fallback: h(CardFallback, { ui, rec, onMessage: setMessage }) },
          h(ExtensionCard, {
            ui,
            rec,
            scopeKeys,
            onOpenSettings: (id) => setSettingsId(id),
            onMessage: setMessage,
          }),
        ),
      ),
    );

  const loadingBlock = h(
    "div",
    { className: "t3x-loading-wrap", "aria-busy": true, "aria-live": "polite" },
    h("p", { className: "t3x-hint" }, L("正在载入扩展…", "Loading extensions…")),
    h(MarketSkeleton, { count: 4 }),
  );

  if (settingsActive) {
    return h(
      "div",
      { className: "t3x-page" },
      !persistent
        ? h(
            "div",
            { className: "t3x-banner t3x-error", role: "alert" },
            t3xIcon("alert", 14, "t3x-banner-icon"),
            h(
              "span",
              { className: "t3x-banner-text" },
              L("扩展数据没能读出：这次的修改只在内存里，重启后会丢失。", "Couldn’t load extension data. Changes made now will be lost when you restart."),
            ),
          )
        : null,
      h(ExtensionSettingsView, { ui, rec: settingsRec, onBack: () => setSettingsId(null) }),
    );
  }

  return h(
    "div",
    { className: "t3x-page" },
    // 隐藏文件选择器始终挂载在 DOM 里，确保随时可用（含本地文件夹降级与 ZIP 上传）。
    h("input", {
      ref: folderRef,
      type: "file",
      hidden: true,
      webkitdirectory: "",
      onChange: (ev) => {
        const files = [...(ev.target.files ?? [])];
        ev.target.value = "";
        if (files.length) installItem("folder", () => readFolder(files));
      },
    }),
    h("input", {
      ref: zipRef,
      type: "file",
      hidden: true,
      accept: ".zip,application/zip",
      onChange: (ev) => {
        const file = ev.target.files?.[0];
        ev.target.value = "";
        if (file) installItem("zip", () => readZip(file));
      },
    }),

    // 标题行：左标题，右“添加本地扩展”与“刷新”
    h(
      "header",
      { className: "t3x-header" },
      h("h1", { className: "t3x-title" }, L("扩展", "Extensions")),
      h(
        "div",
        { className: "t3x-header-actions" },
        h(
          ui.Button,
          {
            size: "xs",
            variant: "outline",
            disabled: !ready || busy,
            onClick: handleAddLocal,
          },
          t3xIcon("folder", 13),
          busyKey === "local" || busyKey === "folder" ? L("导入中…", "Adding…") : L("添加本地扩展", "Add local extension"),
        ),
        h(
          ui.Button,
          {
            size: "xs",
            variant: "outline",
            disabled: !ready || refreshing,
            onClick: handleRefreshAll,
          },
          t3xIcon("refresh", 13, refreshing ? "t3x-spin" : ""),
          refreshing ? L("刷新中…", "Refreshing…") : L("刷新", "Refresh"),
        ),
      ),
    ),

    // 持久化警告与操作结果横幅
    !persistent
      ? h(
          "div",
          { className: "t3x-banner t3x-error", role: "alert" },
          t3xIcon("alert", 14, "t3x-banner-icon"),
          h("span", { className: "t3x-banner-text" }, L("扩展数据没能读出：这次的修改只在内存里，重启后会丢失。", "Couldn’t load extension data. Changes made now will be lost when you restart.")),
        )
      : null,
    h(StatusBanner, { message, onDismiss: () => setMessage(null) }),

    // 全宽搜索框
    h(
      "form",
      {
        className: "t3x-search-form",
        role: "search",
        onSubmit: (ev) => {
          ev.preventDefault();
          if (activeTab === "browse") {
            setBrowseSubmit((s) => ({ seq: s.seq + 1, query: searchQuery }));
          }
        },
      },
      h(
        "div",
        { className: "t3x-search-field" },
        t3xIcon("search", 14, "t3x-search-icon"),
        h("input", {
          className: "t3x-input t3x-search-input",
          type: "search",
          "aria-label": L("搜索扩展", "Search extensions"),
          placeholder: searchPlaceholder,
          value: searchQuery,
          onChange: (ev) => setSearchQuery(ev.target.value),
        }),
        searchQuery
          ? h(
              "button",
              {
                type: "button",
                className: "t3x-search-clear",
                "aria-label": L("清除搜索词", "Clear search"),
                onClick: () => setSearchQuery(""),
              },
              t3xIcon("x", 12),
            )
          : null,
      ),
    ),

    // 分段标签：Installed / Browse
    h(
      "div",
      { className: "t3x-tabs", role: "tablist", "aria-label": L("扩展分类", "Extension tabs") },
      TABS.map((tab, idx) => {
        const selected = activeTab === tab.id;
        const count = tabCounts[tab.id];
        return h(
          "button",
          {
            key: tab.id,
            ref: (el) => {
              tabRefs.current[tab.id] = el;
            },
            id: `t3x-tab-${tab.id}`,
            type: "button",
            role: "tab",
            className: selected ? "t3x-tab t3x-tab-active" : "t3x-tab",
            "aria-selected": selected,
            "aria-controls": `t3x-panel-${tab.id}`,
            tabIndex: selected ? 0 : -1,
            onClick: () => setActiveTab(tab.id),
            onKeyDown: (ev) => handleTabKeyDown(ev, idx),
          },
          h("span", null, tab.label()),
          count !== null ? h("span", { className: "t3x-tab-count" }, String(count)) : null,
        );
      }),
    ),

    // 标签页内容区
    h(
      "div",
      {
        id: `t3x-panel-${activeTab}`,
        className: "t3x-panel",
        role: "tabpanel",
        "aria-labelledby": `t3x-tab-${activeTab}`,
      },
      !ready
        ? loadingBlock
        : activeTab === "installed"
          ? filteredInstalled.length > 0
            ? renderCardGrid(filteredInstalled)
            : installedList.length === 0
              ? h(
                  "div",
                  { className: "t3x-state t3x-state-empty" },
                  h("p", { className: "t3x-state-title" }, L("尚未安装扩展", "No installed extensions yet")),
                  h("p", { className: "t3x-hint" }, L("可以在“浏览”里发现社区扩展、通过链接或 ZIP 安装，或点击右上角添加本地扩展。", "Discover community extensions in Browse, install via URL or ZIP, or add a local extension above.")),
                  h(
                    "div",
                    { className: "t3x-state-actions" },
                    h(ui.Button, { size: "xs", variant: "outline", onClick: () => setActiveTab("browse") }, L("浏览扩展市场", "Browse extensions")),
                    h(ui.Button, { size: "xs", variant: "ghost", disabled: busy, onClick: () => zipRef.current?.click() }, t3xIcon("zip", 13), L("上传 ZIP", "Upload ZIP")),
                  ),
                )
              : h(
                  "div",
                  { className: "t3x-state t3x-state-empty" },
                  h("p", { className: "t3x-state-title" }, L(`没有找到与“${searchQuery.trim()}”匹配的已安装扩展`, `No installed extensions match “${searchQuery.trim()}”`)),
                  h("div", { className: "t3x-state-actions" }, h(ui.Button, { size: "xs", variant: "outline", onClick: () => setSearchQuery("") }, L("清空搜索", "Clear search"))),
                )
          : h(
                "div",
                { className: "t3x-browse" },
                // 手动安装入口：GitHub / plugin.json / index.json 链接 + 上传 ZIP
                h(
                  Guard,
                  { rec: HOST_REC, fallback: h("p", { className: "t3x-error" }, L("手动安装入口出错", "Manual install bar encountered an error")) },
                  h(
                    "section",
                    { className: "t3x-manual-bar", "aria-label": L("手动安装", "Install manually") },
                    h(
                      "form",
                      { className: "t3x-url-row", onSubmit: addUrl },
                      h(
                        "div",
                        { className: "t3x-url-field" },
                        t3xIcon("link", 13, "t3x-search-icon"),
                        h("input", {
                          id: "t3x-manual-url",
                          className: "t3x-input t3x-url-input",
                          type: "url",
                          "aria-label": L("通过链接安装或添加市场", "Install via URL or add marketplace"),
                          placeholder: L("粘贴 GitHub 仓库、plugin.json 或市场 index.json 链接…", "Paste a GitHub repo, plugin.json, or index.json URL…"),
                          value: urlInput,
                          disabled: busy,
                          onChange: (ev) => setUrlInput(ev.target.value),
                        }),
                      ),
                      h(ui.Button, { type: "submit", size: "xs", variant: "outline", disabled: busy || !urlInput.trim() }, busyKey === "url" ? L("添加中…", "Adding…") : L("添加", "Add")),
                      h(
                        ui.Button,
                        {
                          type: "button",
                          size: "xs",
                          variant: "outline",
                          disabled: busy,
                          onClick: () => zipRef.current?.click(),
                        },
                        t3xIcon("upload", 13),
                        busyKey === "zip" ? L("读取中…", "Reading…") : L("上传 ZIP", "Upload ZIP"),
                      ),
                    ),
                  ),
                ),

                // 社区扩展（GitHub 话题搜索）
                h(
                  Guard,
                  { rec: HOST_REC, fallback: h("p", { className: "t3x-error" }, L("社区扩展区块出错", "Community extensions failed to render")) },
                  h(CommunityMarket, {
                    ui,
                    filterQuery: searchQuery,
                    submitSeq: browseSubmit.seq,
                    submittedQuery: browseSubmit.query,
                    refreshSeq: browseRefreshSeq,
                    busy,
                    busyKey,
                    onInstall: installGithub,
                    onClearSearch: () => setSearchQuery(""),
                  }),
                ),

                // 已添加的第三方市场（注册表）
                registryUrls.map((u) => {
                  const m = markets[u];
                  const isLoading = !m || m.loading;
                  const filteredEntries = Array.isArray(m?.extensions)
                    ? q
                      ? m.extensions.filter((e) =>
                          [e.id, e.name, e.description, e.author, localized(e, "name"), localized(e, "description")].some((v) => typeof v === "string" && v.toLowerCase().includes(q)),
                        )
                      : m.extensions
                    : [];
                  return h(
                    Guard,
                    { key: u, rec: HOST_REC, fallback: h("p", { className: "t3x-error" }, L(`市场 ${u} 显示出错`, `Marketplace ${u} failed to render`)) },
                    h(
                      "section",
                      { className: "t3x-group" },
                      h(
                        "div",
                        { className: "t3x-group-head" },
                        h(
                          "div",
                          { className: "t3x-group-title-wrap" },
                          h("h2", { className: "t3x-group-title" }, m?.name ?? u),
                          m?.extensions ? h("span", { className: "t3x-meta" }, L(`${filteredEntries.length} 个扩展`, `${filteredEntries.length} ${filteredEntries.length === 1 ? "plugin" : "plugins"}`)) : null,
                        ),
                        h(
                          "div",
                          { className: "t3x-group-actions" },
                          h(
                            ui.Button,
                            {
                              size: "xs",
                              variant: "ghost",
                              className: "t3x-btn-danger",
                              "aria-label": L(`移除市场 ${m?.name ?? u}`, `Remove marketplace ${m?.name ?? u}`),
                              onClick: () => removeMarket(u),
                            },
                            L("移除市场", "Remove"),
                          ),
                        ),
                      ),
                      isLoading ? h("p", { className: "t3x-hint" }, L("正在读取市场…", "Loading marketplace…")) : null,
                      m?.error
                        ? h(
                            "div",
                            { className: "t3x-state t3x-state-error", role: "alert" },
                            h("div", { className: "t3x-state-body" }, t3xIcon("alert", 15, "t3x-state-icon t3x-state-icon-error"), h("p", { className: "t3x-error" }, m.error)),
                            h("div", { className: "t3x-state-actions" }, h(ui.Button, { size: "xs", variant: "outline", onClick: () => loadRegistry(u) }, L("重试", "Retry"))),
                          )
                        : null,
                      m?.extensions && m.extensions.length === 0
                        ? h("div", { className: "t3x-state t3x-state-empty" }, h("p", { className: "t3x-hint" }, L("这个市场目前没有扩展。", "This marketplace has no extensions yet.")))
                        : null,
                      m?.extensions && m.extensions.length > 0 && filteredEntries.length === 0
                        ? h("div", { className: "t3x-state t3x-state-empty" }, h("p", { className: "t3x-hint" }, L("当前市场中没有匹配的扩展。", "No matching extensions in this marketplace.")))
                        : null,
                      filteredEntries.length > 0
                        ? h(
                            "div",
                            { className: "t3x-grid" },
                            filteredEntries.map((e) =>
                              h(
                                Guard,
                                { key: e.id, rec: HOST_REC, fallback: h("p", { className: "t3x-error" }, L(`${e.id}：这个条目显示不了`, `Couldn’t display the entry for ${e.id}`)) },
                                h(MarketCard, { ui, entry: e, busy, installing: busyKey === `reg:${e.manifestUrl}`, onInstall: installEntry }),
                              ),
                            ),
                          )
                        : null,
                    ),
                  );
                }),
              ),
    ),
  );
}
