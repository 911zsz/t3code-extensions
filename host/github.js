// 社区扩展市场：用 GitHub 话题发现扩展，安装时固定到某个提交。作者在自己仓库里加话题、打 tag 就能上架，不用提交到别处。

const GH_API = "https://api.github.com";
const githubName = (t) => `${t.owner}/${t.repo}${t.path ? `/${t.path}` : ""}`;

async function githubFetch(path, accept = "application/vnd.github+json") {
  try {
    return new TextDecoder().decode(await fetchBytes(`${GH_API}${path}`, LIMITS.index, { Accept: accept }));
  } catch (error) {
    // 不登录时搜索每分钟约 10 次、其他接口每小时 60 次（按出口 IP 算，共用代理时常被别人用光）。
    const hdr = (k) => error.headers?.get(k);
    const retry = Number(hdr("retry-after")); // 次级限流只给 Retry-After，有就以它为准
    if (error.status === 429 || (error.status === 403 && (hdr("x-ratelimit-remaining") === "0" || retry > 0))) {
      const reset = retry > 0 ? Date.now() + retry * 1000 : Number(hdr("x-ratelimit-reset")) * 1000;
      const minutes = Math.ceil((reset - Date.now()) / 60000);
      throw new Error(minutes > 0
        ? L(`GitHub 的访问次数用完了，约 ${minutes} 分钟后恢复`, `GitHub rate limit reached. Try again in about ${minutes} min.`)
        : L("GitHub 的访问次数用完了，过一会儿再试", "GitHub rate limit reached. Try again later."));
    }
    if (error.status === 403) throw new Error(L("GitHub 拒绝了这次访问（403）", "GitHub denied access (403)"));
    if (error.status === 404) throw Object.assign(new Error(L("GitHub 上找不到这个仓库、分支或标签", "GitHub couldn’t find this repository, branch, or tag")), { status: 404 });
    if (error instanceof TypeError) throw new Error(L("连不上 GitHub，检查网络或代理后再试", "Couldn’t reach GitHub. Check your network or proxy and try again."));
    throw error;
  }
}
const githubJson = async (path) => JSON.parse(await githubFetch(path));

const searchCache = new Map(); // 关键词 -> { at, items: Promise }
const SEARCH_TTL = 5 * 60 * 1000;

/** 搜带 t3code-extension 话题的仓库，按 star 排序（只取前 30 个）；同一关键词 5 分钟内复用结果，进行中的请求也复用。 */
function searchGithub(query) {
  const q = String(query ?? "").trim();
  const now = Date.now();
  for (const [k, v] of searchCache) if (now - v.at >= SEARCH_TTL) searchCache.delete(k);
  const hit = searchCache.get(q);
  if (hit) return hit.items;
  const items = loadSearch(q);
  searchCache.set(q, { at: now, items });
  items.catch(() => searchCache.get(q)?.items === items && searchCache.delete(q));
  return items;
}

async function loadSearch(q) {
  const res = await githubJson(`/search/repositories?q=${encodeURIComponent(`topic:${GITHUB_TOPIC} ${q}`.trim())}&sort=stars&order=desc&per_page=30`);
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  return (Array.isArray(res?.items) ? res.items : [])
    .map((r) => ({
      id: Number.isSafeInteger(r?.id) ? r.id : null,
      owner: str(r?.owner?.login, 40),
      repo: str(r?.name, 100),
      description: str(r?.description, 300),
      stars: Number.isFinite(r?.stargazers_count) ? r.stargazers_count : 0,
      license: str(r?.license?.spdx_id, 40),
      updated: str(r?.pushed_at, 40),
    }))
    .filter((r) => t3xParseGithub(`https://github.com/${r.owner}/${r.repo}`));
}

/**
 * 找要装的提交：地址里指定了分支或标签就用它，否则用最新 Release，没有 Release 用默认分支。
 * 同时取仓库 ID：仓库改名或旧名被别人占用时，检查更新靠它认出不是原来那个仓库。
 */
