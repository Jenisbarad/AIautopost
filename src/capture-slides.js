/**
 * capture-slides.js
 * 
 * Captures each slide from all-slides.html as individual 1024x1024 PNG images.
 * Uses Puppeteer to render the HTML and take element-level screenshots.
 * 
 * Usage: node src/capture-slides.js
 */

import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

async function captureSlides() {
    const slidesHtml = path.resolve(ROOT, 'slides', 'all-slides.html');
    const outputDir = path.resolve(ROOT, 'images', 'captured');

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log('\n📸 Slide Capture Tool');
    console.log('━'.repeat(40));
    console.log(`  Source: ${slidesHtml}`);
    console.log(`  Output: ${outputDir}\n`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // Set viewport large enough to render slides
    await page.setViewport({ width: 1200, height: 800 });

    // Navigate to the HTML file
    await page.goto(`file:///${slidesHtml.replace(/\\/g, '/')}`, {
        waitUntil: 'networkidle0',
        timeout: 30000,
    });

    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 2000));

    // Get all slide elements
    const slides = await page.$$('.slide');
    console.log(`  Found ${slides.length} slides to capture.\n`);

    const capturedPaths = {};

    for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];

        // Get the slide's ID
        const slideId = await slide.evaluate(el => el.id);

        // Parse post and slide number from ID (e.g., "p1s1" -> post 1, slide 1)
        const match = slideId.match(/p(\d+)s(\d+)/);
        if (!match) continue;

        const postNum = parseInt(match[1]);
        const slideNum = parseInt(match[2]);

        const filename = `post${postNum}_slide${slideNum}.png`;
        const outputPath = path.resolve(outputDir, filename);

        // Screenshot the individual slide element at high resolution
        // Get element bounding box
        const box = await slide.boundingBox();

        // Take a clipped screenshot of just this element, scaled up to 1024x1024
        await slide.screenshot({
            path: outputPath,
            type: 'png',
            // Capture at native size, we'll set device scale to get 1024px
        });

        // Track paths by post
        if (!capturedPaths[postNum]) {
            capturedPaths[postNum] = [];
        }
        capturedPaths[postNum].push({
            slideNum,
            filename,
            path: outputPath,
        });

        console.log(`  ✅ Post ${postNum}, Slide ${slideNum} → ${filename}`);
    }

    await browser.close();

    // Save mapping file for the posting script
    const mapping = {};
    for (const [postNum, slides] of Object.entries(capturedPaths)) {
        mapping[postNum] = slides
            .sort((a, b) => a.slideNum - b.slideNum)
            .map(s => `images/captured/${s.filename}`);
    }

    const mappingPath = path.resolve(ROOT, 'images', 'captured', 'mapping.json');
    fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));

    console.log(`\n  📋 Mapping saved to: ${mappingPath}`);
    console.log(`\n🎉 All ${slides.length} slides captured successfully!\n`);
    console.log('  Next: run "npm run post-carousels" to upload to Instagram.\n');

    return mapping;
}

captureSlides().catch(err => {
    console.error('❌ Error capturing slides:', err.message);
    process.exit(1);
});
