const baseUrl = process.env.SMOKE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

async function check(path, predicate) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  const data = await response.json();
  if (predicate && !predicate(data)) throw new Error(`${path} returned unexpected shape`);
  console.log(`ok ${path}`);
  return data;
}

async function waitForSnapshot() {
  const started = Date.now();
  let lastStatus = "";
  while (Date.now() - started < 180_000) {
    const response = await fetch(`${baseUrl}/api/status`);
    if (response.ok) {
      const data = await response.json();
      lastStatus = data.snapshot?.status || "unknown";
      if (data.snapshot?.ready) return data;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error(`/api/status snapshot not ready, last status=${lastStatus}`);
}

await check("/api/health", (data) => data.ok === true && data.translation?.model);
await waitForSnapshot();
await check("/api/status", (data) => data.ok === true && data.snapshot?.ready === true);
await check(
  "/api/topics",
  (data) => Array.isArray(data.topics) && data.topics.some((topic) => topic.id === "frontpage")
);
await check(
  "/api/insights",
  (data) => data.ok === true && Array.isArray(data.insights?.rising) && Array.isArray(data.insights?.productRadar) && !("brief" in data.insights)
);
await check(
  "/api/stories?topic=frontpage&limit=3",
  (data) => Array.isArray(data.stories) && data.stories.length > 0 && data.translation?.mode === "snapshot" && data.discussions
);
const feed = await check("/api/stories?topic=frontpage&limit=8", (data) => Array.isArray(data.stories) && data.stories.length > 0);
const firstWithComments = feed.stories.find((story) => (story.comments || 0) > 0) || feed.stories[0];
await check(
  `/api/stories/${encodeURIComponent(firstWithComments.hnId || firstWithComments.id)}/comments`,
  (data) => Array.isArray(data.comments) && Array.isArray(data.bestComments) && typeof data.commentsStatus === "string" && data.translation?.mode === "snapshot"
);
await check("/api/openapi.json", (data) => data.openapi && data.paths?.["/api/stories"]);
