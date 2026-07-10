const FAVORITES_KEY = "qiaomu-hn-favorites-v1";
const RECENT_CACHE_KEY = "qiaomu-hn-recent-cache-v1";
const READ_STORIES_KEY = "qiaomu-hn-read-stories-v2";
const LEGACY_READING_PROGRESS_KEY = "qiaomu-hn-reading-progress-v1";
const RECENT_CACHE_LIMIT = 8;
const READ_STORIES_LIMIT = 1000;

const supportDialogs = {
  follow: {
    kicker: "微信公众号",
    title: "关注向阳乔木",
    image: "/assets/qiaomu_wechat_public_account_qr.jpg",
    imageAlt: "向阳乔木推荐看微信公众号二维码",
    description: "微信扫码关注「向阳乔木推荐看」。"
  },
  reward: {
    kicker: "支持创作",
    title: "打赏支持",
    image: "/assets/qiaomu_reward_qr.png",
    imageAlt: "向阳乔木打赏二维码",
    description: "感谢你支持这个项目继续更新。"
  }
};

const views = [
  { id: "home", label: "首页精选" },
  { id: "rising", label: "升温榜" },
  { id: "productRadar", label: "产品雷达" },
  { id: "favorites", label: "收藏" }
];

const state = {
  activeView: "home",
  topics: [{ id: "frontpage", label: "首页精选", shortLabel: "首页" }],
  activeTopic: "frontpage",
  pointsSort: "desc",
  translate: true,
  storiesAbort: null,
  insightsAbort: null,
  refreshing: false,
  installPromptEvent: null,
  expandedComments: new Map(),
  commentsAbort: new Map(),
  insights: null,
  insightDiscussions: {},
  discussions: {},
  favorites: new Map(),
  readStories: new Map(),
  storyCache: new Map(),
  translationCache: {},
  initialData: null,
  serviceWorkerUpdateShown: false,
  supportDialogTrigger: null
};

const validViews = new Set(views.map((view) => view.id));

const el = {
  viewTabs: document.querySelector("[data-view-tabs]"),
  storyList: document.querySelector("[data-story-list]"),
  feedTitle: document.querySelector("[data-feed-title]"),
  feedCount: document.querySelector("[data-feed-count]"),
  feedStatus: document.querySelector("[data-feed-status]"),
  searchInput: document.querySelector("[data-search-input]"),
  toolbar: document.querySelector(".toolbar"),
  toast: document.querySelector("[data-toast]"),
  refreshBtn: document.querySelector('[data-action="refresh"]'),
  installAppBtn: document.querySelector('[data-action="install-app"]'),
  sortPointsBtn: document.querySelector('[data-action="sort-points"]'),
  exportFavoritesBtn: document.querySelector('[data-action="export-favorites"]'),
  supportDialog: document.querySelector("[data-support-dialog]"),
  supportKicker: document.querySelector("[data-support-kicker]"),
  supportTitle: document.querySelector("[data-support-title]"),
  supportImage: document.querySelector("[data-support-image]"),
  supportDescription: document.querySelector("[data-support-description]")
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function safeDomId(value = "") {
  const normalized = String(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "item";
}

function linkifyText(value = "") {
  const text = String(value);
  const urlPattern = /https?:\/\/[^\s<>"']+/g;
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(urlPattern)) {
    const rawUrl = match[0];
    const start = match.index || 0;
    html += escapeHtml(text.slice(cursor, start));
    const cleanUrl = rawUrl.replace(/[)\].,，。；;!?！？]+$/g, "");
    const trailing = rawUrl.slice(cleanUrl.length);
    try {
      const url = new URL(cleanUrl);
      html += `<a href="${escapeHtml(url.toString())}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanUrl)}</a>${escapeHtml(trailing)}`;
    } catch {
      html += escapeHtml(rawUrl);
    }
    cursor = start + rawUrl.length;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function formatSnapshotTime(value) {
  if (!value) return "快照生成中";
  return `更新 ${formatTime(value)}`;
}

function showToast(text, options = {}) {
  const { actionLabel = "", actionIcon = "", duration = 1800, onAction } = options;
  const message = document.createElement("span");
  message.className = "toast-message";
  message.textContent = text;
  el.toast.replaceChildren(message);

  if (actionLabel && typeof onAction === "function") {
    const action = document.createElement("button");
    action.className = "toast-action";
    action.type = "button";
    if (actionIcon) {
      const icon = document.createElement("span");
      icon.dataset.lucide = actionIcon;
      icon.setAttribute("aria-hidden", "true");
      action.appendChild(icon);
    }
    action.appendChild(document.createTextNode(actionLabel));
    action.addEventListener("click", () => {
      el.toast.classList.remove("show");
      onAction();
    }, { once: true });
    el.toast.appendChild(action);
    renderIcons(action);
  }

  el.toast.classList.add("show");
  clearTimeout(showToast._t);
  if (duration > 0) showToast._t = setTimeout(() => el.toast.classList.remove("show"), duration);
}

function setFeedBusy(busy, announcement = "") {
  el.storyList?.setAttribute("aria-busy", String(Boolean(busy)));
  if (announcement && el.feedStatus) el.feedStatus.textContent = announcement;
}

function renderIcons(root = document) {
  window.qmLucide?.render(root);
}

function openSupportDialog(kind, trigger) {
  const content = supportDialogs[kind];
  if (!content || !el.supportDialog) return;
  state.supportDialogTrigger = trigger || null;
  el.supportKicker.textContent = content.kicker;
  el.supportTitle.textContent = content.title;
  el.supportImage.src = content.image;
  el.supportImage.alt = content.imageAlt;
  el.supportDescription.textContent = content.description;
  if (typeof el.supportDialog.showModal === "function") {
    el.supportDialog.showModal();
  } else {
    el.supportDialog.setAttribute("open", "");
  }
}

function closeSupportDialog() {
  if (!el.supportDialog) return;
  if (typeof el.supportDialog.close === "function" && el.supportDialog.open) {
    el.supportDialog.close();
  } else {
    el.supportDialog.removeAttribute("open");
  }
}

function isPwaStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function setInstallButtonVisible(visible) {
  if (!el.installAppBtn) return;
  el.installAppBtn.hidden = !visible;
}

function updateInstallButton() {
  setInstallButtonVisible(Boolean(state.installPromptEvent) && !isPwaStandalone());
}

function readInitialUrlState() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const query = params.get("q");
  const sort = params.get("sort");
  state.activeView = "home";
  state.pointsSort = "desc";
  el.searchInput.value = "";
  if (validViews.has(view)) state.activeView = view;
  if (query) {
    state.activeView = "home";
    el.searchInput.value = query;
  }
  if (sort === "asc" || sort === "desc") state.pointsSort = sort;
}

function syncUrlState({ replace = false } = {}) {
  const params = new URLSearchParams();
  const query = el.searchInput.value.trim();
  if (state.activeView !== "home") params.set("view", state.activeView);
  if (query) params.set("q", query);
  if (state.pointsSort !== "desc") params.set("sort", state.pointsSort);
  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", nextUrl);
}

function readJsonStorage(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function recentCacheEntries() {
  const cache = readJsonStorage(RECENT_CACHE_KEY, { entries: [] });
  return Array.isArray(cache.entries) ? cache.entries : [];
}

function getRecentCache(key) {
  return recentCacheEntries().find((entry) => entry.key === key)?.data || null;
}

function saveRecentCache(key, data) {
  if (!key || !data) return;
  const entries = recentCacheEntries().filter((entry) => entry.key !== key);
  entries.unshift({ key, data, savedAt: new Date().toISOString() });
  writeJsonStorage(RECENT_CACHE_KEY, { version: 1, entries: entries.slice(0, RECENT_CACHE_LIMIT) });
}

function readInitialData() {
  const node = document.getElementById("__HN_INITIAL_DATA__");
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent);
  } catch {
    return null;
  }
}

