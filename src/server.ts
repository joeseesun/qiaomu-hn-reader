import fs from "node:fs/promises";
import path from "node:path";
import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config, isTranslationEnabled } from "./config.js";
import { openApiDocument } from "./openapi.js";
import { selectBestComments } from "./services/comments.js";
import type { Story } from "./services/hnrss.js";
import { buildHomeInsights } from "./services/insights.js";
import { getPrefetchStatus, startPrefetchLoop } from "./services/prefetch.js";
import { findSnapshotStory, getFeedSnapshot, publicSnapshotMeta, selectSnapshotStories } from "./services/snapshot.js";
import { translateStories } from "./services/translate.js";
import { topics } from "./topics.js";

const app = express();
const publicDir = path.resolve("public");
const appVersion = "0.7.0";

app.disable("x-powered-by");
app.use(compression());
app.use(cors({ origin: true }));
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);
app.use(express.json({ limit: "1mb" }));

function parseNumber(value: unknown) {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(value: unknown) {
  return value === "1" || value === "true" || value === true;
}

function parsePointsSort(value: unknown) {
  return value === "asc" || value === "desc" ? value : undefined;
}

function publicUrl(pathname = "/") {
  return new URL(pathname, config.publicBaseUrl.endsWith("/") ? config.publicBaseUrl : `${config.publicBaseUrl}/`).toString();
}

function escapeJsonForHtml(value: unknown) {
  return JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

async function buildInitialData() {
  const snapshot = await getFeedSnapshot();
  const home = selectSnapshotStories(snapshot, {
    topic: "frontpage",
    pointsSort: "desc",
    limit: 30
  });
  const insights = buildHomeInsights(snapshot);
  const insightStories = [...insights.rising, ...insights.productRadar]
    .map((item) => snapshot.stories[item.id])
    .filter((story): story is Story => Boolean(story));

  return {
    version: appVersion,
    generatedAt: new Date().toISOString(),
    home: {
      stories: home.stories,
      translations: home.translations,
      discussions: discussionMetaForStories(snapshot, home.stories),
      freshness: publicSnapshotMeta(snapshot)
    },
    insights,
    insightDiscussions: discussionMetaForStories(snapshot, insightStories)
  };
}

async function renderHtml(fileName: string, options: { initialData?: unknown } = {}) {
  const html = await fs.readFile(path.join(publicDir, fileName), "utf8");
  const umamiScript = config.umamiWebsiteId
    ? `<script defer src="https://umami.qiaomu.ai/script.js" data-website-id="${config.umamiWebsiteId}" data-domains="hn.qiaomu.ai"></script>`
    : "";
  const initialData = options.initialData
    ? `<script id="__HN_INITIAL_DATA__" type="application/json">${escapeJsonForHtml(options.initialData)}</script>`
    : "";
  return html
    .replaceAll("%PUBLIC_BASE_URL%", config.publicBaseUrl)
    .replaceAll("%UMAMI_SCRIPT%", umamiScript)
    .replaceAll("%INITIAL_DATA%", initialData)
    .replaceAll("%APP_VERSION%", appVersion);
}

app.get("/", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=3600");
    res.type("html").send(await renderHtml("index.html", { initialData: await buildInitialData() }));
  } catch (error) {
    next(error);
  }
});

app.get("/api-docs", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    res.type("html").send(await renderHtml("api.html"));
  } catch (error) {
    next(error);
  }
});

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send([
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    `Sitemap: ${publicUrl("/sitemap.xml")}`,
    ""
  ].join("\n"));
});

