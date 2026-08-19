"use strict";
// Generates the .msg fixtures under test/fixtures/msg/ from the .eml corpus.
//
//   0001-plain-ascii.msg          PR_TRANSPORT_MESSAGE_HEADERS present -- the header path
//   0011-no-transport-headers.msg no 007D stream, three MAPI properties -- the fallback
//
// Both are emitted unconditionally on every run and NEITHER takes an argument to select
// it. The script is invoked bare from two places -- package.json's "pretest" and
// scripts/ci/run-tests.sh, which runs it explicitly because `npm run ci` does not fire
// pretest -- so a flag-gated variant would have to be threaded through both call sites,
// and a missed one yields a one-fixture tree in which the parser test fails with a
// file-not-found pointing at the fixture rather than at the omission.
//
// Neither fixture is committed: test/fixtures/msg/ is gitignored in full.
//
// Minimal CFB v3, 512-byte sectors. Sector 0 = FAT, sector 1 = directory, sectors 2..N =
// stream data. Every stream is padded to exactly 4096 bytes; see PAD_TO below, where the
// reason is not the one it looks like.
const fs = require('node:fs');
const path = require('node:path');

const SEC = 512, FREE = 0xFFFFFFFF, ENDOFCHAIN = 0xFFFFFFFE, FATSECT = 0xFFFFFFFD;
const NOSTREAM = 0xFFFFFFFF;
const MINI_CUTOFF = 0x1000;

// Every stream is padded up to the mini-stream cutoff, and its directory size field
// declares the padded length. This looks like padding for neatness and is not.
//
// src/cfb.js routes a stream read on `entry.size < cfb.miniCutoff`: below the cutoff it
// takes readMini, which needs a mini-FAT (header offset 60) and a mini-stream (the Root
// Entry's own chain). This generator writes ENDOFCHAIN to offset 60 and gives Root Entry
// start=ENDOFCHAIN, size=0, so the mini-stream materialises zero-length and readMini
// returns null. A subject of a few dozen UTF-16LE bytes is far below the cutoff, so an
// unpadded fallback fixture would read as a container carrying NONE of its properties --
// the fallback exercised by a fixture that does not exercise it, failing with a message
// that points at the parser. Padding to the cutoff routes every stream through readChain,
// which this generator already builds correctly.
//
// The cost is a stated fidelity limit: real .msg files store short properties in the
// mini-stream, so these fixtures exercise readChain where production exercises readMini,
// and readMini remains unexercised by any fixture in the corpus.
const PAD_TO = MINI_CUTOFF;

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'test/fixtures/msg');

/** UTF-16LE bytes of `text`, zero-padded to PAD_TO. */
function padded(text) {
    const buf = Buffer.alloc(PAD_TO, 0);
    Buffer.from(text, 'utf16le').copy(buf);
    return buf;
}

/**
 * Build a container holding `streams`, an ordered array of {name, payload}.
 *
 * Directory entry 0 is the Root Entry with child = 1; entries 1..N form a right-linked
 * chain with every left and every child set to NOSTREAM. The linkage is required, not
 * cosmetic: findRootLevelEntry walks the root's children as a red-black tree by
 * left/right sibling pointers and does not descend through `child`, so unlinked entries
 * past the first are unreachable and return null -- indistinguishable, at the reader,
 * from the property being absent.
 */
