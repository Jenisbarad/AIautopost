import { getRssSources } from "./sources.js";
import { fetchRssUrl, parseRssOrAtom } from "./fetch-rss.js";

function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractFirstNumber(text) {
  const t = String(text || "");
  const m =
    t.match(/\$?\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/) || // 12,345 or $12,345
    t.match(/\$?\b\d+(?:\.\d+)?\b/) || // 123 or $123 or 1.5
    t.match(/\b\d+\s?(?:%|percent|bn|billion|m|million|k|thousand)\b/i);
  return m ? m[0] : "";
}

function heuristicScore(item) {
  // Lightweight scoring to pre-rank before the LLM.
  const title = (item.title || "").toLowerCase();
  const desc = (item.description || "").toLowerCase();
  const text = `${title} ${desc}`;

  let score = 0;

  // Recency handled separately; this is "signal" score.
  if (/\bipo\b|\bfiles for ipo\b|\bnasdaq\b|\bnyse\b/.test(text)) score += 10;
  if (/\braises\b|\bfunding\b|\bseries [abc]\b|\bvaluation\b|\bround\b/.test(text)) score += 8;
  if (/\bacquire|acquisition|merger|buys\b/.test(text)) score += 8;
  if (/\blayoffs?\b|\bcuts?\b|\brestructur/.test(text)) score += 7;
  if (/\bregulation\b|\blaw\b|\beu ai act\b|\bexecutive order\b/.test(text)) score += 6;
  if (/\bnvidia\b|\bamd\b|\bintel\b|\bgpu\b|\bchip\b|\bb200\b|\bh100\b|\bmi300\b/.test(text)) score += 5;
  if (/\bopenai\b|\bchatgpt\b|\bgemini\b|\bclaude\b|\bllama\b|\banthropic\b|\bmeta\b|\bgoogle\b/.test(text)) score += 5;
  if (/\bsecurity\b|\bbreach\b|\bleak\b|\bjailbreak\b/.test(text)) score += 5;

  // Numbers bump (financial/scale usually)
  if (extractFirstNumber(text)) score += 6;

  // Penalize generic fluff
  if (/\binnovation continues\b|\bai is growing\b|\bmodels improved\b/.test(text)) score -= 10;

  return score;
}

function withinDays(d, days, now = new Date()) {
  if (!d) return false;
  const ms = now.getTime() - d.getTime();
  return ms >= 0 && ms <= days * 24 * 60 * 60 * 1000;
}

export async function fetchTrendingItems({
  windowDays = 20,
  maxItems = 60,
  perFeedLimit = 25,
  timeoutMs = 15000,
} = {}) {
  const sources = getRssSources();
  const now = new Date();

  const all = [];

  for (const src of sources) {
    for (const url of src.urls) {
      try {
        const { ok, status, text } = await fetchRssUrl(url, { timeoutMs });
        if (!ok) continue;
        const { feedTitle, items } = parseRssOrAtom(text, src.id);
        for (const it of items.slice(0, perFeedLimit)) {
          if (!it?.title || !it?.link) continue;
          if (!withinDays(it.pubDate, windowDays, now)) continue;
          all.push({
            ...it,
            feed: feedTitle || src.id,
            fetchedFrom: url,
          });
        }
      } catch {
        // Ignore individual feed failures
      }
    }
  }

  // Deduplicate (by link + normalized title)
  const seen = new Set();
  const deduped = [];
  for (const it of all) {
    const key = `${it.link}::${normalizeTitle(it.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  // Rank by heuristic score + recency
  const ranked = deduped
    .map((it) => {
      const ageDays = it.pubDate ? (now.getTime() - it.pubDate.getTime()) / (24 * 60 * 60 * 1000) : 999;
      const recencyBoost = Math.max(0, 8 - ageDays); // up to +8 when very recent
      return {
        ...it,
        _score: heuristicScore(it) + recencyBoost,
        _ageDays: ageDays,
      };
    })
    .sort((a, b) => b._score - a._score);

  return ranked.slice(0, maxItems);
}

