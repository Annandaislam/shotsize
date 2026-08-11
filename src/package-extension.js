// Builds extension.zip ready for upload to the Chrome Web Store.
//
//   node src/package-extension.js
//
// Written by hand rather than with Compress-Archive: Windows PowerShell 5.1
// writes entry names with backslashes, which violates the ZIP spec (APPNOTE
// 4.4.17.1 requires forward slashes) and trips up the store's unpacker. The
// store also rejects archives with a wrapper folder, so manifest.json sits at
// the archive root.

import { deflateRawSync } from 'node:zlib';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = path.join(root, 'extension');
const zipPath = path.join(root, 'extension.zip');
const EXCLUDE = new Set(['PRIVACY.md']); // hosted as a listing URL, not shipped

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Convert a JS Date to the packed DOS date/time pair ZIP uses. */
function dosStamp(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

async function collect(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name; // always forward slashes
    if (entry.isDirectory()) out.push(...(await collect(abs, rel)));
    else out.push({ abs, rel });
  }
  return out;
}

const files = (await collect(extDir)).sort((a, b) => a.rel.localeCompare(b.rel));
if (!files.some((f) => f.rel === 'manifest.json')) {
  throw new Error('manifest.json must be at the root of the extension folder');
}

const locals = [];
const central = [];
let offset = 0;

for (const file of files) {
  const data = await readFile(file.abs);
  const { mtime } = await stat(file.abs);
  const { time, day } = dosStamp(mtime);
  const name = Buffer.from(file.rel, 'utf8');
  const deflated = deflateRawSync(data, { level: 9 });
  // Fall back to stored if deflate made it bigger (tiny files sometimes do).
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);          // version needed
  local.writeUInt16LE(0x0800, 6);      // flag bit 11: name is UTF-8
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(day, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);          // extra field length
  locals.push(local, name, body);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);             // version made by
  cd.writeUInt16LE(20, 6);             // version needed
  cd.writeUInt16LE(0x0800, 8);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt16LE(time, 12);
  cd.writeUInt16LE(day, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(body.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt32LE(offset, 42);        // relative offset of local header
  central.push(cd, name);

  offset += local.length + name.length + body.length;
}

const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

await writeFile(zipPath, Buffer.concat([...locals, centralBuf, end]));

const manifest = JSON.parse(await readFile(path.join(extDir, 'manifest.json'), 'utf8'));
console.log(`packaged ${manifest.name} v${manifest.version}: ${files.length} files`);
for (const f of files) console.log(`  ${f.rel}`);
console.log(zipPath);