function buildContainer(streams) {
    const dirEntries = 1 + streams.length;
    if (dirEntries > SEC / 128) throw new Error('directory exceeds one sector');

    const nData = streams.reduce((n, s) => n + s.payload.length / SEC, 0);
    const out = Buffer.alloc(SEC * (1 + 2 + nData), 0);
    const sec = n => SEC * (1 + n);

    Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).copy(out, 0);
    out.writeUInt16LE(0x003E, 24); out.writeUInt16LE(0x0003, 26); out.writeUInt16LE(0xFFFE, 28);
    out.writeUInt16LE(9, 30); out.writeUInt16LE(6, 32);
    out.writeUInt32LE(1, 44); out.writeUInt32LE(1, 48); out.writeUInt32LE(MINI_CUTOFF, 56);
    out.writeUInt32LE(ENDOFCHAIN, 60); out.writeUInt32LE(0, 64);
    out.writeUInt32LE(ENDOFCHAIN, 68); out.writeUInt32LE(0, 72);
    for (let i = 0; i < 109; i++) out.writeUInt32LE(i === 0 ? 0 : FREE, 76 + 4 * i);

    // One FAT sector holds 128 entries, which covers this file with no DIFAT chain:
    // three 4096-byte streams are 24 data sectors, so 1 FAT + 1 directory + 24 = 26.
    for (let i = 0; i < SEC / 4; i++) out.writeUInt32LE(FREE, sec(0) + 4 * i);
    out.writeUInt32LE(FATSECT, sec(0));
    out.writeUInt32LE(ENDOFCHAIN, sec(0) + 4);

    // Each stream is its own chain of consecutive sectors, terminated at its last.
    let next = 2;
    const starts = [];
    for (const s of streams) {
        const n = s.payload.length / SEC;
        starts.push(next);
        for (let i = 0; i < n; i++) {
            const id = next + i;
            out.writeUInt32LE(i === n - 1 ? ENDOFCHAIN : id + 1, sec(0) + 4 * id);
        }
        next += n;
    }

    function dirEntry(off, name, type, start, size, child, right) {
        const u = Buffer.from(name + '\0', 'utf16le');
        u.copy(out, off);
        out.writeUInt16LE(u.length, off + 64);
        out.writeUInt8(type, off + 66);
        out.writeUInt8(1, off + 67);
        out.writeUInt32LE(NOSTREAM, off + 68);   // left
        out.writeUInt32LE(right, off + 72);      // right
        out.writeUInt32LE(child, off + 76);
        out.writeUInt32LE(start, off + 116);
        out.writeUInt32LE(size, off + 120);
    }

    // Unused entries in the directory sector must not look like live siblings.
    for (let i = dirEntries; i < SEC / 128; i++) {
        out.writeUInt32LE(NOSTREAM, sec(1) + 128 * i + 68);
        out.writeUInt32LE(NOSTREAM, sec(1) + 128 * i + 72);
        out.writeUInt32LE(NOSTREAM, sec(1) + 128 * i + 76);
    }

    dirEntry(sec(1), 'Root Entry', 5, ENDOFCHAIN, 0, 1, NOSTREAM);
    streams.forEach((s, i) => {
        const isLast = i === streams.length - 1;
        dirEntry(sec(1) + 128 * (i + 1), s.name, 2, starts[i], s.payload.length,
            NOSTREAM, isLast ? NOSTREAM : i + 2);
    });

    streams.forEach((s, i) => s.payload.copy(out, sec(starts[i])));
    return out;
}

fs.mkdirSync(outDir, { recursive: true });

// 0001 -- the header-bearing container, whose parsed result must equal its .eml twin's.
const eml = fs.readFileSync(path.join(root, 'test/fixtures/eml/0001-plain-ascii.eml'), 'utf8');
const headers = eml.split(/\r?\n\r?\n/)[0] + '\r\n\r\n';
fs.writeFileSync(
    path.join(outDir, '0001-plain-ascii.msg'),
    buildContainer([{ name: '__substg1.0_007D001F', payload: padded(headers) }])
);

// 0011 -- NO 007D stream; the three PT_UNICODE properties the fallback reads. The stem
// takes the next free number in the shared fixture numbering rather than 0002 inside
// msg/, because 0001 is numbered to match its .eml twin and this fixture deliberately
// has no twin -- a matching number would assert a pairing that does not exist.
fs.writeFileSync(
    path.join(outDir, '0011-no-transport-headers.msg'),
    buildContainer([
        { name: '__substg1.0_0037001F', payload: padded('Quarterly planning notes') },
        { name: '__substg1.0_0C1A001F', payload: padded('Dana Whitfield') },
        { name: '__substg1.0_0C1F001F', payload: padded('dana.whitfield@example.org') }
    ])
);
