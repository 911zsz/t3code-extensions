// 设置 → 扩展：“浏览”标签页，第三方市场的卡片和手动安装、社区扩展、已添加市场的面板。

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
          h(ui.Badge, { variant: "success", title: L("安装时按注册表逐个文件校验 SHA-256", "Each file is verified against the registry’s SHA-256 checksum during installation") }, L("已校验", "Verified")),
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
          ? h(ui.Badge, { variant: "success" }, t3xIcon("check", 12), L("已安装", "Installed"))
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

/** “浏览”标签页：手动安装（链接 / ZIP）、社区扩展、已添加的第三方市场。 */
function BrowsePanel({ ui, searchQuery, q, browseSubmit, browseRefreshSeq, busy, busyKey, urlInput, setUrlInput, addUrl, onUploadZip, installGithub, onClearSearch, registryUrls, markets, loadRegistry, removeMarket, installEntry }) {
  return h(
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
            ui.InputGroup,
            { className: "t3x-url-field" },
            h(ui.InputGroupAddon, null, t3xIcon("link", 13)),
            h(ui.InputGroupInput, {
              id: "t3x-manual-url",
              type: "url",
              size: "sm",
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
              onClick: () => onUploadZip(),
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
        onClearSearch,
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
          m?.error ? h(ErrorAlert, { ui, message: m.error, onRetry: () => loadRegistry(u) }) : null,
          m?.extensions && m.extensions.length === 0 ? h(EmptyState, { ui, description: L("这个市场目前没有扩展。", "This marketplace has no extensions yet.") }) : null,
          m?.extensions && m.extensions.length > 0 && filteredEntries.length === 0
            ? h(EmptyState, { ui, description: L("当前市场中没有匹配的扩展。", "No matching extensions in this marketplace.") })
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
  );
}
