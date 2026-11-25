// 扩展市场里的“社区扩展”：GitHub 上带 t3code-extension 话题的仓库，未经审核，安装时固定到提交。

const T3X_ICON_PATHS = {
  plugin: [
    ["rect", { x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.5 }],
    ["rect", { x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.5 }],
    ["rect", { x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.5 }],
    ["path", { d: "M17 3.5v7M13.5 7h7" }],
  ],
  github: [
    [
      "path",
      {
        fill: "currentColor",
        stroke: "none",
        d: "M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z",
      },
    ],
  ],
  search: [
    ["circle", { cx: 11, cy: 11, r: 7 }],
    ["path", { d: "m20 20-3.5-3.5" }],
  ],
  star: [["path", { d: "M12 2.8l2.8 5.6 6.2.9-4.5 4.4 1.1 6.2L12 17l-5.6 2.9 1.1-6.2-4.5-4.4 6.2-.9z" }]],
  check: [["path", { d: "M20 6 9 17l-5-5" }]],
  alert: [
    ["circle", { cx: 12, cy: 12, r: 9 }],
    ["path", { d: "M12 8v4.5M12 16h.01" }],
  ],
  refresh: [
    ["path", { d: "M20 11a8 8 0 0 0-14.9-4M4 4v5h5" }],
    ["path", { d: "M4 13a8 8 0 0 0 14.9 4M20 20v-5h-5" }],
  ],
  x: [["path", { d: "M18 6 6 18M6 6l12 12" }]],
  folder: [["path", { d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }]],
  zip: [
    ["path", { d: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" }],
    ["path", { d: "M14 3v5h5M10 12h2M10 15h2M10 9h1" }],
  ],
  chevron: [["path", { d: "m6 9 6 6 6-6" }]],
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  settings: [
    ["circle", { cx: 12, cy: 12, r: 3 }],
    [
      "path",
      {
        d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z",
      },
    ],
  ],
  external: [
    ["path", { d: "M14 5h5v5" }],
    ["path", { d: "M10 14 19 5" }],
    ["path", { d: "M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" }],
  ],
  upload: [
    ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
    ["path", { d: "m17 8-5-5-5 5" }],
    ["path", { d: "M12 3v12" }],
  ],
  link: [
    ["path", { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" }],
    ["path", { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" }],
  ],
};

function t3xIcon(name, size = 14, className = "") {
  const shapes = T3X_ICON_PATHS[name] ?? [];
  return h(
    "svg",
    {
      className: className ? `t3x-icon ${className}` : "t3x-icon",
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true,
    },
    shapes.map(([tag, props], i) => h(tag, { key: i, ...props })),
  );
}

function formatStars(n) {
  const num = Number(n) || 0;
  if (num < 1000) return String(num);
  return `${(num / 1000).toFixed(num >= 10000 ? 0 : 1)}k`;
}

// 卡片装的是仓库根目录：只认同一仓库（按 ID）根目录装的那份，子目录扩展不算。
const githubInstalled = (item) =>
  [...records.values()].find(
    (r) =>
      // 内置扩展的仓库也带 t3code-extension 话题：按清单里的仓库 ID 认出来，算已安装
      (item.id != null && r.manifest.repositoryId === item.id) ||
      (r.source?.kind === "github" &&
      !r.source.path &&
      (item.id != null ? r.source.repoId === item.id : r.source.owner.toLowerCase() === item.owner.toLowerCase() && r.source.repo.toLowerCase() === item.repo.toLowerCase())),
  );

function CommunityCard({ ui, item, busy, installing, onInstall }) {
  const installed = githubInstalled(item);
  const license = item.license && item.license !== "NOASSERTION" ? item.license : "";
  const updated = item.updated ? item.updated.slice(0, 10) : "";
  const repoUrl = `https://github.com/${item.owner}/${item.repo}`;
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
          h("h3", { className: "t3x-card-name", title: item.repo }, item.repo),
          // 内置扩展自己的仓库（按仓库 ID 认）不算未审核的社区扩展
          installed && (installed.builtin || installed.overridesBuiltin)
            ? h("span", { className: "t3x-badge t3x-badge-ok", title: L("T3 Code Extensions 自带的扩展", "Ships with T3 Code Extensions") }, L("内置", "Built-in"))
            : h(
                "span",
                {
                  className: "t3x-badge t3x-badge-warn",
                  title: L("社区扩展未经审核，安装时会固定到当前提交", "Community extensions are unreviewed and pinned to the current commit when installed"),
                },
                L("未审核", "Unreviewed"),
              ),
        ),
        h(
          "div",
          { className: "t3x-card-sub", title: updated ? L(`最近更新：${updated}`, `Last updated: ${updated}`) : undefined },
          h("span", { className: "t3x-card-sub-text" }, item.owner),
          h("span", { className: "t3x-dot", "aria-hidden": true }, "·"),
          h("span", { className: "t3x-stat t3x-stat-star", "aria-label": L(`${item.stars} 个星标`, `Stars: ${item.stars}`) }, t3xIcon("star", 11), h("span", null, formatStars(item.stars))),
          license ? h("span", { className: "t3x-dot", "aria-hidden": true }, "·") : null,
          license ? h("span", { className: "t3x-stat" }, license) : null,
        ),
      ),
    ),
    h(
      "p",
      {
        className: item.description ? "t3x-card-desc" : "t3x-card-desc t3x-card-desc-empty",
        title: item.description || undefined,
      },
      item.description || L("暂无简介", "No description"),
    ),
    h(
      "div",
      { className: "t3x-card-foot" },
      h(
        "div",
        { className: "t3x-card-foot-left" },
        h(
          "a",
          {
            className: "t3x-details-link",
            href: repoUrl,
            target: "_blank",
            rel: "noreferrer",
            title: L(`在 GitHub 打开 ${item.owner}/${item.repo}`, `Open ${item.owner}/${item.repo} on GitHub`),
          },
          t3xIcon("github", 13),
          h("span", null, L("详情", "Details")),
        ),
      ),
      h(
        "div",
        { className: "t3x-card-foot-right" },
        installed
          ? h("span", { className: "t3x-status-pill t3x-status-installed", "aria-label": L(`${item.repo} 已安装`, `${item.repo} is installed`) }, t3xIcon("check", 12), L("已安装", "Installed"))
          : h(
              ui.Button,
              {
                size: "xs",
                variant: "outline",
                disabled: busy,
                "aria-label": L(`安装 ${item.owner}/${item.repo}`, `Install ${item.owner}/${item.repo}`),
                onClick: onInstall,
              },
              installing ? L("安装中…", "Installing…") : L("安装", "Install"),
            ),
      ),
    ),
  );
}

function MarketSkeleton({ count = 4 }) {
  return h(
    "div",
    { className: "t3x-grid", "aria-hidden": true },
    Array.from({ length: count }, (_, i) =>
      h(
        "div",
        { key: i, className: "t3x-card t3x-card-skeleton" },
        h(
          "div",
          { className: "t3x-card-head" },
          h("div", { className: "t3x-skel-icon" }),
          h("div", { className: "t3x-card-id" }, h("div", { className: "t3x-skel-line t3x-skel-title" }), h("div", { className: "t3x-skel-line t3x-skel-sub" })),
        ),
        h("div", { className: "t3x-skel-line t3x-skel-desc" }),
        h("div", { className: "t3x-skel-foot" }, h("div", { className: "t3x-skel-line t3x-skel-meta" }), h("div", { className: "t3x-skel-btn" })),
      ),
    ),
  );
}

/** 社区扩展列表：挂载时拉取话题下的仓库，复用 5 分钟缓存；支持外部刷新和顶部搜索框过滤/按回车远端搜索。 */
function CommunityMarket({ ui, filterQuery = "", submitSeq = 0, submittedQuery = "", refreshSeq = 0, busy, busyKey, onInstall, onClearSearch }) {
  const [activeQuery, setActiveQuery] = React.useState("");
  const [state, setState] = React.useState({ loading: true, items: [], error: null });
  const reqIdRef = React.useRef(0);
  const lastRefreshRef = React.useRef(refreshSeq);
  const lastSubmitRef = React.useRef(submitSeq);

  const search = (raw, { force = false } = {}) => {
    const q = String(raw ?? "").trim();
    const id = ++reqIdRef.current;
    if (force && typeof searchCache !== "undefined") searchCache.delete(q);
    setActiveQuery(q);
    setState((s) => ({ ...s, loading: true, error: null }));
    searchGithub(q).then(
      (items) => {
        if (reqIdRef.current !== id) return;
        setState({ loading: false, items, error: null });
      },
      (error) => {
        if (reqIdRef.current !== id) return;
        setState({ loading: false, items: [], error: String(error?.message ?? error) });
      },
    );
  };

  React.useEffect(() => {
    search("");
  }, []);

  React.useEffect(() => {
    if (refreshSeq === lastRefreshRef.current) return;
    lastRefreshRef.current = refreshSeq;
    search(activeQuery, { force: true });
  }, [refreshSeq]);

  React.useEffect(() => {
    if (submitSeq === lastSubmitRef.current) return;
    lastSubmitRef.current = submitSeq;
    search(submittedQuery);
  }, [submitSeq]);

  // 清空顶部搜索框时，如果之前按关键词远端搜过 GitHub，自动恢复全部列表。
  React.useEffect(() => {
    if (!String(filterQuery).trim() && activeQuery) search("");
  }, [filterQuery]);

  const q = String(filterQuery ?? "").trim().toLowerCase();
  const visibleItems = q
    ? state.items.filter((item) =>
        [item.repo, item.owner, item.description, item.license].some((v) => typeof v === "string" && v.toLowerCase().includes(q)),
      )
    : state.items;
  const canRemoteSearch = Boolean(q) && q !== activeQuery.toLowerCase();

  return h(
    "section",
    { className: "t3x-group", "aria-label": L("社区扩展", "Community extensions") },
    h(
      "div",
      { className: "t3x-group-head" },
      h(
        "div",
        { className: "t3x-group-title-wrap" },
        h("h2", { className: "t3x-group-title" }, L("社区扩展", "Community")),
        h("span", { className: "t3x-topic-pill", title: L(`GitHub 话题：${GITHUB_TOPIC}`, `GitHub topic: ${GITHUB_TOPIC}`) }, `#${GITHUB_TOPIC}`),
        !state.loading && !state.error && visibleItems.length > 0
          ? h("span", { className: "t3x-meta" }, L(`${visibleItems.length} 个`, `${visibleItems.length}`))
          : null,
      ),
      h(
        "div",
        { className: "t3x-group-actions" },
        canRemoteSearch
          ? h(
              ui.Button,
              {
                size: "xs",
                variant: "outline",
                disabled: state.loading,
                onClick: () => search(filterQuery),
              },
              t3xIcon("search", 12),
              L("在 GitHub 搜索", "Search GitHub"),
            )
          : null,
        activeQuery
          ? h(
              ui.Button,
              {
                size: "xs",
                variant: "ghost",
                onClick: () => {
                  onClearSearch?.();
                  search("");
                },
              },
              L("查看全部", "Show all"),
            )
          : null,
      ),
    ),
    state.loading
      ? h(
          "div",
          { className: "t3x-loading-wrap", "aria-busy": true, "aria-live": "polite" },
          h("p", { className: "t3x-hint" }, L("正在加载社区扩展…", "Loading community extensions…")),
          h(MarketSkeleton, { count: 4 }),
        )
      : null,
    !state.loading && state.error
      ? h(
          "div",
          { className: "t3x-state t3x-state-error", role: "alert" },
          h(
            "div",
            { className: "t3x-state-body" },
            t3xIcon("alert", 15, "t3x-state-icon t3x-state-icon-error"),
            h("p", { className: "t3x-error" }, state.error),
          ),
          h(
            "div",
            { className: "t3x-state-actions" },
            h(ui.Button, { size: "xs", variant: "outline", onClick: () => search(activeQuery, { force: true }) }, L("重试", "Retry")),
          ),
        )
      : null,
    !state.loading && !state.error && visibleItems.length === 0
      ? h(
          "div",
          { className: "t3x-state t3x-state-empty" },
          h(
            "p",
            { className: "t3x-state-title" },
            q || activeQuery ? L(`没有找到与“${filterQuery.trim() || activeQuery}”相关的扩展`, `No extensions found for “${filterQuery.trim() || activeQuery}”`) : L("暂无社区扩展", "No community extensions"),
          ),
          h(
            "p",
            { className: "t3x-hint" },
            canRemoteSearch
              ? L("当前列表里没有匹配项，可以按回车或在 GitHub 上远程搜索。", "No matches in the loaded list. Press Enter or search GitHub remotely.")
              : q || activeQuery
                ? L("试试换个关键词，或清空搜索查看全部。", "Try a different keyword, or clear the search to see all extensions.")
                : L(`给 GitHub 仓库添加 ${GITHUB_TOPIC} 话题即可出现在这里。`, `Add the ${GITHUB_TOPIC} topic to a GitHub repository to list it here.`),
          ),
          q || activeQuery
            ? h(
                "div",
                { className: "t3x-state-actions" },
                canRemoteSearch ? h(ui.Button, { size: "xs", variant: "outline", onClick: () => search(filterQuery) }, L("在 GitHub 搜索", "Search GitHub")) : null,
                h(
                  ui.Button,
                  {
                    size: "xs",
                    variant: "ghost",
                    onClick: () => {
                      onClearSearch?.();
                      if (activeQuery) search("");
                    },
                  },
                  L("清空搜索", "Clear search"),
                ),
              )
            : null,
        )
      : null,
    !state.loading && !state.error && visibleItems.length > 0
      ? h(
          "div",
          { className: "t3x-grid" },
          visibleItems.map((item) => {
            const key = `gh:${item.owner}/${item.repo}`;
            return h(
              Guard,
              { key: `${item.owner}/${item.repo}`, rec: HOST_REC, fallback: h("p", { className: "t3x-error" }, L(`${item.repo}：这个条目显示不了`, `Couldn’t display the entry for ${item.repo}`)) },
              h(CommunityCard, {
                ui,
                item,
                busy,
                installing: busyKey === key,
                onInstall: () => onInstall({ owner: item.owner, repo: item.repo, ref: null, path: "", repoId: item.id }, key),
              }),
            );
          }),
        )
      : null,
  );
}
