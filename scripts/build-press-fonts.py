"""Build the serif subset for hn.qiaomu.ai: titles come from the reader's translation and discussion caches."""
import json, sys
from pathlib import Path
sys.path.insert(0, "/Users/joe/Documents/ChatGPT/hackernews-data/hn-common")
from press_fonts import main

sp = Path(sys.argv[1])
site = Path(sys.argv[2])
titles = []
for v in json.load(open(sp / "translations.json")).values():
    titles.append(v.get("titleZh") or "")
arts = json.load(open(sp / "discussion-articles.json"))
for v in (arts.values() if isinstance(arts, dict) else arts):
    if isinstance(v, dict):
        a = v.get("article", v)
        titles.append(a.get("title") or "")
text = "\n".join(titles)
print("titles", len(titles), "unique chars", len({c for c in text if ord(c) > 0x2E7F}))
main(site, text, "首页精选升温榜产品雷达收藏搜索结果乔木速读")
