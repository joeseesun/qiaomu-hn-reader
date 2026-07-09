const FAVORITES_KEY = "qiaomu-hn-favorites-v1";

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
  expandedComments: new Map(),
  commentsAbort: new Map(),
  insights: null,
  insightDiscussions: {},
  discussions: {},
  favorites: new Map(),
  storyCache: new Map(),
  translationCache: {}
};

const el = {
  viewTabs: document.querySelector("[data-view-tabs]"),
  storyList: document.querySelector("[data-story-list]"),
  feedTitle: document.querySelector("[data-feed-title]"),
  feedCount: document.querySelector("[data-feed-count]"),
  searchInput: document.querySelector("[data-search-input]"),
  toolbar: document.querySelector(".toolbar"),
  toast: document.querySelector("[data-toast]"),
  refreshBtn: document.querySelector('[data-action="refresh"]'),
  sortPointsBtn: document.querySelector('[data-action="sort-points"]')
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

function showToast(text) {
  el.toast.textContent = text;
  el.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.toast.classList.remove("show"), 1800);
}

function renderIcons(root = document) {
  window.qmLucide?.render(root);
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
  el.viewTabs.innerHTML = views.map((view) => {
    const active = view.id === state.activeView ? " is-active" : "";
    return `<button class="section-tab${active}" type="button" data-view="${escapeHtml(view.id)}">${escapeHtml(view.label)}</button>`;
  }).join("");
}

