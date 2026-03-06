/**
 * generate-content.js
 *
 * Uses Google Gemini AI to automatically:
 *   1. Research today's top AI/ML news
 *   2. Generate 5 Instagram carousel posts
 *   3. Save content JSON with headlines, slide text, captions, hashtags
 *
 * Usage:
 *   node src/generate-content.js              → generate today's content
 *   node src/generate-content.js --date 2026-02-25  → specific date
 *
 * Requires: GEMINI_API_KEY in .env or environment variable
 */

import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { fetchTrendingItems } from "./trends/trend-engine.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// ============================================================
// 🔥 SAFE JSON PARSER (FIX FOR GITHUB ACTIONS FAILURE)
// ============================================================

function safeJsonParse(text) {
    if (!text || typeof text !== "string") {
        throw new Error("Empty AI response");
    }

    let cleaned = text.trim();

    // Remove markdown fences
    if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, "");
        const lastFence = cleaned.lastIndexOf("```");
        if (lastFence !== -1) {
            cleaned = cleaned.slice(0, lastFence);
        }
    }

    // Extract JSON object
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        throw new Error("No valid JSON object found");
    }

    cleaned = cleaned.slice(firstBrace, lastBrace + 1);

    return JSON.parse(cleaned);
}

function envTrim(name) {
    const v = process.env[name];
    return typeof v === "string" ? v.trim() : "";
}

function envBool(name, defaultValue = false) {
    const v = envTrim(name).toLowerCase();
    if (!v) return defaultValue;
    return v === "1" || v === "true" || v === "yes" || v === "y" || v === "on";
}

function formatEventDate(d) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mmm = d.toLocaleString("en-US", { month: "short" });
    const yyyy = d.getFullYear();
    return `${dd} ${mmm} ${yyyy}`;
}

function parseYmd(dateStr) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetweenUtc(a, b) {
    // Whole-day diff between two Date objects using UTC midnight.
    if (!(a instanceof Date) || !(b instanceof Date)) return NaN;
    const aUtc = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
    const bUtc = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
    return Math.floor((aUtc - bUtc) / 86400000);
}

function normalizeTopicText(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function topicTokens(s) {
    const stop = new Set([
        "the","a","an","and","or","but","to","of","in","on","for","with","from","by","as","at",
        "is","are","was","were","be","been","being","it","its","this","that","these","those",
        "new","latest","today","update","reports","report","says","said","will","may","could",
        "into","over","after","before","about","more","less","than","vs",
        "ai","ml" // too generic for dedupe
    ]);
    const cleaned = normalizeTopicText(s);
    if (!cleaned) return [];
    return cleaned
        .split(" ")
        .filter(t => t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t));
}

function jaccardSimilarity(aTokens, bTokens) {
    const a = new Set(aTokens);
    const b = new Set(bTokens);
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}

function topicFingerprint(s) {
    const toks = topicTokens(s);
    // Keep only first ~10 tokens to stabilize comparisons.
    return toks.slice(0, 10).join(" ");
}

function lighten(hex, amount = 0.3) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const newR = Math.round(r + (255 - r) * amount);
    const newG = Math.round(g + (255 - g) * amount);
    const newB = Math.round(b + (255 - b) * amount);
    return `#${newR.toString(16).padStart(2, "0")}${newG
        .toString(16)
        .padStart(2, "0")}${newB.toString(16).padStart(2, "0")}`.toUpperCase();
}

function themeForDate(targetDate) {
    const basePalette = [
        "#0B1F3B", // Day 1: Deep Navy
        "#0B2F3B", // Day 2: Blue-Teal
        "#0B3B36", // Day 3: Dark Teal
        "#0F3B2A", // Day 4: Green Navy
        "#1A1F3B", // Day 5: Deep Indigo
        "#1F1A3B", // Day 6: Dark Purple Navy
        "#0B223D", // Day 7: refined navy variant (reset)
    ];

    const d = parseYmd(targetDate) || new Date();
    const dayIndex = Math.floor(d.getTime() / 86400000);
    const base = basePalette[Math.abs(dayIndex) % basePalette.length];
    return { backgroundHex: base,
             accentHex: lighten(base, 0.45),
             textHex: "#E6E6E6",};
}

