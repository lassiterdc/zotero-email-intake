"use strict";

// Read-only Compound File Binary reader. Host-free by the same rule that governs
// src/message.js: the host-object token R14 forbids must not appear anywhere in this
// file, comments included, because the rule is a plain grep with no comment exemption.
//
// Declaration form is a correctness constraint inherited from the loading mechanism,
// not a style choice. Every top-level declaration here is a `function` or a `var`,
// never `const`, `let`, or `class`, because loadSubScript re-evaluates this file into
// the SAME global on an in-session disable/re-enable and a top-level lexical
// redeclaration is an early error that leaves the plugin enabled and inert.
//
// Scope is deliberately one function: locate a named stream at the ROOT level of the
// container and return its bytes. Everything the format offers below that -- storage
// recursion, property parsing, writing -- is out of scope and stays out.

var CFB_SIGNATURE = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
var MAXREGSECT = 0xFFFFFFFA;
var DIFSECT = 0xFFFFFFFC;
var FATSECT = 0xFFFFFFFD;
var ENDOFCHAIN = 0xFFFFFFFE;
var FREESECT = 0xFFFFFFFF;
var DIR_ENTRY_SIZE = 128;
var NOSTREAM = 0xFFFFFFFF;
var OBJ_STREAM = 2;
var OBJ_ROOT = 5;

// A malformed or hostile container must not be able to spin the reader. Every chain
// walk is bounded by the number of sectors the file could possibly contain.
var MAX_CHAIN = 1 << 20;

function u16(bytes, off) {
    return bytes[off] | (bytes[off + 1] << 8);
}

function u32(bytes, off) {
    return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
}

function hasSignature(bytes) {
    if (!bytes || bytes.length < 512) return false;
    for (var i = 0; i < CFB_SIGNATURE.length; i++) {
        if (bytes[i] !== CFB_SIGNATURE[i]) return false;
    }
    return true;
}

/**
 * Parse the 512-byte header and materialise the FAT.
 *
 * Returns null rather than throwing on anything malformed: the caller's contract is
 * `bytes -> stream bytes or null`, and a container this reader cannot make sense of is
 * indistinguishable, from the caller's side, from one that lacks the stream.
 */
function openContainer(bytes) {
    if (!hasSignature(bytes)) return null;

    var sectorShift = u16(bytes, 30);
    if (sectorShift !== 9 && sectorShift !== 12) return null;
    var sectorSize = 1 << sectorShift;

    var miniSectorShift = u16(bytes, 32);
    if (miniSectorShift !== 6) return null;
    var miniSectorSize = 1 << miniSectorShift;

    var cfb = {
        bytes: bytes,
        sectorSize: sectorSize,
        miniSectorSize: miniSectorSize,
        miniCutoff: u32(bytes, 56),
        dirStart: u32(bytes, 48),
        miniFatStart: u32(bytes, 60),
        fat: null,
        miniFat: null,
        miniStream: null
    };

    cfb.fat = buildFat(cfb, u32(bytes, 44), u32(bytes, 68), u32(bytes, 72));
    if (cfb.fat === null) return null;
    return cfb;
}

/** Byte offset of sector `id`. The 512-byte header occupies the slot before sector 0. */
function sectorOffset(cfb, id) {
    return (id + 1) * cfb.sectorSize;
}

function sectorInRange(cfb, id) {
    var start = sectorOffset(cfb, id);
    return id <= MAXREGSECT && start >= 0 && start + cfb.sectorSize <= cfb.bytes.length;
}

/**
 * Collect every FAT sector id -- the first 109 from the header's DIFAT array, then any
 * remainder by walking the DIFAT sector chain -- and read the FAT entries out of them.
 */
function buildFat(cfb, fatSectorCount, difatStart, difatSectorCount) {
    var bytes = cfb.bytes;
    var perSector = cfb.sectorSize / 4;
    var fatSectors = [];

    for (var i = 0; i < 109 && fatSectors.length < fatSectorCount; i++) {
        var id = u32(bytes, 76 + 4 * i);
        if (id > MAXREGSECT) continue;
        fatSectors.push(id);
    }

    var next = difatStart;
    var guard = 0;
    while (next <= MAXREGSECT && fatSectors.length < fatSectorCount) {
        if (!sectorInRange(cfb, next)) return null;
        if (++guard > MAX_CHAIN || guard > difatSectorCount + 1) break;
        var base = sectorOffset(cfb, next);
        for (var j = 0; j < perSector - 1 && fatSectors.length < fatSectorCount; j++) {
            var fid = u32(bytes, base + 4 * j);
            if (fid > MAXREGSECT) continue;
            fatSectors.push(fid);
        }
        next = u32(bytes, base + 4 * (perSector - 1));
    }

    var fat = new Uint32Array(fatSectors.length * perSector);
    var w = 0;
    for (var k = 0; k < fatSectors.length; k++) {
        if (!sectorInRange(cfb, fatSectors[k])) return null;
        var off = sectorOffset(cfb, fatSectors[k]);
        for (var m = 0; m < perSector; m++) {
            fat[w++] = u32(bytes, off + 4 * m);
        }
    }
    return fat;
}

/** Follow a FAT chain from `start`, returning the ordered sector ids. */
function chain(cfb, start) {
    var ids = [];
    var id = start;
    var guard = 0;
    while (id <= MAXREGSECT) {
        if (++guard > MAX_CHAIN) return null;
        if (!sectorInRange(cfb, id)) return null;
        ids.push(id);
        if (id >= cfb.fat.length) return null;
        id = cfb.fat[id];
    }
    return ids;
}

