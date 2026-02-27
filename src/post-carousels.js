/**
 * post-carousels.js
 *
 * Autonomous Instagram carousel posting pipeline:
 *   1. Load content JSON for today's date
 *   2. Build public GitHub raw URLs for slide images
 *   3. Post each set of slides as an Instagram carousel
 *
 * Usage:
 *   node src/post-carousels.js                      → post all carousels
 *   node src/post-carousels.js --dry-run             → simulate everything
 *   node src/post-carousels.js --post-index 2        → only post #2
 *   node src/post-carousels.js --post-index 2 --dry-run
 *
 * No ImgBB needed — uses GitHub raw URLs directly.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { config, validateConfig } from './config.js';
import { validateToken, getInstagramAccountId, postCarousel } from './instagram-poster.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ======================================
// STEP 1: BUILD GITHUB RAW IMAGE URLS
// ======================================
function buildGitHubImageUrls(capturedDir, onlyPostIndex = null) {
    console.log('\n🔗 STEP 1: Building GitHub raw image URLs');
    console.log('━'.repeat(50));

    if (!fs.existsSync(capturedDir)) {
        console.error(`❌ No captured images directory: ${capturedDir}`);
        process.exit(1);
    }

    const files = fs.readdirSync(capturedDir).filter(f => f.endsWith('.png'));
    if (files.length === 0) {
        console.error('❌ No PNG images found in images/captured/');
        process.exit(1);
    }

    const imagesByPost = {};

    for (const filename of files) {
        const match = filename.match(/post(\d+)_slide(\d+)\.png/);
        if (!match) continue;

        const postNum = parseInt(match[1]);
        const slideNum = parseInt(match[2]);

        // Skip posts we won't be posting
        if (onlyPostIndex !== null && postNum !== onlyPostIndex) continue;

        const rawUrl = `${config.github.rawBaseUrl}/images/captured/${filename}`;

        if (!imagesByPost[postNum]) imagesByPost[postNum] = [];
        imagesByPost[postNum].push({ slideNum, url: rawUrl, filename });

        console.log(`  ✅ Post ${postNum}, Slide ${slideNum} → ${rawUrl}`);
    }

    // Sort slides within each post
    for (const key of Object.keys(imagesByPost)) {
        imagesByPost[key].sort((a, b) => a.slideNum - b.slideNum);
    }

    const totalSlides = Object.values(imagesByPost).flat().length;
    console.log(`\n  📊 ${totalSlides} image URLs ready.\n`);
    return imagesByPost;
}

// ========================
// STEP 2: POST CAROUSELS
// ========================
async function postAllCarousels(imagesByPost, content, igAccountId, dryRun = false, onlyPostIndex = null) {
    console.log('\n🚀 STEP 2: Posting carousels to Instagram');
    console.log('━'.repeat(50));

    const posts = content.posts;

    for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        const postNum = post.id;

        // Skip if only posting a specific index
        if (onlyPostIndex !== null && postNum !== onlyPostIndex) continue;

        const postImages = imagesByPost[postNum];
        if (!postImages || postImages.length === 0) {
            console.log(`\n  ⚠️  Post ${postNum}: No images, skipping.`);
            continue;
        }

        const imageUrls = postImages.map(img => img.url);

        console.log(`\n  ┌─────────────────────────────────────────┐`);
        console.log(`  │ POST ${postNum}: ${post.topic.padEnd(33)}│`);
        console.log(`  │ Slides: ${imageUrls.length}${' '.repeat(33)}│`);
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

        // Wait between posts (unless it's dry run or the last post or single post mode)
        if (!dryRun && i < posts.length - 1 && onlyPostIndex === null) {
            const spacingMs = config.posting.spacingMs;
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
    console.log('║   Using GitHub Raw URLs (no ImgBB)           ║');
    console.log('╚══════════════════════════════════════════════╝');

    if (dryRun) console.log('\n  🧪 DRY RUN MODE — no actual posts.\n');

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

    // Load content — auto-detect latest JSON file from content/
    const contentDir = path.resolve(ROOT, 'content');
    const jsonFiles = fs.readdirSync(contentDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();

    if (jsonFiles.length === 0) {
        console.error('No content JSON files found in content/');
        process.exit(1);
    }

    const contentFile = jsonFiles[0];
    const contentPath = path.resolve(contentDir, contentFile);
    const content = JSON.parse(fs.readFileSync(contentPath, 'utf-8'));
    console.log(`\n📄 Loaded ${content.posts.length} posts from ${contentFile}`);

    // STEP 1: Build GitHub raw image URLs (no uploads needed!)
    const capturedDir = path.resolve(ROOT, 'images', 'captured');
    const imagesByPost = buildGitHubImageUrls(capturedDir, onlyPostIndex);

    // STEP 2: Post carousels
    await postAllCarousels(imagesByPost, content, igAccountId, dryRun, onlyPostIndex);

    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   ✅ Pipeline complete!                      ║');
    console.log('╚══════════════════════════════════════════════╝\n');
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
});
