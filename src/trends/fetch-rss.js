import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseTagValue: true,
  trimValues: true,
});

function toArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function safeDate(d) {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t;
}

function normalizeWhitespace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function stripHtml(s) {
  return normalizeWhitespace(String(s || "").replace(/<[^>]*>/g, " "));
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = normalizeWhitespace(v);
    if (s) return s;
  }
  return "";
}

export async function fetchRssUrl(url, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "dailyainewsone-trend-engine/1.0 (+rss)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(t);
  }
}

export function parseRssOrAtom(xmlText, fallbackSourceName = "") {
  const parsed = parser.parse(xmlText);

  // RSS 2.0
  if (parsed?.rss?.channel) {
    const ch = parsed.rss.channel;
    const channelTitle = stripHtml(ch.title) || fallbackSourceName;
    const items = toArray(ch.item).map((it) => {
      const title = stripHtml(it.title);
      const link = firstNonEmpty(it.link, it.guid?.["#text"], it.guid);
      const pubDate = safeDate(it.pubDate || it.published || it.updated);
      const source = stripHtml(it.source?.["#text"] || it.source) || channelTitle || fallbackSourceName;
      const description = stripHtml(it.description || it["content:encoded"] || "");
      return {
        title,
        link,
        pubDate,
        source,
        description,
      };
    });
    return { feedTitle: channelTitle, items };
  }

  // Atom
  if (parsed?.feed) {
    const feedTitle = stripHtml(parsed.feed.title) || fallbackSourceName;
    const entries = toArray(parsed.feed.entry).map((e) => {
      const title = stripHtml(e.title);
      const links = toArray(e.link);
      const href =
        (links.find((l) => l?.["@_rel"] === "alternate")?.["@_href"]) ||
        links[0]?.["@_href"] ||
        e.link?.["@_href"] ||
        "";
      const pubDate = safeDate(e.published || e.updated);
      const source = feedTitle || fallbackSourceName;
      const summary = stripHtml(e.summary || e.content || "");
      return { title, link: href, pubDate, source, description: summary };
    });
    return { feedTitle, items: entries };
  }

  return { feedTitle: fallbackSourceName, items: [] };
}

