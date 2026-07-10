import assert from "node:assert/strict";

process.env.HN_COMMENT_PREFETCH_LIMIT = "12";

const { pickCommentCandidates } = await import("../dist/services/prefetch.js");

function story(id, points, comments = 20, publishedAt = "2026-07-10T00:00:00.000Z") {
  return {
    id,
    hnId: id,
    title: id,
    url: `https://example.com/${id}`,
    domain: "example.com",
    points,
    comments,
    publishedAt
  };
}

function readyComments() {
  return {
    status: "ready",
    updatedAt: "2026-07-10T00:00:00.000Z",
    comments: [{ id: "comment", author: "tester", textHtml: "ok", textPlain: "ok" }],
    translations: {}
  };
}

function readyArticle(id) {
  return {
    storyId: id,
    status: "generated",
    title: id,
    lead: "ready",
    sections: [],
    highlights: ["ready"],
    commentQuotes: [],
    disagreements: [],
    takeaways: [],
    sourceCommentCount: 1,
    model: "test",
    updatedAt: "2026-07-10T00:00:00.000Z",
    signature: id
  };
}

const rawFrontpage = Array.from({ length: 14 }, (_, index) => story(`recent-${index}`, 40 - index));
const hotStory = story("hot-visible-story", 407, 104, "2026-07-09T08:05:04.000Z");
rawFrontpage.push(hotStory);

const stories = Object.fromEntries(rawFrontpage.map((item) => [item.id, item]));
stories["cached-high-score"] = story("cached-high-score", 1000, 400);
stories["missing-discussion"] = story("missing-discussion", 55, 30);

const comments = {};
const articles = {};
for (const item of [...rawFrontpage, stories["cached-high-score"]]) {
  comments[item.id] = readyComments();
  articles[item.id] = readyArticle(item.id);
}

const snapshot = {
  version: 1,
  generatedAt: null,
  startedAt: null,
  durationMs: null,
  status: "ready",
  errors: [],
  topics: {
    frontpage: {
      topicId: "frontpage",
      updatedAt: "2026-07-10T00:00:00.000Z",
      storyIds: rawFrontpage.map((item) => item.id),
      fetchedCount: rawFrontpage.length,
      filteredCount: 0
    }
  },
  stories,
  translations: {},
  comments,
  articles,
  filters: {}
};

const candidates = pickCommentCandidates(snapshot);
const candidateIds = candidates.map((item) => item.id);

assert.equal(candidates.length, 12);
assert.equal(candidateIds[0], hotStory.id, "homepage candidates should follow the public points order");
assert.ok(candidateIds.includes(hotStory.id), "a hot story must not be skipped because the RSS order is newer-first");
assert.ok(candidateIds.includes("missing-discussion"), "unused slots should catch up missing discussion content");

console.log("prefetch priority regression checks passed");