function loadFavorites() {
  try {
    const rows = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    state.favorites = new Map(rows.map((row) => [row.story.id, row]));
  } catch {
    state.favorites = new Map();
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(state.favorites.values())));
}

function saveReadStories() {
  const rows = Array.from(state.readStories.entries())
    .sort((a, b) => Date.parse(b[1] || "0") - Date.parse(a[1] || "0"))
    .slice(0, READ_STORIES_LIMIT);
  state.readStories = new Map(rows);
  writeJsonStorage(READ_STORIES_KEY, Object.fromEntries(rows));
}

function loadReadStories() {
  const stored = readJsonStorage(READ_STORIES_KEY, {});
  const readStories = new Map(Object.entries(stored).filter(([storyId, readAt]) => (
    storyId && typeof readAt === "string"
  )));
  const legacy = readJsonStorage(LEGACY_READING_PROGRESS_KEY, {});
  let changed = false;

  Object.values(legacy).forEach((record) => {
    if (!record?.storyId || readStories.has(record.storyId)) return;
    readStories.set(record.storyId, record.updatedAt || new Date().toISOString());
    changed = true;
  });

  state.readStories = readStories;
  if (Object.keys(legacy).length) {
    localStorage.removeItem(LEGACY_READING_PROGRESS_KEY);
    changed = true;
  }
  if (changed || state.readStories.size > READ_STORIES_LIMIT) saveReadStories();
}

function markStoryRead(storyId) {
  if (!storyId || state.readStories.has(storyId)) return;
  state.readStories.set(storyId, new Date().toISOString());
  saveReadStories();
  applyReadState();
}

function isFavorite(storyId) {
  return state.favorites.has(storyId);
}

function setFavorite(storyId, shouldSave) {
  const story = state.storyCache.get(storyId);
  if (!story) return;
  if (shouldSave) {
    state.favorites.set(storyId, {
      story,
      translation: state.translationCache[storyId] || null,
      discussion: state.discussions[storyId] || state.insightDiscussions[storyId] || null,
      savedAt: new Date().toISOString()
    });
  } else {
    state.favorites.delete(storyId);
  }
  saveFavorites();
}

function renderViewTabs() {
  if (!el.viewTabs.children.length) {
    el.viewTabs.innerHTML = views.map((view) => `
      <button class="section-tab" id="view-tab-${escapeHtml(view.id)}" type="button" role="tab" aria-controls="feed" data-view="${escapeHtml(view.id)}">${escapeHtml(view.label)}</button>
    `).join("");
  }
  el.viewTabs.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.activeView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  el.storyList.setAttribute("aria-labelledby", `view-tab-${state.activeView}`);
}

