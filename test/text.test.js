const { test } = require("node:test");
const assert = require("node:assert/strict");
const { truncateToTokenBudget } = require("../lib/text");

test("returns text unchanged when within budget", () => {
  const text = "short text";
  assert.equal(truncateToTokenBudget(text, 100), text);
});

test("truncates text that exceeds the char budget (tokens * 4)", () => {
  const text = "a".repeat(50);
  const result = truncateToTokenBudget(text, 5); // charLimit = 20
  assert.ok(result.startsWith("a".repeat(20)));
  assert.ok(result.includes("[...TRUNCATED DUE TO TOKEN BUDGET...]"));
  assert.ok(result.length < text.length + 50);
});

test("keeps text exactly at the limit", () => {
  const text = "a".repeat(20);
  assert.equal(truncateToTokenBudget(text, 5), text); // not > charLimit
});
