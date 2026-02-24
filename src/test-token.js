import { config, validateConfig } from './config.js';
import { validateToken, getInstagramAccountId } from './instagram-poster.js';

/**
 * Test script to verify your access token and find your Instagram Account ID.
 * Run: npm run test-token
 */
async function main() {
    console.log('');
    console.log('🔑 Instagram Token Tester');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Check config
    if (!validateConfig()) {
        process.exit(1);
    }

    // Validate token
    console.log('1️⃣  Validating access token...\n');
    const tokenCheck = await validateToken();

    if (!tokenCheck.valid) {
        console.error(`  ❌ Token is INVALID: ${tokenCheck.error}`);
        console.error('');
        console.error('  Common fixes:');
        console.error('  • Token may have expired — generate a new one');
        console.error('  • Make sure you extended it to a long-lived token');
        console.error('  • Check that you granted all required permissions');
        console.error('');
        process.exit(1);
    }

    console.log(`  ✅ Token is VALID`);
    console.log(`  👤 Logged in as: ${tokenCheck.name} (ID: ${tokenCheck.id})\n`);

    // Get Instagram Account ID
    console.log('2️⃣  Looking up Instagram Business Account...\n');

    try {
        const igId = await getInstagramAccountId();
        console.log(`  ✅ Instagram Account ID: ${igId}`);
        console.log('');
        console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`  📋 Add this to your .env file:`);
        console.log(`     INSTAGRAM_ACCOUNT_ID=${igId}`);
        console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('  🎉 Everything is set up! You can now run:');
        console.log('     npm run dry-run    (test without posting)');
        console.log('     npm run post       (publish to Instagram)');
        console.log('');
    } catch (err) {
        console.error(`  ❌ ${err.message}`);
        console.error('');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('💥 Error:', err.message);
    process.exit(1);
});
