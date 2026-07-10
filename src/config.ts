import path from "node:path";

export const config = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://127.0.0.1:3000",
  hnrssBaseUrl: process.env.HNRSS_BASE_URL || "https://hnrss.org",
  hnApiBaseUrl: (process.env.HN_API_BASE_URL || "https://hacker-news.firebaseio.com/v0").replace(/\/+$/, ""),
  hnApiTimeoutMs: Number(process.env.HN_API_TIMEOUT_MS || 10_000),
  cacheTtlMs: Number(process.env.HN_CACHE_TTL_MS || 5 * 60 * 1000),
  refreshIntervalMs: Number(process.env.HN_REFRESH_INTERVAL_MS || 60 * 60 * 1000),
  refreshStartupDelayMs: Number(process.env.HN_REFRESH_STARTUP_DELAY_MS || 1_000),
  storyPrefetchLimit: Number(process.env.HN_STORY_PREFETCH_LIMIT || 30),
  commentPrefetchLimit: Number(process.env.HN_COMMENT_PREFETCH_LIMIT || 12),
  commentsPerStory: Number(process.env.HN_COMMENTS_PER_STORY || 24),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, ""),
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
  deepseekTimeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS || 50_000),
  umamiWebsiteId: process.env.UMAMI_WEBSITE_ID || "",
  nodeEnv: process.env.NODE_ENV || "development",
  dataDir: path.resolve(process.env.DATA_DIR || ".data")
};

export function isTranslationEnabled() {
  return Boolean(config.deepseekApiKey);
}
