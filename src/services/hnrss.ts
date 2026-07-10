import Parser from "rss-parser";
import { config } from "../config.js";
import { getTopic, topics, type Topic } from "../topics.js";

type JsonFeedItem = {
  id?: string;
  title?: string;
  content_html?: string;
  url?: string;
  external_url?: string;
  date_published?: string;
  author?: { name?: string; url?: string };
};

type JsonFeed = {
  title?: string;
  items?: JsonFeedItem[];
};

type HnApiItem = {
  id?: number;
  by?: string;
  time?: number;
  text?: string;
  type?: string;
  kids?: number[];
  deleted?: boolean;
  dead?: boolean;
};

export type Story = {
  id: string;
  hnId: string | null;
  title: string;
  url: string;
  commentsUrl: string;
  domain: string;
  author: string;
  points: number | null;
  comments: number | null;
  publishedAt: string | null;
  sourceFeed: string;
  topicId: string;
  topicLabel: string;
};

export type StoryQuery = {
  topic?: string;
  feed?: string;
  query?: string;
  minPoints?: number;
  minComments?: number;
  pointsSort?: "asc" | "desc";
  limit?: number;
};

export type Comment = {
  id: string;
  author: string;
  textHtml: string;
  textPlain: string;
  url: string;
  publishedAt: string | null;
};

const parser = new Parser();
type FeedCacheValue = { expiresAt: number; stories: Story[] } | { expiresAt: number; comments: Comment[] };
const feedCache = new Map<string, FeedCacheValue>();

