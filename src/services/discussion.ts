import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { config, isTranslationEnabled } from "../config.js";
import { selectBestComments } from "./comments.js";
import type { Comment, Story } from "./hnrss.js";
import type { CommentTranslation, Translation } from "./translate.js";

const DISCUSSION_ARTICLE_VERSION = 2;

export type DiscussionQuote = {
  author: string;
  point: string;
  quote: string;
};

export type DiscussionArticle = {
  storyId: string;
  status: "generated" | "cached" | "fallback" | "disabled" | "error";
  title: string;
  lead: string;
  sections: Array<{ heading: string; body: string }>;
  highlights: string[];
  commentQuotes: DiscussionQuote[];
  disagreements: string[];
  takeaways: string[];
  sourceCommentCount: number;
  model: string;
  updatedAt: string;
  signature: string;
  error?: string;
};

type ArticleCacheShape = Record<string, DiscussionArticle>;

const articleFile = path.join(config.dataDir, "discussion-articles.json");

let articleCacheLoaded = false;
let articleCacheLoadPromise: Promise<void> | null = null;
let articleCache: ArticleCacheShape = {};

function extractJson(content: string) {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("DeepSeek response did not contain JSON");
  return match[0];
}

function makeSignature(story: Story, comments: Comment[]) {
  const material = JSON.stringify({
    version: DISCUSSION_ARTICLE_VERSION,
    id: story.id,
    title: story.title,
    comments: comments.map((comment) => [comment.id, comment.textPlain.length, comment.textPlain.slice(0, 120)])
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 20);
}

async function loadArticleCache() {
  if (articleCacheLoaded) return;
  if (!articleCacheLoadPromise) {
    articleCacheLoadPromise = (async () => {
      try {
        const raw = await fs.readFile(articleFile, "utf8");
        articleCache = JSON.parse(raw) as ArticleCacheShape;
      } catch {
        articleCache = {};
      } finally {
        articleCacheLoaded = true;
      }
    })();
  }
  await articleCacheLoadPromise;
}

async function saveArticleCache() {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(articleFile, JSON.stringify(articleCache, null, 2));
}

function fallbackArticle(story: Story, translation: Translation | undefined, comments: Comment[], status: DiscussionArticle["status"], error?: string): DiscussionArticle {
  const title = translation?.titleZh || story.title;
  const usableSummary = translation && (translation.status === "translated" || translation.status === "cached") ? translation.summaryZh : "";
  const lead = comments.length
    ? "这条讨论已经抓取到评论，但中文讨论文章还在准备中。你可以先看下方评论译文和英文原文。"
    : "这条帖子暂时没有可用评论，先保留标题、热度和原文链接。";
  return {
    storyId: story.id,
    status,
    title,
    lead,
    sections: comments.length
      ? [
          {
            heading: "先读结论",
            body: usableSummary || "可以先从标题、分数和评论热度判断是否继续阅读。"
          }
        ]
      : [],
    highlights: [],
    commentQuotes: [],
    disagreements: [],
    takeaways: [],
    sourceCommentCount: comments.length,
    model: config.deepseekModel,
    updatedAt: new Date().toISOString(),
    signature: makeSignature(story, comments),
    error
  };
}

function normalizeQuotes(value: unknown): DiscussionQuote[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 4)
    .map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        author: String(row.author || "").replace(/^@/, "").trim(),
        point: String(row.point || "").trim(),
        quote: String(row.quote || "").trim()
      };
    })
    .filter((item) => item.point && item.quote);
}

export async function getCachedDiscussionArticle(storyId: string) {
  await loadArticleCache();
  return articleCache[storyId] || null;
}

export async function generateDiscussionArticle(
  story: Story,
  translation: Translation | undefined,
  comments: Comment[],
  commentTranslations: Record<string, CommentTranslation>,
  force = false
): Promise<DiscussionArticle> {
  await loadArticleCache();
  const signature = makeSignature(story, comments);
  const cached = articleCache[story.id];
  const hasReusableCache = cached
    && cached.signature === signature
    && (cached.status === "generated" || cached.status === "cached");
  if (hasReusableCache && !force) return { ...cached, status: "cached" };

  if (!comments.length) return fallbackArticle(story, translation, comments, "fallback");
  if (!isTranslationEnabled()) return fallbackArticle(story, translation, comments, "disabled");

  const bestCandidateIds = new Set(selectBestComments(comments, commentTranslations, 6).map((comment) => comment.id));
  const commentPayload = comments.slice(0, config.commentsPerStory).map((comment) => {
    const translated = commentTranslations[comment.id]?.textZh;
    return {
      id: comment.id,
      author: comment.author,
      bestCandidate: bestCandidateIds.has(comment.id),
      text: (translated || comment.textPlain).slice(0, 900)
    };
  });

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
            max_tokens: 2200,
            messages: [
              {
                role: "system",
                content:
                  "你是中文技术媒体编辑。把 Hacker News 评论讨论改写成一篇克制、准确、便于快速阅读的中文文章。不要编造评论里没有的信息，不写政治军事扩展，不营销。HNRSS 不提供评论点赞数，所以不要写高赞、点赞最多等表述；只能说精选评论或评论观点。只返回 JSON。"
              },
              {
                role: "user",
                content: JSON.stringify({
                  schema:
                    "Return {\"title\":\"中文文章标题\",\"lead\":\"80字内导语\",\"sections\":[{\"heading\":\"小标题\",\"body\":\"120字内正文\"}],\"highlights\":[\"3-5条要点\"],\"commentQuotes\":[{\"author\":\"HN用户名\",\"point\":\"22字内核心观点\",\"quote\":\"45字内中文原意引用\"}],\"disagreements\":[\"0-3条分歧\"],\"takeaways\":[\"2-4条给开发者/产品人的启发\"]}",
                  rules: [
                    "commentQuotes 选 2-4 条，优先 bestCandidate=true 且观点具体、有经验或反驳价值的评论。",
                    "quote 必须来自评论原意，可以压缩改写成自然中文，但不能加入评论没有的信息。",
                    "point 是编辑提炼的核心观点，不要重复 quote 原句。",
                    "不要使用高赞、点赞最多、投票最高等无法从输入验证的词。"
                  ],
                  story: {
                    title: story.title,
                    titleZh: translation?.titleZh,
                    summaryZh: translation?.summaryZh,
                    points: story.points,
                    comments: story.comments,
                    domain: story.domain
                  },
                  comments: commentPayload
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
    const parsed = JSON.parse(extractJson(data.choices?.[0]?.message?.content || "")) as Partial<DiscussionArticle>;
    const article: DiscussionArticle = {
      storyId: story.id,
      status: "generated",
      title: String(parsed.title || translation?.titleZh || story.title).trim(),
      lead: String(parsed.lead || translation?.summaryZh || "").trim(),
      sections: Array.isArray(parsed.sections) ? parsed.sections.slice(0, 5) : [],
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 5).map(String) : [],
      commentQuotes: normalizeQuotes((parsed as { commentQuotes?: unknown }).commentQuotes),
      disagreements: Array.isArray(parsed.disagreements) ? parsed.disagreements.slice(0, 3).map(String) : [],
      takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways.slice(0, 4).map(String) : [],
      sourceCommentCount: comments.length,
      model: config.deepseekModel,
      updatedAt: new Date().toISOString(),
      signature
    };
    articleCache[story.id] = article;
    await saveArticleCache();
    return article;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown discussion article error";
    const article = fallbackArticle(story, translation, comments, "error", message);
    articleCache[story.id] = article;
    await saveArticleCache();
    return article;
  }
}
