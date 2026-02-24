import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

/**
 * Upload a local image to ImgBB and return its public URL.
 * Instagram API requires publicly accessible image URLs.
 */
export async function uploadImage(imagePath) {
    if (!config.imgbb.apiKey) {
        throw new Error('IMGBB_API_KEY not set. Get a free key at https://api.imgbb.com/');
    }

    const absolutePath = path.resolve(imagePath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Image not found: ${absolutePath}`);
    }

    console.log(`  📤 Uploading: ${path.basename(imagePath)}`);

    const imageData = fs.readFileSync(absolutePath);
    const base64Image = imageData.toString('base64');

    const formBody = new URLSearchParams();
    formBody.append('key', config.imgbb.apiKey);
    formBody.append('image', base64Image);
    formBody.append('name', path.basename(imagePath, path.extname(imagePath)));

    const response = await fetch(config.imgbb.uploadUrl, {
        method: 'POST',
        body: formBody,
    });

    const result = await response.json();

    if (!result.success) {
        throw new Error(`ImgBB upload failed: ${JSON.stringify(result.error || result)}`);
    }

    const publicUrl = result.data.url;
    console.log(`  ✅ Uploaded: ${publicUrl}`);
    return publicUrl;
}

/**
 * Upload multiple images and return array of public URLs.
 */
export async function uploadImages(imagePaths) {
    console.log(`\n🖼️  Uploading ${imagePaths.length} images to ImgBB...\n`);
    const urls = [];

    for (const imgPath of imagePaths) {
        try {
            const url = await uploadImage(imgPath);
            urls.push(url);
            // Small delay between uploads to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
            console.error(`  ❌ Failed to upload ${imgPath}: ${err.message}`);
            urls.push(null);
        }
    }

    const successCount = urls.filter(u => u !== null).length;
    console.log(`\n📊 Upload complete: ${successCount}/${imagePaths.length} successful\n`);
    return urls;
}
