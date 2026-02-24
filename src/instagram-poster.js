import fetch from 'node-fetch';
import { config } from './config.js';

const GRAPH_API = config.instagram.graphApiBase;
const FB_GRAPH_API = config.instagram.facebookGraphBase;

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get the Instagram Business Account ID from the access token.
 * Uses Instagram Graph API /me endpoint (works with Instagram Login tokens).
 */
export async function getInstagramAccountId() {
    // If already set in config, return it
    if (config.instagram.accountId) {
        return config.instagram.accountId;
    }

    console.log('🔍 Looking up your Instagram Business Account ID...\n');

    // Query Instagram Graph API /me to get the account ID
    const res = await fetch(
        `${GRAPH_API}/me?fields=id,username,name,account_type&access_token=${config.instagram.accessToken}`
    );
    const data = await res.json();

    if (data.error) {
        throw new Error(`Instagram API error: ${data.error.message}`);
    }

    if (!data.id) {
        throw new Error(
            'Could not find Instagram Business Account.\n' +
            'Make sure @dailyainewsone is a Business/Creator account.'
        );
    }

    console.log(`  📸 Instagram Account: @${data.username || 'dailyainewsone'}`);
    console.log(`  🆔 Account ID: ${data.id}`);
    console.log(`  📋 Account Type: ${data.account_type || 'N/A'}\n`);
    return data.id;
}

/**
 * Create a single media container for a carousel item.
 */
async function createMediaContainer(igAccountId, imageUrl, isCarouselItem = true) {
    const params = new URLSearchParams({
        image_url: imageUrl,
        is_carousel_item: isCarouselItem.toString(),
        access_token: config.instagram.accessToken,
    });

    const res = await fetch(`${GRAPH_API}/${igAccountId}/media`, {
        method: 'POST',
        body: params,
    });

    const data = await res.json();

    if (data.error) {
        throw new Error(`Failed to create media container: ${data.error.message}`);
    }

    return data.id;
}

/**
 * Check the status of a media container.
 * Instagram processes uploaded media asynchronously.
 */
async function checkContainerStatus(containerId) {
    const res = await fetch(
        `${GRAPH_API}/${containerId}?fields=status_code,status&access_token=${config.instagram.accessToken}`
    );
    const data = await res.json();
    return data;
}

/**
 * Wait for a media container to finish processing.
 */
async function waitForContainer(containerId, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        const status = await checkContainerStatus(containerId);

        if (status.status_code === 'FINISHED') {
            return true;
        }

        if (status.status_code === 'ERROR') {
            throw new Error(`Container ${containerId} failed: ${status.status || 'Unknown error'}`);
        }

        // Wait 2 seconds before checking again
        await sleep(2000);
    }

    throw new Error(`Container ${containerId} timed out after ${maxAttempts * 2} seconds`);
}

/**
 * Create a carousel container from multiple media containers.
 */
async function createCarouselContainer(igAccountId, childContainerIds, caption) {
    const params = new URLSearchParams({
        media_type: 'CAROUSEL',
        children: childContainerIds.join(','),
        caption: caption,
        access_token: config.instagram.accessToken,
    });

    const res = await fetch(`${GRAPH_API}/${igAccountId}/media`, {
        method: 'POST',
        body: params,
    });

    const data = await res.json();

    if (data.error) {
        throw new Error(`Failed to create carousel: ${data.error.message}`);
    }

    return data.id;
}

/**
 * Publish a media container (makes it live on Instagram).
 */
async function publishMedia(igAccountId, creationId) {
    const params = new URLSearchParams({
        creation_id: creationId,
        access_token: config.instagram.accessToken,
    });

    const res = await fetch(`${GRAPH_API}/${igAccountId}/media_publish`, {
        method: 'POST',
        body: params,
    });

    const data = await res.json();

    if (data.error) {
        throw new Error(`Failed to publish: ${data.error.message}`);
    }

    return data.id;
}

/**
 * Post a single image (non-carousel) to Instagram.
 */
async function createSingleImageContainer(igAccountId, imageUrl, caption) {
    const params = new URLSearchParams({
        image_url: imageUrl,
        caption: caption,
        access_token: config.instagram.accessToken,
    });

    const res = await fetch(`${GRAPH_API}/${igAccountId}/media`, {
        method: 'POST',
        body: params,
    });

    const data = await res.json();

    if (data.error) {
        throw new Error(`Failed to create image post: ${data.error.message}`);
    }

    return data.id;
}

/**
 * Post a carousel to Instagram.
 * @param {string} igAccountId - Instagram Business Account ID
 * @param {string[]} imageUrls - Array of public image URLs (2-10 images)
 * @param {string} caption - Post caption with hashtags
 * @param {boolean} dryRun - If true, simulate without posting
 */
export async function postCarousel(igAccountId, imageUrls, caption, dryRun = false) {
    // Filter out any null URLs from failed uploads
    const validUrls = imageUrls.filter(url => url !== null);

    if (validUrls.length === 0) {
        throw new Error('No valid image URLs to post');
    }

    if (dryRun) {
        console.log('  🧪 DRY RUN — would post carousel with:');
        console.log(`     Images: ${validUrls.length}`);
        console.log(`     Caption: ${caption.substring(0, 80)}...`);
        console.log('     ✅ Validation passed\n');
        return 'DRY_RUN_SUCCESS';
    }

    // If only one image, post as single image instead of carousel
    if (validUrls.length === 1) {
        console.log('  📷 Posting as single image (1 slide)...');
        const containerId = await createSingleImageContainer(igAccountId, validUrls[0], caption);
        await waitForContainer(containerId);
        const postId = await publishMedia(igAccountId, containerId);
        console.log(`  ✅ Published! Post ID: ${postId}\n`);
        return postId;
    }

    // Step 1: Create individual containers for each image
    console.log(`  📦 Creating ${validUrls.length} media containers...`);
    const containerIds = [];

    for (let i = 0; i < validUrls.length; i++) {
        const containerId = await createMediaContainer(igAccountId, validUrls[i]);
        containerIds.push(containerId);
        console.log(`     Slide ${i + 1}: Container ${containerId}`);
        await sleep(1000); // Respect rate limits
    }

    // Step 2: Wait for all containers to finish processing
    console.log('  ⏳ Waiting for media processing...');
    for (const cid of containerIds) {
        await waitForContainer(cid);
    }
    console.log('  ✅ All media processed');

    // Step 3: Create the carousel container
    console.log('  🎠 Creating carousel...');
    const carouselId = await createCarouselContainer(igAccountId, containerIds, caption);
    await waitForContainer(carouselId);

    // Step 4: Publish
    console.log('  🚀 Publishing...');
    const postId = await publishMedia(igAccountId, carouselId);
    console.log(`  ✅ Published! Post ID: ${postId}\n`);

    return postId;
}

/**
 * Validate that the access token is still valid.
 * Uses Instagram Graph API /me (works with Instagram Login tokens).
 */
export async function validateToken() {
    const res = await fetch(
        `${GRAPH_API}/me?fields=id,username,name&access_token=${config.instagram.accessToken}`
    );
    const data = await res.json();

    if (data.error) {
        return { valid: false, error: data.error.message };
    }

    return { valid: true, name: data.username || data.name || data.id, id: data.id };
}
