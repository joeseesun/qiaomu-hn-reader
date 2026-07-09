import { getTopic } from "../topics.js";
import type { Story } from "./hnrss.js";
import type { FeedSnapshot } from "./snapshot.js";
import type { Translation } from "./translate.js";

export type InsightStory = {
  id: string;
  hnId: string | null;
  title: string;
  titleZh: string;
  summaryZh: string;
  url: string;
  domain: string;
  points: number | null;
  comments: number | null;
  publishedAt: string | null;
  reason: string;
  score: number;
};

export type HomeInsights = {
  generatedAt: string | null;
  rising: InsightStory[];
  productRadar: InsightStory[];
};

const PRODUCT_TITLE_RE = /\b(show hn|launch hn|yc\s+[sw]\d{2}|api|sdk|agent|browser|editor|database|devtool|developer|open source|github|tool|app)\b/i;

function uniqueStories(stories: Story[]) {
  const seen = new Set<string>();
  const result: Story[] = [];
  for (const story of stories) {
    if (seen.has(story.id)) continue;
    seen.add(story.id);
    result.push(story);
  }
  return result;
}

function topicStories(snapshot: FeedSnapshot, topicId: string) {
  return (snapshot.topics[topicId]?.storyIds || []).map((id) => snapshot.stories[id]).filter(Boolean);
}

function allVisibleStories(snapshot: FeedSnapshot) {
  return uniqueStories(Object.values(snapshot.topics).flatMap((topic) => topic.storyIds.map((id) => snapshot.stories[id]).filter(Boolean)));
}

function ageHours(story: Story) {
  const published = Date.parse(story.publishedAt || "");
  if (!Number.isFinite(published)) return 24;
  return Math.max(1, (Date.now() - published) / 36e5);
}

function heatScore(story: Story) {
  return (story.points || 0) * 1.15 + (story.comments || 0) * 2.4 - ageHours(story) * 1.6;
}

function productScore(story: Story) {
  const launchBoost = story.sourceFeed === "launches" || /^launch hn/i.test(story.title) ? 55 : 0;
  const showBoost = story.sourceFeed === "show" || /^show hn/i.test(story.title) ? 45 : 0;
  return heatScore(story) + launchBoost + showBoost;
}

function translationFor(snapshot: FeedSnapshot, story: Story): Translation | undefined {
  return snapshot.translations[story.id];
}

function reasonFor(story: Story, kind: "rising" | "product") {
  if (kind === "product") {
    if (/^launch hn/i.test(story.title) || story.sourceFeed === "launches") return "新产品发布";
    if (/^show hn/i.test(story.title) || story.sourceFeed === "show") return "开发者作品";
    return story.domain;
  }
  const comments = story.comments || 0;
  if (comments >= 40) return `${comments} 条讨论正在升温`;
  return `${story.points || 0} points · ${comments} 评论`;
}

function toInsightStory(snapshot: FeedSnapshot, story: Story, kind: "rising" | "product"): InsightStory {
  const translation = translationFor(snapshot, story);
  const score = kind === "product" ? productScore(story) : heatScore(story);
  return {
    id: story.id,
    hnId: story.hnId,
    title: story.title,
    titleZh: translation?.titleZh || "",
    summaryZh: translation?.summaryZh || "",
    url: story.url,
    domain: story.domain,
    points: story.points,
    comments: story.comments,
    publishedAt: story.publishedAt,
    reason: reasonFor(story, kind),
    score: Math.round(score)
  };
}

function productStories(snapshot: FeedSnapshot) {
  const fromProductFeeds = uniqueStories([...topicStories(snapshot, "show"), ...topicStories(snapshot, "launches")]);
  const fromCurrent = allVisibleStories(snapshot).filter((story) => PRODUCT_TITLE_RE.test(story.title));
  return uniqueStories([...fromProductFeeds, ...fromCurrent]);
}

export function buildHomeInsights(snapshot: FeedSnapshot): HomeInsights {
  const frontpage = topicStories(snapshot, "frontpage");
  const active = topicStories(snapshot, "active");
  const all = uniqueStories([...frontpage, ...active, ...allVisibleStories(snapshot)]);

  const rising = all
    .filter((story) => (story.comments || 0) > 0 || (story.points || 0) > 0)
    .sort((a, b) => heatScore(b) - heatScore(a))
    .slice(0, 5)
    .map((story) => toInsightStory(snapshot, story, "rising"));

  const productRadar = productStories(snapshot)
    .sort((a, b) => productScore(b) - productScore(a))
    .slice(0, 5)
    .map((story) => toInsightStory(snapshot, story, "product"));

  return {
    generatedAt: snapshot.generatedAt,
    rising,
    productRadar
  };
}
