/**
 * post-carousels.js
 * 
 * Full automated pipeline:
 *   1. Capture slides from HTML → individual PNG images
 *   2. Upload images to ImgBB → get public URLs
 *   3. Post each set of slides as an Instagram carousel
 * 
 * Usage:
 *   npm run post-carousels           → capture + upload + post all
 *   npm run post-carousels -- --dry-run   → simulate everything
 *   npm run post-carousels -- --post-index 2  → only post #2
 */

import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { config, validateConfig } from './config.js';
import { uploadImage } from './upload-images.js';
import { validateToken, getInstagramAccountId, postCarousel } from './instagram-poster.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========================
// STEP 1: CAPTURE SLIDES
// ========================
async function captureAllSlides() {
    const slidesHtml = path.resolve(ROOT, 'slides', 'all-slides.html');
    const outputDir = path.resolve(ROOT, 'images', 'captured');

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log('\n📸 STEP 1: Capturing slides from HTML');
    console.log('━'.repeat(50));

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // Use device scale factor 2x to get 1024px from 512px slides
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });

    await page.goto(`file:///${slidesHtml.replace(/\\/g, '/')}`, {
        waitUntil: 'networkidle0',
        timeout: 30000,
    });

    // Wait for fonts
    await page.evaluate(() => document.fonts.ready);
    await sleep(2000);

    const slideElements = await page.$$('.slide');
    console.log(`  Found ${slideElements.length} slides.\n`);

    const capturedByPost = {};

    for (let i = 0; i < slideElements.length; i++) {
        const slide = slideElements[i];
        const slideId = await slide.evaluate(el => el.id);

        const match = slideId.match(/p(\d+)s(\d+)/);
        if (!match) continue;

        const postNum = parseInt(match[1]);
        const slideNum = parseInt(match[2]);
        const filename = `post${postNum}_slide${slideNum}.png`;
        const outputPath = path.resolve(outputDir, filename);

        await slide.screenshot({ path: outputPath, type: 'png' });

        if (!capturedByPost[postNum]) capturedByPost[postNum] = [];
        capturedByPost[postNum].push({
            slideNum,
            filename,
            absolutePath: outputPath,
            relativePath: `images/captured/${filename}`,
        });

        console.log(`  ✅ Post ${postNum}, Slide ${slideNum} → ${filename}`);
    }

    await browser.close();

    // Sort slides within each post
    for (const key of Object.keys(capturedByPost)) {
        capturedByPost[key].sort((a, b) => a.slideNum - b.slideNum);
    }

    console.log(`\n  📸 Captured ${slideElements.length} slides total.\n`);
    return capturedByPost;
}

// ========================
// STEP 2: UPLOAD TO IMGBB
// ========================
async function uploadAllSlides(capturedByPost, dryRun = false) {
    console.log('\n☁️  STEP 2: Uploading slides to ImgBB');
    console.log('━'.repeat(50));

    const uploadedByPost = {};

    for (const [postNum, slides] of Object.entries(capturedByPost)) {
        uploadedByPost[postNum] = [];
        console.log(`\n  📤 Post ${postNum}: ${slides.length} slides`);

        for (const slide of slides) {
            if (dryRun) {
                const fakeUrl = `https://i.ibb.co/fake/post${postNum}_slide${slide.slideNum}.png`;
                uploadedByPost[postNum].push(fakeUrl);
                console.log(`    🧪 Slide ${slide.slideNum}: [DRY RUN] ${fakeUrl}`);
            } else {
                try {
                    const url = await uploadImage(slide.absolutePath);
                    uploadedByPost[postNum].push(url);
                    console.log(`    ✅ Slide ${slide.slideNum}: ${url}`);
                    await sleep(500); // Respect rate limits
                } catch (err) {
                    console.error(`    ❌ Slide ${slide.slideNum} failed: ${err.message}`);
                    uploadedByPost[postNum].push(null);
                }
            }
        }
    }

    console.log('\n  ☁️  All uploads complete.\n');
    return uploadedByPost;
}

