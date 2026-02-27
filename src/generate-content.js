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
// Prompt
// ==============================
const CONTENT_PROMPT = `You are an AI news researcher and Instagram content creator for @dailyainewsone.

Today's date: {DATE}

Generate 5 AI news Instagram carousel posts.

Return ONLY valid JSON.
No explanation.
No markdown.
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
                            max_tokens: 5000
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
                    max_tokens: 5000
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
                    max_tokens: 5000
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

    // Parse JSON
    let content;
    try {
        content = JSON.parse(responseText);
    } catch (err) {
        console.error("❌ Failed to parse JSON.");
        console.error(responseText.substring(0, 500));
        process.exit(1);
    }

    if (!content.posts || !Array.isArray(content.posts)) {
        console.error("❌ Invalid JSON structure.");
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
