import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { config, isTranslationEnabled } from "../config.js";
import type { Story, Comment } from "./hnrss.js";

export type Translation = {
  titleZh: string;
  summaryZh: string;
  tags: string[];
  model: string;
  status: "translated" | "cached" | "disabled" | "error";
  cachedAt?: string;
  error?: string;
};

type CacheShape = Record<string, Omit<Translation, "status"> & { cachedAt: string }>;

let cacheLoaded = false;
let cacheLoadPromise: Promise<void> | null = null;
let translationCache: CacheShape = {};

function cacheKey(story: Pick<Story, "title" | "url">) {
  return Buffer.from(`${config.deepseekModel}\n${story.title}\n${story.url}`).toString("base64url");
}

async function loadCache() {
  if (cacheLoaded) return;
  if (!cacheLoadPromise) {
    cacheLoadPromise = (async () => {
      try {
        const raw = await fs.readFile(path.join(config.dataDir, "translations.json"), "utf8");
        translationCache = JSON.parse(raw) as CacheShape;
      } catch {
        translationCache = {};
      } finally {
        cacheLoaded = true;
      }
    })();
  }
  await cacheLoadPromise;
}

async function saveCache() {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(path.join(config.dataDir, "translations.json"), JSON.stringify(translationCache, null, 2));
}

function disabledTranslation(): Translation {
  return {
    titleZh: "",
    summaryZh: "中文翻译暂未准备，已保留英文原文。",
    tags: [],
    model: config.deepseekModel,
    status: "disabled"
  };
}

function extractJson(content: string) {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("DeepSeek response did not contain JSON");
  return match[0];
}

function getStoryTranslationCacheHits(stories: Story[], force = false) {
  const result: Record<string, Translation> = {};
  const missing = stories.filter((story) => {
    const key = cacheKey(story);
    const cached = translationCache[key];
    if (cached && !force) {
      result[story.id] = { ...cached, status: "cached" };
      return false;
    }
    return true;
  });
  return { result, missing };
}

export async function preloadStoryTranslationCache() {
  await loadCache();
}

export async function getCachedStoryTranslations(stories: Story[]): Promise<Record<string, Translation>> {
  await loadCache();
  return getStoryTranslationCacheHits(stories).result;
}

const storyTranslationQueue = new Map<string, Story>();
let storyTranslationQueuePromise: Promise<void> | null = null;

async function drainStoryTranslationQueue() {
  if (storyTranslationQueuePromise) return storyTranslationQueuePromise;
  storyTranslationQueuePromise = (async () => {
    try {
      while (storyTranslationQueue.size) {
        const batch = Array.from(storyTranslationQueue.entries()).slice(0, 40);
        batch.forEach(([key]) => storyTranslationQueue.delete(key));
        await translateStories(batch.map(([, story]) => story));
      }
    } finally {
      storyTranslationQueuePromise = null;
      if (storyTranslationQueue.size) void drainStoryTranslationQueue();
    }
  })();
  return storyTranslationQueuePromise;
}

export function queueStoryTranslations(stories: Story[], source = "api") {
  if (!stories.length || !isTranslationEnabled()) return;
  void (async () => {
    await loadCache();
    let queued = 0;
    for (const story of stories) {
      const key = cacheKey(story);
      if (translationCache[key] || storyTranslationQueue.has(key)) continue;
      storyTranslationQueue.set(key, story);
      queued += 1;
    }
    if (!queued) return;
    console.log(`[translate] queued=${queued} source=${source}`);
    void drainStoryTranslationQueue();
  })().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown";
    console.warn(`[translate] queue error: ${message}`);
  });
}