// ========================
// STEP 3: POST CAROUSELS
// ========================
async function postAllCarousels(uploadedByPost, content, igAccountId, dryRun = false, onlyPostIndex = null) {
    console.log('\n🚀 STEP 3: Posting carousels to Instagram');
    console.log('━'.repeat(50));

    const posts = content.posts;
    const spacingMs = config.posting.spacingMs;

    for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        const postNum = post.id;

        // Skip if only posting a specific index
        if (onlyPostIndex !== null && postNum !== onlyPostIndex) continue;

        const imageUrls = uploadedByPost[postNum];
        if (!imageUrls || imageUrls.length === 0) {
            console.log(`\n  ⚠️  Post ${postNum}: No images, skipping.`);
            continue;
        }

        console.log(`\n  ┌─────────────────────────────────────────┐`);
        console.log(`  │ POST ${postNum}: ${post.topic.padEnd(33)}│`);
        console.log(`  │ Slides: ${imageUrls.filter(u => u).length}${' '.repeat(33)}│`);
        console.log(`  └─────────────────────────────────────────┘`);

        try {
            const postId = await postCarousel(
                igAccountId,
                imageUrls,
                post.caption,
                dryRun
            );
            console.log(`  ✅ Post ${postNum} done! ID: ${postId}`);
        } catch (err) {
            console.error(`  ❌ Post ${postNum} failed: ${err.message}`);
        }

        // Wait between posts (unless it's dry run or the last post)
        if (!dryRun && i < posts.length - 1 && onlyPostIndex === null) {
            const hours = spacingMs / 3600000;
            console.log(`\n  ⏳ Waiting ${hours} hours before next post...`);
            await sleep(spacingMs);
        }

    }
}

// ========================
// MAIN
// ========================
async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const postIndexArg = args.indexOf('--post-index');
    const onlyPostIndex = postIndexArg !== -1 ? parseInt(args[postIndexArg + 1]) : null;

    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   📸 Instagram Carousel Auto-Publisher       ║');
    console.log('║   @dailyainewsone                            ║');
    console.log('╚══════════════════════════════════════════════╝');

    if (dryRun) console.log('\n  🧪 DRY RUN MODE — no actual uploads or posts.\n');

    // Validate config
    const configErrors = validateConfig();
    if (configErrors.length > 0) {
        console.error('\n❌ Configuration errors:');
        configErrors.forEach(e => console.error(`   • ${e}`));
        process.exit(1);
    }

    // Validate token
    console.log('\n🔑 Validating Instagram token...');
    if (!dryRun) {
        const tokenCheck = await validateToken();
        if (!tokenCheck.valid) {
            console.error(`❌ Token invalid: ${tokenCheck.error}`);
            process.exit(1);
        }
        console.log(`  ✅ Logged in as: ${tokenCheck.name}`);
    } else {
        console.log('  🧪 [DRY RUN] Skipping token validation.');
    }

    // Get IG Account ID
    const igAccountId = dryRun ? 'DRY_RUN_ID' : await getInstagramAccountId();

    // Load content
    const contentPath = path.resolve(ROOT, 'src', 'content', '2026-02-23.json');
    const content = JSON.parse(fs.readFileSync(contentPath, 'utf-8'));
    console.log(`\n📋 Loaded ${content.posts.length} posts for ${content.date}`);

    // STEP 1: Capture
    const capturedByPost = await captureAllSlides();

    // STEP 2: Upload
    const uploadedByPost = await uploadAllSlides(capturedByPost, dryRun);

    // STEP 3: Post
    await postAllCarousels(uploadedByPost, content, igAccountId, dryRun, onlyPostIndex);

    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   ✅ Pipeline complete!                      ║');
    console.log('╚══════════════════════════════════════════════╝\n');
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
});