function clampLimit(value: unknown, fallback = 30) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function buildUrl(feed: string, params: Record<string, string | number | undefined>, format: "jsonfeed" | "rss") {
  const cleanFeed = feed.replace(/^\/+|\/+$/g, "");
  const suffix = format === "jsonfeed" ? ".jsonfeed" : "";
  const url = new URL(`${config.hnrssBaseUrl.replace(/\/+$/, "")}/${cleanFeed}${suffix}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function extractNumber(html: string | undefined, label: "Points" | "# Comments") {
  if (!html) return null;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`${escaped}:\\s*([0-9]+)`, "i"));
  return match ? Number(match[1]) : null;
}

function extractHnId(value: string | undefined) {
  if (!value) return null;
  const match = value.match(/item\?id=(\d+)/);
  return match ? match[1] : null;
}

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "news.ycombinator.com";
  }
}

function normalizeJsonItem(item: JsonFeedItem, topic: Topic, sourceFeed: string): Story | null {
  const title = item.title?.trim();
  const commentsUrl = item.external_url || item.id || "";
  const url = item.url || commentsUrl;
  if (!title || !url) return null;
  const hnId = extractHnId(commentsUrl) || extractHnId(item.id);
  return {
    id: hnId || item.id || url,
    hnId,
    title,
    url,
    commentsUrl,
    domain: getDomain(url),
    author: item.author?.name || "unknown",
    points: extractNumber(item.content_html, "Points"),
    comments: extractNumber(item.content_html, "# Comments"),
    publishedAt: item.date_published || null,
    sourceFeed,
    topicId: topic.id,
    topicLabel: topic.label
  };
}

function normalizeRssItem(item: Parser.Item, topic: Topic, sourceFeed: string): Story | null {
  const rssItem = item as Parser.Item & { comments?: string; creator?: string };
  const title = item.title?.trim();
  const commentsUrl = rssItem.comments || item.guid || "";
  const url = item.link || commentsUrl;
  if (!title || !url) return null;
  const hnId = extractHnId(commentsUrl) || extractHnId(item.guid);
  return {
    id: hnId || item.guid || url,
    hnId,
    title,
    url,
    commentsUrl,
    domain: getDomain(url),
    author: rssItem.creator || "unknown",
    points: extractNumber(item.content || item.contentSnippet, "Points"),
    comments: extractNumber(item.content || item.contentSnippet, "# Comments"),
    publishedAt: item.isoDate || item.pubDate || null,
    sourceFeed,
    topicId: topic.id,
    topicLabel: topic.label
  };
}

function applyLocalFilters(stories: Story[], query: StoryQuery) {
  const filtered = stories.filter((story) => {
    if (query.minPoints !== undefined && (story.points || 0) < query.minPoints) return false;
    if (query.minComments !== undefined && (story.comments || 0) < query.minComments) return false;
    return true;
  });
  const pointsSort = query.pointsSort;
  if (!pointsSort) return filtered;
  return filtered.sort((a, b) => compareByPoints(a, b, pointsSort));
}

function compareByFreshness(a: Story, b: Story) {
  return Date.parse(b.publishedAt || "0") - Date.parse(a.publishedAt || "0");
}

function compareByPoints(a: Story, b: Story, direction: "asc" | "desc") {
  const sign = direction === "asc" ? 1 : -1;
  const pointDelta = ((a.points || 0) - (b.points || 0)) * sign;
  if (pointDelta !== 0) return pointDelta;
  const commentDelta = ((a.comments || 0) - (b.comments || 0)) * sign;
  if (commentDelta !== 0) return commentDelta;
  return compareByFreshness(a, b);
}

async function fetchJsonFeed(url: string, topic: Topic, sourceFeed: string) {
  const response = await fetch(url, {
    headers: {
      accept: "application/feed+json, application/json;q=0.9, */*;q=0.5",
      "user-agent": "hn.qiaomu.ai/0.1 (+https://hn.qiaomu.ai)"
    }
  });
  if (!response.ok) throw new Error(`HNRSS JSON Feed ${response.status}`);
  const feed = (await response.json()) as JsonFeed;
  return (feed.items || []).map((item) => normalizeJsonItem(item, topic, sourceFeed)).filter(Boolean) as Story[];
}

async function fetchRssFeed(url: string, topic: Topic, sourceFeed: string) {
  const feed = await parser.parseURL(url);
  return feed.items.map((item) => normalizeRssItem(item, topic, sourceFeed)).filter(Boolean) as Story[];
}

export async function getStories(query: StoryQuery = {}) {
  const topic = getTopic(query.topic || "") || {
    id: "custom",
    label: query.query ? "自定义搜索" : "首页精选",
    shortLabel: "搜索",
    description: "Custom HNRSS query",
    feed: query.feed || "frontpage",
    query: query.query,
    accent: "#ff6600"
  };
  const feed = query.feed || topic.feed;
  const limit = clampLimit(query.limit);
  const remoteLimit = Math.min(100, Math.max(limit, 30));
  const params = {
    q: query.query || topic.query,
    count: remoteLimit,
    points: topic.minPoints,
    comments: topic.minComments
  };
  const cacheKey = JSON.stringify({ feed, params, topic: topic.id });
  const cached = feedCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && "stories" in cached) return applyLocalFilters(cached.stories, query).slice(0, limit);

  const jsonUrl = buildUrl(feed, params, "jsonfeed");
  const rssUrl = buildUrl(feed, params, "rss");
  let stories: Story[];
  try {
    stories = await fetchJsonFeed(jsonUrl, topic, feed);
  } catch {
    stories = await fetchRssFeed(rssUrl, topic, feed);
  }

  feedCache.set(cacheKey, { expiresAt: Date.now() + config.cacheTtlMs, stories });
  return applyLocalFilters(stories, query).slice(0, limit);
}

export async function getMergedStories(topicIds: string[], limitPerTopic = 20) {
  const selectedTopics = topicIds.map((id) => getTopic(id)).filter(Boolean) as Topic[];
  const usableTopics = selectedTopics.length ? selectedTopics : topics.slice(0, 3);
  const batches = await Promise.all(
    usableTopics.map((topic) => getStories({ topic: topic.id, limit: Math.min(50, limitPerTopic) }))
  );
  const seen = new Set<string>();
  return batches
    .flat()
    .filter((story) => {
      if (seen.has(story.id)) return false;
      seen.add(story.id);
      return true;
    })
    .sort((a, b) => Date.parse(b.publishedAt || "0") - Date.parse(a.publishedAt || "0"));
}

// ===== 评论 =====

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComment(item: JsonFeedItem): Comment | null {
  const textHtml = item.content_html || "";
  const textPlain = stripHtml(textHtml);
  if (!textPlain) return null;
  const url = item.url || item.external_url || item.id || "";
  const id = item.id || url;
  return {
    id,
    author: item.author?.name || "unknown",
    textHtml,
    textPlain,
    url,
    publishedAt: item.date_published || null
  };
}

async function fetchHnApiItem(id: string | number): Promise<HnApiItem | null> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), config.hnApiTimeoutMs);
  try {
    const response = await fetch(`${config.hnApiBaseUrl}/item/${id}.json`, {
      signal: abort.signal,
      headers: {
        accept: "application/json",
        "user-agent": "hn.qiaomu.ai/0.5 (+https://hn.qiaomu.ai)"
      }
    });
    if (!response.ok) throw new Error(`HN API item ${response.status}`);
    return (await response.json()) as HnApiItem | null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeHnApiComment(item: HnApiItem | null): Comment | null {
  if (!item?.id || item.type !== "comment" || item.deleted || item.dead) return null;
  const textHtml = item.text || "";
  const textPlain = stripHtml(textHtml);
  if (!textPlain) return null;
  const url = `https://news.ycombinator.com/item?id=${item.id}`;
  return {
    id: url,
    author: item.by || "unknown",
    textHtml,
    textPlain,
    url,
    publishedAt: item.time ? new Date(item.time * 1000).toISOString() : null
  };
}

export async function getCommentsFromHnApi(storyId: string, requestedLimit = 30): Promise<Comment[]> {
  const cacheKey = `comments:${storyId}`;
  const cached = feedCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && "comments" in cached && cached.comments.length) return cached.comments;

  const hnId = extractHnId(storyId) || (/^\d+$/.test(storyId) ? storyId : null);
  if (!hnId) throw new Error("HN API fallback requires a numeric story id");

  const limit = clampLimit(requestedLimit);
  const story = await fetchHnApiItem(hnId);
  if (!story) throw new Error("HN API story not found");

  const queue = [...(story.kids || [])];
  const seen = new Set<number>();
  const comments: Comment[] = [];
  let fetchedCount = 0;
  const maxFetchedItems = limit * 4;

  while (queue.length && comments.length < limit && fetchedCount < maxFetchedItems) {
    const remaining = maxFetchedItems - fetchedCount;
    const batchIds = queue.splice(0, Math.min(8, remaining)).filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (!batchIds.length) continue;

    const items = await Promise.all(batchIds.map((id) => fetchHnApiItem(id)));
    fetchedCount += batchIds.length;
    for (const item of items) {
      if (item?.kids?.length) queue.push(...item.kids);
      const comment = normalizeHnApiComment(item);
      if (comment) comments.push(comment);
      if (comments.length >= limit) break;
    }
  }

  feedCache.set(cacheKey, { expiresAt: Date.now() + config.cacheTtlMs, comments });
  return comments;
}