function loadRecentPostMetadata({ targetDate, windowDays = 20 }) {
    const target = parseYmd(targetDate);
    if (!target) return [];

    const contentDir = path.resolve(ROOT, "content");
    if (!fs.existsSync(contentDir)) return [];

    const files = fs
        .readdirSync(contentDir)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/i.test(f))
        .sort();

    const meta = [];

    for (const f of files) {
        const dateStr = f.replace(/\.json$/i, "");
        if (dateStr === targetDate) continue;
        const d = parseYmd(dateStr);
        if (!d) continue;
        const ageDays = daysBetweenUtc(target, d);
        if (!(ageDays >= 0 && ageDays <= windowDays)) continue;

        try {
            const p = path.resolve(contentDir, f);
            const j = JSON.parse(fs.readFileSync(p, "utf-8"));
            const posts = Array.isArray(j?.posts) ? j.posts : [];
            for (const post of posts) {
                meta.push({
                    date: dateStr,
                    topic: String(post?.topic || ""),
                    sourceUrl: String(post?.sourceUrl || ""),
                    sourceName: String(post?.sourceName || ""),
                    fingerprint: topicFingerprint(`${post?.topic || ""} ${post?.caption || ""}`),
                });
            }
        } catch {
            // Ignore malformed historical files
        }
    }

    return meta;
}

function cleanupOldContentFiles({ targetDate, keepDays = 20 }) {
    const target = parseYmd(targetDate);
    if (!target) return { deleted: 0, kept: 0 };

    const contentDir = path.resolve(ROOT, "content");
    if (!fs.existsSync(contentDir)) return { deleted: 0, kept: 0 };

    const files = fs
        .readdirSync(contentDir)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/i.test(f));

    let deleted = 0;
    let kept = 0;

    for (const f of files) {
        const dateStr = f.replace(/\.json$/i, "");
        if (dateStr === targetDate) {
            kept++;
            continue;
        }
        const d = parseYmd(dateStr);
        if (!d) {
            kept++;
            continue;
        }
        const ageDays = daysBetweenUtc(target, d);
        // Keep only within last `keepDays` days; delete older OR future-dated artifacts.
        const shouldDelete = !(ageDays >= 0 && ageDays <= keepDays);
        if (!shouldDelete) {
            kept++;
            continue;
        }

        try {
            fs.unlinkSync(path.resolve(contentDir, f));
            deleted++;
        } catch {
            kept++;
        }
    }

    if (deleted > 0) {
        console.log(`🧹 Cleaned ${deleted} old content JSON file(s) (kept ${kept}).`);
    }

    return { deleted, kept };
}

// ==============================
// Get Target Date
// ==============================
function getTargetDate() {
    const args = process.argv.slice(2);
    const dateIdx = args.indexOf("--date");
    if (dateIdx !== -1 && args[dateIdx + 1]) {
        return args[dateIdx + 1];
    }
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    return ist.toISOString().split("T")[0];
}

