import { config } from "./config.js";

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "乔木 HN 速读 API",
      version: "0.5.2",
      description: "面向中文 Hacker News 速读网站和未来 iOS App 的公共 API。"
    },
    servers: [{ url: config.publicBaseUrl }],
    paths: {
      "/api/health": {
        get: {
          summary: "服务健康检查",
          responses: { "200": { description: "OK" } }
        }
      },
      "/api/status": {
        get: {
          summary: "后台快照与刷新状态",
          responses: { "200": { description: "Worker and snapshot status" } }
        }
      },
      "/api/topics": {
        get: {
          summary: "获取内置主题",
          responses: { "200": { description: "Topic list" } }
        }
      },
      "/api/insights": {
        get: {
          summary: "读取首页升温榜和产品雷达",
          responses: { "200": { description: "Home insight sections from snapshot" } }
        }
      },
      "/api/stories": {
        get: {
          summary: "从本地快照读取单个主题或自定义搜索的 HN 条目",
          parameters: [
            { name: "topic", in: "query", schema: { type: "string" } },
            { name: "feed", in: "query", schema: { type: "string" } },
            { name: "query", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "pointsSort", in: "query", schema: { type: "string", enum: ["desc", "asc"] }, description: "按 HN points 排序；desc 为高到低，asc 为低到高。" },
            { name: "minPoints", in: "query", schema: { type: "integer" } },
            { name: "minComments", in: "query", schema: { type: "integer" } },
            { name: "translate", in: "query", schema: { type: "boolean" }, description: "兼容参数；当前推荐使用快照翻译" }
          ],
          responses: { "200": { description: "Story list" } }
        }
      },
      "/api/stories/{id}/comments": {
        get: {
          summary: "从快照读取某条帖子的评论、评论译文和讨论速读文章",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Hacker News item id" }
          ],
          responses: { "200": { description: "Cached comment list with translations and article" } }
        }
      },
      "/api/stories/{id}": {
        get: {
          summary: "从快照读取帖子详情、讨论文章和已缓存评论",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Hacker News item id" }
          ],
          responses: { "200": { description: "Story detail from snapshot" } }
        }
      },
      "/api/stories/merge": {
        post: {
          summary: "合并多个订阅主题",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    topics: { type: "array", items: { type: "string" } },
                    limitPerTopic: { type: "integer", minimum: 1, maximum: 50 },
                    translate: { type: "boolean" }
                  }
                }
              }
            }
          },
          responses: { "200": { description: "Merged story list" } }
        }
      },
      "/api/translate": {
        post: {
          summary: "翻译传入 story 列表",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    force: { type: "boolean" },
                    stories: { type: "array", items: { type: "object" } }
                  }
                }
              }
            }
          },
          responses: { "200": { description: "Translation map" } }
        }
      }
    }
  };
}
