import type { Story } from "./hnrss.js";

export type RiskAssessment = {
  blocked: boolean;
  category: "politics" | "military" | "sensitive" | "none";
  reason?: string;
  matched?: string[];
};

const militaryPatterns = [
  /\bwar\b/i,
  /\bwars\b/i,
  /\bmilitary\b/i,
  /\bweapon(?:s|ized|ization)?\b/i,
  /\bmissile(?:s)?\b/i,
  /\bdrone(?:s)?\b/i,
  /\barmy\b/i,
  /\bnavy\b/i,
  /\bair force\b/i,
  /\bdefen[cs]e\b/i,
  /\bnato\b/i,
  /\bcombat\b/i,
  /\bbattlefield\b/i,
  /\binvasion\b/i,
  /\bterror(?:ism|ist)?\b/i,
  /战争|军事|武器|导弹|无人机|军队|海军|空军|国防|战场|入侵|恐怖主义/
];

const politicsPatterns = [
  /\belection(?:s)?\b/i,
  /\bpresident(?:ial)?\b/i,
  /\bcongress\b/i,
  /\bsenate\b/i,
  /\bparliament\b/i,
  /\bminister\b/i,
  /\bgovernment\b/i,
  /\bgeopolitic(?:s|al)?\b/i,
  /\bsanction(?:s|ed)?\b/i,
  /\btariff(?:s)?\b/i,
  /\bpropaganda\b/i,
  /\bcensorship\b/i,
  /\bchina\b.*\bpolicy\b/i,
  /\brussia\b/i,
  /\bukraine\b/i,
  /\bisrael\b/i,
  /\bgaza\b/i,
  /\biran\b/i,
  /\bsyria\b/i,
  /\bmiddle east\b/i,
  /\bpalestine\b/i,
  /\blebanon\b/i,
  /\byemen\b/i,
  /\btaiwan\b/i,
  /选举|总统|国会|参议院|议会|部长|政府|地缘政治|制裁|关税|宣传|审查|俄罗斯|乌克兰|以色列|加沙|伊朗|叙利亚|中东|巴勒斯坦|黎巴嫩|也门|台湾/
];

const sensitivePatterns = [
  /\blgbtq?\+?ia?\b/i,
  /\btransgender\b/i,
  /\bgender identity\b/i,
  /\bsexual orientation\b/i,
  /\brace\b.*\bpolicy\b/i,
  /\bidentity politics\b/i,
  /性别认同|性少数|社会议题|身份政治/
];

function collectMatches(text: string, patterns: RegExp[]) {
  return patterns
    .map((pattern) => text.match(pattern)?.[0])
    .filter((match): match is string => Boolean(match))
    .slice(0, 4);
}

export function assessStoryRisk(story: Story): RiskAssessment {
  const text = `${story.title} ${story.domain} ${story.url}`.toLowerCase();
  const military = collectMatches(text, militaryPatterns);
  if (military.length) {
    return {
      blocked: true,
      category: "military",
      reason: "军事、战争或武器相关内容默认不进入公开首页",
      matched: military
    };
  }

  const politics = collectMatches(text, politicsPatterns);
  if (politics.length) {
    return {
      blocked: true,
      category: "politics",
      reason: "政治、选举、制裁或地缘冲突相关内容默认不进入公开首页",
      matched: politics
    };
  }

  const sensitive = collectMatches(text, sensitivePatterns);
  if (sensitive.length) {
    return {
      blocked: true,
      category: "sensitive",
      reason: "社会争议议题相关内容默认不进入公开首页",
      matched: sensitive
    };
  }

  return { blocked: false, category: "none", matched: [] };
}
