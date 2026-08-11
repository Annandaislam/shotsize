#!/usr/bin/env node
import { capture, launch, parseSize, normalizeUrl } from './capture.js';

const HELP = `
shotsize: capture a website at exact pixel dimensions

  node src/cli.js <url...> --size WxH [--size WxH ...] [options]

Options
  --size WxH        Output size, repeatable. Default 1920x1080
  --out DIR         Output folder (default ./shots)
  --format png|jpeg|webp   Default png
  --quality 1-100   JPEG/WebP quality (default 90)
  --scale N         Device pixel ratio; 2 doubles the output pixels
  --full            Capture the whole scrollable page at the given width
  --delay MS        Wait this long after load before capturing
  --hide-banners    Try to hide cookie/consent overlays
  -h, --help

Examples
  node src/cli.js example.com --size 1920x1080
  node src/cli.js example.com --size 1920x1080 --size 1920x1920
  node src/cli.js a.com b.com --size 1440x900 --out ./out --hide-banners
`;

function parseArgs(argv) {
  const opts = {
    urls: [],
    sizes: [],
    out: 'shots',
    format: 'png',
    quality: 90,
    scale: 1,
    full: false,
    delay: 0,
    hideCookieBanners: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h':
      case '--help':
        console.log(HELP);
        process.exit(0);
        break;
      case '--size': opts.sizes.push(parseSize(argv[++i])); break;
      case '--out': opts.out = argv[++i]; break;
      case '--format': opts.format = argv[++i]; break;
      case '--quality': opts.quality = Number(argv[++i]); break;
      case '--scale': opts.scale = Number(argv[++i]); break;
      case '--delay': opts.delay = Number(argv[++i]); break;
      case '--full': opts.full = true; break;
      case '--hide-banners': opts.hideCookieBanners = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`Unknown option ${a}`);
        opts.urls.push(normalizeUrl(a));
    }
  }
  if (!opts.urls.length) { console.log(HELP); process.exit(1); }
  if (!opts.sizes.length) opts.sizes.push(parseSize('1920x1080'));
  if (!['png', 'jpeg', 'webp'].includes(opts.format)) throw new Error(`Unknown format ${opts.format}`);
  return opts;
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const browser = await launch();
let failures = 0;

try {
  for (const url of opts.urls) {
    for (const size of opts.sizes) {
      const label = `${url} @ ${size.width}x${size.height}`;
      try {
        const r = await capture({
          browser,
          url,
          size,
          outDir: opts.out,
          format: opts.format,
          quality: opts.quality,
          scale: opts.scale,
          fullPage: opts.full,
          delay: opts.delay,
          hideCookieBanners: opts.hideCookieBanners,
        });
        console.log(`  ok  ${label} -> ${r.file} (${r.width}x${r.height})`);
      } catch (err) {
        failures++;
        console.error(`fail  ${label}: ${err.message}`);
      }
    }
  }
} finally {
  await browser.close();
}

process.exit(failures ? 1 : 0);