// ==============================
// Prompt (Trend Intelligence Engine)
// ==============================
const CONTENT_PROMPT_UNUSED = `You are a Trend Intelligence Content Engine generating Instagram carousel posts for:

AI, Startups, Tech, Business, Internet Culture & Global Innovation Trends

Instagram handle: dailyainewsone

You act like:
- Tech journalist
- Market analyst
- VC researcher
- Trend forecaster
NOT like a generic motivational page.

Today's date: {DATE}

Your job is to generate EXACTLY 5 high-signal Instagram carousel posts using the process below.
Return ONLY valid JSON at the end (no markdown, no code fences, no commentary).

🧠 STEP 1 — IDENTIFY WHAT IS TRENDING

First, internally imagine 10 candidate topics based on:
- AI & ML
- Startups
- Big Tech companies
- Venture capital
- IPOs & funding
- Internet platforms
- Policy & regulation
- Stock market tech movements
- Creator economy
- SaaS launches
- Cybersecurity
- Hardware / chip wars
- Major layoffs
- Major acquisitions
- Global tech expansion
- Breakthrough research
- Viral tech product launches

Each candidate topic MUST:
- Be a real, specific, verifiable event (plausible and concrete).
- Include at least one real entity (company, product, model, government, exchange, VC, etc.).
- Include at least one number (%, $, users, valuation, date, benchmark score, revenue, funding amount, layoffs %, etc.).
If a topic is generic like "AI innovation continues" or "Tech is growing" → reject it.

TRUSTED SOURCES LIST:

Global:
- TechCrunch
- Bloomberg Tech
- Reuters Tech
- VentureBeat
- The Information

India:
- Inc42
- YourStory
- Entrackr
- Economic Times Tech
- Moneycontrol Tech
- Business Standard Tech

📊 STEP 2 — USEFULNESS & VIRALITY SCORING (0–100)

In addition, mentally compute a more detailed 0–100 score for each remaining topic:

CORE IMPACT (50 points total)
- Score 0–10 each for:
  - Impact Size
  - Financial Weight
  - Competitive Disruption
  - Innovation Depth
  - Public Relevance
  - Shareability
- Normalize proportionally to 50 max.

TRENDINGNESS (20 points total)
- Score 0–20 based on:
  - Trending on major platforms (X, LinkedIn, Reddit)
  - Engagement velocity
  - Influencer amplification
  - Discussion intensity

MULTI-SOURCE CREDIBILITY (20 points total)
- 20 → 2+ trusted sources
- 15 → 1 major trusted source
- 5  → Minor coverage
- 0  → Weak/unverified

RECENCY (10 points total)
- 10 → 0–2 days old
- 9  → 2–4 days old
- 8  → 4–6 days old
- 7  → 6–8 days old
- 6  → 8–10 days old
- 5  → 10–12 days old
- 4  → 12–14 days old
- 3  → 14–16 days old
- 2  → 16–18 days old
- 1  → 18–20 days old
- 0  → Older than 20 days (REJECT)

Use this advanced score to make sure:
- At least 2 final topics score 70+.
- No topic older than 20 days is used.

📈 STEP 3 — PERFORMANCE-AWARE OPTIMIZATION (mental heuristic)

Assume you have access to past Instagram analytics:
- If similar posts had:
  - High likes/comments → slightly boost similar topics.
  - High saves → prioritize educational, explanation-heavy posts.
  - High shares → prioritize funding/acquisition/controversy and regulation.
  - Low engagement → slightly lower priority.

Prefer:
- Funding rounds above $20M.
- IPOs.
- $1B+ valuations.
- Major updates from big tech brands.
- Competitive battles (e.g., model wars, pricing wars).
- Layoffs above 10%.
- Revenue milestones above $50M.

Avoid:
- Small seed rounds unless strategically important.
- Minor UI updates.
- Low-impact regional-only news.

✅ STRICT CONTENT RULES (additive)

- Only use real events from the last 20 days (based on {DATE}).
- Always include, whenever available:
  - Exact date (e.g., "27 Feb 2026" or "Feb 2026").
  - Company name.
  - Product/tool/model name (if applicable).
  - Real funding, valuation, revenue, user count, or layoff numbers when they actually happened.
- Do NOT invent fake precise percentages or fake benchmark numbers.
- You may use soft language like "double‑digit growth" but avoid fabricated exact % unless widely reported.
- Avoid generic filler statements like "AI innovation continues" or "Tech keeps growing".
- Add a source line at the bottom of the last slide (or last bullet) in the form:
  - "Source: [Publication, Month Year]" (e.g., "Source: Financial Times, Feb 2026").

📦 STEP 4 — STRUCTURE THE OUTPUT (JSON ONLY)

Now, for the final 5 topics, produce JSON in this shape:

{
  "date": "{DATE}",
  "instagramHandle": "dailyainewsone",
  "totalPosts": 5,
  "backgroundHex": "#0B1F3B or similar dark hex",
  "accentHex": "#1E4C8F or another lighter tone of the base",
  "textHex": "#E6E6E6",
  "posts": [
    {
      "id": 1,
      "topic": "2–6 word short title",
      "slides": 3 or 4,
      "svgIcon": "brain|chip|shield|network|globe|code|atom|rocket|database|lock",
      "slideContent": {
        "slide1": {
          "headline": "Strong attention-grabbing hook",
          "subtitle": "Short context explanation"
        },
        "slide2": {
          "title": "WHAT HAPPENED",
          "lines": [
            "Clear explanation of the event with entity and number",
            "Additional important detail",
            "Financial / technical / strategic number",
            "Expansion or future plan"
          ]
        },
        "slide3": {
          "title": "WHY IT MATTERS",
          "lines": [
            "Impact on market or industry",
            "Impact on users/developers/investors",
            "Competitive implication",
            "Long-term signal"
          ]
        },
        "slide4": {
          "title": "INSIGHTS",
          "bullets": [
            "Short insight",
            "Short insight",
            "Short insight",
            "Short insight",
            "Source: [Publication, Month Year]"
          ]
        }
      },
      "caption": "Engaging 2–4 paragraph caption with question + hashtags"
    }
  ]
}

🧾 FLEXIBILITY & VALIDATION RULES

- Always output exactly 5 posts in "posts" (id = 1..5).
- If "slides" is 3 then you may omit "slide4".
- "slide2.lines" and "slide3.lines" must be arrays of 3–5 concise lines (natural language, no strict word count).
- Slide lines must be specific and mention entity + at least one number somewhere in slide2.
- Caption is mandatory for every post.
- Captions:
  - Paragraph 1: clear summary of the news.
  - Paragraph 2: one engaging question.
  - Optional extra paragraph(s): 1–2 lines of extra context.
  - Hashtags: 6–10 total, mixing:
      #AInews #StartupNews #TechNews #BusinessNews #Innovation #FutureTech
      plus 2–4 entity-specific tags (e.g. #OpenAI #Llama3 #Gemini #IPO).

FINAL CHECK BEFORE YOU RETURN JSON:
- max 3 posts (for this pipeline, use exactly 3).
- No duplicate topics.
- Each post includes at least one real entity.
- Each post includes at least one number.
- At least 2 high-impact topics (mentally scored 25+).
- Mix of categories (not all funding).
- Caption included for all posts.
`;