async function resolveGithub(target) {
  // 只收不带 / 的分支或标签名：提交号、refs/pull/N/head、main~1 这类写法能取到 fork 或 PR 里的代码，弹窗却会显示成上游仓库。
  // shortcut: 名字带 / 的分支或标签不支持，有人需要时改成按 git/refs 接口逐个核实。
  if (target.ref && (!/^[A-Za-z0-9._-]{1,100}$/.test(target.ref) || /^[0-9a-f]{7,40}$/i.test(target.ref))) throw new Error(L("只支持不带 / 的分支名或标签名，不能填提交号", "Enter a branch or tag name without slashes. Commit SHAs are unsupported."));
  const repo = await githubJson(`/repos/${target.owner}/${target.repo}`);
  const [owner, name] = String(repo?.full_name ?? "").split("/");
  if (!Number.isSafeInteger(repo?.id) || !t3xParseGithub(`https://github.com/${owner}/${name}`)) throw new Error(L("GitHub 没有返回有效的仓库信息", "GitHub didn’t return valid repository information"));
  // 社区卡片和检查更新都带着预期的仓库 ID：名字被别的仓库占用时，在下载前就停下。
  if (target.repoId != null && repo.id !== target.repoId) throw new Error(L(`${target.owner}/${target.repo} 已经不是原来那个仓库（可能改了名，旧名被别人用了）`, `${target.owner}/${target.repo} now points to a different repository. The original may have been renamed and its old name reused.`));
  let ref = target.ref;
  if (!ref) {
    try {
      const release = await githubJson(`/repos/${owner}/${name}/releases/latest`);
      ref = typeof release?.tag_name === "string" ? release.tag_name : null;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  // 这个媒体类型只返回 40 位 SHA，不带 diff：大提交的 JSON 可能超过下载上限。
  const sha = (await githubFetch(`/repos/${owner}/${name}/commits/${encodeURIComponent(ref ?? "HEAD")}`, "application/vnd.github.sha")).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(L("GitHub 没有返回有效的提交", "GitHub didn’t return a valid commit"));
  return { sha, ref: ref ?? "默认分支", repoId: repo.id, owner, repo: name };
}

/** 下载 GitHub 仓库里的扩展，文件地址都固定到同一个提交。 */
async function fetchGithubExtension(target, resolved) {
  const { sha, ref, repoId, owner, repo } = resolved ?? (await resolveGithub(target));
  const where = { owner, repo, path: target.path };
  const item = await fetchExtension(t3xRawUrl(where, sha, "plugin.json"), null).catch((error) => {
    if (error.status === 404) throw new Error(L(`${githubName(where)} 里没有 plugin.json，不是 T3 扩展（多扩展仓库要填到子目录）`, `${githubName(where)} has no plugin.json. For repositories with multiple extensions, enter the extension’s subdirectory.`));
    throw error;
  });
  // 记下用户写的 ref（没写就是 null）：以后检查更新按同样的规则找。名字用 GitHub 返回的规范写法。
  return { ...item, source: { kind: "github", ...where, repoId, pin: target.ref, ref, sha, url: `https://github.com/${owner}/${repo}` } };
}

/** 已装的 GitHub 扩展有没有新提交：有就返回下载好的新版本，没有返回 null。 */
async function checkGithubUpdate(source) {
  if (!Number.isSafeInteger(source.repoId)) throw new Error(L("这份安装没有记录仓库身份，请核对来源后移除再重新安装", "This installation has no recorded repository ID. Verify the source, then remove and reinstall the extension."));
  const target = { owner: source.owner, repo: source.repo, path: source.path ?? "", ref: source.pin ?? null, repoId: source.repoId };
  const resolved = await resolveGithub(target);
  return resolved.sha === source.sha ? null : fetchGithubExtension(target, resolved);
}

/** 这个扩展能不能检查更新：只有 GitHub 来源的能。 */
const canCheckUpdate = (rec) => rec.source?.kind === "github";

/** 检查一个扩展的更新：有新版本返回下载好的包，没有返回 null。下载期间扩展被换掉或新包 id 不同都作废。 */
async function checkUpdate(rec) {
  const next = await checkGithubUpdate(rec.source);
  if (records.get(rec.manifest.id) !== rec) throw new Error(L("扩展在检查期间被移除或替换了", "The extension was removed or replaced while checking for updates."));
  if (next && next.manifest.id !== rec.manifest.id) {
    throw new Error(L(`新版本的 id 变成了“${next.manifest.id}”，和已装的“${rec.manifest.id}”不同，没有安装`, `The new version’s ID is “${next.manifest.id}”, which doesn’t match the installed “${rec.manifest.id}”. It wasn’t installed.`));
  }
  return next;
}

// 检查结果：id -> { state: "checking" | "latest" | "available" | "error", item?, error? }。界面用 useHostVersion 订阅。
const updates = new Map();

/** 检查一个扩展并记下结果；按顺序调用，别并发打满 GitHub 的访问次数。 */
async function refreshUpdate(rec) {
  const id = rec.manifest.id;
  updates.set(id, { state: "checking" });
  bump();
  try {
    const item = await checkUpdate(rec);
    updates.set(id, item ? { state: "available", item, rec } : { state: "latest" });
  } catch (error) {
    updates.set(id, { state: "error", error: String(error?.message ?? error) });
  }
  bump();
  return updates.get(id);
}

/** “刷新”：依次检查所有能检查的扩展。 */
async function refreshAllUpdates() {
  for (const rec of [...records.values()]) if (canCheckUpdate(rec)) await refreshUpdate(rec);
}

/** 装上检查到的新版本（调用方先弹 consent 确认）。 */
async function applyUpdate(id) {
  const u = updates.get(id);
  if (u?.state !== "available") return;
  // 检查之后扩展又被安装、替换或移除过：这份结果可能比现在装的还旧，要求重新检查。
  if (records.get(id) !== u.rec) {
    updates.delete(id);
    bump();
    throw new Error(L("扩展在检查之后变过，请重新检查更新", "The extension changed after the check. Check for updates again."));
  }
  await install(u.item);
  updates.delete(id);
  bump();
}
