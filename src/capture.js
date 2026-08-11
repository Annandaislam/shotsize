import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Parse "1920x1080" into { width, height }. Accepts x, X, or * as separator.
 */
export function parseSize(input) {
  const m = String(input).trim().match(/^(\d{1,5})\s*[xX*]\s*(\d{1,5})$/);
  if (!m) throw new Error(`Bad size "${input}": expected WIDTHxHEIGHT, e.g. 1920x1080`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width < 1 || height < 1) throw new Error(`Bad size "${input}": dimensions must be at least 1px`);
  // Chromium refuses to allocate device metrics beyond this.
  if (width > 16384 || height > 16384) throw new Error(`Bad size "${input}": max 16384px per side`);
  return { width, height };
}

export function normalizeUrl(input, { allowLocal = true } = {}) {
  const url = String(input).trim();
  const full = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;

  let parsed;
  try { parsed = new URL(full); }
  catch { throw new Error(`Bad URL "${input}"`); }

  // Only ever drive the browser to web pages. file:, data: and javascript: can
  // read local files or run in privileged contexts, so no caller may select
  // them, however the URL reaches this function.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http and https URLs are allowed, got "${parsed.protocol}"`);
  }

  // The web UI accepts URLs over a socket, so it passes allowLocal:false to stop
  // a request aiming the browser at loopback or private-network addresses
  // (router admin pages, other local dev servers, cloud metadata endpoints).
  if (!allowLocal && isPrivateHost(parsed.hostname)) {
    throw new Error('Refusing to capture a local or private-network address');
  }
  return parsed.href;
}

/**
 * True for loopback, link-local and RFC1918 private addresses. Hostname-based
 * only: a guard against obvious abuse, not a defence against hostile DNS.
 */
export function isPrivateHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 0 || a === 10) return true;
  if (a === 169 && b === 254) return true;           // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Build a filename like "example.com--pricing_1920x1080.png".
 */
export function fileNameFor(url, { width, height }, format) {
  let stem;
  try {
    const u = new URL(url);
    const slug = u.pathname.replace(/\/+$/, '').replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-');
    stem = u.hostname.replace(/^www\./, '') + (slug ? `--${slug}` : '');
  } catch {
    stem = 'screenshot';
  }
  return `${stem}_${width}x${height}.${format === 'jpeg' ? 'jpg' : format}`;
}

/**
 * Scroll the page bottom-to-top to trigger lazy-loaded images, then return to
 * the top so the captured box matches what a visitor sees on arrival.
 */
async function primeLazyContent(page, viewportHeight) {
  await page.evaluate(async (step) => {
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const max = document.documentElement.scrollHeight;
    for (let y = 0; y < max; y += step) {
      window.scrollTo(0, y);
      await pause(60);
    }
    window.scrollTo(0, 0);
    await pause(120);
  }, Math.max(200, Math.floor(viewportHeight * 0.8)));
}

/**
 * Capture one URL at one exact size. The output file is always exactly
 * width x height pixels (times scale): a page shorter than the viewport is
 * padded with its own background, a longer page is cropped.
 *
 * @returns {Promise<{file: string, width: number, height: number}>}
 */
export async function capture({
  browser,
  url,
  size,
  outDir = 'shots',
  format = 'png',
  quality = 90,
  scale = 1,
  fullPage = false,
  delay = 0,
  timeout = 45000,
  hideCookieBanners = false,
  fileName,
}) {
  const { width, height } = size;
  await mkdir(outDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    // Some sites gate layout on a real UA; the default headless UA is fine but
    // announcing a desktop Chrome avoids mobile redirects on a few hosts.
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout });
    // "load" fires before late XHR content settles; give the network a moment
    // but do not fail the shot if a socket stays open (analytics, chat widgets).
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    if (fullPage) await primeLazyContent(page, height);

    if (hideCookieBanners) {
      await page.addStyleTag({
        content: `[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],
                  [aria-label*="cookie" i],#onetrust-consent-sdk,.cc-window,#CybotCookiebotDialog
                  { display: none !important; }
                  html { overflow: auto !important; }`,
      }).catch(() => {});
    }

    if (delay > 0) await page.waitForTimeout(delay);

    // In full-page mode the real output height is the document height, not the
    // height that was asked for; measure it so the name and the report match
    // the file that actually lands on disk.
    const capturedHeight = fullPage
      ? await page.evaluate(() =>
          Math.max(
            document.documentElement.scrollHeight,
            document.body?.scrollHeight ?? 0,
            innerHeight
          )
        )
      : height;

    const file = path.resolve(
      outDir,
      fileName || fileNameFor(url, { width, height: capturedHeight }, format)
    );

    await page.screenshot({
      path: file,
      type: format,
      ...(format === 'jpeg' ? { quality } : {}),
      ...(fullPage
        ? { fullPage: true }
        : // Explicit clip guarantees the exact box even if a fixed element or
          // scrollbar would otherwise shift the captured region.
          { clip: { x: 0, y: 0, width, height } }),
    });

    return { file, width: width * scale, height: capturedHeight * scale };
  } finally {
    await context.close();
  }
}

export async function launch() {
  return chromium.launch({ args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
}
