"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detect, parseHeaders, mapToPayload, textFromMsg, parseMsg } = require('../src/message.js');

const dir = path.join(__dirname, 'fixtures', 'eml');

for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.eml'))) {
  test(`eml fixture ${f}`, () => {
    const text = new TextDecoder('utf-8').decode(fs.readFileSync(path.join(dir, f)));
    const expectedPath = path.join(dir, f.replace(/\.eml$/, '.expected.json'));
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    assert.deepEqual(mapToPayload(parseHeaders(text)), expected);
    // The committed fixtures land LF-terminated, but CRLF is the wire format RFC 5322
    // specifies and is what the MSG generator re-emits. Without this second assertion
    // nothing in the corpus exercises CRLF unfolding, and a splitter that keys on \n
    // alone leaves a trailing \r on every unfolded value — which reaches the subject,
    // the cite-key, and a directory name.
    const crlf = text.replace(/\r?\n/g, '\r\n');
    assert.deepEqual(mapToPayload(parseHeaders(crlf)), expected);
  });
}

test('detect classifies by magic bytes, not by extension', () => {
  const enc = new TextEncoder();
  assert.equal(detect(enc.encode('From: a@example.com\r\n'), 'x.eml'), 'eml');
  assert.equal(detect(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]), 'x.eml'), null);
  assert.equal(detect(new Uint8Array([0xD0, 0xCF, 0x11, 0xE0]), 'x.msg'), 'msg');
  assert.equal(detect(enc.encode('From: a@example.com\r\n'), 'x.pdf'), null);
});

// The stretch's cross-container check. Byte identity between an .eml and its .msg twin
// is not guaranteed by the formats, so this asserts equality of the PARSED result --
// the property the one-parser-two-readers seam actually claims -- rather than of the
// containers. The .msg is generated at pretest from this same .eml.
test('msg and eml twins parse to the same ParsedMessage', () => {
  const stem = '0001-plain-ascii';
  const emlText = new TextDecoder('utf-8').decode(fs.readFileSync(path.join(dir, `${stem}.eml`)));
  const msgBytes = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'msg', `${stem}.msg`)));

  const msgText = textFromMsg(msgBytes);
  assert.ok(msgText !== null, 'the msg container must yield a header block');

  assert.deepEqual(parseHeaders(msgText), parseHeaders(emlText));

  const expected = JSON.parse(fs.readFileSync(path.join(dir, `${stem}.expected.json`), 'utf8'));
  assert.deepEqual(mapToPayload(parseHeaders(msgText)), expected);
});

// The fallback path, which nothing else in this file reaches. The three blocks above are
// the .eml loop, the detect test, and the twin test -- and the twin test calls textFromMsg
// on the header-BEARING fixture, so it proves the header path and says nothing about this
// one. Validation item 9's "already proves at the parser level" is accurate about item 9.
//
// What this does NOT establish: the fixture is synthetic and routes its short streams
// through readChain rather than the mini-stream a real container would use, so this is
// regression coverage of the parser, not evidence about real .msg layout. The live-Zotero
// DoD row remains the observation of the real path.
test('a msg with no transport headers parses through the MAPI property fallback', () => {
  const msgBytes = new Uint8Array(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'msg', '0011-no-transport-headers.msg'))
  );

  // First, and load-bearing: the fixture genuinely omits __substg1.0_007D001F, so the
  // fallback is reached rather than the header path. Without this the whole block would
  // pass against a fixture that still carried transport headers and prove nothing.
  assert.equal(textFromMsg(msgBytes), null, 'the fixture must carry no transport headers');

  const parsed = parseMsg(msgBytes);
  assert.ok(parsed !== null, 'the fallback must yield a ParsedMessage');
  assert.equal(parsed.subject, 'Quarterly planning notes');
  assert.equal(parsed.from.name, 'Dana Whitfield');
  assert.equal(parsed.from.email, 'dana.whitfield@example.org');

  // The generator pads each stream to the mini-stream cutoff, so an untrimmed read yields
  // thousands of NULs that would reach the item title, the cite key and the renamed
  // filename while failing no other assertion here.
  assert.ok(!/\u0000/.test(parsed.subject), 'trailing NUL padding must be trimmed');
  assert.ok(!/\u0000/.test(parsed.from.name), 'trailing NUL padding must be trimmed');
  assert.ok(!/\u0000/.test(parsed.from.email), 'trailing NUL padding must be trimmed');

  // The two deliberate omissions, which are the substance of the fallback contract.
  assert.equal(parsed.date, '');
  assert.equal(parsed.messageId, '');

  // mapToPayload emits the Message-ID line only for a non-empty message-id, and an empty
  // extra is exactly what Validation item 10 observes end to end -- asserting it here
  // makes the live-Zotero row a confirmation rather than the sole evidence.
  assert.equal(mapToPayload(parsed).extra, '');
});