function setSkeleton(count = 5) {
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

function articleReadyFromMeta(meta = {}) {
  return Boolean(meta.articleReady);
}

function storyCommentId(story) {
  return story.hnId || extractHnId(story.commentsUrl) || story.id;
}

function renderStories(stories, translations = {}, freshness = {}, discussions = {}) {
  state.discussions = discussions || {};
  state.translationCache = { ...translations };
  state.storyCache.clear();

  if (!stories.length) {
    el.storyList.innerHTML = `
      <div class="state">
        <h3>${freshness.ready === false ? "正在准备中文快照" : "没有匹配的条目"}</h3>
        <p>${freshness.ready === false ? "后台正在同步 Hacker News,稍后刷新即可阅读。" : "换一个关键词试试。"}</p>
      </div>
    `;
    el.feedCount.textContent = freshness.ready === false ? "同步中" : "";
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
    const delay = i < 12 ? Math.min(i * 45, 360) : 0;
    const rank = String(i + 1).padStart(2, "0");
    const commentId = storyCommentId(story);
    const commentsCount = story.comments ?? 0;
    const discussion = discussions[story.id] || {};
    const canReadSummary = commentsCount > 0 && articleReadyFromMeta(discussion);
    const canReadBest = commentsCount > 0 && (discussion.bestCount || 0) > 0;
    const favorite = isFavorite(story.id);

    return `
      <article class="story${noZh}" data-story-id="${escapeHtml(story.id)}" data-comment-id="${escapeHtml(commentId)}" style="animation-delay:${delay}ms">
        <div class="story-rank">${rank}</div>
        <div class="story-main">
          <div class="story-topline">
            <div class="story-title-block">
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
          <div class="meta">
            <span class="points">${story.points ?? 0}</span>
            ${commentsCount > 0 ? `
              <button class="meta-text comment-count-btn" type="button" data-toggle-comments data-preferred-tab="comments" data-comment-id="${escapeHtml(commentId)}" data-comments-count="${commentsCount}">${commentsCount} 评论</button>
            ` : `<span class="meta-text">0 评论</span>`}
            <span class="meta-dot">·</span>
            <a class="meta-text domain domain-link" href="${escapeHtml(story.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(story.domain)}</a>
            <span class="meta-dot">·</span>
            <span class="meta-text">${escapeHtml(formatTime(story.publishedAt))}</span>
            <span class="meta-dot">·</span>
            ${commentsCount > 0 ? `
              ${canReadSummary ? `
                <button class="meta-text discuss-btn" type="button" data-toggle-comments data-preferred-tab="summary" data-comment-id="${escapeHtml(commentId)}">讨论速读</button>
              ` : `<span class="meta-text discuss-status">生成速读中</span>`}
              <span class="meta-dot">·</span>
              <button class="meta-text discuss-btn" type="button" data-toggle-comments data-preferred-tab="best" data-comment-id="${escapeHtml(commentId)}" ${canReadBest ? "" : "disabled"}>${canReadBest ? "最佳评论" : "暂无最佳评论"}</button>
            ` : `<span class="meta-text discuss-status">暂无讨论</span>`}
          </div>
          <div class="comments-container" data-comments-for="${escapeHtml(commentId)}" hidden></div>
        </div>
      </article>
    `;
  }).join("");
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

  el.toolbar.hidden = false;
  el.feedTitle.textContent = search ? "搜索结果" : (topic?.label || "首页精选");
  if (!silent) setSkeleton(8);

  try {
    const response = await fetch(storyUrl(), { signal: state.storiesAbort.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderStories(data.stories || [], data.translations || {}, data.freshness || {}, data.discussions || {});
  } catch (error) {
    if (error.name === "AbortError") return;
    el.storyList.innerHTML = `
      <div class="state">
        <h3>这次没读到 Hacker News</h3>
        <p>稍后刷新,或换个主题试试。</p>
      </div>
    `;
    el.feedCount.textContent = "";
  }
}

async function loadInsights() {
  if (state.insightsAbort) state.insightsAbort.abort();
  state.insightsAbort = new AbortController();
  const response = await fetch("/api/insights", { signal: state.insightsAbort.signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  state.insights = data.insights || null;
  state.insightDiscussions = data.discussions || {};
  return data;
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

async function renderInsightView(viewId) {
  el.toolbar.hidden = true;
  if (!state.insights) {
    setSkeleton(4);
    await loadInsights();
  }
  const items = state.insights?.[viewId] || [];
  const label = views.find((view) => view.id === viewId)?.label || "";
  el.feedTitle.textContent = label;
  if (!items.length) {
    el.feedCount.textContent = "";
    el.storyList.innerHTML = `
      <div class="state">
        <h3>这一栏还在准备</h3>
        <p>后台快照更新后会自动补上。</p>
      </div>
    `;
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
    return;
  }
  const stories = rows.map((row) => row.story);
  const translations = Object.fromEntries(rows.filter((row) => row.translation).map((row) => [row.story.id, row.translation]));
  const discussions = Object.fromEntries(rows.filter((row) => row.discussion).map((row) => [row.story.id, row.discussion]));
  renderStories(stories, translations, { generatedAt: rows[0]?.savedAt, ready: true }, discussions);
  el.feedTitle.textContent = "收藏";
}

async function loadCurrentView({ silent = false } = {}) {
  renderViewTabs();
  if (state.activeView === "home") return loadStories({ silent });
  if (state.activeView === "favorites") return renderFavoritesView();
  return renderInsightView(state.activeView);
}

async function setActiveView(viewId) {
  state.activeView = viewId;
  state.expandedComments.clear();
  if (viewId !== "home") el.searchInput.value = "";
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
  const target = container.querySelector(`[data-discussion-tab="${CSS.escape(tab)}"]`);
  if (!target || target.disabled) return;
  container.querySelectorAll("[data-discussion-tab]").forEach((btn) => {
    const active = btn.dataset.discussionTab === tab;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
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

  container.innerHTML = `
    <div class="discussion-tabs" role="tablist">
      <button type="button" data-discussion-tab="summary" role="tab" ${summaryReady ? "" : "disabled"}>讨论速读</button>
      <button type="button" data-discussion-tab="comments" role="tab">全部评论</button>
      <button type="button" data-discussion-tab="best" role="tab" ${hasBest ? "" : "disabled"}>${hasBest ? "最佳评论" : "暂无最佳评论"}</button>
    </div>
    <div class="discussion-panel" data-tab-panel="summary">${renderDiscussionArticle(article, bestComments, translations)}</div>
    <div class="discussion-panel" data-tab-panel="comments">
      <div class="comments-list">${commentsHtml}</div>
      ${hasBest ? `<button class="comments-bottom-switch" type="button" data-switch-tab="best"><span data-lucide="star" aria-hidden="true"></span>看最佳评论</button>` : ""}
    </div>
    <div class="discussion-panel" data-tab-panel="best">
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

async function init() {
  loadFavorites();
  renderViewTabs();
  setSortButton();
  renderIcons();
  loadInsights().catch(() => {});
  await loadStories();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  }
}

el.viewTabs.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-view]");
  if (!btn) return;
  setActiveView(btn.dataset.view).catch(() => showToast("这一栏暂时没读到"));
});

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
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
  } else if (action === "sort-points") {
    state.pointsSort = state.pointsSort === "desc" ? "asc" : "desc";
    state.expandedComments.clear();
    setSortButton();
    if (state.activeView !== "home") state.activeView = "home";
    loadCurrentView();
  }
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
  if (!btn || btn.disabled) return;
  const commentId = btn.dataset.commentId;
  const container = el.storyList.querySelector(`[data-comments-for="${CSS.escape(commentId)}"]`);
  if (container) toggleComments(commentId, container, btn, btn.dataset.preferredTab || "summary");
});

const reloadFromFilters = debounce(() => {
  if (state.activeView !== "home") {
    state.activeView = "home";
    renderViewTabs();
  }
  loadStories();
}, 320);
el.searchInput.addEventListener("input", reloadFromFilters);
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
});
