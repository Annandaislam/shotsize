// ShotSize service worker.
//
// Chrome's own capture APIs (tabs.captureVisibleTab) are limited to whatever
// the visible viewport happens to be, so a 1920x1920 shot is impossible on a
// 1080p display. The DevTools protocol can override device metrics on the
// renderer side, which is why this extension attaches a debugger session for
// the duration of a single capture and detaches immediately afterwards.

const PROTOCOL_VERSION = '1.3';

const BANNER_CSS = `
[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],
[aria-label*="cookie" i],#onetrust-consent-sdk,.cc-window,#CybotCookiebotDialog,
.fc-consent-root,[class*="gdpr" i] { display: none !important; }
html, body { overflow: auto !important; }
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(target, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

function attach(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, PROTOCOL_VERSION, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function detach(target) {
  return new Promise((resolve) => chrome.debugger.detach(target, () => {
    void chrome.runtime.lastError; // already gone is fine
    resolve();
  }));
}

function buildFileName(url, width, height, format) {
  let stem = 'screenshot';
  try {
    const u = new URL(url);
    const slug = u.pathname.replace(/\/+$/, '').replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-');
    stem = u.hostname.replace(/^www\./, '') + (slug ? `--${slug}` : '');
  } catch { /* keep default */ }
  return `${stem}_${width}x${height}.${format === 'jpeg' ? 'jpg' : 'png'}`;
}

async function captureTab({ tabId, url, width, height, scale, format, quality, fullPage, hideBanners, delay }) {
  const target = { tabId };

  if (hideBanners) {
    // activeTab covers this: the popup click is the user gesture that grants it.
    await chrome.scripting
      .insertCSS({ target: { tabId }, css: BANNER_CSS })
      .catch(() => {}); // blocked on some pages; not worth failing the capture
  }

  await attach(target);
  try {
    let captureHeight = height;

    await send(target, 'Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: scale,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });

    // Give layout and any width-dependent media queries a frame to settle.
    await sleep(250 + delay);

    if (fullPage) {
      const metrics = await send(target, 'Page.getLayoutMetrics', {});
      const contentHeight = Math.ceil(
        metrics.cssContentSize?.height ?? metrics.contentSize?.height ?? height
      );
      captureHeight = Math.min(Math.max(contentHeight, height), 16384);
      await send(target, 'Emulation.setDeviceMetricsOverride', {
        width,
        height: captureHeight,
        deviceScaleFactor: scale,
        mobile: false,
        screenWidth: width,
        screenHeight: captureHeight,
      });
      await sleep(300);
    }

    const shot = await send(target, 'Page.captureScreenshot', {
      format,
      ...(format === 'jpeg' ? { quality } : {}),
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: captureHeight, scale: 1 },
    });

    return {
      dataUrl: `data:image/${format};base64,${shot.data}`,
      name: buildFileName(url, width, captureHeight, format),
      width: width * scale,
      height: captureHeight * scale,
    };
  } finally {
    // Clearing before detach avoids leaving the tab stuck at the fake size if
    // the renderer survives the session teardown.
    await send(target, 'Emulation.clearDeviceMetricsOverride', {}).catch(() => {});
    await detach(target);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'capture') return false;

  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab.');
      if (/^(chrome|edge|about|chrome-extension|devtools):/i.test(tab.url || '')) {
        throw new Error('Chrome blocks capture on browser pages. Open a normal website first.');
      }
      const result = await captureTab({ tabId: tab.id, url: tab.url || '', ...msg.options });
      sendResponse({ ok: true, ...result });
    } catch (err) {
      const hint = /Another debugger/i.test(err.message)
        ? ' Close DevTools on this tab and try again.'
        : '';
      sendResponse({ ok: false, error: err.message + hint });
    }
  })();

  return true; // keep the message channel open for the async response
});
