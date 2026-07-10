import { config } from "../config.js";
import { topics } from "../topics.js";
import { generateDiscussionArticle } from "./discussion.js";
import { getComments, getStories, type Comment, type Story } from "./hnrss.js";
import { assessStoryRisk } from "./risk.js";
import {
  createRefreshDraft,
  getFeedSnapshot,
  publicSnapshotMeta,
  saveFeedSnapshot,
  type FeedSnapshot
} from "./snapshot.js";
import { preloadStoryTranslationCache, translateComments, translateStories } from "./translate.js";

const TOPIC_DELAY_MS = 3000;
const COMMENT_DELAY_MS = 3000;
const COMMENT_FETCH_RETRIES = 1;
const COMMENT_RETRY_DELAY_MS = 1200;
const PREFETCH_TOPIC_IDS = new Set(["frontpage", "active", "show", "launches"]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageForError(error: unknown, fallback = "Unknown") {
  return error instanceof Error ? error.message : fallback;
}

async function getCommentsWithRetry(storyId: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= COMMENT_FETCH_RETRIES; attempt++) {
    try {
      return await getComments(storyId);
    } catch (error) {
      lastError = error;
      if (attempt < COMMENT_FETCH_RETRIES) await sleep(COMMENT_RETRY_DELAY_MS);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unknown comments fetch error");
}

function preservePreviousComments(draft: FeedSnapshot, base: FeedSnapshot, storyId: string, message: string) {
  const previous = draft.comments[storyId] || base.comments[storyId];
  if (previous?.comments.length) {
    draft.comments[storyId] = {
      ...previous,
      status: "partial",
      error: message
    };
    return previous.comments.length;
  }

  draft.comments[storyId] = {
    status: "error",
    updatedAt: new Date().toISOString(),
    comments: [],
    translations: {},
    error: message
  };
  return 0;
}

function scoreStory(story: Story) {
  const points = story.points || 0;
  const comments = story.comments || 0;
  const ageHours = Math.max(1, (Date.now() - Date.parse(story.publishedAt || new Date().toISOString())) / 36e5);
  return points * 1.2 + comments * 2.4 - ageHours * 1.8;
}

function pickCommentCandidates(snapshot: FeedSnapshot) {
  const frontpageIds = snapshot.topics.frontpage?.storyIds || [];
  const preferred = frontpageIds
    .map((id) => snapshot.stories[id])
    .filter(Boolean)
    .slice(0, Math.ceil(config.commentPrefetchLimit * 0.7));
  const scored = Object.values(snapshot.stories)
    .filter((story) => (story.comments || 0) > 0)
    .sort((a, b) => scoreStory(b) - scoreStory(a));

  const seen = new Set<string>();
  const candidates: Story[] = [];
  for (const story of [...preferred, ...scored]) {
    if (!story || seen.has(story.id)) continue;
    seen.add(story.id);
    candidates.push(story);
    if (candidates.length >= config.commentPrefetchLimit) break;
  }
  return candidates;
}

function getPrefetchTopics() {
  return topics.filter((topic) => PREFETCH_TOPIC_IDS.has(topic.id));
}

let runningPromise: Promise<FeedSnapshot> | null = null;
let lastRefresh: {
  startedAt: string | null;
  finishedAt: string | null;
  reason: string | null;
  status: "idle" | "running" | "ready" | "error";
  error?: string;
} = {
  startedAt: null,
  finishedAt: null,
  reason: null,
  status: "idle"
};

export function getPrefetchStatus(snapshot: FeedSnapshot) {
  return {
    worker: lastRefresh,
    snapshot: publicSnapshotMeta(snapshot),
    intervalMs: config.refreshIntervalMs,
    storyPrefetchLimit: config.storyPrefetchLimit,
    commentPrefetchLimit: config.commentPrefetchLimit,
    commentsPerStory: config.commentsPerStory
  };
}

export async function refreshFeedSnapshot(reason = "scheduled") {
  if (runningPromise) return runningPromise;

  runningPromise = (async () => {
    const base = await getFeedSnapshot();
    const draft = createRefreshDraft(base, reason);
    const started = Date.now();
    lastRefresh = {
      startedAt: draft.startedAt,
      finishedAt: null,
      reason,
      status: "running"
    };
    await saveFeedSnapshot(draft);

    const prefetchTopics = getPrefetchTopics();
    for (let i = 0; i < prefetchTopics.length; i++) {
      const topic = prefetchTopics[i];
      try {
        const fetched = await getStories({ topic: topic.id, limit: config.storyPrefetchLimit });
        const publicStories: Story[] = [];
        let filteredCount = 0;

        for (const story of fetched) {
          const risk = assessStoryRisk(story);
          if (risk.blocked) {
            draft.filters[story.id] = risk;
            filteredCount += 1;
            continue;
          }
          publicStories.push(story);
          draft.stories[story.id] = story;
        }

        const translations = await translateStories(publicStories);
        Object.assign(draft.translations, translations);
        draft.topics[topic.id] = {
          topicId: topic.id,
          updatedAt: new Date().toISOString(),
          storyIds: publicStories.map((story) => story.id),
          fetchedCount: fetched.length,
          filteredCount
        };
        console.log(`[prefetch] topic=${topic.id} stories=${publicStories.length} filtered=${filteredCount}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown";
        draft.errors.push(`${topic.id}: ${message}`);
        const previousTopic = draft.topics[topic.id] || base.topics[topic.id];
        draft.topics[topic.id] = previousTopic
          ? { ...previousTopic, error: message }
          : {
              topicId: topic.id,
              updatedAt: new Date().toISOString(),
              storyIds: [],
              fetchedCount: 0,
              filteredCount: 0,
              error: message
            };
        console.warn(`[prefetch] topic=${topic.id} error: ${message}`);
      }

      await saveFeedSnapshot(draft);
      if (i < prefetchTopics.length - 1) await sleep(TOPIC_DELAY_MS);
    }

    draft.status = draft.errors.length && !Object.keys(draft.stories).length ? "error" : "ready";
    draft.generatedAt = new Date().toISOString();
    draft.durationMs = Date.now() - started;
    await saveFeedSnapshot(draft);

    const candidates = pickCommentCandidates(draft);
    for (let i = 0; i < candidates.length; i++) {
      const story = candidates[i];
      const commentTargetId = story.hnId || story.id;
      let comments: Comment[];
      try {
        comments = (await getCommentsWithRetry(commentTargetId)).slice(0, config.commentsPerStory);
      } catch (error) {
        const message = messageForError(error);
        const preservedCount = preservePreviousComments(draft, base, story.id, message);
        draft.errors.push(`comments:${story.id}: ${message}`);
        console.warn(`[prefetch] comments story=${story.id} error: ${message}${preservedCount ? ` preserved=${preservedCount}` : ""}`);
        await saveFeedSnapshot(draft);
        if (i < candidates.length - 1) await sleep(COMMENT_DELAY_MS);
        continue;
      }

      let translations = draft.comments[story.id]?.translations || {};
      let status: "ready" | "empty" | "partial" = comments.length ? "ready" : "empty";
      let commentError: string | undefined;

      if (comments.length) {
        try {
          translations = await translateComments(comments, story.id);
        } catch (error) {
          const message = messageForError(error, "Unknown comments translation error");
          status = "partial";
          commentError = `评论翻译失败: ${message}`;
          draft.errors.push(`commentTranslations:${story.id}: ${message}`);
          console.warn(`[prefetch] comment translations story=${story.id} error: ${message}`);
        }
      }

      draft.comments[story.id] = {
        status,
        updatedAt: new Date().toISOString(),
        comments,
        translations,
        ...(commentError ? { error: commentError } : {})
      };

      try {
        draft.articles[story.id] = await generateDiscussionArticle(story, draft.translations[story.id], comments, translations);
      } catch (error) {
        const message = messageForError(error, "Unknown discussion article error");
        const previousArticle = draft.articles[story.id] || base.articles[story.id];
        if (previousArticle) draft.articles[story.id] = previousArticle;
        draft.errors.push(`discussion:${story.id}: ${message}`);
        console.warn(`[prefetch] discussion story=${story.id} error: ${message}`);
      }

      console.log(`[prefetch] comments story=${story.id} comments=${comments.length} article=${draft.articles[story.id]?.status || "none"}`);
      await saveFeedSnapshot(draft);
      if (i < candidates.length - 1) await sleep(COMMENT_DELAY_MS);
    }

    draft.durationMs = Date.now() - started;
    await saveFeedSnapshot(draft);
    lastRefresh = {
      startedAt: draft.startedAt,
      finishedAt: draft.generatedAt,
      reason,
      status: draft.status === "error" ? "error" : "ready",
      error: draft.errors[0]
    };
    console.log(`[prefetch] snapshot done stories=${Object.keys(draft.stories).length} comments=${Object.keys(draft.comments).length} duration=${(draft.durationMs / 1000).toFixed(1)}s`);
    return draft;
  })().finally(() => {
    runningPromise = null;
  });

  return runningPromise;
}

export function startPrefetchLoop() {
  preloadStoryTranslationCache().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown";
    console.warn(`[prefetch] translation cache preload error: ${message}`);
  });

  setTimeout(() => {
    refreshFeedSnapshot("startup").catch(() => {});
    setInterval(() => {
      refreshFeedSnapshot("scheduled").catch(() => {});
    }, config.refreshIntervalMs);
  }, config.refreshStartupDelayMs);
  console.log(`[prefetch] scheduled, interval=${config.refreshIntervalMs / 1000}s`);
}
