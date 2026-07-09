export type Topic = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  feed: string;
  query?: string;
  minPoints?: number;
  minComments?: number;
  accent: string;
};

export const topics: Topic[] = [
  {
    id: "frontpage",
    label: "首页精选",
    shortLabel: "首页",
    description: "Hacker News front page",
    feed: "frontpage",
    accent: "#d4661a"
  },
  {
    id: "active",
    label: "热议讨论",
    shortLabel: "热议",
    description: "正在快速增长的讨论串",
    feed: "active",
    accent: "#2f6f5e"
  },
  {
    id: "show",
    label: "产品作品",
    shortLabel: "Show",
    description: "Show HN 开发者作品",
    feed: "show",
    minPoints: 10,
    accent: "#7c3aed"
  },
  {
    id: "launches",
    label: "Launch HN",
    shortLabel: "Launch",
    description: "YC 生态新产品发布",
    feed: "launches",
    accent: "#0f766e"
  },
  {
    id: "claude",
    label: "Claude",
    shortLabel: "Claude",
    description: "Claude、Anthropic 与相关生态",
    feed: "newest",
    query: "Claude OR Anthropic",
    accent: "#c2410c"
  },
  {
    id: "gpt",
    label: "GPT",
    shortLabel: "GPT",
    description: "GPT、OpenAI 与大语言模型",
    feed: "newest",
    query: "GPT OR OpenAI OR ChatGPT OR LLM",
    accent: "#2563eb"
  },
  {
    id: "skill",
    label: "Skill",
    shortLabel: "Skill",
    description: "Agent Skills、MCP 与工具生态",
    feed: "newest",
    query: "\"Claude Skills\" OR \"Agent Skill\" OR MCP OR tooling",
    accent: "#0f766e"
  }
];

export function getTopic(id: string) {
  return topics.find((topic) => topic.id === id);
}
