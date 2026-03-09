/**
 * generate-images.js
 *
 * Autonomous image generation pipeline for GitHub Actions:
 *   1. Loads content JSON for the target date
 *   2. Generates HTML slides via generate-slides.js logic
 *   3. Captures each slide as a 1024x1024 PNG using Puppeteer
 *   4. Saves images to images/captured/ (overwrites previous)
 *
 * Usage:
 *   node src/generate-images.js                     → uses latest content
 *   node src/generate-images.js --date 2026-02-25   → specific date
 *
 * Runs fully inside GitHub Actions — no local PC needed.
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Find content JSON ───
function loadContent() {
    const args = process.argv.slice(2);
    const dateIdx = args.indexOf('--date');
    let targetDate = null;

    if (dateIdx !== -1 && args[dateIdx + 1]) {
        targetDate = args[dateIdx + 1];
    }

    const contentDir = path.resolve(ROOT, 'content');
    let contentFile;

    if (targetDate) {
        contentFile = `${targetDate}.json`;
    } else {
        // Use latest JSON file
        const files = fs.readdirSync(contentDir).filter(f => f.endsWith('.json')).sort().reverse();
        if (files.length === 0) {
            console.error('No content JSON files found in content/');
            process.exit(1);
        }
        contentFile = files[0];
    }

    const contentPath = path.resolve(contentDir, contentFile);
    if (!fs.existsSync(contentPath)) {
        console.error(`Content file not found: ${contentPath}`);
        process.exit(1);
    }

    console.log(`  📄 Loading content: ${contentFile}`);
    const content = JSON.parse(fs.readFileSync(contentPath, 'utf-8'));
    const inferredDate = targetDate || contentFile.replace(/\.json$/i, '');
    return { content, inferredDate, contentFile };
}

// ─── Step 1: Generate HTML slides (inline from generate-slides.js) ───
function generateSlidesHTML(content) {
    function hexToRgb(hex) {
        const h = String(hex || '').replace('#', '').trim();
        if (h.length !== 6) return null;
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        if ([r, g, b].some(n => Number.isNaN(n))) return null;
        return { r, g, b };
    }

    function rgbToHex({ r, g, b }) {
        const to = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
        return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
    }

    function lighten(hex, amount = 0.3) {
        const rgb = hexToRgb(hex);
        if (!rgb) return hex;
        return rgbToHex({
            r: rgb.r + (255 - rgb.r) * amount,
            g: rgb.g + (255 - rgb.g) * amount,
            b: rgb.b + (255 - rgb.b) * amount,
        });
    }

    function themeForDate(dateStr) {
        const basePalette = [
            '#0B1F3B',
            '#0B2F3B',
            '#0B3B36',
            '#0F3B2A',
            '#1A1F3B',
            '#1F1A3B',
            '#0B223D',
        ];
        const d = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
        const dayIndex = Math.floor(d.getTime() / (24 * 60 * 60 * 1000));
        const base = basePalette[Math.abs(dayIndex) % basePalette.length];
        const accent = lighten(base, 0.45);
        const accent2 = lighten(base, 0.6);
        const text = '#E6E6E6';
        return { backgroundHex: base, accentHex: accent, accentHex2: accent2, textHex: text, _dayIndex: dayIndex, _palette: basePalette };
    }

    const theme = {
        ...themeForDate(content.date),
        backgroundHex: content.backgroundHex || themeForDate(content.date).backgroundHex,
        accentHex: content.accentHex || themeForDate(content.date).accentHex,
        textHex: content.textHex || themeForDate(content.date).textHex,
    };
    theme.accentHex2 = content.accentHex2 || lighten(theme.backgroundHex, 0.6);

    function themeForPost(postNum) {
        // Colors change exactly after every 3 posts: (1-3) same, (4-6) next, etc.
        const groupIndex = Math.floor((Number(postNum || 1) - 1) / 3);
        const basePalette = theme?._palette || themeForDate(content.date)._palette;
        const dayIndex = typeof theme?._dayIndex === 'number' ? theme._dayIndex : themeForDate(content.date)._dayIndex;
        const base = basePalette[Math.abs(dayIndex + groupIndex) % basePalette.length];
        return {
            backgroundHex: base,
            accentHex: lighten(base, 0.45),
            accentHex2: lighten(base, 0.6),
            textHex: theme.textHex || '#E6E6E6',
        };
    }

    function escapeHtml(s) {
        // We escape only the characters that would break HTML markup.
        // Apostrophes are left as-is so they render as normal characters
        // in the final PNGs instead of the literal sequence &#39;.
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function highlightNumbers(escapedText) {
        // Input must already be HTML-escaped
        const re = /(\$?\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\$?\b\d+(?:\.\d+)?\b(?:\s?(?:%|bn|b|m|k))?)/gi;
        return String(escapedText).replace(re, '<span class="num">$1</span>');
    }

    function formatLine(s) {
        return highlightNumbers(escapeHtml(s));
    }

    // SVG icon library
    const SVG_ICONS = {
        brain: '<svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="20" stroke="#4d8dff" stroke-width="1.5" opacity="0.4"/><circle cx="32" cy="32" r="10" fill="#4d8dff" opacity="0.25"/><circle cx="32" cy="32" r="5" fill="#4d8dff"/><line x1="32" y1="6" x2="32" y2="16" stroke="#4d8dff" stroke-width="1.5"/><line x1="32" y1="48" x2="32" y2="58" stroke="#4d8dff" stroke-width="1.5"/><line x1="6" y1="32" x2="16" y2="32" stroke="#4d8dff" stroke-width="1.5"/><line x1="48" y1="32" x2="58" y2="32" stroke="#4d8dff" stroke-width="1.5"/></svg>',
        chip: '<svg viewBox="0 0 64 64" fill="none"><rect x="12" y="12" width="40" height="40" rx="4" stroke="#4d8dff" stroke-width="1.5" opacity="0.4"/><rect x="22" y="22" width="20" height="20" rx="2" fill="#4d8dff" opacity="0.25"/><rect x="28" y="28" width="8" height="8" rx="1" fill="#4d8dff"/><line x1="32" y1="4" x2="32" y2="12" stroke="#4d8dff" stroke-width="1.5"/><line x1="32" y1="52" x2="32" y2="60" stroke="#4d8dff" stroke-width="1.5"/><line x1="4" y1="32" x2="12" y2="32" stroke="#4d8dff" stroke-width="1.5"/><line x1="52" y1="32" x2="60" y2="32" stroke="#4d8dff" stroke-width="1.5"/></svg>',
        shield: '<svg viewBox="0 0 64 64" fill="none"><path d="M32 6L10 20V48L32 58L54 48V20L32 6Z" stroke="#4d8dff" stroke-width="1.5" opacity="0.4"/><path d="M32 18L42 24V36L32 42L22 36V24L32 18Z" fill="#4d8dff" opacity="0.25"/><path d="M32 26L36 28V34L32 36L28 34V28L32 26Z" fill="#4d8dff"/></svg>',
        network: '<svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="20" r="14" stroke="#4d8dff" stroke-width="1.5" opacity="0.4"/><circle cx="32" cy="20" r="7" fill="#4d8dff" opacity="0.25"/><circle cx="32" cy="20" r="3" fill="#4d8dff"/><line x1="24" y1="34" x2="18" y2="56" stroke="#4d8dff" stroke-width="1.5" opacity="0.5"/><line x1="40" y1="34" x2="46" y2="56" stroke="#4d8dff" stroke-width="1.5" opacity="0.5"/><line x1="32" y1="34" x2="32" y2="58" stroke="#4d8dff" stroke-width="1.5"/></svg>',
        globe: '<svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="22" stroke="#4d8dff" stroke-width="1.5" opacity="0.4"/><ellipse cx="32" cy="32" rx="12" ry="22" stroke="#4d8dff" stroke-width="1" opacity="0.3"/><line x1="10" y1="32" x2="54" y2="32" stroke="#4d8dff" stroke-width="1" opacity="0.3"/><circle cx="32" cy="32" r="8" fill="#4d8dff" opacity="0.2"/><circle cx="32" cy="32" r="3" fill="#4d8dff"/></svg>',
        code: '<svg viewBox="0 0 64 64" fill="none"><rect x="8" y="14" width="48" height="36" rx="4" stroke="#4d8dff" stroke-width="1.5" opacity="0.4"/><text x="20" y="38" fill="#4d8dff" font-size="16" font-family="monospace" opacity="0.8">&lt;/&gt;</text></svg>',
        atom: '<svg viewBox="0 0 64 64" fill="none"><ellipse cx="32" cy="32" rx="24" ry="10" stroke="#4d8dff" stroke-width="1.5" opacity="0.3" transform="rotate(0 32 32)"/><ellipse cx="32" cy="32" rx="24" ry="10" stroke="#4d8dff" stroke-width="1.5" opacity="0.3" transform="rotate(60 32 32)"/><ellipse cx="32" cy="32" rx="24" ry="10" stroke="#4d8dff" stroke-width="1.5" opacity="0.3" transform="rotate(120 32 32)"/><circle cx="32" cy="32" r="4" fill="#4d8dff"/></svg>',
        rocket: '<svg viewBox="0 0 64 64" fill="none"><path d="M32 8C32 8 44 20 44 36C44 44 38 52 32 56C26 52 20 44 20 36C20 20 32 8 32 8Z" stroke="#4d8dff" stroke-width="1.5" opacity="0.4"/><circle cx="32" cy="32" r="6" fill="#4d8dff" opacity="0.25"/><circle cx="32" cy="32" r="3" fill="#4d8dff"/></svg>',
        database: '<svg viewBox="0 0 64 64" fill="none"><ellipse cx="32" cy="18" rx="20" ry="8" stroke="#4d8dff" stroke-width="1.5" opacity="0.4"/><path d="M12 18V46C12 50.4 20.9 54 32 54C43.1 54 52 50.4 52 46V18" stroke="#4d8dff" stroke-width="1.5" opacity="0.4"/><ellipse cx="32" cy="32" rx="20" ry="8" stroke="#4d8dff" stroke-width="1" opacity="0.2"/><ellipse cx="32" cy="18" rx="10" ry="4" fill="#4d8dff" opacity="0.25"/></svg>',
        lock: '<svg viewBox="0 0 64 64" fill="none"><path d="M32 6L10 20V48L32 58L54 48V20L32 6Z" stroke="#4d8dff" stroke-width="1.5" opacity="0.3"/><path d="M32 16L18 24V40L32 48L46 40V24L32 16Z" stroke="#4d8dff" stroke-width="1.5" opacity="0.5"/><rect x="26" y="24" width="12" height="14" rx="2" fill="#4d8dff" opacity="0.25"/><rect x="29" y="30" width="6" height="8" rx="1" fill="#4d8dff"/></svg>',
    };

    function getIcon(name) {
        return SVG_ICONS[name] || SVG_ICONS.brain;
    }

    function findGlowWord(headline) {
        const skip = ['the', 'a', 'an', 'is', 'are', 'was', 'its', 'it', 'to', 'for', 'and', 'or', 'in', 'on', 'of', 'at', 'by', 'this', 'that', 'now', 'just', 'will', 'can', 'has', 'had', 'not', 'but', 'with', 'from', 'as', 'be', 'do'];
        const words = headline.split(' ');
        for (const w of words) {
            if (/^\$?\d/.test(w)) return w;
        }
        const candidates = words.filter(w => !skip.includes(w.toLowerCase()) && w.length > 3);
        return candidates.length > 0 ? candidates[Math.floor(candidates.length / 2)] : words[2] || words[0];
    }

    function generateSlideHTML(post, postNum) {
        const sc = post.slideContent;
        if (!sc || !sc.slide1 || !sc.slide2 || !sc.slide3) {
            throw new Error(
                `Content JSON is missing slideContent for post ${postNum}. ` +
                `Regenerate content using the updated generator (node src/generate-content.js --date <YYYY-MM-DD>).`
            );
        }
        const totalSlides = post.slides || (sc.slide4 ? 4 : 3);
        const icon = getIcon(post.svgIcon || 'brain');
        const glowWord = findGlowWord(sc.slide1.headline);
        const safeHeadline = escapeHtml(sc.slide1.headline);
        const safeGlowWord = escapeHtml(glowWord);
        const headlineHtml = safeHeadline.replace(safeGlowWord, `<span class="g">${safeGlowWord}</span>`);

        let slides = '';

        // Slide 1: Cover
        slides += `
  <div class="slide" id="p${postNum}s1">
    <div class="grid"></div><div class="blob1"></div><div class="blob2"></div>
    <div class="content cover">
      <div class="cover-icon">${icon}</div>
      <h1>${headlineHtml}</h1>
      <div class="sub">${formatLine(sc.slide1.subtitle)}</div>
    </div>
    <div class="glow-border"></div><div class="glow-left"></div><div class="glow-right"></div>
    <div class="corner-tl"></div><div class="corner-br"></div>
    <div class="bottom-bar"><span>@dailyainewsone</span><span>1/${totalSlides}</span></div>
  </div>`;

        // Slide 2
        const s2lines = sc.slide2.lines.map(formatLine).join('<br><br>');
        slides += `
  <div class="slide" id="p${postNum}s2">
    <div class="grid"></div><div class="blob1"></div><div class="blob2"></div>
    <div class="content body">
      <div class="label">${sc.slide2.title.toUpperCase()}</div>
      <div class="text">${s2lines}</div>
    </div>
    <div class="glow-border"></div><div class="glow-left"></div><div class="glow-right"></div>
    <div class="corner-tl"></div><div class="corner-br"></div>
    <div class="bottom-bar"><span>@dailyainewsone</span><span>2/${totalSlides}</span></div>
  </div>`;

        // Slide 3
        const s3lines = sc.slide3.lines.map(formatLine).join('<br><br>');
        slides += `
  <div class="slide" id="p${postNum}s3">
    <div class="grid"></div><div class="blob1"></div><div class="blob2"></div>
    <div class="content body">
      <div class="label">${sc.slide3.title.toUpperCase()}</div>
      <div class="text">${s3lines}</div>
    </div>
    <div class="glow-border"></div><div class="glow-left"></div><div class="glow-right"></div>
    <div class="corner-tl"></div><div class="corner-br"></div>
    <div class="bottom-bar"><span>@dailyainewsone</span><span>3/${totalSlides}</span></div>
  </div>`;

        // Slide 4 (optional)
        if (totalSlides >= 4 && sc.slide4) {
            const bullets = Array.isArray(sc.slide4.bullets) ? [...sc.slide4.bullets] : [];
            let sourceLine = '';
            if (bullets.length > 0 && String(bullets[bullets.length - 1]).trim().toLowerCase().startsWith('source:')) {
                sourceLine = String(bullets.pop());
            }
            const bulletsHtml = bullets.map(b => `<div class="bi">${formatLine(b)}</div>`).join('\n        ');
            slides += `
  <div class="slide" id="p${postNum}s4">
    <div class="grid"></div><div class="blob1"></div><div class="blob2"></div>
    <div class="content body">
      <div class="label alt">${escapeHtml(sc.slide4.title.toUpperCase())}</div>
      <div class="bullets">
        ${bulletsHtml}
      </div>
      ${sourceLine ? `<div class="source">${formatLine(sourceLine)}</div>` : ''}
    </div>
    <div class="glow-border"></div><div class="glow-left"></div><div class="glow-right"></div>
    <div class="corner-tl"></div><div class="corner-br"></div>
    <div class="bottom-bar"><span>@dailyainewsone</span><span>4/${totalSlides}</span></div>
  </div>`;
        }

        return slides;
    }

    const postSections = content.posts.map((post) => {
        const postNum = post.id;
        const t = themeForPost(postNum);
        const accentRgb = hexToRgb(t.accentHex) || { r: 77, g: 141, b: 255 };
        const accentRgbStr = `${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}`;
        const slideHtml = generateSlideHTML(post, postNum);
        return `
<!-- ========== POST ${postNum}: ${post.topic.toUpperCase()} ========== -->
<div class="post-theme" style="--bg:${t.backgroundHex};--accent:${t.accentHex};--accent2:${t.accentHex2};--text:${t.textHex};--accent-rgb:${accentRgbStr};">
  <div class="post-label">POST ${postNum} — ${post.topic.toUpperCase()}</div>
  <div class="slide-row">
  ${slideHtml}
  </div>
</div>

<hr>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Daily AI News Slides — ${content.date}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  :root { --bg: ${theme.backgroundHex}; --accent: ${theme.accentHex}; --accent2: ${theme.accentHex2}; --text: ${theme.textHex}; --accent-rgb: 77, 141, 255; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #050810;
    font-family: 'Inter', sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px;
    gap: 60px;
  }
  .post-label { font-size: 16px; font-weight: 700; color: var(--accent); letter-spacing: 4px; text-transform: uppercase; text-align: center; margin-bottom: -30px; }
  .slide-row { display: flex; gap: 30px; flex-wrap: wrap; justify-content: center; }
  .slide { width: 512px; height: 512px; position: relative; overflow: hidden; flex-shrink: 0; background: linear-gradient(135deg, #050810 0%, var(--bg) 55%, #050810 100%); }
  .grid { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-image: linear-gradient(rgba(var(--accent-rgb),0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(var(--accent-rgb),0.06) 1px, transparent 1px); background-size: 32px 32px; z-index: 1; }
  .glow-border { position: absolute; top: 0; left: 0; right: 0; bottom: 0; border: 1.5px solid rgba(var(--accent-rgb),0.14); z-index: 5; pointer-events: none; }
  .glow-border::before { content: ''; position: absolute; top: -1px; left: 15%; right: 15%; height: 2px; background: linear-gradient(90deg, transparent, var(--accent), var(--accent2), transparent); filter: blur(1px); }
  .glow-border::after { content: ''; position: absolute; bottom: -1px; left: 15%; right: 15%; height: 2px; background: linear-gradient(90deg, transparent, var(--accent2), var(--accent), transparent); filter: blur(1px); }
  .glow-left { position: absolute; top: 15%; bottom: 15%; left: -1px; width: 2px; background: linear-gradient(180deg, transparent, var(--accent), transparent); filter: blur(1px); z-index: 5; }
  .glow-right { position: absolute; top: 15%; bottom: 15%; right: -1px; width: 2px; background: linear-gradient(180deg, transparent, var(--accent2), transparent); filter: blur(1px); z-index: 5; }
  .corner-tl { position: absolute; top: 16px; left: 16px; width: 48px; height: 48px; border-top: 1.5px solid rgba(var(--accent-rgb),0.25); border-left: 1.5px solid rgba(var(--accent-rgb),0.25); z-index: 4; }
  .corner-tl::after { content: ''; position: absolute; top: -3px; left: -3px; width: 6px; height: 6px; background: var(--accent); border-radius: 50%; box-shadow: 0 0 10px rgba(var(--accent-rgb),0.9); }
  .corner-br { position: absolute; bottom: 16px; right: 16px; width: 48px; height: 48px; border-bottom: 1.5px solid rgba(var(--accent-rgb),0.22); border-right: 1.5px solid rgba(var(--accent-rgb),0.22); z-index: 4; }
  .corner-br::after { content: ''; position: absolute; bottom: -3px; right: -3px; width: 6px; height: 6px; background: var(--accent2); border-radius: 50%; box-shadow: 0 0 10px rgba(var(--accent-rgb),0.55); }
  .blob1 { position: absolute; width: 250px; height: 250px; background: radial-gradient(circle, rgba(var(--accent-rgb),0.12) 0%, transparent 70%); top: -80px; right: -60px; z-index: 1; }
  .blob2 { position: absolute; width: 200px; height: 200px; background: radial-gradient(circle, rgba(var(--accent-rgb),0.08) 0%, transparent 70%); bottom: -60px; left: -40px; z-index: 1; }
  .content { position: relative; z-index: 3; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 52px; }
  .bottom-bar { position: absolute; bottom: 20px; left: 52px; right: 52px; display: flex; justify-content: space-between; z-index: 6; font-size: 11px; font-weight: 600; color: rgba(148,163,184,0.5); }
  .content.cover { text-align: center; align-items: center; }
  .cover-icon { margin-bottom: 24px; }
  .cover-icon svg { width: 44px; height: 44px; filter: drop-shadow(0 0 14px rgba(var(--accent-rgb),0.55)); }
  .cover h1 { font-size: 32px; font-weight: 900; line-height: 1.15; letter-spacing: -0.5px; color: #fff; margin-bottom: 14px; }
  .cover h1 .g { color: var(--accent); text-shadow: 0 0 25px rgba(var(--accent-rgb),0.5); }
  .cover .sub { font-size: 14px; color: var(--text); opacity: 0.8; }
  .content.body { text-align: left; }
  .label { font-size: 11px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: var(--accent); margin-bottom: 26px; }
  .label.alt { color: var(--accent2); }
  .text { font-size: 15px; font-weight: 400; line-height: 1.8; color: var(--text); opacity: 0.92; }
  .bullets { text-align: left; }
  .bi { font-size: 13px; line-height: 1.45; color: var(--text); opacity: 0.92; margin-bottom: 14px; padding-left: 22px; position: relative; }
  .bi::before { content: ''; position: absolute; left: 0; top: 6px; width: 10px; height: 10px; background: var(--accent); border-radius: 50%; box-shadow: 0 0 10px rgba(var(--accent-rgb),0.55); }
  .num { font-weight: 800; color: inherit; }
  .source { position: absolute; left: 52px; right: 52px; bottom: 44px; font-size: 10px; color: var(--text); opacity: 0.75; }
  hr { border: none; border-top: 1px solid rgba(var(--accent-rgb),0.14); width: 400px; margin: 20px 0; }
</style>
</head>
<body>

${postSections}

</body>
</html>`;
}

// ─── Step 2: Capture screenshots with Puppeteer ───
async function captureSlides(htmlPath, outputDir) {
    console.log('\n📸 Capturing slides with Puppeteer...');
    console.log('━'.repeat(40));

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });

    await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, {
        waitUntil: 'networkidle0',
        timeout: 30000,
    });

    // Wait for fonts
    await page.evaluate(() => document.fonts.ready);
    await sleep(2000);

    const slideElements = await page.$$('.slide');
    console.log(`  Found ${slideElements.length} slides to capture.\n`);

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

    console.log(`\n  🎉 Captured ${slideElements.length} slides total.\n`);
    return capturedByPost;
}

// ─── MAIN ───
async function main() {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   🖼️  Image Generator — @dailyainewsone      ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    // Step 1: Load content
    const { content, inferredDate, contentFile } = loadContent();
    const dateTag = inferredDate || content.date;
    if (!dateTag) {
        console.error('Could not determine target date for images folder.');
        process.exit(1);
    }
    console.log(`  📅 Date: ${content.date || dateTag}`);
    console.log(`  🧾 Source: ${contentFile}`);
    console.log(`  📊 Posts: ${content.posts.length}\n`);

    // Step 2: Generate HTML
    console.log('  🎨 Generating slide HTML...');
    const html = generateSlidesHTML(content);

    const slidesDir = path.resolve(ROOT, 'slides');
    if (!fs.existsSync(slidesDir)) {
        fs.mkdirSync(slidesDir, { recursive: true });
    }

    const htmlPath = path.resolve(slidesDir, 'all-slides.html');
    fs.writeFileSync(htmlPath, html);
    console.log(`  ✅ HTML saved: ${htmlPath}`);

    // Step 3: Capture screenshots
    // Store images under a date folder to avoid reusing/caching old URLs
    const outputDir = path.resolve(ROOT, 'images', 'captured', dateTag);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Clear old captured images
    const oldFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.png'));
    for (const f of oldFiles) {
        fs.unlinkSync(path.resolve(outputDir, f));
    }
    console.log(`  🗑️  Cleared ${oldFiles.length} old images.`);

    const capturedByPost = await captureSlides(htmlPath, outputDir);

    // Save mapping file
    const mapping = {};
    for (const [postNum, slides] of Object.entries(capturedByPost)) {
        mapping[postNum] = slides.map(s => s.relativePath);
    }

    const mappingPath = path.resolve(outputDir, 'mapping.json');
    fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
    console.log(`  📋 Mapping saved: ${mappingPath}`);

    // Save meta for workflow/debugging
    const metaPath = path.resolve(outputDir, 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({
        date: dateTag,
        sourceContentFile: contentFile,
        generatedAt: new Date().toISOString(),
        totalSlides: Object.values(capturedByPost).flat().length,
    }, null, 2));

    const totalSlides = Object.values(capturedByPost).flat().length;
    console.log(`\n╔══════════════════════════════════════════════╗`);
    console.log(`║   ✅ ${totalSlides} images generated successfully!      ║`);
    console.log(`╚══════════════════════════════════════════════╝\n`);
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
});
