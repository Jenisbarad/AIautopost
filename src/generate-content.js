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

import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY is not set.');
    console.error('Get a free key at: https://aistudio.google.com/apikey');
    console.error('Add it to .env or GitHub Secrets.');
    process.exit(1);
}

// Get today's date or from --date argument
function getTargetDate() {
    const args = process.argv.slice(2);
    const dateIdx = args.indexOf('--date');
    if (dateIdx !== -1 && args[dateIdx + 1]) {
        return args[dateIdx + 1];
    }
    // Use IST date (UTC+5:30)
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    return ist.toISOString().split('T')[0];
}

const CONTENT_PROMPT = `You are an AI news researcher and Instagram content creator for @dailyainewsone.

Today's date: {DATE}

YOUR TASK:
1. Think of the 5 most important AI/ML news stories that would be trending today (use realistic, plausible topics for {DATE}).
2. For each story, create an Instagram carousel post.

STRICT OUTPUT FORMAT — Return ONLY valid JSON, no markdown, no explanation:

{
  "date": "{DATE}",
  "instagramHandle": "dailyainewsone",
  "totalPosts": 5,
  "posts": [
    {
      "id": 1,
      "topic": "Short topic name",
      "popularityScore": 85,
      "headline": "Max 9 Word Headline Here",
      "slides": 4,
      "slideContent": {
        "slide1": {
          "headline": "Max 9 Word Headline",
          "subtitle": "One short subtitle line"
        },
        "slide2": {
          "title": "What Happened",
          "lines": ["Line 1 here.", "Line 2 here.", "Line 3 here.", "Line 4 here."]
        },
        "slide3": {
          "title": "Why It Matters",
          "lines": ["Line 1 here.", "Line 2 here.", "Line 3 here.", "Line 4 here."]
        },
        "slide4": {
          "title": "Key Takeaways",
          "bullets": ["Bullet point 1", "Bullet point 2", "Bullet point 3"]
        }
      },
      "caption": "Hook line here.\\\\n\\\\n3-4 short summary sentences here. Keep it simple and human.\\\\n\\\\nOne engagement question here?\\\\n\\\\n#AInews #hashtag2 #hashtag3 #hashtag4 #hashtag5 #hashtag6\\\\n\\\\nStay ahead. Stay intelligent. 🚀",
      "svgIcon": "brain"
    }
  ]
}

RULES:
- Each slide: max 35 words
- Simple, natural English — no jargon, no hype words
- No emojis inside slide text
- Headlines max 9 words
- slide4 is optional (set "slides": 3 to skip it)
- Posts 1-2 should have 4 slides, posts 3-5 can have 3 slides
- popularityScore: 50-95 range, highest first
- svgIcon must be one of: "brain", "chip", "shield", "network", "globe", "code", "atom", "rocket", "database", "lock"
- Caption must end with: "Stay ahead. Stay intelligent. 🚀"
- 6-8 hashtags per post, always include #AInews
- Make content about REAL types of AI/ML developments (model releases, funding, regulation, research, tools)

RETURN ONLY THE JSON. No other text.`;

async function generateContent(targetDate) {
    console.log('\n==============================================');
    console.log('  AI Content Generator — @dailyainewsone');
    console.log('==============================================');
    console.log(`  Date: ${targetDate}`);
    console.log(`  Model: Gemini 2.0 Flash\n`);

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
        },
    });

    const prompt = CONTENT_PROMPT.replace(/\{DATE\}/g, targetDate);

    console.log('  Researching AI news and generating content...\n');

    let result;
    try {
        result = await model.generateContent(prompt);
    } catch (err) {
        console.error('  Gemini API error:', err.message);
        process.exit(1);
    }

    const responseText = result.response.text();

    // Parse JSON from response
    let content;
    try {
        content = JSON.parse(responseText);
    } catch (err) {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            content = JSON.parse(jsonMatch[1].trim());
        } else {
            console.error('  Failed to parse Gemini response as JSON.');
            console.error('  Raw response:', responseText.substring(0, 500));
            process.exit(1);
        }
    }

    // Validate structure
    if (!content.posts || !Array.isArray(content.posts) || content.posts.length === 0) {
        console.error('  Invalid content structure — no posts found.');
        process.exit(1);
    }

    // Add images field for compatibility
    content.posts.forEach((post, i) => {
        post.images = [`images/captured/post${post.id}_slide1.png`];
    });

    // Save content JSON to content/ directory (project root)
    const contentDir = path.resolve(ROOT, 'content');
    if (!fs.existsSync(contentDir)) {
        fs.mkdirSync(contentDir, { recursive: true });
    }

    const outputPath = path.resolve(contentDir, `${targetDate}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(content, null, 2));

    console.log('  Generated posts:');
    content.posts.forEach(post => {
        console.log(`    ${post.id}. [${post.popularityScore}] ${post.headline}`);
        console.log(`       Slides: ${post.slides} | Icon: ${post.svgIcon}`);
    });

    console.log(`\n  Saved to: ${outputPath}`);
    console.log('  Content generation complete!\n');

    return { content, outputPath };
}

// Run
const targetDate = getTargetDate();
generateContent(targetDate).catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
