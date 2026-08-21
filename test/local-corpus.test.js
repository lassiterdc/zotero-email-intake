"use strict";
// Acceptance of the CFB reader against REAL .msg containers.
//
// The corpus is real correspondence and is never committed: it lives in the gitignored
// test/fixtures/local/ per R19, and this test SKIPS when that directory is absent, so
// every other clone and CI run stays green without it.
//
// The require below sits at MODULE scope, ABOVE the skip check, and that placement is
// deliberate: it is what makes a broken src/cfb.js fail this file at load even when the
// corpus is absent. Moving it inside the test body would restore the hole where a
// syntax error reaches CI unnoticed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readStream } = require('../src/cfb.js');
const { parseHeaders, mapToPayload } = require('../src/message.js');

const LOCAL_DIR = path.join(__dirname, 'fixtures', 'local');
const PROP_TRANSPORT_HEADERS = '__substg1.0_007D001F';

// Coverage oracle, computed WITHOUT the reader. A container's directory stores entry
// names as UTF-16LE, so scanning the raw bytes for the encoded name says whether the
// container carries the property at all -- independently of every line of reader logic.
// This is what turns "at least one extraction" into "extracted exactly the ones that
// have it": a partial directory walk that finds the first sibling and misses the rest
// disagrees on every container it skipped, rather than passing on the one it found.
function nameBytesUtf16le(name) {
  const b = new Uint8Array(name.length * 2);
  for (let i = 0; i < name.length; i++) {
    b[2 * i] = name.charCodeAt(i) & 0xFF;
    b[2 * i + 1] = name.charCodeAt(i) >> 8;
  }
  return b;
}

function containsBytes(hay, needle) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

function trimTrailingNulls(text) {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 0) end--;
  return text.slice(0, end);
}

function localMsgFiles() {
  if (!fs.existsSync(LOCAL_DIR)) return null;
  return fs.readdirSync(LOCAL_DIR)
    .filter(n => n.toLowerCase().endsWith('.msg'))
    .map(n => path.join(LOCAL_DIR, n));
}

const files = localMsgFiles();
const skip = files === null
  ? 'test/fixtures/local/ is absent -- real-corpus acceptance is owner-local by R19'
  : (files.length === 0 ? 'test/fixtures/local/ holds no .msg containers' : false);

test('CFB reader accepts a real .msg corpus', { skip }, () => {
  const needle = nameBytesUtf16le(PROP_TRANSPORT_HEADERS);
  let extracted = 0;
  let declined = 0;

  files.forEach((p, index) => {
    // Index, never filename: these names encode correspondents and subjects.
    const bytes = new Uint8Array(fs.readFileSync(p));

    let result;
    assert.doesNotThrow(() => { result = readStream(bytes, PROP_TRANSPORT_HEADERS); },
      `container ${index} must not throw`);

    // Coverage: the reader must succeed on exactly the containers that carry the entry.
    const carries = containsBytes(bytes, needle);
    assert.equal(result !== null, carries,
      `container ${index}: reader ${result === null ? 'declined' : 'extracted'} but the ` +
      `directory entry is ${carries ? 'present' : 'absent'}. A reader that walks only the ` +
      `root child pointer, or only part of the sibling tree, reaches exactly this state. ` +
      `KNOWN false positive: a container holding an EMBEDDED message carries the inner ` +
      `message's own entry, so the scan reports present while the reader correctly ` +
      `refuses to descend into sub-storages -- if that is this container, move it out of ` +
      `test/fixtures/local/, which is owner-curated and uncommitted.`);

    if (result === null) { declined++; return; }
    extracted++;
    assert.ok(result instanceof Uint8Array, `container ${index} must yield bytes`);
    assert.ok(result.length > 0, `container ${index} yielded an empty stream`);

    const text = trimTrailingNulls(new TextDecoder('utf-16le').decode(result));
    assert.match(text.split(/\r?\n/)[0], /^[\x21-\x39\x3B-\x7E]+:/,
      `container ${index} did not yield an RFC 5322 header block`);

    // Per-container integrity: PR_TRANSPORT_MESSAGE_HEADERS exists because the message
    // traversed SMTP, and SMTP requires a Message-ID -- so an absent one means the bytes
    // are misaligned or truncated rather than the message being unusual. Subject and date
    // are deliberately NOT asserted: both can be legitimately empty, and committed
    // fixture 0005 is the proof for date.
    assert.ok(mapToPayload(parseHeaders(text)).extra.length > 0,
      `container ${index} parsed to a payload with no Message-ID -- the extracted bytes ` +
      `are misaligned or truncated`);
  });

  assert.ok(extracted > 0,
    `the reader extracted nothing from ${files.length} real containers`);

  console.log(`      real-corpus acceptance: ${extracted} extracted, ${declined} declined, ${files.length} total`);
});
