import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
  instagram: {
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
    accountId: process.env.INSTAGRAM_ACCOUNT_ID,
    graphApiBase: 'https://graph.instagram.com/v21.0',
    facebookGraphBase: 'https://graph.facebook.com/v21.0',
  },
  github: {
    rawBaseUrl: 'https://raw.githubusercontent.com/Jenisbarad/AIautopost/main',
  },
  posting: {
    spacingMs: parseInt(process.env.POST_SPACING_MS || '10800000', 10), // 3 hours
    maxPostsPerDay: 5,
  },
};

export function validateConfig() {
  const errors = [];

  if (!config.instagram.accessToken || config.instagram.accessToken === 'PASTE_YOUR_TOKEN_HERE') {
    errors.push('INSTAGRAM_ACCESS_TOKEN is not set in .env');
  }

  if (errors.length > 0) {
    console.log('\n🔧 Configuration Issues:\n');
    errors.forEach(e => console.log(`  ${e}`));
    console.log('\n📖 See .env file for setup instructions.\n');
  }

  return errors;
}
