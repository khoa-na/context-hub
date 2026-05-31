const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseBoolean } = require("../lib/http");

test("returns booleans unchanged", () => {
  assert.equal(parseBoolean(true), true);
  assert.equal(parseBoolean(false), false);
});

test("parses truthy strings case-insensitively and trimmed", () => {
  for (const value of ["1", "true", "yes", "on", " TRUE ", "Yes"]) {
    assert.equal(parseBoolean(value), true, `expected ${value} -> true`);
  }
});

test("treats other strings as false", () => {
  for (const value of ["0", "false", "no", "off", "", "maybe"]) {
    assert.equal(parseBoolean(value), false, `expected ${value} -> false`);
  }
});

test("returns false for non-string, non-boolean values", () => {
  assert.equal(parseBoolean(undefined), false);
  assert.equal(parseBoolean(null), false);
  assert.equal(parseBoolean(1), false);
  assert.equal(parseBoolean({}), false);
});