// ==============================
// Prompt builder (REAL events only)
// ==============================
function buildContentPrompt({ targetDate, theme, items }) {
    const itemsBlock = items
        .slice(0, 25)
        .map((it, idx) => {
            const id = `N${idx + 1}`;
            const date = it.pubDate ? formatEventDate(it.pubDate) : "";
            const desc = String(it.description || "").slice(0, 220).replace(/\s+/g, " ").trim();
            // IMPORTANT: Do not include long URLs in model output (prevents truncation/invalid JSON).
            // The model must reference the source via this short id.
            return `${id} | ${date} | ${it.source} | ${it.title}\nSNIP: ${desc}`;
        })
        .join("\n\n");

    return `You are a Trend Intelligence Content Engine for Instagram (@dailyainewsone).
You act like a tech journalist + market analyst + VC researcher + trend forecaster.
You MUST NOT invent events, dates, funding, layoffs, percentages, or benchmarks.
You must ONLY use the REAL news items provided below as ground truth.

Today's date: ${targetDate}
Hard rule: only use events from the last 20 days.

Generate EXACTLY 3 posts (maximum 3 posts/day).
All 3 posts must be different categories (mix funding/product/policy/security/markets).
At least 2 posts should be high-impact.
Avoid generic statements and shallow summaries.

STRICT CONTENT REQUIREMENTS (per post):
- Include an exact event date (e.g., "27 Feb 2026") or "Mon YYYY" if exact day not available.
- Include company name and product/tool/model name if applicable.
- Include at least one REAL number that appears in the news item.
- No fake percentages. No predictions.
- Add a source line visible in the carousel: "Source: Publication, Mon YYYY"
- Add context + implications + useful insights (reader should learn something, not just hear news).
- Make the caption provoke 2–3 deeper questions naturally (include a short "Questions to consider" section).

THEME (apply to today):
- backgroundHex: ${theme.backgroundHex}
- accentHex: ${theme.accentHex}
- textHex: ${theme.textHex}

REAL NEWS ITEMS (use ONLY these; do NOT use outside knowledge):
${itemsBlock}

OUTPUT: Return ONLY valid JSON with this structure:
{
  "date": "${targetDate}",
  "instagramHandle": "dailyainewsone",
  "totalPosts": 3,
  "backgroundHex": "${theme.backgroundHex}",
  "accentHex": "${theme.accentHex}",
  "textHex": "${theme.textHex}",
  "posts": [
    {
      "id": 1,
      "topic": "2–6 word short title",
      "slides": 3 or 4,
      "svgIcon": "brain|chip|shield|network|globe|code|atom|rocket|database|lock",
      "sourceId": "One of N1..N25 (MUST match exactly)",
      "slideContent": {
        "slide1": { "headline": "hook", "subtitle": "context" },
        "slide2": { "title": "WHAT HAPPENED", "lines": ["...", "...", "...", "..."] },
        "slide3": { "title": "WHY IT MATTERS", "lines": ["...", "...", "...", "..."] },
        "slide4": { "title": "INSIGHTS", "bullets": ["...", "...", "...", "...", "Source: Publication, Mon YYYY"] }
      },
      "caption": "2–4 paragraphs + question + 6–10 hashtags"
    }
  ]
}

VALIDATION before you return:
- Exactly 3 posts, ids 1..3
- Each post uses a different sourceId
- Each sourceId is one of N1..N25
- Slide2 includes at least one REAL number
- If slide4 exists, its last bullet must be the Source line
`;
}