function setSkeleton(count = 5) {
  setFeedBusy(true);
  el.storyList.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton" aria-hidden="true">
      <div class="skeleton-rank"></div>
      <div class="skeleton-body">
        <div class="skeleton-line w-zh"></div>
        <div class="skeleton-line w-en"></div>
        <div class="skeleton-line w-meta"></div>
      </div>
    </div>
  `).join("");
}

function getActiveTopic() {
  return state.topics.find((t) => t.id === state.activeTopic) || state.topics[0];
}

function setSortButton() {
  if (!el.sortPointsBtn) return;
  const desc = state.pointsSort === "desc";
  el.sortPointsBtn.dataset.sortPoints = state.pointsSort;
  el.sortPointsBtn.setAttribute("aria-label", desc ? "当前按热度从高到低,点击改为低到高" : "当前按热度从低到高,点击改为高到低");
  const icon = el.sortPointsBtn.querySelector("[data-lucide]");
  if (icon) icon.setAttribute("data-lucide", desc ? "arrow-down-wide-narrow" : "arrow-up-narrow-wide");
  renderIcons(el.sortPointsBtn);
}

function storyUrl() {
  const params = new URLSearchParams();
  const search = el.searchInput.value.trim();
  if (search) {
    params.set("feed", "newest");
    params.set("query", search);
  } else {
    params.set("topic", state.activeTopic);
  }
  params.set("limit", "30");
  params.set("pointsSort", state.pointsSort);
  return `/api/stories?${params.toString()}`;
}

function updateFeedActions() {
  if (el.exportFavoritesBtn) {
    el.exportFavoritesBtn.hidden = !(state.activeView === "favorites" && state.favorites.size > 0);
  }
}

function applyReadState() {
  el.storyList.querySelectorAll(".story").forEach((node) => {
    const isRead = state.readStories.has(node.dataset.storyId);
    node.classList.toggle("is-read", isRead);
    const status = node.querySelector("[data-read-status]");
    if (status) status.textContent = isRead ? "已读：" : "";
  });
  updateFeedActions();
}

function articleReadyFromMeta(meta = {}) {
  return Boolean(meta.articleReady);
}

function storyCommentId(story) {
  return story.hnId || extractHnId(story.commentsUrl) || story.id;
}

function renderStories(stories, translations = {}, freshness = {}, discussions = {}, options = {}) {
  state.discussions = discussions || {};
  state.translationCache = { ...translations };
  state.storyCache.clear();
  const animate = options.animate !== false;

  if (!stories.length) {
    el.storyList.innerHTML = `
      <div class="state">
        <h3>${freshness.ready === false ? "正在准备中文快照" : "没有匹配的条目"}</h3>
        <p>${freshness.ready === false ? "后台正在同步 Hacker News,稍后刷新即可阅读。" : "换一个关键词试试。"}</p>
      </div>
    `;
    el.feedCount.textContent = freshness.ready === false ? "同步中" : "";
    setFeedBusy(false, freshness.ready === false ? "中文快照正在准备" : "没有匹配的条目");
    updateFeedActions();
    return;
  }

  el.feedCount.textContent = `${stories.length} 篇 · ${formatSnapshotTime(freshness.generatedAt)}`;

  el.storyList.innerHTML = stories.map((story, i) => {
    state.storyCache.set(story.id, story);
    const t = translations[story.id];
    const translationOk = t && (t.status === "translated" || t.status === "cached");
    const hasZh = state.translate && translationOk && t?.titleZh;
    const titleZh = hasZh ? t.titleZh : "";
    const summary = hasZh && t?.summaryZh ? t.summaryZh : story.reason || "";
    const noZh = !hasZh ? " no-translation" : "";
    const delay = animate && i < 12 ? Math.min(i * 45, 360) : 0;
    const rank = String(i + 1).padStart(2, "0");
    const commentId = storyCommentId(story);
    const commentsCount = story.comments ?? 0;
    const discussion = discussions[story.id] || {};
    const canReadSummary = commentsCount > 0 && articleReadyFromMeta(discussion);
    const canReadBest = commentsCount > 0 && (discussion.bestCount || 0) > 0;
    const favorite = isFavorite(story.id);

    return `
      <article class="story${noZh}${animate ? "" : " story-instant"}" data-story-id="${escapeHtml(story.id)}" data-story-url="${escapeHtml(story.url)}" data-comment-id="${escapeHtml(commentId)}" style="animation-delay:${delay}ms">
        <div class="story-rank">${rank}</div>
        <div class="story-main">
          <div class="story-topline">
            <div class="story-title-block">
              <span class="sr-only" data-read-status></span>
              ${hasZh ? `
                <div class="title-zh"><a href="${escapeHtml(story.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(titleZh)}</a></div>
                <div class="title-en">${escapeHtml(story.title)}</div>
              ` : `
                <div class="title-en"><a href="${escapeHtml(story.url)}" target="_blank" rel="noopener noreferrer" style="color:inherit">${escapeHtml(story.title)}</a></div>
              `}
            </div>
            <button class="favorite-btn${favorite ? " is-active" : ""}" type="button" data-toggle-favorite data-story-id="${escapeHtml(story.id)}" aria-pressed="${favorite}" aria-label="${favorite ? "取消收藏" : "收藏"}">
              <span data-lucide="star" aria-hidden="true"></span>
            </button>
          </div>
          ${summary ? `<p class="summary">${escapeHtml(summary)}</p>` : ""}
          <div class="story-meta">
            <div class="meta meta-facts">
              <span class="points" aria-label="${story.points ?? 0} 热度">${story.points ?? 0}</span>
              ${commentsCount > 0 ? `
                <button class="meta-text meta-interactive comment-count-btn" type="button" data-toggle-comments data-preferred-tab="comments" data-comment-id="${escapeHtml(commentId)}" data-comments-count="${commentsCount}">${commentsCount} 评论</button>
              ` : `<span class="meta-text">0 评论</span>`}
              <span class="meta-dot">·</span>
              <a class="meta-text meta-interactive domain domain-link" href="${escapeHtml(story.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(story.domain)}</a>
              <span class="meta-dot">·</span>
              ${commentsCount > 0 ? `
                ${canReadSummary ? `
                  <button class="meta-text meta-interactive discuss-btn" type="button" data-toggle-comments data-preferred-tab="summary" data-comment-id="${escapeHtml(commentId)}">讨论速读</button>
                ` : `<span class="meta-text discuss-status">生成速读中</span>`}
                <span class="meta-dot">·</span>
                ${canReadBest ? `
                  <button class="meta-text meta-interactive discuss-btn" type="button" data-toggle-comments data-preferred-tab="best" data-comment-id="${escapeHtml(commentId)}">最佳评论</button>
                ` : `<span class="meta-text discuss-status">暂无最佳评论</span>`}
              ` : `<span class="meta-text discuss-status">暂无讨论</span>`}
              <span class="meta-dot">·</span>
              <span class="meta-text">${escapeHtml(formatTime(story.publishedAt))}</span>
            </div>
          </div>
          <div class="comments-container" data-comments-for="${escapeHtml(commentId)}" hidden></div>
        </div>
      </article>
    `;
  }).join("");
  applyReadState();
  setFeedBusy(false, `${el.feedTitle.textContent || "当前栏目"}，共 ${stories.length} 篇`);
  renderIcons(el.storyList);
}

function extractHnId(url) {
  if (!url) return null;
  const match = String(url).match(/item\?id=(\d+)/);
  return match ? match[1] : null;
}

async function loadStories({ silent = false } = {}) {
  if (state.storiesAbort) state.storiesAbort.abort();
  state.storiesAbort = new AbortController();
  const topic = getActiveTopic();
  const search = el.searchInput.value.trim();
  const cacheKey = storyUrl();

  el.toolbar.hidden = false;
  el.feedTitle.textContent = search ? "搜索结果" : (topic?.label || "首页精选");
  if (!silent) setSkeleton(8);

  try {
    const response = await fetch(cacheKey, { signal: state.storiesAbort.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderStories(data.stories || [], data.translations || {}, data.freshness || {}, data.discussions || {}, { animate: !silent });
    saveRecentCache(cacheKey, {
      stories: data.stories || [],
      translations: data.translations || {},
      freshness: data.freshness || {},
      discussions: data.discussions || {}
    });
  } catch (error) {
    if (error.name === "AbortError") return;
    const cached = getRecentCache(cacheKey);
    if (cached?.stories?.length) {
      renderStories(cached.stories || [], cached.translations || {}, cached.freshness || {}, cached.discussions || {}, { animate: false });
      showToast("已显示最近缓存");
      return;
    }
    el.storyList.innerHTML = `
      <div class="state">
        <h3>这次没读到 Hacker News</h3>
        <p>稍后刷新,或换个主题试试。</p>
      </div>
    `;
    el.feedCount.textContent = "";
    setFeedBusy(false, "新闻列表加载失败");
    updateFeedActions();
  }
}

async function loadInsights() {
  if (state.insightsAbort) state.insightsAbort.abort();
  state.insightsAbort = new AbortController();
  const cacheKey = "/api/insights";
  try {
    const response = await fetch(cacheKey, { signal: state.insightsAbort.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.insights = data.insights || null;
    state.insightDiscussions = data.discussions || {};
    saveRecentCache(cacheKey, {
      ok: true,
      insights: state.insights,
      discussions: state.insightDiscussions,
      freshness: data.freshness || {}
    });
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw error;
    const cached = getRecentCache(cacheKey);
    if (cached?.insights) {
      state.insights = cached.insights;
      state.insightDiscussions = cached.discussions || {};
      return cached;
    }
    throw error;
  }
}

function storyFromInsight(item) {
  return {
    id: item.id,
    hnId: item.hnId,
    title: item.title,
    url: item.url,
    commentsUrl: item.hnId ? `https://news.ycombinator.com/item?id=${item.hnId}` : item.url,
    domain: item.domain,
    author: "unknown",
    points: item.points,
    comments: item.comments,
    publishedAt: item.publishedAt,
    sourceFeed: "",
    topicId: state.activeView,
    topicLabel: views.find((view) => view.id === state.activeView)?.label || "",
    reason: item.reason
  };
}

