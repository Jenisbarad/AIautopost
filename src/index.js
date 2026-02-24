import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, validateConfig } from './config.js';
import { uploadImages } from './upload-images.js';
import { postCarousel, getInstagramAccountId, validateToken } from './instagram-poster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Sleep for a given number of milliseconds with a countdown display.
 */
function sleepWithCountdown(ms, label) {
    return new Promise(resolve => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        console.log(`\n⏰ Next post in ${hours}h ${minutes}m — ${label}`);
        console.log('   (Press Ctrl+C to cancel)\n');
        setTimeout(resolve, ms);
    });
}

/**
 * Load today's content file.
 */
function loadContent(dateStr) {
    const contentPath = path.join(__dirname, 'content', `${dateStr}.json`);

    if (!fs.existsSync(contentPath)) {
        console.error(`❌ No content file found for ${dateStr}`);
        console.error(`   Expected: ${contentPath}`);
        console.error(`   Generate content first using the AI-ML News Agent workflow.`);
        process.exit(1);
    }

    return JSON.parse(fs.readFileSync(contentPath, 'utf-8'));
}

/**
 * Resolve image paths relative to the content directory.
 */
function resolveImagePaths(images) {
    return images.map(img => {
        const resolved = path.resolve(path.join(__dirname, 'content'), img);
        if (!fs.existsSync(resolved)) {
            // Try from project root images/ directory
            const fromRoot = path.resolve(path.join(__dirname, '..', 'images', path.basename(img)));
            if (fs.existsSync(fromRoot)) return fromRoot;
            console.warn(`  ⚠️  Image not found: ${resolved}`);
            return null;
        }
        return resolved;
    }).filter(Boolean);
}

/**
 * Main execution function.
 */
async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const postIndexArg = args.find(a => a.startsWith('--post-index'));
    const specificPost = postIndexArg ? parseInt(args[args.indexOf('--post-index') + 1], 10) : null;

    // Header
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   🤖 AI-ML News Instagram Poster             ║');
    console.log('║   @dailyainewsone                            ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    if (dryRun) {
        console.log('🧪 DRY RUN MODE — no posts will be published\n');
    }

    // Step 1: Validate configuration
    console.log('━━━ Step 1: Checking configuration ━━━\n');
    if (!validateConfig()) {
        process.exit(1);
    }
    console.log('  ✅ Configuration OK\n');

    // Step 2: Validate token
    console.log('━━━ Step 2: Validating access token ━━━\n');
    if (!dryRun) {
        const tokenCheck = await validateToken();
        if (!tokenCheck.valid) {
            console.error(`  ❌ Access token is invalid: ${tokenCheck.error}`);
            console.error('  💡 Generate a new token at developers.facebook.com/tools/explorer\n');
            process.exit(1);
        }
        console.log(`  ✅ Token valid — logged in as: ${tokenCheck.name}\n`);
    } else {
        console.log('  ⏩ Skipped in dry-run mode\n');
    }

    // Step 3: Get Instagram Account ID
    console.log('━━━ Step 3: Getting Instagram Account ID ━━━\n');
    let igAccountId;
    if (!dryRun) {
        igAccountId = await getInstagramAccountId();
    } else {
        igAccountId = config.instagram.accountId || 'DRY_RUN_ID';
        console.log(`  ⏩ Using: ${igAccountId}\n`);
    }

    // Step 4: Load content
    console.log('━━━ Step 4: Loading content ━━━\n');
    const today = new Date().toISOString().split('T')[0];
    const content = loadContent('2026-02-23'); // Use today's content
    console.log(`  📅 Date: ${content.date}`);
    console.log(`  📊 Posts: ${content.totalPosts}`);
    console.log(`  🔥 Highest score: ${content.highestPopularityScore}\n`);

    // Determine which posts to publish
    let postsToPublish = content.posts;
    if (specificPost !== null) {
        postsToPublish = content.posts.filter(p => p.id === specificPost);
        if (postsToPublish.length === 0) {
            console.error(`  ❌ Post index ${specificPost} not found`);
            process.exit(1);
        }
        console.log(`  🎯 Publishing only Post #${specificPost}\n`);
    }

    // Step 5: Process each post
    for (let i = 0; i < postsToPublish.length; i++) {
        const post = postsToPublish[i];

        console.log(`━━━ Post ${post.id}/${content.totalPosts}: ${post.topic} ━━━`);
        console.log(`  📰 "${post.headline}"`);
        console.log(`  📈 Popularity: ${post.popularityScore}/100\n`);

        // Upload images
        const imagePaths = resolveImagePaths(post.images);

        if (imagePaths.length === 0) {
            console.log('  ⚠️  No images found — skipping this post\n');
            continue;
        }

        let imageUrls;
        if (!dryRun) {
            imageUrls = await uploadImages(imagePaths);
        } else {
            imageUrls = imagePaths.map(p => `https://example.com/${path.basename(p)}`);
            console.log(`  🧪 DRY RUN: Would upload ${imagePaths.length} images\n`);
        }

        // Post to Instagram
        try {
            const postId = await postCarousel(igAccountId, imageUrls, post.caption, dryRun);
            console.log(`  🎉 Post ${post.id} complete! ${dryRun ? '(dry run)' : `ID: ${postId}`}\n`);
        } catch (err) {
            console.error(`  ❌ Failed to post: ${err.message}\n`);
            // Continue with next post
        }

        // Wait between posts (skip for last post and dry runs)
        if (i < postsToPublish.length - 1 && !dryRun && !specificPost) {
            await sleepWithCountdown(
                config.posting.spacingMs,
                `Post ${postsToPublish[i + 1].id}: ${postsToPublish[i + 1].topic}`
            );
        }
    }

    // Summary
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   ✅ All posts processed!                    ║');
    console.log('║   Check @dailyainewsone on Instagram         ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
}

main().catch(err => {
    console.error('\\n💥 Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
});
