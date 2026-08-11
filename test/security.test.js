// Guards for the local web UI's threat model:
//   - the server must answer only this machine (bind + Host/Origin checks)
//   - the capture engine must never be pointed at file:, data: or javascript:
//   - requests arriving over the socket must not reach private-network hosts
//
//   node test/security.test.js

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUrl, isPrivateHost } from '../src/capture.js';

// fetch() refuses to override the Host header, so spoofing needs raw http.
function rawRequest({ headers = {}, method = 'GET', path: p = '/', body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method, path: p, headers, setHost: false },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;
let failed = 0;

function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
}

function rejects(name, fn) {
  try { const v = fn(); check(name, false, `returned ${v}`); }
  catch { check(name, true); }
}

// ---- URL scheme and host guards -------------------------------------------
rejects('file: URL rejected', () => normalizeUrl('file:///C:/Windows/win.ini'));
rejects('file: URL rejected (uppercase)', () => normalizeUrl('FILE:///etc/passwd'));
rejects('data: URL rejected', () => normalizeUrl('data:text/html,<h1>x'));
rejects('javascript: URL rejected', () => normalizeUrl('javascript:alert(1)'));
check('plain host still becomes https', normalizeUrl('example.com') === 'https://example.com/');
check('http URL preserved', normalizeUrl('http://example.com/a') === 'http://example.com/a');

rejects('loopback blocked when allowLocal false', () => normalizeUrl('http://127.0.0.1:8080', { allowLocal: false }));
rejects('localhost blocked when allowLocal false', () => normalizeUrl('http://localhost:3000', { allowLocal: false }));
rejects('RFC1918 blocked when allowLocal false', () => normalizeUrl('http://192.168.1.1/admin', { allowLocal: false }));
rejects('cloud metadata blocked when allowLocal false', () => normalizeUrl('http://169.254.169.254/latest/meta-data/', { allowLocal: false }));
check('public host allowed when allowLocal false', normalizeUrl('https://example.com', { allowLocal: false }) === 'https://example.com/');
check('CLI keeps localhost by default', normalizeUrl('http://localhost:4180') === 'http://localhost:4180/');

check('isPrivateHost: 10.x', isPrivateHost('10.0.0.5'));
check('isPrivateHost: 172.16-31', isPrivateHost('172.20.1.1') && !isPrivateHost('172.32.1.1'));
check('isPrivateHost: public ip', !isPrivateHost('93.184.216.34'));

// ---- server binding and Host/Origin checks --------------------------------
const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), SHOTSIZE_NO_OPEN: '1' },
  stdio: 'ignore',
});
const stop = () => { try { server.kill(); } catch {} };
process.on('exit', stop);

await new Promise((r) => setTimeout(r, 1500));

try {
  const ok = await rawRequest({ headers: { host: `127.0.0.1:${PORT}` } });
  check('loopback Host served', ok.status === 200, `status ${ok.status}`);

  const spoofed = await rawRequest({ headers: { host: 'evil.example.com' } });
  check('foreign Host rejected (DNS rebinding)', spoofed.status === 403, `status ${spoofed.status}`);

  const payload = JSON.stringify({ url: 'example.com', size: '100x100' });
  const crossOrigin = await rawRequest({
    method: 'POST', path: '/api/capture', body: payload,
    headers: {
      host: `127.0.0.1:${PORT}`, origin: 'https://evil.example.com',
      'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
    },
  });
  check('cross-origin API call rejected', crossOrigin.status === 403, `status ${crossOrigin.status}`);

  const filePayload = JSON.stringify({ url: 'file:///C:/Windows/win.ini', size: '100x100' });
  const fileReq = await rawRequest({
    method: 'POST', path: '/api/capture', body: filePayload,
    headers: {
      host: `127.0.0.1:${PORT}`,
      'content-type': 'application/json', 'content-length': Buffer.byteLength(filePayload),
    },
  });
  check('API refuses file: URL', fileReq.status === 400 && fileReq.body.includes('"ok":false'), fileReq.body.slice(0, 60));

  // Not bound to a routable interface: a non-loopback local IP must not answer.
  const { networkInterfaces } = await import('node:os');
  const lan = Object.values(networkInterfaces()).flat()
    .find((n) => n && n.family === 'IPv4' && !n.internal);
  if (lan) {
    let reachable = false;
    try {
      const ctl = AbortSignal.timeout(1500);
      const r = await fetch(`http://${lan.address}:${PORT}`, { signal: ctl });
      reachable = r.status < 500;
    } catch { reachable = false; }
    check(`not reachable on LAN address ${lan.address}`, !reachable);
  } else {
    console.log('  --  no external interface found, LAN check skipped');
  }
} finally {
  stop();
}

console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