function translationFromInsight(item) {
  return {
    status: "cached",
    titleZh: item.titleZh || "",
    summaryZh: item.summaryZh || item.reason || "",
    tags: []
  };
}

function canUseInitialHomeData() {
  return state.activeView === "home"
    && state.activeTopic === "frontpage"
    && state.pointsSort === "desc"
    && !el.searchInput.value.trim()
    && state.initialData?.home?.stories?.length;
}

function applyInitialHomeData() {
  if (!canUseInitialHomeData()) return false;
  const home = state.initialData.home;
  state.insights = state.initialData.insights || null;
  state.insightDiscussions = state.initialData.insightDiscussions || {};
  el.toolbar.hidden = false;
  el.feedTitle.textContent = "首页精选";
  renderStories(home.stories || [], home.translations || {}, home.freshness || {}, home.discussions || {}, { animate: false });
  saveRecentCache(storyUrl(), {
    stories: home.stories || [],
    translations: home.translations || {},
    freshness: home.freshness || {},
    discussions: home.discussions || {}
  });
  if (state.insights) {
    saveRecentCache("/api/insights", {
      ok: true,
      insights: state.insights,
      discussions: state.insightDiscussions,
      freshness: home.freshness || {}
    });
  }
  return true;
}

async function renderInsightView(viewId) {
  el.toolbar.hidden = true;
  const label = views.find((view) => view.id === viewId)?.label || "";
  el.feedTitle.textContent = label;
  if (!state.insights) {
    setSkeleton(4);
    try {
      await loadInsights();
    } catch {
      el.feedCount.textContent = "";
      el.storyList.innerHTML = `
        <div class="state">
          <h3>这一栏暂时没读到</h3>
          <p>恢复网络后会继续读取最新快照。</p>
        </div>
      `;
      setFeedBusy(false, `${label}加载失败`);
      updateFeedActions();
      return;
    }
  }
  const items = state.insights?.[viewId] || [];
  el.feedTitle.textContent = label;
  if (!items.length) {
    el.feedCount.textContent = "";
    el.storyList.innerHTML = `
      <div class="state">
        <h3>这一栏还在准备</h3>
        <p>后台快照更新后会自动补上。</p>
      </div>
    `;
    setFeedBusy(false, `${label}暂时没有内容`);
    updateFeedActions();
    return;
  }
  const stories = items.map(storyFromInsight);
  const translations = Object.fromEntries(items.map((item) => [item.id, translationFromInsight(item)]));
  renderStories(stories, translations, { generatedAt: state.insights.generatedAt, ready: true }, state.insightDiscussions);
  el.feedTitle.textContent = label;
}

