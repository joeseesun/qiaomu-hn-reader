import type { Comment } from "./hnrss.js";
import type { CommentTranslation } from "./translate.js";

export type BestComment = Comment & {
  score: number;
};

function textForScore(comment: Comment, translations: Record<string, CommentTranslation>) {
  const translated = translations[comment.id]?.textZh;
  return (translated || comment.textPlain || "").trim();
}

function scoreComment(comment: Comment, translations: Record<string, CommentTranslation>) {
  const text = textForScore(comment, translations);
  const length = text.length;
  if (length < 80) return 0;

  let score = Math.min(60, Math.floor(length / 18));
  if (/[？?]/.test(text)) score += 4;
  if (/因为|所以|问题|经验|建议|取舍|风险|成本|实践|原因|对比|however|because|trade-?off|experience/i.test(text)) score += 12;
  if (/http|www\./i.test(text)) score += 3;
  if (length > 900) score -= 8;
  if (/^\s*(thanks|thank you|哈哈|lol|agree|same)\b/i.test(text)) score -= 10;
  return Math.max(0, score);
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
