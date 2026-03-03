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

function hexToRgb(hex) {
    const h = String(hex || "").replace("#", "").trim();
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some((x) => Number.isNaN(x))) return null;
    return { r, g, b };
}

function rgbToHex({ r, g, b }) {
    const to = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

function lighten(hex, amount = 0.3) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    return rgbToHex({
        r: rgb.r + (255 - rgb.r) * amount,
        g: rgb.g + (255 - rgb.g) * amount,
        b: rgb.b + (255 - rgb.b) * amount,
    });
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
    const dayIndex = Math.floor(d.getTime() / (24 * 60 * 60 * 1000));
    const base = basePalette[Math.abs(dayIndex) % basePalette.length];
    const accent = lighten(base, 0.45);
    const text = "#E6E6E6";
    return { backgroundHex: base, accentHex: accent, textHex: text };
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
- max 5 posts (for this pipeline, use exactly 5).
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
            return `${id} | ${date} | ${it.source} | ${it.title}\nURL: ${it.link}\nSNIP: ${desc}`;
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
Avoid generic statements.

STRICT CONTENT REQUIREMENTS (per post):
- Include an exact event date (e.g., "27 Feb 2026") or "Mon YYYY" if exact day not available.
- Include company name and product/tool/model name if applicable.
- Include at least one REAL number that appears in the news item.
- No fake percentages. No predictions.
- Add a source line visible in the carousel: "Source: Publication, Mon YYYY"

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
      "eventDate": "DD Mon YYYY or Mon YYYY",
      "sourceName": "Publication name",
      "sourceMonthYear": "Mon YYYY",
      "sourceUrl": "MUST exactly match one provided URL",
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
- Each post uses a different sourceUrl
- Each sourceUrl matches one of the URLs above
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

Allowed sourceUrl values (must match exactly one of these):
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
        if (typeof p.eventDate !== "string") return false;
        if (typeof p.sourceName !== "string") return false;
        if (typeof p.sourceMonthYear !== "string") return false;
        if (typeof p.sourceUrl !== "string") return false;
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

    // Second-pass repair: ask provider(s) to convert into the required schema.
    const inputJson = (() => {
        try {
            return JSON.stringify(normalized ?? parsedObj ?? responseText);
        } catch {
            return String(responseText);
        }
    })();

    const clipped = inputJson.length > 20000 ? inputJson.slice(0, 20000) : inputJson;
    const allowedUrlsBlock = Array.isArray(allowedUrls) && allowedUrls.length > 0 ? allowedUrls.join("\n") : "(none provided)";
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
        repairedObj = JSON.parse(repairedText);
    } catch {
        throw new Error("Repair step returned non-JSON.");
    }

    const repairedNorm = normalizeMaybe(repairedObj, targetDate);
    if (isExpectedContentShape(repairedNorm)) return repairedNorm;

    const keys = repairedNorm && typeof repairedNorm === "object" ? Object.keys(repairedNorm).join(", ") : typeof repairedNorm;
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

    const theme = themeForDate(targetDate);

    console.log("🧠 Fetching real news (last 20 days)...");
    const items = await fetchTrendingItems({ windowDays: 20, maxItems: 50 });
    if (!items || items.length < 8) {
        console.error("❌ Not enough real news items fetched to generate reliable posts.");
        console.error("Try rerunning later, or add more RSS queries/sources in src/trends/sources.js.");
        process.exit(1);
    }

    const allowedUrls = items.slice(0, 25).map((i) => i.link);
    const prompt = buildContentPrompt({ targetDate, theme, items });

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
        parsed = JSON.parse(responseText);
    } catch (err) {
        console.error("❌ Failed to parse JSON.");
        console.error(responseText.substring(0, 700));
        process.exit(1);
    }

    let content;
    try {
        content = await coerceToExpected(responseText, parsed, targetDate, { theme, allowedUrls });
    } catch (err) {
        console.error("❌ Invalid JSON structure.");
        console.error(String(err?.message || err));
        process.exit(1);
    }

    // Enforce "real events only": every post must reference one of the fetched URLs
    const allowedSet = new Set(allowedUrls);
    const bad = (content.posts || []).filter((p) => !allowedSet.has(p.sourceUrl));
    if (bad.length > 0) {
        console.error("❌ Validation failed: one or more posts used a sourceUrl not in the fetched news list.");
        bad.forEach((p) => console.error(`   - Post ${p.id}: ${p.sourceUrl}`));
        process.exit(1);
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