function renderFavoritesView() {
  el.toolbar.hidden = true;
  el.feedTitle.textContent = "收藏";
  const rows = Array.from(state.favorites.values()).sort((a, b) => Date.parse(b.savedAt || "0") - Date.parse(a.savedAt || "0"));
  if (!rows.length) {
    el.feedCount.textContent = "";
    el.storyList.innerHTML = `
      <div class="state">
        <h3>还没有收藏</h3>
        <p>看到值得回看的帖子，点右上角星标即可保存到本机。</p>
      </div>
    `;
    setFeedBusy(false, "收藏列表为空");
    updateFeedActions();
    return;
  }
  const stories = rows.map((row) => row.story);
  const translations = Object.fromEntries(rows.filter((row) => row.translation).map((row) => [row.story.id, row.translation]));
  const discussions = Object.fromEntries(rows.filter((row) => row.discussion).map((row) => [row.story.id, row.discussion]));
  renderStories(stories, translations, { generatedAt: rows[0]?.savedAt, ready: true }, discussions);
  el.feedTitle.textContent = "收藏";
  updateFeedActions();
}

function markdownEscape(value = "") {
  return String(value).replace(/\r?\n/g, " ").trim();
}

function exportFavorites() {
  const rows = Array.from(state.favorites.values()).sort((a, b) => Date.parse(b.savedAt || "0") - Date.parse(a.savedAt || "0"));
  if (!rows.length) {
    showToast("暂无收藏可导出");
    return;
  }
  const lines = [
    "# 乔木 HN 速读收藏",
    "",
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    `收藏数量：${rows.length}`,
    ""
  ];
  rows.forEach((row, index) => {
    const story = row.story || {};
    const translation = row.translation || {};
    const title = translation.titleZh || story.title || `收藏 ${index + 1}`;
    const commentsUrl = story.hnId ? `https://news.ycombinator.com/item?id=${story.hnId}` : story.commentsUrl;
    lines.push(`## ${index + 1}. ${markdownEscape(title)}`);
    if (story.title && story.title !== title) lines.push(`原题：${markdownEscape(story.title)}`);
    if (translation.summaryZh) lines.push(`摘要：${markdownEscape(translation.summaryZh)}`);
    lines.push(`链接：${story.url || ""}`);
    if (commentsUrl) lines.push(`讨论：${commentsUrl}`);
    lines.push(`数据：${story.points ?? 0} points · ${story.comments ?? 0} 评论 · ${story.domain || ""}`);
    if (row.savedAt) lines.push(`收藏时间：${new Date(row.savedAt).toLocaleString("zh-CN")}`);
    lines.push("");
  });

  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `qiaomu-hn-favorites-${stamp}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
  showToast("已导出收藏");
}

async function loadCurrentView({ silent = false } = {}) {
  renderViewTabs();
  if (state.activeView === "home") return loadStories({ silent });
  if (state.activeView === "favorites") return renderFavoritesView();
  return renderInsightView(state.activeView);
}

async function setActiveView(viewId) {
  if (!validViews.has(viewId)) return;
  state.activeView = viewId;
  state.expandedComments.clear();
  if (viewId !== "home") el.searchInput.value = "";
  syncUrlState();
  await loadCurrentView();
}

function articleIsReady(article) {
  return Boolean(article && (article.status === "generated" || article.status === "cached") && (article.lead || article.highlights?.length));
}

function compactText(value = "", max = 92) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function firstSentence(value = "") {
  const text = String(value).replace(/\s+/g, " ").trim();
  const match = text.match(/^(.{24,110}?[。！？.!?])\s*/);
  return compactText(match ? match[1] : text, 90);
}

function commentQuoteText(comment, translations) {
  const tr = translations[comment.id];
  if (tr && (tr.status === "translated" || tr.status === "cached") && tr.textZh) return tr.textZh;
  return comment.textPlain || "";
}

function discussionQuoteRows(article, bestComments = [], translations = {}) {
  const generated = Array.isArray(article?.commentQuotes)
    ? article.commentQuotes
        .map((item) => ({
          author: String(item.author || "").replace(/^@/, "").trim(),
          point: compactText(item.point || "", 42),
          quote: compactText(item.quote || "", 110)
        }))
        .filter((item) => item.point && item.quote)
        .slice(0, 4)
    : [];
  if (generated.length) return generated;

  return bestComments.slice(0, 3).map((comment) => {
    const text = commentQuoteText(comment, translations);
    return {
      author: comment.author || "",
      point: firstSentence(text),
      quote: compactText(text, 110)
    };
  }).filter((item) => item.point && item.quote);
}

function renderDiscussionArticle(article, bestComments = [], translations = {}) {
  if (!articleIsReady(article)) {
    return `
      <div class="ai-pending">
        <span class="ai-pill"><span data-lucide="bot" aria-hidden="true"></span>AI</span>
        <p>生成速读中。先看评论译文或最佳评论。</p>
      </div>
    `;
  }
  const highlights = (article.highlights || []).slice(0, 3);
  const quotes = discussionQuoteRows(article, bestComments, translations);
  return `
    <article class="discussion-article">
      <div class="discussion-kicker">讨论速读</div>
      <h3>${escapeHtml(article.title || "这条讨论的中文速读")}</h3>
      ${article.lead ? `<p class="discussion-lead">${escapeHtml(article.lead)}</p>` : ""}
      ${highlights.length ? `
        <div class="discussion-list">
          ${highlights.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        </div>
      ` : ""}
      ${quotes.length ? `
        <div class="discussion-quotes">
          <div class="discussion-quotes-head"><span data-lucide="message-square-text" aria-hidden="true"></span>精选评论观点</div>
          ${quotes.map((item) => `
            <figure class="discussion-quote">
              <p>${escapeHtml(item.point)}</p>
              <figcaption>${escapeHtml(item.quote)}${item.author ? ` <span>@${escapeHtml(item.author)}</span>` : ""}</figcaption>
            </figure>
          `).join("")}
        </div>
      ` : ""}
    </article>
  `;
}

function renderCommentItem(c, translations, marker = "") {
  const tr = translations[c.id];
  const translationOk = tr && (tr.status === "translated" || tr.status === "cached") && tr.textZh;
  return `
    <div class="comment">
      <div class="comment-head">
        <span class="comment-author">@${escapeHtml(c.author)}</span>
        ${marker ? `<span class="comment-marker">${escapeHtml(marker)}</span>` : ""}
        <span class="comment-time">${escapeHtml(formatTime(c.publishedAt))}</span>
      </div>
      ${translationOk ? `
        <p class="comment-zh">${linkifyText(tr.textZh).replace(/\n/g, "<br>")}</p>
        <details class="comment-en"><summary>英文原文</summary><p>${linkifyText(c.textPlain).replace(/\n/g, "<br>")}</p></details>
      ` : `
        <p class="comment-en-direct">${linkifyText(c.textPlain).replace(/\n/g, "<br>")}</p>
      `}
    </div>
  `;
}

function setActiveDiscussionTab(container, tab) {
  if (!container) return;
  const target = container.querySelector(`[data-discussion-tab="${CSS.escape(tab)}"]`);
  if (!target || target.disabled) return;
  container.querySelectorAll("[data-discussion-tab]").forEach((btn) => {
    const active = btn.dataset.discussionTab === tab;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
    btn.tabIndex = active ? 0 : -1;
  });
  container.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tab;
  });
}

function renderComments(container, comments, translations, article, status, bestComments = [], preferredTab = "summary") {
  const summaryReady = articleIsReady(article);
  const hasBest = bestComments.length > 0;
  const activeTab = preferredTab === "comments"
    ? "comments"
    : preferredTab === "best" && hasBest
      ? "best"
      : summaryReady
        ? "summary"
        : hasBest
          ? "best"
          : "comments";
  const commentsHtml = comments.length
    ? comments.map((comment) => renderCommentItem(comment, translations)).join("")
    : `<div class="comments-empty"><p>${status === "preparing" ? "评论还在后台整理。" : "这条还没有可显示的评论。"}</p></div>`;
  const bestHtml = hasBest
    ? bestComments.map((comment, index) => renderCommentItem(comment, translations, `最佳 ${index + 1}`)).join("")
    : `<div class="comments-empty"><p>暂无最佳评论</p></div>`;
  const groupId = `discussion-${safeDomId(container.dataset.commentsFor)}`;

  container.innerHTML = `
    <div class="discussion-tabs" role="tablist" aria-label="讨论内容">
      <button id="${groupId}-tab-summary" type="button" data-discussion-tab="summary" role="tab" aria-controls="${groupId}-panel-summary" aria-selected="false" tabindex="-1" ${summaryReady ? "" : "disabled"}>讨论速读</button>
      <button id="${groupId}-tab-comments" type="button" data-discussion-tab="comments" role="tab" aria-controls="${groupId}-panel-comments" aria-selected="false" tabindex="-1">全部评论</button>
      <button id="${groupId}-tab-best" type="button" data-discussion-tab="best" role="tab" aria-controls="${groupId}-panel-best" aria-selected="false" tabindex="-1" ${hasBest ? "" : "disabled"}>${hasBest ? "最佳评论" : "暂无最佳评论"}</button>
    </div>
    <div id="${groupId}-panel-summary" class="discussion-panel" data-tab-panel="summary" role="tabpanel" aria-labelledby="${groupId}-tab-summary" tabindex="0">${renderDiscussionArticle(article, bestComments, translations)}</div>
    <div id="${groupId}-panel-comments" class="discussion-panel" data-tab-panel="comments" role="tabpanel" aria-labelledby="${groupId}-tab-comments" tabindex="0">
      <div class="comments-list">${commentsHtml}</div>
      ${hasBest ? `<button class="comments-bottom-switch" type="button" data-switch-tab="best"><span data-lucide="star" aria-hidden="true"></span>看最佳评论</button>` : ""}
    </div>
    <div id="${groupId}-panel-best" class="discussion-panel" data-tab-panel="best" role="tabpanel" aria-labelledby="${groupId}-tab-best" tabindex="0">
      <div class="comments-list best-comments-list">${bestHtml}</div>
    </div>
  `;
  renderIcons(container);
  setActiveDiscussionTab(container, activeTab);
}

function resetCommentButtonLabel(button) {
  if (button.dataset.preferredTab === "best") {
    button.textContent = button.disabled ? "暂无最佳评论" : "最佳评论";
    return;
  }
  if (button.dataset.preferredTab === "comments") {
    button.textContent = `${button.dataset.commentsCount || "0"} 评论`;
    return;
  }
  button.textContent = "讨论速读";
}

function resetCommentButtons(article) {
  if (!article) return;
  article.querySelectorAll("[data-toggle-comments]").forEach((button) => {
    resetCommentButtonLabel(button);
  });
}

async function toggleComments(commentId, container, btn, preferredTab = "summary") {
  const cached = state.expandedComments.get(commentId);
  if (cached?.loaded) {
    const article = btn.closest(".story");
    if (!container.hidden && btn.textContent.trim() === "收起评论") {
      container.classList.remove("open");
      resetCommentButtons(article);
      setTimeout(() => { container.hidden = true; }, 240);
      return;
    }
    if (container.hidden) {
      container.hidden = false;
      requestAnimationFrame(() => container.classList.add("open"));
    }
    resetCommentButtons(article);
    btn.textContent = "收起评论";
    setActiveDiscussionTab(container, preferredTab);
    return;
  }

  if (cached?.loading) return;
  state.expandedComments.set(commentId, { loading: true, loaded: false });
  container.hidden = false;
  btn.textContent = "加载中…";
  container.innerHTML = `
    <div class="comments-skeleton">
      <div class="skeleton-line w-zh"></div>
      <div class="skeleton-line w-en" style="width:50%"></div>
      <div class="skeleton-line w-zh" style="margin-top:12px"></div>
      <div class="skeleton-line w-en" style="width:40%"></div>
    </div>
  `;
  requestAnimationFrame(() => container.classList.add("open"));

  if (state.commentsAbort.has(commentId)) state.commentsAbort.get(commentId).abort();
  const controller = new AbortController();
  state.commentsAbort.set(commentId, controller);

  try {
    const response = await fetch(`/api/stories/${encodeURIComponent(commentId)}/comments`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderComments(container, data.comments || [], data.translations || {}, data.article || null, data.commentsStatus || "preparing", data.bestComments || [], preferredTab);
    state.expandedComments.set(commentId, { loading: false, loaded: true });
    resetCommentButtons(btn.closest(".story"));
    btn.textContent = "收起评论";
  } catch (error) {
    if (error.name === "AbortError") return;
    container.innerHTML = `<div class="comments-error"><p>评论加载失败,稍后再试。</p></div>`;
    resetCommentButtonLabel(btn);
    state.expandedComments.set(commentId, { loading: false, loaded: false });
  }
}

function debounce(fn, delay = 300) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function showServiceWorkerUpdate() {
  if (state.serviceWorkerUpdateShown) return;
  state.serviceWorkerUpdateShown = true;
  showToast("新版本已就绪", {
    actionLabel: "刷新",
    actionIcon: "refresh-cw",
    duration: 12000,
    onAction: () => window.location.reload()
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) showServiceWorkerUpdate();
  }, { once: true });
  await navigator.serviceWorker.register("/service-worker.js");
}

async function init() {
  loadFavorites();
  loadReadStories();
  readInitialUrlState();
  state.initialData = readInitialData();
  renderViewTabs();
  setSortButton();
  renderIcons();
  updateInstallButton();
  const usedInitialHome = applyInitialHomeData();
  loadInsights().catch(() => {});
  if (usedInitialHome) {
    loadStories({ silent: true }).catch(() => {});
  } else {
    await loadCurrentView();
  }

  registerServiceWorker().catch(() => {});
}

el.viewTabs.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-view]");
  if (!btn) return;
  setActiveView(btn.dataset.view).catch(() => showToast("这一栏暂时没读到"));
});

el.viewTabs.addEventListener("keydown", (event) => {
  const current = event.target.closest("[role=tab]");
  if (!current || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(el.viewTabs.querySelectorAll("[role=tab]"));
  const currentIndex = tabs.indexOf(current);
  let nextIndex = currentIndex;
  if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  event.preventDefault();
  tabs[nextIndex]?.focus();
});

document.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  const action = actionTarget?.dataset.action;
  if (action === "refresh") {
    if (state.refreshing) return;
    state.refreshing = true;
    el.refreshBtn.classList.add("is-spin");
    state.expandedComments.clear();
    state.insights = null;
    Promise.resolve(loadCurrentView({ silent: false })).finally(() => {
      setTimeout(() => {
        el.refreshBtn.classList.remove("is-spin");
        state.refreshing = false;
      }, 500);
      showToast("已刷新");
    });
  } else if (action === "install-app") {
    if (!state.installPromptEvent || isPwaStandalone()) {
      updateInstallButton();
      return;
    }
    const promptEvent = state.installPromptEvent;
    state.installPromptEvent = null;
    updateInstallButton();
    promptEvent.prompt();
    promptEvent.userChoice.then((choice) => {
      if (choice.outcome === "accepted") showToast("正在安装");
    }).catch(() => {});
  } else if (action === "sort-points") {
    state.pointsSort = state.pointsSort === "desc" ? "asc" : "desc";
    state.expandedComments.clear();
    setSortButton();
    if (state.activeView !== "home") state.activeView = "home";
    syncUrlState({ replace: true });
    loadCurrentView();
  } else if (action === "export-favorites") {
    exportFavorites();
  } else if (action === "open-support") {
    openSupportDialog(actionTarget.dataset.support, actionTarget);
  } else if (action === "close-support") {
    closeSupportDialog();
  }
});

el.supportDialog?.addEventListener("click", (event) => {
  if (event.target === el.supportDialog) closeSupportDialog();
});

el.supportDialog?.addEventListener("close", () => {
  const trigger = state.supportDialogTrigger;
  state.supportDialogTrigger = null;
  requestAnimationFrame(() => trigger?.focus());
});

el.storyList.addEventListener("click", (event) => {
  const fav = event.target.closest("[data-toggle-favorite]");
  if (fav) {
    const storyId = fav.dataset.storyId;
    const next = !isFavorite(storyId);
    setFavorite(storyId, next);
    fav.classList.toggle("is-active", next);
    fav.setAttribute("aria-pressed", String(next));
    fav.setAttribute("aria-label", next ? "取消收藏" : "收藏");
    showToast(next ? "已收藏" : "已取消收藏");
    if (state.activeView === "favorites" && !next) renderFavoritesView();
    return;
  }

  const storyNode = event.target.closest(".story");
  if (storyNode && event.target.closest("a, [data-toggle-comments]")) {
    markStoryRead(storyNode.dataset.storyId);
  }

  const tab = event.target.closest("[data-discussion-tab]");
  if (tab) {
    setActiveDiscussionTab(event.target.closest(".comments-container"), tab.dataset.discussionTab);
    return;
  }

  const switcher = event.target.closest("[data-switch-tab]");
  if (switcher) {
    setActiveDiscussionTab(event.target.closest(".comments-container"), switcher.dataset.switchTab);
    return;
  }

  const btn = event.target.closest("[data-toggle-comments]");
  if (btn && !btn.disabled) {
    const commentId = btn.dataset.commentId;
    const container = el.storyList.querySelector(`[data-comments-for="${CSS.escape(commentId)}"]`);
    if (container) toggleComments(commentId, container, btn, btn.dataset.preferredTab || "summary");
    return;
  }

  if (!storyNode || event.button !== 0 || event.defaultPrevented) return;
  if (event.target.closest("a, button, input, select, textarea, details, summary, [role=button], [role=tab], .comments-container")) return;
  if (!window.getSelection()?.isCollapsed) return;
  const url = storyNode.dataset.storyUrl;
  if (!url) return;
  markStoryRead(storyNode.dataset.storyId);
  window.open(url, "_blank", "noopener,noreferrer");
});

el.storyList.addEventListener("keydown", (event) => {
  const current = event.target.closest("[data-discussion-tab]");
  if (!current || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const container = current.closest(".comments-container");
  const tabs = Array.from(container.querySelectorAll("[data-discussion-tab]:not(:disabled)"));
  const currentIndex = tabs.indexOf(current);
  let nextIndex = currentIndex;
  if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  const target = tabs[nextIndex];
  if (!target) return;
  event.preventDefault();
  setActiveDiscussionTab(container, target.dataset.discussionTab);
  target.focus();
});

const reloadFromFilters = debounce(() => {
  if (state.activeView !== "home") {
    state.activeView = "home";
    renderViewTabs();
  }
  syncUrlState({ replace: true });
  loadStories();
}, 320);
el.searchInput.addEventListener("input", reloadFromFilters);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPromptEvent = event;
  updateInstallButton();
});
window.addEventListener("appinstalled", () => {
  state.installPromptEvent = null;
  updateInstallButton();
});
window.matchMedia("(display-mode: standalone)").addEventListener?.("change", updateInstallButton);
window.addEventListener("popstate", () => {
  state.expandedComments.clear();
  readInitialUrlState();
  setSortButton();
  loadCurrentView().catch(() => showToast("这一栏暂时没读到"));
});
document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select, textarea")) return;
  if (event.key === "r" || event.key === "R") {
    event.preventDefault();
    el.refreshBtn?.click();
  }
});

init().catch(() => {
  el.storyList.innerHTML = `
    <div class="state">
      <h3>初始化失败</h3>
      <p>请刷新页面重试。</p>
    </div>
  `;
  setFeedBusy(false, "页面初始化失败");
});