/** Concatenate a FAT chain's sectors, truncated to `size` bytes when size is given. */
function readChain(cfb, start, size) {
    var ids = chain(cfb, start);
    if (ids === null) return null;
    var total = ids.length * cfb.sectorSize;
    var want = (typeof size === 'number' && size >= 0 && size <= total) ? size : total;
    var out = new Uint8Array(want);
    var w = 0;
    for (var i = 0; i < ids.length && w < want; i++) {
        var off = sectorOffset(cfb, ids[i]);
        for (var j = 0; j < cfb.sectorSize && w < want; j++) {
            out[w++] = cfb.bytes[off + j];
        }
    }
    return out;
}

function dirEntryOffset(cfb, dirSectors, index) {
    var perSector = cfb.sectorSize / DIR_ENTRY_SIZE;
    var sectorIdx = (index / perSector) | 0;
    if (sectorIdx >= dirSectors.length) return -1;
    return sectorOffset(cfb, dirSectors[sectorIdx]) + (index % perSector) * DIR_ENTRY_SIZE;
}

function readDirEntry(cfb, dirSectors, index) {
    var off = dirEntryOffset(cfb, dirSectors, index);
    if (off < 0 || off + DIR_ENTRY_SIZE > cfb.bytes.length) return null;
    var bytes = cfb.bytes;

    var nameLen = u16(bytes, off + 64);
    if (nameLen > 64) nameLen = 64;
    var name = '';
    for (var i = 0; i + 1 < nameLen; i += 2) {
        var code = bytes[off + i] | (bytes[off + i + 1] << 8);
        if (code === 0) break;
        name += String.fromCharCode(code);
    }

    return {
        name: name,
        type: bytes[off + 66],
        left: u32(bytes, off + 68),
        right: u32(bytes, off + 72),
        child: u32(bytes, off + 76),
        start: u32(bytes, off + 116),
        size: u32(bytes, off + 120)
    };
}

/**
 * Find a stream by name among the ROOT storage's immediate children.
 *
 * The root's children form a red-black tree linked by left/right sibling pointers, so
 * this walks that tree and does NOT descend through any child pointer it finds. Both
 * halves matter. Following only the root's `child` would see exactly one entry, which
 * passes against a minimal generated fixture and fails against every real container --
 * measured at 59 to 289 root-level entries across a real corpus. Descending into
 * storages would be worse than useless: an embedded message attachment carries its own
 * copy of the same property name, so a name-matching scan that recursed could return
 * the INNER message's headers for the outer message, silently and plausibly.
 */
function findRootLevelEntry(cfb, name) {
    var dirSectors = chain(cfb, cfb.dirStart);
    if (dirSectors === null) return null;

    var root = readDirEntry(cfb, dirSectors, 0);
    if (root === null || root.type !== OBJ_ROOT) return null;
    cfb.root = root;

    var stack = [root.child];
    var seen = {};
    var guard = 0;

    while (stack.length > 0) {
        var id = stack.pop();
        if (id === NOSTREAM || id > MAXREGSECT) continue;
        if (seen[id]) continue;          // malformed tree must not loop
        seen[id] = true;
        if (++guard > MAX_CHAIN) return null;

        var entry = readDirEntry(cfb, dirSectors, id);
        if (entry === null) continue;
        if (entry.type === OBJ_STREAM && entry.name === name) return entry;

        stack.push(entry.left);
        stack.push(entry.right);
    }
    return null;
}

/** The mini stream lives in the root entry's own chain; mini sectors index into it. */
function readMini(cfb, start, size) {
    if (cfb.miniStream === null) {
        cfb.miniStream = readChain(cfb, cfb.root.start, cfb.root.size);
        if (cfb.miniStream === null) return null;
    }
    if (cfb.miniFat === null) {
        var raw = readChain(cfb, cfb.miniFatStart, -1);
        if (raw === null) return null;
        cfb.miniFat = new Uint32Array(raw.length / 4);
        for (var i = 0; i < cfb.miniFat.length; i++) cfb.miniFat[i] = u32(raw, 4 * i);
    }

    var out = new Uint8Array(size);
    var w = 0;
    var id = start;
    var guard = 0;
    while (id <= MAXREGSECT && w < size) {
        if (++guard > MAX_CHAIN) return null;
        var off = id * cfb.miniSectorSize;
        if (off + cfb.miniSectorSize > cfb.miniStream.length) return null;
        for (var j = 0; j < cfb.miniSectorSize && w < size; j++) {
            out[w++] = cfb.miniStream[off + j];
        }
        if (id >= cfb.miniFat.length) return null;
        id = cfb.miniFat[id];
    }
    return out;
}

/**
 * Return the bytes of the root-level stream named `name`, or null.
 *
 * Null covers every failure the caller can do nothing about: not a container, a
 * container this reader declines, no such stream, or a chain that does not resolve.
 * The caller's own contract is to decline the file visibly, so one null is enough.
 */
function readStream(bytes, name) {
    var cfb = openContainer(bytes);
    if (cfb === null) return null;

    var entry = findRootLevelEntry(cfb, name);
    if (entry === null) return null;
    if (entry.size === 0) return new Uint8Array(0);

    if (entry.size < cfb.miniCutoff) return readMini(cfb, entry.start, entry.size);
    return readChain(cfb, entry.start, entry.size);
}

if (typeof module !== 'undefined') { module.exports = { readStream }; }
