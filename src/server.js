import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, launch, parseSize, normalizeUrl } from './capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const OUT_DIR = path.join(__dirname, '..', 'shots');
const PORT = Number(process.env.PORT) || 4180;
// Bind to loopback only. This server drives a real browser and writes files, so
// it must never be reachable from other machines on the network.
const HOST = '127.0.0.1';

// Only requests that actually originate from this machine's own loopback are
// allowed. Validating the Host header (not just the bind address) also defeats
// DNS-rebinding, where a malicious site resolves its name to 127.0.0.1 and
// tries to talk to this server from the victim's browser.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
function hostnameOf(headerVal) {
  if (!headerVal) return null;
  try {
    const h = headerVal.includes('://') ? new URL(headerVal).hostname : headerVal.split(':')[0];
    return h.replace(/^\[|\]$/g, '').toLowerCase();
  } catch { return null; }
}
function isLocalRequest(req) {
  const host = hostnameOf(req.headers.host);
  if (!host || !LOCAL_HOSTS.has(host)) return false;
  // A cross-site request carries an Origin; it must also be loopback.
  if (req.headers.origin) {
    const oh = hostnameOf(req.headers.origin);
    if (!oh || !LOCAL_HOSTS.has(oh)) return false;
  }
  return true;
}

// One browser for the process lifetime; each capture gets its own context.
let browserPromise = null;
const getBrowser = () => (browserPromise ??= launch());

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readJsonBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = http.createServer(async (req, res) => {
  try {
    if (!isLocalRequest(req)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      return res.end('shotsize only serves this machine.');
    }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = await readFile(path.join(PUBLIC, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (req.method === 'POST' && req.url === '/api/capture') {
      const body = await readJsonBody(req);
      const url = normalizeUrl(body.url ?? '', { allowLocal: false });
      const size = parseSize(body.size ?? '1920x1080');
      const format = ['png', 'jpeg', 'webp'].includes(body.format) ? body.format : 'png';
      const scale = Number(body.scale) === 2 ? 2 : 1;

      const browser = await getBrowser();
      const result = await capture({
        browser,
        url,
        size,
        outDir: OUT_DIR,
        format,
        scale,
        fullPage: Boolean(body.fullPage),
        delay: Math.min(Number(body.delay) || 0, 15000),
        hideCookieBanners: Boolean(body.hideCookieBanners),
      });

      const bytes = await readFile(result.file);
      const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      return json(res, 200, {
        ok: true,
        file: result.file,
        name: path.basename(result.file),
        width: result.width,
        height: result.height,
        bytes: bytes.length,
        dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
      });
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    json(res, 400, { ok: false, error: err.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Is shotsize already running?`);
    console.error(`Close the other instance, or run with another port: PORT=${PORT + 1} npm run ui`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`shotsize UI running at ${url}`);
  console.log(`saving to ${OUT_DIR}`);
  // Best-effort: open the default browser. If it fails (headless box, no
  // desktop), the printed URL above is the fallback.
  if (process.env.SHOTSIZE_NO_OPEN) return;
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (browserPromise) await (await browserPromise).close().catch(() => {});
    process.exit(0);
  });
}
