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
            console.log("🔵 Trying Groq (Llama3 70B)...");
            const res = await axios.post(
                "https://api.groq.com/openai/v1/chat/completions",
                {
                    model: "llama3-70b-8192",
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.8,
                    max_tokens: 5000
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                        "Content-Type": "application/json"
                    }
                }
            );
            return res.data.choices[0].message.content;
        },

        // 2️⃣ OpenRouter Free
        async () => {
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
                        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        "Content-Type": "application/json"
                    }
                }
            );
            return res.data.choices[0].message.content;
        },

        // 3️⃣ Gemini Backup
        async () => {
            console.log("🟢 Trying Gemini...");
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({
                model: "gemini-1.5-pro"
            });
            const result = await model.generateContent(prompt);
            return result.response.text();
        }

    ];

    for (let i = 0; i < providers.length; i++) {
        try {
            const output = await providers[i]();
            console.log("✅ Success!\n");
            return output;
        } catch (err) {
            console.log("❌ Failed:", err.response?.data || err.message);
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
