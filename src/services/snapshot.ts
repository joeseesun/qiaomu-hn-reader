import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { getTopic, topics } from "../topics.js";
import type { Comment, Story, StoryQuery } from "./hnrss.js";
import type { DiscussionArticle } from "./discussion.js";
import type { CommentTranslation, Translation } from "./translate.js";
import type { RiskAssessment } from "./risk.js";

export type CommentSnapshot = {
  status: "ready" | "empty" | "partial" | "error";
  updatedAt: string;
  comments: Comment[];
  translations: Record<string, CommentTranslation>;
  error?: string;
};

export type TopicSnapshot = {
  topicId: string;
  updatedAt: string;
  storyIds: string[];
  fetchedCount: number;
  filteredCount: number;
  error?: string;
};

export type FeedSnapshot = {
  version: 1;
  generatedAt: string | null;
  startedAt: string | null;
  durationMs: number | null;
  status: "empty" | "refreshing" | "ready" | "error";
  refreshReason?: string;
  errors: string[];
  topics: Record<string, TopicSnapshot>;
  stories: Record<string, Story>;
  translations: Record<string, Translation>;
  comments: Record<string, CommentSnapshot>;
  articles: Record<string, DiscussionArticle>;
  filters: Record<string, RiskAssessment>;
};

export type SnapshotStoriesResult = {
  snapshot: FeedSnapshot;
  stories: Story[];
  translations: Record<string, Translation>;
};

const snapshotFile = path.join(config.dataDir, "feed-snapshot.json");

let snapshotLoaded = false;
let snapshotLoadPromise: Promise<void> | null = null;
let currentSnapshot: FeedSnapshot = emptySnapshot();

function emptySnapshot(): FeedSnapshot {
  return {
    version: 1,
    generatedAt: null,
    startedAt: null,
    durationMs: null,
    status: "empty",
    errors: [],
    topics: {},
    stories: {},
    translations: {},
    comments: {},
    articles: {},
    filters: {}
  };
}

function clampLimit(value: unknown, fallback = 30) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
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

function copySnapshot(snapshot: FeedSnapshot): FeedSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as FeedSnapshot;
}

async function loadSnapshot() {
  if (snapshotLoaded) return;
  if (!snapshotLoadPromise) {
    snapshotLoadPromise = (async () => {
      try {
        const raw = await fs.readFile(snapshotFile, "utf8");
        currentSnapshot = { ...emptySnapshot(), ...(JSON.parse(raw) as FeedSnapshot), version: 1 };
      } catch {
        currentSnapshot = emptySnapshot();
      } finally {
        snapshotLoaded = true;
      }
    })();
  }
  await snapshotLoadPromise;
}

export async function getFeedSnapshot() {
  await loadSnapshot();
  return currentSnapshot;
}

export async function saveFeedSnapshot(snapshot: FeedSnapshot) {
  await fs.mkdir(config.dataDir, { recursive: true });
  currentSnapshot = snapshot;
  snapshotLoaded = true;
  await fs.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2));
}

export async function updateFeedSnapshot(mutator: (snapshot: FeedSnapshot) => FeedSnapshot | void) {
  await loadSnapshot();
  const draft = copySnapshot(currentSnapshot);
  const next = mutator(draft) || draft;
  await saveFeedSnapshot(next);
  return next;
}

export function createRefreshDraft(base: FeedSnapshot, reason: string): FeedSnapshot {
  const draft = emptySnapshot();
  draft.startedAt = new Date().toISOString();
  draft.status = "refreshing";
  draft.refreshReason = reason;
  draft.topics = { ...base.topics };
  draft.stories = { ...base.stories };
  draft.translations = { ...base.translations };
  draft.comments = { ...base.comments };
  draft.articles = { ...base.articles };
  draft.filters = { ...base.filters };
  return draft;
}

export function publicSnapshotMeta(snapshot: FeedSnapshot) {
  return {
    ready: snapshot.status === "ready",
    status: snapshot.status,
    generatedAt: snapshot.generatedAt,
    durationMs: snapshot.durationMs,
    errors: snapshot.errors.length
  };
}

export function findSnapshotStory(snapshot: FeedSnapshot, id: string) {
  return snapshot.stories[id] || Object.values(snapshot.stories).find((story) => story.hnId === id);
}

export function selectSnapshotStories(snapshot: FeedSnapshot, query: StoryQuery = {}): SnapshotStoriesResult {
  const limit = clampLimit(query.limit);
  const search = query.query?.trim().toLowerCase();
  let stories: Story[] = [];

  if (search) {
    stories = Object.values(snapshot.stories).filter((story) => {
      const translation = snapshot.translations[story.id];
      const haystack = `${story.title} ${translation?.titleZh || ""} ${translation?.summaryZh || ""} ${story.domain}`.toLowerCase();
      return haystack.includes(search);
    });
  } else {
    const topic = getTopic(query.topic || "") || topics[0];
    const topicSnapshot = snapshot.topics[topic.id];
    stories = topicSnapshot?.storyIds.map((id) => snapshot.stories[id]).filter(Boolean) || [];
  }

  stories = stories
    .filter((story) => {
      if (query.minPoints !== undefined && (story.points || 0) < query.minPoints) return false;
      if (query.minComments !== undefined && (story.comments || 0) < query.minComments) return false;
      return true;
    })
    .sort((a, b) => {
      if (query.pointsSort) return compareByPoints(a, b, query.pointsSort);
      if (!search) return 0;
      return compareByFreshness(a, b);
    })
    .slice(0, limit);

  const translations: Record<string, Translation> = {};
  for (const story of stories) {
    const translation = snapshot.translations[story.id];
    if (translation) translations[story.id] = translation;
  }

  return { snapshot, stories, translations };
}
