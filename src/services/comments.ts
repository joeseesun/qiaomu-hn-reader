import type { Comment } from "./hnrss.js";
import type { CommentTranslation } from "./translate.js";

export type BestComment = Comment & {
  score: number;
};

const REASONING_RE = /因为|所以|但是|不过|问题|经验|建议|取舍|权衡|风险|成本|实践|原因|对比|反例|性能|延迟|调试|维护|部署|however|because|trade-?off|experience|latency|debug|cost|risk|maintain|deploy|performance/i;
const LOW_SIGNAL_RE = /^\s*(thanks|thank you|哈哈|呵呵|lol|agree|same|\+1|this\.?|cool|nice)\b/i;
const SUBSTANTIVE_RE = /[。！？.!?]|因为|所以|但是|不过|如果|when|because|but|however|if/i;

function textForScore(comment: Comment, translations: Record<string, CommentTranslation>) {
  const translated = translations[comment.id]?.textZh;
  return (translated || comment.textPlain || "").trim();
}

function fallbackScore(text: string) {
  const length = text.length;
  if (length < 18) return 0;
  if (LOW_SIGNAL_RE.test(text) && length < 80) return 0;

  let score = Math.min(28, Math.floor(length / 22));
  if (REASONING_RE.test(text)) score += 8;
  if (SUBSTANTIVE_RE.test(text)) score += 4;
  if (/http|www\./i.test(text)) score += 3;
  if (length > 1200) score -= 6;
  if (LOW_SIGNAL_RE.test(text)) score -= 10;
  return Math.max(0, score);
}

function scoreComment(comment: Comment, translations: Record<string, CommentTranslation>) {
  const text = textForScore(comment, translations);
  const length = text.length;
  if (length < 18) return 0;

  let score = length >= 80 ? Math.min(60, Math.floor(length / 18)) : 0;
  if (/[？?]/.test(text)) score += 4;
  if (REASONING_RE.test(text)) score += 12;
  if (/http|www\./i.test(text)) score += 3;
  if (length > 900) score -= 8;
  if (LOW_SIGNAL_RE.test(text)) score -= 10;
  return Math.max(Math.max(0, score), fallbackScore(text));
}

export function selectBestComments(
  comments: Comment[],
  translations: Record<string, CommentTranslation> = {},
  limit = 4
): BestComment[] {
  return comments
    .map((comment) => ({ ...comment, score: scoreComment(comment, translations) }))
    .filter((comment) => comment.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Date.parse(a.publishedAt || "0") - Date.parse(b.publishedAt || "0");
    })
    .slice(0, limit);
}
