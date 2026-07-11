import assert from "node:assert/strict";
import { createServer } from "node:http";

const items = {
  101: { id: 101, type: "story", by: "alice", time: 1_720_000_000, title: "Top fallback story", url: "https://example.com/top", score: 88, descendants: 14 },
  201: { id: 201, type: "story", by: "bob", time: 1_720_000_100, title: "Show HN: Fallback demo", url: "https://example.com/show", score: 42, descendants: 8 },
  301: { id: 301, type: "story", by: "carol", time: 1_720_000_200, title: "Launch HN: Useful product", url: "https://example.com/launch", score: 21, descendants: 5 },
  302: { id: 302, type: "story", by: "dave", time: 1_720_000_300, title: "Ordinary new story", url: "https://example.com/new", score: 20, descendants: 4 }
};

const server = createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  response.setHeader("content-type", "application/json");

  if (pathname.startsWith("/hnrss/")) {
    response.statusCode = 429;
    response.end(JSON.stringify({ error: "rate_limited" }));
    return;
  }
  if (pathname === "/v0/topstories.json") {
    response.end(JSON.stringify([101]));
    return;
  }
  if (pathname === "/v0/showstories.json") {
    response.end(JSON.stringify([201]));
    return;
  }
  if (pathname === "/v0/newstories.json") {
    response.end(JSON.stringify([302, 301]));
    return;
  }
  const itemMatch = pathname.match(/^\/v0\/item\/(\d+)\.json$/);
  if (itemMatch) {
    response.end(JSON.stringify(items[Number(itemMatch[1])] || null));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not_found" }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("test server did not bind");

process.env.HNRSS_BASE_URL = `http://127.0.0.1:${address.port}/hnrss`;
process.env.HN_API_BASE_URL = `http://127.0.0.1:${address.port}/v0`;
process.env.HN_HNRSS_RETRIES = "0";
process.env.HN_CACHE_TTL_MS = "1";

try {
  const { getStories } = await import("../dist/services/hnrss.js");
  const frontpage = await getStories({ topic: "frontpage", limit: 1 });
  assert.equal(frontpage[0]?.title, "Top fallback story");
  assert.equal(frontpage[0]?.sourceFeed, "hn-api:topstories");
  assert.equal(frontpage[0]?.points, 88);

  const show = await getStories({ topic: "show", limit: 1 });
  assert.equal(show[0]?.sourceFeed, "hn-api:showstories");

  const launches = await getStories({ topic: "launches", limit: 5 });
  assert.deepEqual(launches.map((story) => story.id), ["301"]);
  assert.equal(launches[0]?.sourceFeed, "hn-api:newstories");

  console.log("feed fallback regression checks passed");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
