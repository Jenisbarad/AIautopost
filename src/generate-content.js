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
// Prompt (must match slide generator needs)
// ==============================
const CONTENT_PROMPT = `You are an AI news researcher and Instagram carousel writer for @dailyainewsone.

Today's date: {DATE}

Task: Generate EXACTLY 5 AI news carousel posts for Instagram.

Return ONLY valid JSON (no markdown, no code fences, no commentary).

Topic selection rules (very important):
- Pick topics that are REAL and SPECIFIC. Each topic must include at least one concrete entity: company/product/model/tool/law/dataset/paper.
- Avoid vague/general topics like: "AI models improved", "AI growth continues", "New algorithms developed", "Investment increases".
- Each post must be materially different (no repeats of the same story).
- Prefer practical/value topics people can use: new tool releases, major model updates, policy changes with impact, security incidents, benchmark results, pricing changes, open-source releases.
- Include at least one number per post (price, % score, context window, funding, date, benchmark, limits), but don’t invent absurd numbers.

Required JSON shape:
{
  "date": "{DATE}",
  "instagramHandle": "dailyainewsone",
  "totalPosts": 5,
  "posts": [
    {
      "id": 1,
      "topic": "Short topic (2-5 words)",
      "slides": 3 or 4,
      "svgIcon": "brain|chip|shield|network|globe|code|atom|rocket|database|lock",
      "slideContent": {
        "slide1": { "headline": "6-10 words max", "subtitle": "8-14 words max" },
        "slide2": { "title": "WHAT HAPPENED", "lines": ["sentence 1", "sentence 2"] },
        "slide3": { "title": "WHY IT MATTERS", "lines": ["sentence 1", "sentence 2"] },
        "slide4": { "title": "KEY TAKEAWAYS", "bullets": ["bullet 1", "bullet 2", "bullet 3"] }
      },
      "caption": "Instagram caption with line breaks + 6-10 hashtags"
    }
  ]
}

Rules:
- ids must be 1..5 unique and in order.
- If "slides" is 3 then omit "slide4".
- "slide2.lines" and "slide3.lines" must be arrays of strings.
- Make each slide much more informative (but still readable):
  - slide2.lines: EXACTLY 4 lines
  - slide3.lines: EXACTLY 4 lines
  - slide4.bullets: EXACTLY 5 bullets (only if slide4 exists)
- Every line/bullet must contain at least one concrete detail (name, feature, metric, number, or constraint).
- Keep each line short (max ~14 words) so it fits a 1024x1024 slide.
`;

const REPAIR_PROMPT = `You are given JSON from another model that is NOT in the required schema for our slide renderer.

Convert it into the REQUIRED JSON shape below. Return ONLY valid JSON.

REQUIRED JSON shape (same as before):
{
  "date": "{DATE}",
  "instagramHandle": "dailyainewsone",
  "totalPosts": 5,
  "posts": [
    {
      "id": 1,
      "topic": "Short topic (2-5 words)",
      "slides": 3 or 4,
      "svgIcon": "brain|chip|shield|network|globe|code|atom|rocket|database|lock",
      "slideContent": {
        "slide1": { "headline": "6-10 words max", "subtitle": "8-14 words max" },
        "slide2": { "title": "WHAT HAPPENED", "lines": ["line 1", "line 2", "line 3", "line 4"] },
        "slide3": { "title": "WHY IT MATTERS", "lines": ["line 1", "line 2", "line 3", "line 4"] },
        "slide4": { "title": "KEY TAKEAWAYS", "bullets": ["bullet 1", "bullet 2", "bullet 3", "bullet 4", "bullet 5"] }
      },
      "caption": "Instagram caption with line breaks + 6-10 hashtags"
    }
  ]
}

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
    if (!Array.isArray(obj.posts) || obj.posts.length !== 5) return false;
    for (let i = 0; i < obj.posts.length; i++) {
        const p = obj.posts[i];
        if (!p || typeof p !== "object") return false;
        if (typeof p.id !== "number") return false;
        if (typeof p.topic !== "string") return false;
        if (typeof p.caption !== "string") return false;
        if (!p.slideContent || typeof p.slideContent !== "object") return false;
        const sc = p.slideContent;
        if (!sc.slide1?.headline || !sc.slide1?.subtitle) return false;
        if (!Array.isArray(sc.slide2?.lines) || !Array.isArray(sc.slide3?.lines)) return false;
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

async function coerceToExpected(responseText, parsedObj, targetDate) {
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
    const prompt = REPAIR_PROMPT
        .replace(/\{DATE\}/g, targetDate)
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

    const prompt = CONTENT_PROMPT.replace(/\{DATE\}/g, targetDate);

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
        content = await coerceToExpected(responseText, parsed, targetDate);
    } catch (err) {
        console.error("❌ Invalid JSON structure.");
        console.error(String(err?.message || err));
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
