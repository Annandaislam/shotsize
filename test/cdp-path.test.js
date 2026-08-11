// Verifies the DevTools-protocol call sequence used by extension/background.js.
// The extension itself can't run headless, but the CDP commands it issues are
// identical, so this catches the part most likely to be wrong: whether the
// output PNG really comes out at the requested pixel box.
//
//   node test/cdp-path.test.js

import { chromium } from 'playwright';

function pngSize(base64) {
  const b = Buffer.from(base64, 'base64');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const CASES = [
  { width: 1920, height: 1080, scale: 1 },
  { width: 1920, height: 1920, scale: 1 },
  { width: 800, height: 2400, scale: 1 },
  { width: 1920, height: 1080, scale: 2 },
  { width: 390, height: 844, scale: 2 },
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1024, height: 640 } });
const page = await context.newPage();
await page.setContent(
  `<body style="margin:0;height:3000px;background:linear-gradient(#fff,#333)">
     <h1 style="font:700 40px sans-serif;padding:24px">shotsize cdp test</h1>
   </body>`,
  { waitUntil: 'load' }
);

const cdp = await context.newCDPSession(page);
let failed = 0;

for (const { width, height, scale } of CASES) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile: false,
    screenWidth: width, screenHeight: height,
  });
  await page.waitForTimeout(200);

  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });

  const got = pngSize(shot.data);
  const want = { width: width * scale, height: height * scale };
  const ok = got.width === want.width && got.height === want.height;
  if (!ok) failed++;
  console.log(
    `${ok ? '  ok' : 'FAIL'}  request ${width}x${height} @${scale}x  ->  ${got.width}x${got.height}` +
    (ok ? '' : `  (expected ${want.width}x${want.height})`)
  );
}

// The tab must be back to its real size once the override is cleared.
await cdp.send('Emulation.clearDeviceMetricsOverride');
await page.waitForTimeout(150);
const restored = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
const restoredOk = restored.w === 1024 && restored.h === 640;
if (!restoredOk) failed++;
console.log(`${restoredOk ? '  ok' : 'FAIL'}  viewport restored to ${restored.w}x${restored.h}`);

await browser.close();
console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