export async function translateStories(stories: Story[], force = false): Promise<Record<string, Translation>> {
  await loadCache();
  const { result, missing } = getStoryTranslationCacheHits(stories, force);

  if (!missing.length) return result;
  if (!isTranslationEnabled()) {
    missing.forEach((story) => {
      result[story.id] = disabledTranslation();
    });
    return result;
  }

  const payload = missing.slice(0, 40).map((story) => ({
    id: story.id,
    title: story.title,
    domain: story.domain,
    points: story.points,
    comments: story.comments
  }));

  try {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), config.deepseekTimeoutMs);
    const response = await (async () => {
      try {
        return await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
          method: "POST",
          signal: abort.signal,
          headers: {
            authorization: `Bearer ${config.deepseekApiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: config.deepseekModel,
            thinking: { type: "disabled" },
            response_format: { type: "json_object" },
            temperature: 0.2,
            max_tokens: 1400,
            messages: [
              {
                role: "system",
                content:
                  "你是给中文开发者和产品经理服务的 Hacker News 编辑。把英文标题翻译成自然、克制、准确的简体中文，并用一句话说明为什么值得点开。不要夸张，不要营销腔。只返回 JSON。"
              },
              {
                role: "user",
                content: JSON.stringify({
                  schema:
                    "Return {\"items\":[{\"id\":\"same id\",\"titleZh\":\"简体中文标题\",\"summaryZh\":\"一句中文看点，少于 34 个汉字\",\"tags\":[\"1-3 个中文标签\"]}]}",
                  stories: payload
                })
              }
            ]
          })
        });
      } finally {
        clearTimeout(timeout);
      }
    })();
    if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${await response.text()}`);
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(extractJson(content)) as {
      items?: Array<{ id: string; titleZh: string; summaryZh: string; tags?: string[] }>;
    };
    const byId = new Map((parsed.items || []).map((item) => [item.id, item]));
    const now = new Date().toISOString();
    missing.forEach((story) => {
      const item = byId.get(story.id);
      const value = {
        titleZh: item?.titleZh?.trim() || story.title,
        summaryZh: item?.summaryZh?.trim() || "这条值得从标题和讨论热度判断是否继续阅读。",
        tags: (item?.tags || []).slice(0, 3),
        model: config.deepseekModel,
        cachedAt: now
      };
      translationCache[cacheKey(story)] = value;
      result[story.id] = { ...value, status: "translated" };
    });
    await saveCache();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown translation error";
    missing.forEach((story) => {
      result[story.id] = {
        titleZh: "",
        summaryZh: "中文翻译暂时不可用，已保留英文原文。",
        tags: [],
        model: config.deepseekModel,
        status: "error",
        error: message
      };
    });
    return result;
  }
}

// ===== 评论翻译 =====

export type CommentTranslation = {
  textZh: string;
  model: string;
  status: "translated" | "cached" | "disabled" | "error";
  error?: string;
};

type CommentCacheShape = Record<string, { textZh: string; model: string; cachedAt: string }>;

let commentCacheLoaded = false;
let commentCacheLoadPromise: Promise<void> | null = null;
let commentCache: CommentCacheShape = {};

function commentCacheKey(storyId: string, text: string) {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return `${config.deepseekModel}\n${storyId}\n${hash}`;
}

async function loadCommentCache() {
  if (commentCacheLoaded) return;
  if (!commentCacheLoadPromise) {
    commentCacheLoadPromise = (async () => {
      try {
        const raw = await fs.readFile(path.join(config.dataDir, "comment-translations.json"), "utf8");
        commentCache = JSON.parse(raw) as CommentCacheShape;
      } catch {
        commentCache = {};
      } finally {
        commentCacheLoaded = true;
      }
    })();
  }
  await commentCacheLoadPromise;
}

async function saveCommentCache() {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(path.join(config.dataDir, "comment-translations.json"), JSON.stringify(commentCache, null, 2));
}

export async function translateComments(comments: Comment[], storyId: string): Promise<Record<string, CommentTranslation>> {
  const result: Record<string, CommentTranslation> = {};
  if (!comments.length) return result;

  await loadCommentCache();
  const missing: Comment[] = [];
  comments.forEach((comment) => {
    const key = commentCacheKey(storyId, comment.textPlain);
    const cached = commentCache[key];
    if (cached) {
      result[comment.id] = { textZh: cached.textZh, model: cached.model, status: "cached" };
    } else {
      missing.push(comment);
    }
  });

  if (!missing.length) return result;
  if (!isTranslationEnabled()) {
    missing.forEach((comment) => {
      result[comment.id] = { textZh: "", model: config.deepseekModel, status: "disabled" };
    });
    return result;
  }

  // 评论可能很长,分批处理(每批最多 15 条,避免超 token)
  const batches: Comment[][] = [];
  for (let i = 0; i < missing.length; i += 15) batches.push(missing.slice(i, i + 15));

  for (const batch of batches) {
    try {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), config.deepseekTimeoutMs);
      const response = await (async () => {
        try {
          return await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
            method: "POST",
            signal: abort.signal,
            headers: {
              authorization: `Bearer ${config.deepseekApiKey}`,
              "content-type": "application/json"
            },
            body: JSON.stringify({
              model: config.deepseekModel,
              thinking: { type: "disabled" },
              response_format: { type: "json_object" },
              temperature: 0.2,
              max_tokens: 2400,
              messages: [
                {
                  role: "system",
                  content:
                    "你是给中文开发者翻译 Hacker News 评论的编辑。把英文评论翻译成自然、口语化的简体中文,保留原作者的语气和态度。不要添加解释,不要夸张。只返回 JSON。"
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    schema:
                      "Return {\"items\":[{\"id\":\"same id\",\"textZh\":\"简体中文译文,保留段落结构用 \\n 分隔\"}]}",
                    comments: batch.map((c) => ({ id: c.id, text: c.textPlain.slice(0, 600) }))
                  })
                }
              ]
            })
          });
        } finally {
          clearTimeout(timeout);
        }
      })();
      if (!response.ok) throw new Error(`DeepSeek ${response.status}`);
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content || "";
      const parsed = JSON.parse(extractJson(content)) as {
        items?: Array<{ id: string; textZh: string }>;
      };
      const byId = new Map((parsed.items || []).map((item) => [item.id, item]));
      const now = new Date().toISOString();
      batch.forEach((comment) => {
        const item = byId.get(comment.id);
        const textZh = item?.textZh?.trim() || "";
        commentCache[commentCacheKey(storyId, comment.textPlain)] = { textZh, model: config.deepseekModel, cachedAt: now };
        result[comment.id] = { textZh, model: config.deepseekModel, status: "translated" };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      batch.forEach((comment) => {
        result[comment.id] = { textZh: "", model: config.deepseekModel, status: "error", error: message };
      });
    }
  }

  await saveCommentCache();
  return result;
}
