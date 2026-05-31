const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeModelAnswer,
  normalizeModelText,
  extractFirstJsonObject,
  parseStructuredAnswerPayload,
} = require("../services/gemini");

test("sanitizeModelAnswer strips markdown emphasis and code fences", () => {
  assert.equal(sanitizeModelAnswer("**bold**"), "bold");
  assert.equal(sanitizeModelAnswer("```code```"), "code");
});

test("sanitizeModelAnswer drops leaked reasoning lines before the real answer", () => {
  const out = sanitizeModelAnswer("Thinking: my private reasoning\nReal answer here.");
  assert.equal(out, "Real answer here.");
});

test("normalizeModelText converts math/arrow notation and removes stray $", () => {
  assert.equal(normalizeModelText("a \\rightarrow b"), "a -> b");
  assert.equal(normalizeModelText("x \\geq y"), "x >= y");
  assert.equal(normalizeModelText("price $5"), "price 5");
});

test("extractFirstJsonObject extracts a balanced object from surrounding noise", () => {
  assert.equal(extractFirstJsonObject('prefix {"a":1} suffix'), '{"a":1}');
  assert.equal(extractFirstJsonObject('x {"a":{"b":2}} y'), '{"a":{"b":2}}');
});

test("extractFirstJsonObject ignores braces inside strings", () => {
  assert.equal(extractFirstJsonObject('{"a":"}"}'), '{"a":"}"}');
});

test("extractFirstJsonObject returns empty string when there is no object", () => {
  assert.equal(extractFirstJsonObject("no json here"), "");
});

test("parseStructuredAnswerPayload parses a valid structured answer", () => {
  const parsed = parseStructuredAnswerPayload(
    '{"answer":"Xin chào","citations":["c1"],"follow_up_questions":["q1"]}'
  );
  assert.deepEqual(parsed, {
    answer: "Xin chào",
    citations: ["c1"],
    follow_up_questions: ["q1"],
  });
});

test("parseStructuredAnswerPayload rejects empty or symbol-only answers", () => {
  assert.equal(parseStructuredAnswerPayload('{"answer":"","citations":[]}'), null);
  assert.equal(parseStructuredAnswerPayload('{"answer":"...","citations":[]}'), null);
});

test("parseStructuredAnswerPayload returns null for non-JSON text", () => {
  assert.equal(parseStructuredAnswerPayload("just a plain sentence"), null);
});
