# shotsize

Capture any web page at an exact pixel box. Type `1920x1080` and you get a
1920×1080 file. Type `1920x1920` and you get a 1920×1920 file, even though no
monitor is that shape.

Two ways to use it:

1. **Local tool** (`src/`): a CLI and a small web UI, driven by Playwright.
   No install ceremony, no store review, works on URLs you haven't opened.
2. **Chrome extension** (`extension/`): capture whatever tab you're looking at,
   including pages behind a login. Publishable to the Chrome Web Store.

Both use the same trick: override the renderer's device metrics, then capture
that exact box. A page shorter than the requested height is padded with its own
background; a longer page is cropped at the requested height.

---

## Local tool

### Setup

Needs [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/Annandaislam/shotsize.git
cd shotsize
npm install
```

`npm install` also downloads a private Chromium build (~150 MB) via Playwright.

### CLI

```bash
node src/cli.js example.com --size 1920x1080
```

Repeat `--size` for more than one output, and pass more than one URL:

```bash
node src/cli.js example.com stripe.com --size 1920x1080 --size 1920x1920 --hide-banners
```

| Flag | Meaning |
| --- | --- |
| `--size WxH` | Output size. Repeatable. Default `1920x1080` |
| `--out DIR` | Output folder. Default `./shots` |
| `--format png\|jpeg\|webp` | Default `png` |
| `--quality 1-100` | JPEG/WebP quality. Default 90 |
| `--scale N` | Device pixel ratio; `2` doubles the output pixels |
| `--full` | Capture the whole scrollable page at the given width |
| `--delay MS` | Wait after load before capturing (animations, fonts) |
| `--hide-banners` | Try to hide cookie/consent overlays |

Files are named `example.com--pricing_1920x1080.png`.

### Web UI

```bash
npm run ui
```

Your browser opens at <http://localhost:4180> automatically (the terminal prints
the address too, in case it doesn't). Size presets, live preview, and a download
button; every shot is also written to `shots/`.

### Security model

The web UI drives a real browser and writes files, so it is deliberately
antisocial:

- It binds to `127.0.0.1` only. Other machines on your network cannot reach it,
  even on shared wifi.
- It checks the `Host` and `Origin` of every request, so a hostile web page
  cannot talk to it through your browser (DNS rebinding, cross-site POSTs).
- It captures `http` and `https` only. `file:`, `data:` and `javascript:` URLs
  are refused everywhere, so no request can turn the tool into a local-file
  reader.
- Requests arriving over the socket may not target loopback or private-network
  addresses (router pages, other dev servers, cloud metadata).

Nothing is uploaded anywhere: captures are written next to the tool, on your
machine. The extension's privacy policy is in [`extension/PRIVACY.md`](extension/PRIVACY.md).

### Test

```bash
npm test
npm run test:security
```

Runs the DevTools-protocol sequence the extension uses and asserts the resulting
PNG headers really carry the requested dimensions, at 1× and 2×, and that the
tab's real viewport is restored afterwards.

---

## Chrome extension

### Load it locally

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this repo's `extension/` folder
4. Open any normal website, click the ShotSize icon, type a size, hit **Capture**

Chrome will show a yellow **"ShotSize is debugging this browser"** bar while a
capture runs. That is unavoidable and expected; see below.

### Why it needs the debugger permission

`chrome.tabs.captureVisibleTab`, the ordinary screenshot API, only ever returns
the visible viewport. On a 1080p screen it can never produce a 1920×1920 image.
The only API that can lay a page out at a size other than the window is the
DevTools protocol, reached through `chrome.debugger`. ShotSize attaches for the
length of one capture, calls `Emulation.setDeviceMetricsOverride` and
`Page.captureScreenshot`, then clears the override and detaches.

Two consequences worth knowing:

- The yellow debugging bar appears during capture.
- If DevTools is already open on that tab, the attach fails: Chrome allows one
  debugger client per tab. Close DevTools and retry.

Chrome also blocks capture on `chrome://`, `edge://`, and extension pages.

### Package for the store

```bash
npm run package
```

Writes `extension.zip` with `manifest.json` at the archive root and forward-slash
entry names. (Windows PowerShell's `Compress-Archive` writes backslashes, which
the store's unpacker mishandles, hence the hand-rolled writer in
`src/package-extension.js`.)

### Regenerate icons

```bash
npm run icons
```

Renders the mark to `extension/icons/` at 16, 48, and 128 px using the same
capture engine. Edit the SVG in `src/make-icons.js` to change it.

The extension is not on the stores yet.

---

## Layout

```
shotsize/
  src/capture.js            shared capture engine (Playwright)
  src/cli.js                command line
  src/server.js             local web UI server
  src/make-icons.js         icon generator
  src/package-extension.js  spec-correct zip writer
  public/index.html         web UI
  test/cdp-path.test.js     dimension assertions for the extension's CDP path
  test/security.test.js     loopback, Host/Origin and URL-scheme guards
  extension/                Chrome MV3 extension
  shots/                    output
```