const REPAIR_PROMPT = `You are given JSON from another model that is NOT in the required schema for our slide renderer.

Convert it into the REQUIRED JSON shape below. Return ONLY valid JSON.

REQUIRED JSON shape (same as before):
{
  "date": "{DATE}",
  "instagramHandle": "dailyainewsone",
  "totalPosts": 3,
  "backgroundHex": "{BACKGROUND_HEX}",
  "accentHex": "{ACCENT_HEX}",
  "textHex": "{TEXT_HEX}",
  "posts": [
    {
      "id": 1,
      "topic": "2–6 word short title",
      "slides": 3 or 4,
      "svgIcon": "brain|chip|shield|network|globe|code|atom|rocket|database|lock",
      "eventDate": "DD Mon YYYY or Mon YYYY",
      "sourceName": "Publication name",
      "sourceMonthYear": "Mon YYYY",
      "sourceUrl": "Must match one of the allowed URLs",
      "slideContent": {
        "slide1": {
          "headline": "Strong attention-grabbing hook",
          "subtitle": "Short context explanation"
        },
        "slide2": {
          "title": "WHAT HAPPENED",
          "lines": [
            "Clear explanation of the event with entity and number",
            "Additional important detail",
            "Financial / technical / strategic number",
            "Expansion or future plan"
          ]
        },
        "slide3": {
          "title": "WHY IT MATTERS",
          "lines": [
            "Impact on market or industry",
            "Impact on users/developers/investors",
            "Competitive implication",
            "Long-term signal"
          ]
        },
        "slide4": {
          "title": "INSIGHTS",
          "bullets": [
            "Short insight",
            "Short insight",
            "Short insight",
            "Short insight",
            "Source: Publication, Mon YYYY"
          ]
        }
      },
      "caption": "Engaging 2–4 paragraph caption with question + hashtags"
    }
  ]
}

Allowed sourceId values (must match exactly one of these):
{ALLOWED_URLS}

Input JSON to convert:
{INPUT_JSON}
`;