export async function getComments(storyId: string): Promise<Comment[]> {
  const cacheKey = `comments:${storyId}`;
  const cached = feedCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && "comments" in cached) return cached.comments;

  const params = { id: storyId, count: 30 };
  const jsonUrl = buildUrl("item", params, "jsonfeed");
  const rssUrl = buildUrl("item", params, "rss");

  // HNRSS item feed 返回的是评论列表(扁平,无父子层级)
  let comments: Comment[];
  try {
    const response = await fetch(jsonUrl, {
      headers: {
        accept: "application/feed+json, application/json;q=0.9, */*;q=0.5",
        "user-agent": "hn.qiaomu.ai/0.3 (+https://hn.qiaomu.ai)"
      }
    });
    if (!response.ok) throw new Error(`HNRSS item ${response.status}`);
    const feed = (await response.json()) as JsonFeed;
    comments = (feed.items || []).map(normalizeComment).filter(Boolean) as Comment[];
  } catch {
    // RSS fallback:评论正文在 description
    const feed = await parser.parseURL(rssUrl);
    comments = feed.items
      .map((item) => {
        const textHtml = item.content || item.contentSnippet || "";
        const textPlain = stripHtml(textHtml);
        if (!textPlain) return null;
        return {
          id: item.guid || item.link || "",
          author: (item as Parser.Item & { creator?: string }).creator || "unknown",
          textHtml,
          textPlain,
          url: item.link || item.guid || "",
          publishedAt: item.isoDate || item.pubDate || null
        } as Comment;
      })
      .filter(Boolean) as Comment[];
  }

  feedCache.set(cacheKey, { expiresAt: Date.now() + config.cacheTtlMs, comments });
  return comments;
}
