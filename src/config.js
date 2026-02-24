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
  imgbb: {
    apiKey: process.env.IMGBB_API_KEY,
    uploadUrl: 'https://api.imgbb.com/1/upload',
  },
  posting: {
    spacingMs: parseInt(process.env.POST_SPACING_MS || '10800000', 10), // 3 hours
    maxPostsPerDay: 5,
  },
};

export function validateConfig() {
  const errors = [];

  if (!config.instagram.accessToken || config.instagram.accessToken === 'PASTE_YOUR_TOKEN_HERE') {
    errors.push(' INSTAGRAM_ACCESS_TOKEN is not set in .env');
  }

  if (!config.imgbb.apiKey) {
    errors.push(' IMGBB_API_KEY is not set. Get a free key at https://api.imgbb.com/');
  }

  if (errors.length > 0) {
    console.log('\\n🔧 Configuration Issues:\\n');
    errors.forEach(e => console.log(`  ${e}`));
    console.log('\\n📖 See .env file for setup instructions.\\n');
    return false;
  }

  return true;
}