// ==============================
// FREE MULTI-AI FALLBACK SYSTEM
// ==============================
async function generateWithFallback(prompt) {

    const providers = [

        // 1️⃣ GROQ (Primary Free)
        async () => {
            const groqKey = envTrim("GROQ_API_KEY");
            if (!groqKey) {
                throw new Error("SKIP: GROQ_API_KEY not set");
            }
            console.log("🔵 Trying Groq (Llama3 70B)...");
            const groqModelCandidates = [
                envTrim("GROQ_MODEL"),
                "llama-3.3-70b-versatile",
                "llama-3.1-70b-versatile",
                "llama-3.1-8b-instant",
            ].filter(Boolean);

            let lastErr = null;
            for (const modelName of groqModelCandidates) {
                try {
                    const res = await axios.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        {
                            model: modelName,
                            messages: [{ role: "user", content: prompt }],
                            temperature: 0.8,
                            max_tokens: 6000
                        },
                        {
                            headers: {
                                Authorization: `Bearer ${groqKey}`,
                                "Content-Type": "application/json"
                            }
                        }
                    );
                    return res.data.choices[0].message.content;
                } catch (e) {
                    lastErr = e;
                    const data = e?.response?.data;
                    const msg = (data?.error?.message || e?.message || "").toLowerCase();
                    const code = data?.error?.code;
                    if (code === "model_decommissioned" || msg.includes("decommissioned") || msg.includes("no longer supported") || msg.includes("model")) {
                        continue;
                    }
                    throw e;
                }
            }

            throw lastErr || new Error("Groq failed");
        },

        // 2️⃣ OpenRouter Free
        async () => {
            const openrouterKey = envTrim("OPENROUTER_API_KEY");
            if (!openrouterKey) {
                throw new Error("SKIP: OPENROUTER_API_KEY not set");
            }
            console.log("🟣 Trying OpenRouter...");
            const res = await axios.post(
                "https://openrouter.ai/api/v1/chat/completions",
                {
                    model: "meta-llama/llama-3-8b-instruct",
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.8,
                    max_tokens: 6000
                },
                {
                    headers: {
                        Authorization: `Bearer ${openrouterKey}`,
                        // Optional but recommended by OpenRouter; safe even if unset
                        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://github.com",
                        "X-Title": process.env.OPENROUTER_APP_NAME || "dailyainewsone",
                        "Content-Type": "application/json"
                    }
                }
            );
            return res.data.choices[0].message.content;
        },

        // 3️⃣ Together AI (OpenAI-compatible)
        async () => {
            const togetherKey = envTrim("TOGETHER_API_KEY");
            if (!togetherKey) {
                throw new Error("SKIP: TOGETHER_API_KEY not set");
            }
            console.log("🟠 Trying Together...");
            const res = await axios.post(
                "https://api.together.xyz/v1/chat/completions",
                {
                    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.8,
                    max_tokens: 6000
                },
                {
                    headers: {
                        Authorization: `Bearer ${togetherKey}`,
                        "Content-Type": "application/json"
                    }
                }
            );
            return res.data.choices[0].message.content;
        },

        // 4️⃣ Gemini Backup
        async () => {
            if (envBool("DISABLE_GEMINI", false)) {
                throw new Error("SKIP: Gemini disabled (DISABLE_GEMINI=true)");
            }
            const geminiKey = envTrim("GEMINI_API_KEY");
            if (!geminiKey) {
                throw new Error("SKIP: GEMINI_API_KEY not set");
            }
            console.log("🟢 Trying Gemini...");
            const genAI = new GoogleGenerativeAI(geminiKey);
            const modelCandidates = [
                envTrim("GEMINI_MODEL"),
                "gemini-2.0-flash",
                "gemini-2.0-pro",
                "gemini-1.5-pro-latest",
                "gemini-1.5-flash-latest",
                "gemini-1.5-pro",
                "gemini-1.5-flash",
            ].filter(Boolean);

            let lastErr = null;
            for (const modelName of modelCandidates) {
                try {
                    const model = genAI.getGenerativeModel({
                        model: modelName,
                        generationConfig: {
                            temperature: 0.8,
                            maxOutputTokens: 6000,
                        },
                    });
                    const result = await model.generateContent(prompt);
                    return result.response.text();
                } catch (e) {
                    lastErr = e;
                    const msg = e?.message || String(e);
                    // Try the next candidate if the model name/version is wrong
                    if (msg.includes("404") || msg.includes("not found") || msg.includes("ListModels")) {
                        continue;
                    }
                    throw e;
                }
            }

            throw lastErr || new Error("Gemini failed");
        }

    ];

    for (let i = 0; i < providers.length; i++) {
        try {
            const output = await providers[i]();
            console.log("✅ Success!\n");
            return output;
        } catch (err) {
            const msg = err?.message || String(err);
            if (msg.startsWith("SKIP:")) {
                console.log(`⚪ ${msg}`);
                continue;
            }
            console.log("❌ Failed:", err.response?.data || msg);
        }
    }

    throw new Error("All AI providers failed.");
}

function isExpectedContentShape(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (!Array.isArray(obj.posts) || obj.posts.length !== 3) return false;
    if (typeof obj.totalPosts !== "number" || obj.totalPosts !== 3) return false;
    for (let i = 0; i < obj.posts.length; i++) {
        const p = obj.posts[i];
        if (!p || typeof p !== "object") return false;
        if (typeof p.id !== "number") return false;
        if (typeof p.topic !== "string") return false;
        if (typeof p.caption !== "string") return false;
        if (typeof p.sourceId !== "string") return false;
        if (!p.slideContent || typeof p.slideContent !== "object") return false;
        const sc = p.slideContent;
        if (!sc.slide1?.headline || !sc.slide1?.subtitle) return false;
        if (!Array.isArray(sc.slide2?.lines) || sc.slide2.lines.length < 2) return false;
        if (!Array.isArray(sc.slide3?.lines) || sc.slide3.lines.length < 2) return false;
    }
    return true;
}

