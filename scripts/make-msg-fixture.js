"use strict";
// Generates test/fixtures/msg/0001-plain-ascii.msg from the .eml of the same stem.
// Minimal CFB v3, 512-byte sectors: sector 0 = FAT, sector 1 = directory,
// sectors 2..9 = the PR_TRANSPORT_MESSAGE_HEADERS stream padded to 4096 bytes.
const fs = require('node:fs');
const path = require('node:path');

const SEC = 512, FREE = 0xFFFFFFFF, ENDOFCHAIN = 0xFFFFFFFE, FATSECT = 0xFFFFFFFD;
const root = path.join(__dirname, '..');
const eml = fs.readFileSync(path.join(root, 'test/fixtures/eml/0001-plain-ascii.eml'), 'utf8');
const headers = eml.split(/\r?\n\r?\n/)[0] + '\r\n\r\n';

const payload = Buffer.alloc(4096, 0);
Buffer.from(headers, 'utf16le').copy(payload);
const nData = payload.length / SEC;
const out = Buffer.alloc(SEC * (1 + 2 + nData), 0);
const sec = n => SEC * (1 + n);

Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).copy(out, 0);
out.writeUInt16LE(0x003E, 24); out.writeUInt16LE(0x0003, 26); out.writeUInt16LE(0xFFFE, 28);
out.writeUInt16LE(9, 30); out.writeUInt16LE(6, 32);
out.writeUInt32LE(1, 44); out.writeUInt32LE(1, 48); out.writeUInt32LE(0x1000, 56);
out.writeUInt32LE(ENDOFCHAIN, 60); out.writeUInt32LE(0, 64);
out.writeUInt32LE(ENDOFCHAIN, 68); out.writeUInt32LE(0, 72);
for (let i = 0; i < 109; i++) out.writeUInt32LE(i === 0 ? 0 : FREE, 76 + 4 * i);

for (let i = 0; i < SEC / 4; i++) out.writeUInt32LE(FREE, sec(0) + 4 * i);
out.writeUInt32LE(FATSECT, sec(0));
out.writeUInt32LE(ENDOFCHAIN, sec(0) + 4);
for (let i = 0; i < nData; i++) {
  out.writeUInt32LE(i === nData - 1 ? ENDOFCHAIN : 3 + i, sec(0) + 4 * (2 + i));
}

function dirEntry(off, name, type, start, size, child) {
  const u = Buffer.from(name + '\0', 'utf16le');
  u.copy(out, off);
  out.writeUInt16LE(u.length, off + 64);
  out.writeUInt8(type, off + 66);
  out.writeUInt8(1, off + 67);
  out.writeUInt32LE(FREE, off + 68);
  out.writeUInt32LE(FREE, off + 72);
  out.writeUInt32LE(child, off + 76);
  out.writeUInt32LE(start, off + 116);
  out.writeUInt32LE(size, off + 120);
}
for (let i = 2; i < 4; i++) {
  out.writeUInt32LE(FREE, sec(1) + 128 * i + 68);
  out.writeUInt32LE(FREE, sec(1) + 128 * i + 72);
  out.writeUInt32LE(FREE, sec(1) + 128 * i + 76);
}
dirEntry(sec(1), 'Root Entry', 5, ENDOFCHAIN, 0, 1);
dirEntry(sec(1) + 128, '__substg1.0_007D001F', 2, 2, payload.length, FREE);

payload.copy(out, sec(2));
fs.mkdirSync(path.join(root, 'test/fixtures/msg'), { recursive: true });
fs.writeFileSync(path.join(root, 'test/fixtures/msg/0001-plain-ascii.msg'), out);
