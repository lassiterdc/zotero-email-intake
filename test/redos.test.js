"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHeaders } = require('../src/message.js');

function ms(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

function folded(n) {
  return 'Subject: start' + '\r\n unfolded continuation'.repeat(n) + '\r\n\r\n';
}

test('header parsing is not superlinear in folded-line count', () => {
  parseHeaders(folded(1000));                 // warm up; do not measure the first sight of the parser
  const t1 = ms(() => parseHeaders(folded(40000)));
  const t2 = ms(() => parseHeaders(folded(80000)));
  // The baseline must clear timer granularity by a wide margin, or an additive slack
  // term swamps the ratio and the assertion becomes unfalsifiable.
  assert.ok(t1 > 5,
    `baseline was ${t1.toFixed(1)} ms — too small to support a ratio assertion; raise the fold count`);
  // Linear is 2x. Quadratic is exactly 4x, so any bound at or above 4x passes the
  // repeated-concatenation unfolder this test exists to catch.
  assert.ok(t2 < 2.5 * t1,
    `doubling the input took ${(t2 / t1).toFixed(1)}x — expected about 2x; 4x is quadratic`);
});

// The two pathological inputs `docs/architecture.md` § Security posture names, built
// in process. They are generated rather than committed because a 200 KB fixture in a
// public repo is bulk with no reader, and because generating them keeps the input
// shape visible next to the assertion it feeds.
function longSingleValue(nBytes) {
  const unit = 'a \t';                       // alternating whitespace and non-whitespace
  return 'Subject: ' + unit.repeat(Math.ceil(nBytes / unit.length)) + '\r\n\r\n';
}

test('pathological inputs parse under an absolute backstop', () => {
  const cases = {
    'one 200 KB alternating-whitespace header value': longSingleValue(200 * 1024),
    'ten thousand folded continuation lines': folded(10000),
  };
  for (const [name, text] of Object.entries(cases)) {
    const elapsed = ms(() => parseHeaders(text));
    assert.ok(elapsed < 250, `${name} took ${elapsed.toFixed(1)} ms, exceeding the 250 ms backstop`);
  }
});