function normalizeMaybe(obj, targetDate) {
    // Accept array-of-posts shape
    if (Array.isArray(obj)) {
        obj = { date: targetDate, instagramHandle: "dailyainewsone", totalPosts: obj.length, posts: obj };
    }

    // posts could be an object keyed by numbers
    if (obj && typeof obj === "object" && obj.posts && !Array.isArray(obj.posts) && typeof obj.posts === "object") {
        const arr = Object.values(obj.posts);
        obj.posts = arr;
    }

    if (obj && typeof obj === "object") {
        if (!obj.date) obj.date = targetDate;
        if (!obj.instagramHandle) obj.instagramHandle = "dailyainewsone";
        if (!obj.totalPosts && Array.isArray(obj.posts)) obj.totalPosts = obj.posts.length;
    }

    return obj;
}

async function coerceToExpected(responseText, parsedObj, targetDate, { theme, allowedUrls } = {}) {
    const normalized = normalizeMaybe(parsedObj, targetDate);
    if (isExpectedContentShape(normalized)) return normalized;

    const inputJson = (() => {
        try {
            return JSON.stringify(normalized ?? parsedObj ?? responseText);
        } catch {
            return String(responseText);
        }
    })();

    const clipped = inputJson.length > 20000 ? inputJson.slice(0, 20000) : inputJson;
    const allowedUrlsBlock = Array.isArray(allowedUrls) && allowedUrls.length > 0
        ? allowedUrls.join("\n")
        : "(none provided)";

    const prompt = REPAIR_PROMPT
        .replace(/\{DATE\}/g, targetDate)
        .replace("{BACKGROUND_HEX}", theme?.backgroundHex || "#0B1F3B")
        .replace("{ACCENT_HEX}", theme?.accentHex || "#4D8DFF")
        .replace("{TEXT_HEX}", theme?.textHex || "#E6E6E6")
        .replace("{ALLOWED_URLS}", allowedUrlsBlock)
        .replace("{INPUT_JSON}", clipped);

    const repairedText = await generateWithFallback(prompt);

    let repairedObj;
    try {
        // ✅ USE SAFE PARSER HERE (CRITICAL FIX)
        repairedObj = safeJsonParse(repairedText);
    } catch (err) {
        throw new Error("Repair step returned non-JSON.");
    }

    const repairedNorm = normalizeMaybe(repairedObj, targetDate);
    if (isExpectedContentShape(repairedNorm)) return repairedNorm;

    const keys =
        repairedNorm && typeof repairedNorm === "object"
            ? Object.keys(repairedNorm).join(", ")
            : typeof repairedNorm;

    throw new Error(`Invalid JSON structure after repair. Top-level: ${keys}`);
}