app.get("/sitemap.xml", (_req, res) => {
  const updatedAt = new Date().toISOString();
  const urls = [
    { loc: publicUrl("/"), priority: "1.0", changefreq: "hourly" },
    { loc: publicUrl("/api-docs"), priority: "0.4", changefreq: "weekly" }
  ];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((item) => `  <url>
    <loc>${item.loc}</loc>
    <lastmod>${updatedAt}</lastmod>
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`).join("\n")}
</urlset>
`);
});

app.use(express.static(publicDir, { index: false, maxAge: config.nodeEnv === "production" ? "1h" : 0 }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "hn-qiaomu",
    version: appVersion,
    time: new Date().toISOString(),
    translation: {
      enabled: isTranslationEnabled(),
      model: config.deepseekModel
    }
  });
});

app.get("/api/status", async (_req, res, next) => {
  try {
    const snapshot = await getFeedSnapshot();
    res.json({
      ok: true,
      service: "hn-qiaomu",
      time: new Date().toISOString(),
      ...getPrefetchStatus(snapshot)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/config", (_req, res) => {
  res.json({
    publicBaseUrl: config.publicBaseUrl,
    translation: {
      enabled: isTranslationEnabled(),
      model: config.deepseekModel
    },
    defaults: {
      limit: 30,
      cacheTtlMs: config.cacheTtlMs
    }
  });
});

app.get("/api/topics", (_req, res) => {
  res.json({ topics });
});

function discussionMetaForStories(snapshot: Awaited<ReturnType<typeof getFeedSnapshot>>, stories: Story[]) {
  const result: Record<string, unknown> = {};
  for (const story of stories) {
    const article = snapshot.articles[story.id] || null;
    const comments = snapshot.comments[story.id];
    const articleReady = Boolean(article && (article.status === "generated" || article.status === "cached") && (article.lead || article.highlights?.length));
    result[story.id] = {
      articleStatus: article?.status || "preparing",
      articleReady,
      commentsStatus: comments?.status || "preparing",
      commentsCount: comments?.comments.length || 0,
      bestCount: comments ? selectBestComments(comments.comments, comments.translations).length : 0
    };
  }
  return result;
}

app.get("/api/insights", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=3600");
    const snapshot = await getFeedSnapshot();
    const insights = buildHomeInsights(snapshot);
    const stories = [...insights.rising, ...insights.productRadar]
      .map((item) => snapshot.stories[item.id])
      .filter((story): story is Story => Boolean(story));
    res.json({
      ok: true,
      insights,
      discussions: discussionMetaForStories(snapshot, stories),
      freshness: publicSnapshotMeta(snapshot)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/stories", async (req, res, next) => {
  try {
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=3600");
    const snapshot = await getFeedSnapshot();
    const result = selectSnapshotStories(snapshot, {
      topic: String(req.query.topic || "frontpage"),
      feed: req.query.feed ? String(req.query.feed) : undefined,
      query: req.query.query ? String(req.query.query) : undefined,
      minPoints: parseNumber(req.query.minPoints),
      minComments: parseNumber(req.query.minComments),
      pointsSort: parsePointsSort(req.query.pointsSort),
      limit: parseNumber(req.query.limit)
    });
    res.json({
      stories: result.stories,
      translations: result.translations,
      discussions: discussionMetaForStories(snapshot, result.stories),
      translation: {
        enabled: isTranslationEnabled(),
        requested: true,
        mode: "snapshot",
        model: config.deepseekModel,
        pending: 0
      },
      freshness: publicSnapshotMeta(result.snapshot)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/stories/:id/comments", async (req, res, next) => {
  try {
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    const snapshot = await getFeedSnapshot();
    const story = findSnapshotStory(snapshot, req.params.id);
    if (!story) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const comments = snapshot.comments[story.id];
    const bestComments = comments ? selectBestComments(comments.comments, comments.translations) : [];
    res.json({
      story,
      comments: comments?.comments || [],
      translations: comments?.translations || {},
      bestComments,
      article: snapshot.articles[story.id] || null,
      commentsStatus: comments?.status || "preparing",
      translation: {
        enabled: isTranslationEnabled(),
        requested: true,
        mode: "snapshot",
        model: config.deepseekModel
      },
      freshness: publicSnapshotMeta(snapshot)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/stories/:id", async (req, res, next) => {
  try {
    const snapshot = await getFeedSnapshot();
    const story = findSnapshotStory(snapshot, req.params.id);
    if (!story) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const comments = snapshot.comments[story.id];
    const bestComments = comments ? selectBestComments(comments.comments, comments.translations) : [];
    res.json({
      story,
      translation: snapshot.translations[story.id] || null,
      comments: comments?.comments || [],
      commentTranslations: comments?.translations || {},
      bestComments,
      article: snapshot.articles[story.id] || null,
      commentsStatus: comments?.status || "preparing",
      freshness: publicSnapshotMeta(snapshot)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/stories/merge", async (req, res, next) => {
  try {
    const body = req.body as { topics?: unknown; limitPerTopic?: unknown; translate?: unknown };
    const topicIds = Array.isArray(body.topics) ? body.topics.map(String) : [];
    const snapshot = await getFeedSnapshot();
    const usableTopicIds = topicIds.length ? topicIds : topics.slice(0, 3).map((topic) => topic.id);
    const limitPerTopic = Math.min(50, Number(body.limitPerTopic || 20));
    const seen = new Set<string>();
    const stories = usableTopicIds
      .flatMap((topicId) => (snapshot.topics[topicId]?.storyIds || []).slice(0, limitPerTopic))
      .map((id) => snapshot.stories[id])
      .filter((story): story is Story => Boolean(story))
      .filter((story) => {
        if (seen.has(story.id)) return false;
        seen.add(story.id);
        return true;
      })
      .sort((a, b) => Date.parse(b.publishedAt || "0") - Date.parse(a.publishedAt || "0"));
    const translations: Record<string, unknown> = {};
    for (const story of stories) {
      if (snapshot.translations[story.id]) translations[story.id] = snapshot.translations[story.id];
    }
    res.json({
      stories,
      translations,
      translation: {
        enabled: isTranslationEnabled(),
        requested: parseBoolean(body.translate),
        mode: "snapshot",
        model: config.deepseekModel
      },
      freshness: publicSnapshotMeta(snapshot)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/translate", async (req, res, next) => {
  try {
    const body = req.body as { stories?: Story[]; force?: boolean };
    const stories = Array.isArray(body.stories) ? body.stories.slice(0, 40) : [];
    const translations = await translateStories(stories, Boolean(body.force));
    res.json({
      translations,
      translation: {
        enabled: isTranslationEnabled(),
        requested: true,
        model: config.deepseekModel
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/openapi.json", (_req, res) => {
  res.json(openApiDocument());
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(500).json({ error: "internal_error", message });
});

app.listen(config.port, config.host, () => {
  console.log(`hn-qiaomu listening on ${config.host}:${config.port}`);
  startPrefetchLoop();
});
