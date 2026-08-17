"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, 'fixtures', 'eml');

test('fixture corpus is non-empty and fully paired', () => {
  const names = fs.readdirSync(dir);
  const eml = names.filter(n => n.endsWith('.eml')).map(n => n.slice(0, -4)).sort();
  const exp = names.filter(n => n.endsWith('.expected.json')).map(n => n.slice(0, -14)).sort();
  assert.ok(eml.length > 0, 'fixture corpus is empty — the parse suite would pass vacuously');
  assert.deepEqual(eml, exp, 'every .eml needs an .expected.json and every .expected.json needs an .eml');
});
