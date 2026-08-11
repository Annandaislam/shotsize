// Renders the ShotSize mark to the PNG sizes the Chrome Web Store requires.
// Run once: node src/make-icons.js
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');
await mkdir(outDir, { recursive: true });

// A crop-frame mark: rounded square, corner brackets, ratio dot in the middle.
const svg = (s) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${s}" height="${s}">
  <rect width="128" height="128" rx="26" fill="#c15f3c"/>
  <g fill="none" stroke="#ffffff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
    <path d="M36 50V38a2 2 0 0 1 2-2h12"/>
    <path d="M78 36h12a2 2 0 0 1 2 2v12"/>
    <path d="M92 78v12a2 2 0 0 1-2 2H78"/>
    <path d="M50 92H38a2 2 0 0 1-2-2V78"/>
  </g>
  <circle cx="64" cy="64" r="10" fill="#ffffff"/>
</svg>`;

const browser = await chromium.launch();
try {
  for (const size of [16, 48, 128]) {
    const context = await browser.newContext({ viewport: { width: size, height: size } });
    const page = await context.newPage();
    await page.setContent(
      `<body style="margin:0;background:transparent">${svg(size)}</body>`,
      { waitUntil: 'load' }
    );
    await page.screenshot({
      path: path.join(outDir, `icon${size}.png`),
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await context.close();
    console.log(`icon${size}.png`);
  }
} finally {
  await browser.close();
}