// ==============================
// Main Function
// ==============================
async function generateContent(targetDate) {

    console.log("\n==============================================");
    console.log("  AI Content Generator — @dailyainewsone");
    console.log("==============================================");
    console.log(`  Date: ${targetDate}`);
    console.log("  Multi-provider free fallback mode\n");

    // Keep repo clean: content JSONs older than 20 days are removed automatically.
    cleanupOldContentFiles({ targetDate, keepDays: 20 });

    const theme = themeForDate(targetDate);

    // Sliding window memory (20 days): avoid repeating similar topics
    const recentMeta = loadRecentPostMetadata({ targetDate, windowDays: 20 });
    const recentFingerprints = recentMeta.map(m => m.fingerprint).filter(Boolean);

    console.log("🧠 Fetching real news (last 20 days)...");
    const items = await fetchTrendingItems({ windowDays: 20, maxItems: 50 });
    if (!items || items.length < 8) {
        console.error("❌ Not enough real news items fetched to generate reliable posts.");
        console.error("Try rerunning later, or add more RSS queries/sources in src/trends/sources.js.");
        process.exit(1);
    }

    // Filter out items that look too similar to recent topics
    const filteredItems = items.filter((it) => {
        const fp = topicFingerprint(`${it?.title || ""} ${it?.description || ""}`);
        if (!fp) return true;
        for (const oldFp of recentFingerprints) {
            const sim = jaccardSimilarity(fp.split(" "), String(oldFp).split(" "));
            if (sim >= 0.55) return false;
        }
        return true;
    });

    const candidateItems = filteredItems.length >= 12 ? filteredItems : items;
    const topItems = candidateItems.slice(0, 25);
    const allowedIds = topItems.map((_, idx) => `N${idx + 1}`);
    const prompt = buildContentPrompt({ targetDate, theme, items: topItems });

    let responseText;

    try {
        responseText = await generateWithFallback(prompt);
    } catch (err) {
        console.error("🚨 All providers failed:", err.message);
        process.exit(1);
    }

    // Parse + coerce into the exact schema our slide renderer needs
    let parsed;

    try {
        parsed = safeJsonParse(responseText);
    } catch (err) {
        console.error("❌ Failed to parse JSON.");
        console.error(responseText.substring(0, 800));
        process.exit(1);
    }

    let content;
    try {
        content = await coerceToExpected(responseText, parsed, targetDate, { theme, allowedUrls: allowedIds });
    } catch (err) {
        console.error("❌ Invalid JSON structure.");
        console.error(String(err?.message || err));
        process.exit(1);
    }

    // Enforce + fill grounded source fields based on sourceId
    const allowedIdSet = new Set(allowedIds);
    const byId = new Map(topItems.map((it, idx) => [`N${idx + 1}`, it]));

    for (const p of content.posts || []) {
        if (!allowedIdSet.has(p.sourceId)) {
            console.error(`❌ Validation failed: Post ${p.id} has invalid sourceId: ${p.sourceId}`);
            process.exit(1);
        }
        const it = byId.get(p.sourceId);
        if (!it) {
            console.error(`❌ Validation failed: sourceId not found in fetched items: ${p.sourceId}`);
            process.exit(1);
        }
        const pub = it.pubDate instanceof Date ? it.pubDate : null;
        const monthYear = pub ? pub.toLocaleString("en-US", { month: "short", year: "numeric" }) : "";
        const eventDate = pub ? formatEventDate(pub) : monthYear;

        p.sourceUrl = it.link;
        p.sourceName = it.source || it.feed || "";
        p.sourceMonthYear = monthYear;
        p.eventDate = eventDate;

        // Ensure the event date is visible somewhere in slide2 (reduces "wrong dates" risk)
        const dateLike = /\b\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b|\b[A-Za-z]{3}\s+\d{4}\b/;
        if (p.slideContent?.slide2?.lines && Array.isArray(p.slideContent.slide2.lines)) {
            const joined = p.slideContent.slide2.lines.join(" ");
            if (!dateLike.test(joined) && p.eventDate) {
                p.slideContent.slide2.lines.unshift(`Event date: ${p.eventDate}`);
            }
        }

        // Ensure visible source line in slide4 (if present)
        if (p.slideContent?.slide4?.bullets && Array.isArray(p.slideContent.slide4.bullets)) {
            const srcLine = `Source: ${p.sourceName}, ${p.sourceMonthYear}`.trim();
            if (p.slideContent.slide4.bullets.length === 0) {
                p.slideContent.slide4.bullets.push(srcLine);
            } else {
                p.slideContent.slide4.bullets[p.slideContent.slide4.bullets.length - 1] = srcLine;
            }
        }
    }

    // Final dedupe guard (non-fatal): warn if content still looks too similar to recent topics.
    // We avoid dropping posts here to keep the daily 3-post pipeline stable.
    const recentTopics = recentMeta.map(m => `${m.topic} ${m.sourceName}`).filter(Boolean);
    for (const p of content.posts || []) {
        const fp = topicFingerprint(`${p?.topic || ""} ${p?.caption || ""}`);
        if (!fp) continue;
        for (const old of recentTopics) {
            const sim = jaccardSimilarity(fp.split(" "), topicFingerprint(old).split(" "));
            if (sim >= 0.6) {
                console.warn(`⚠️ Potential repeat vs last 20 days: "${p.topic}" (similarity ${sim.toFixed(2)})`);
                break;
            }
        }
    }

    // Save
    const contentDir = path.resolve(ROOT, "content");
    if (!fs.existsSync(contentDir)) {
        fs.mkdirSync(contentDir, { recursive: true });
    }

    const outputPath = path.resolve(contentDir, `${targetDate}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(content, null, 2));

    console.log("📁 Saved to:", outputPath);
    console.log("🚀 Content generation complete!\n");

    return { content, outputPath };
}

// Run
const targetDate = getTargetDate();
generateContent(targetDate);
