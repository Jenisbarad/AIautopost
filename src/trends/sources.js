export const GOOGLE_NEWS_RSS_BASE = "https://news.google.com/rss/search";

function googleNewsSearchUrl(q) {
  const params = new URLSearchParams({
    q,
    hl: "en-IN",
    gl: "IN",
    ceid: "IN:en",
  });
  return `${GOOGLE_NEWS_RSS_BASE}?${params.toString()}`;
}

export function getRssSources() {
  // Mix: AI, startups, funding, chips, security, policy, IPOs, platform shifts.
  // Google News RSS is used to avoid per-site RSS reliability issues.
  const queries = [
    // AI + models
    '("OpenAI" OR "ChatGPT" OR "GPT-4" OR "Sam Altman") (launch OR update OR pricing OR partnership)',
    '("Google" OR "Gemini") (model OR update OR release OR API) (benchmark OR tokens OR price)',
    '("Anthropic" OR "Claude") (launch OR update OR safety OR enterprise)',
    '("Meta" OR "Llama") (release OR open-source OR model) (parameters OR context)',
    '("Nvidia" OR "AMD" OR "Intel") (AI chip OR GPU) (H100 OR B200 OR MI300) (supply OR earnings OR revenue)',

    // Startups + funding + M&A + IPO
    '(startup OR "AI startup") (funding OR "Series A" OR "Series B" OR "raises" OR valuation) (AI OR ML)',
    '("IPO" OR "files for IPO" OR "public offering") (tech OR AI OR SaaS) (NYSE OR Nasdaq)',
    '("acquires" OR acquisition OR merger) (AI OR startup OR SaaS) (deal OR billion OR million)',

    // Policy + regulation
    '("AI Act" OR regulation OR "executive order" OR "data protection") (AI OR model) (EU OR US OR India)',

    // Security + incidents
    '(AI OR LLM) (security OR jailbreak OR "data leak" OR breach) (report OR researchers)',

    // Creator economy / platforms
    '("YouTube" OR "TikTok" OR "Instagram" OR "X") (AI OR algorithm) (monetization OR creator OR policy)',
  ];

  const urls = queries.map(googleNewsSearchUrl);

  return [
    {
      id: "google-news-search",
      type: "rss",
      urls,
    },
  ];
}

