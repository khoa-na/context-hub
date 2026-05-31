const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  dedupePreserveOrder,
  recallAtK,
  precisionAtK,
  reciprocalRank,
  ndcgAtK,
  mean,
} = require("../eval/metrics");

test("dedupePreserveOrder keeps first occurrence order", () => {
  assert.deepEqual(dedupePreserveOrder(["a", "b", "a", "c", "b"]), ["a", "b", "c"]);
  assert.deepEqual(dedupePreserveOrder([]), []);
});

test("recallAtK finds relevant docs within the cutoff", () => {
  const ranked = ["q2-2026", "q1-2026", "q3-2026"];
  assert.equal(recallAtK(ranked, ["q1-2026"], 1), 0); // top-1 is wrong
  assert.equal(recallAtK(ranked, ["q1-2026"], 2), 1); // found at rank 2
  assert.equal(recallAtK(ranked, ["q1-2026", "q3-2026"], 3), 1); // both within top-3
  assert.equal(recallAtK(ranked, ["q1-2026", "q3-2026"], 2), 0.5); // only one within top-2
});

test("recallAtK returns 0 when there are no relevant docs", () => {
  assert.equal(recallAtK(["a", "b"], [], 3), 0);
});

test("precisionAtK counts relevant positions over k", () => {
  const ranked = ["a", "b", "c", "d"];
  assert.equal(precisionAtK(ranked, ["a", "c"], 4), 0.5); // 2 of 4
  assert.equal(precisionAtK(ranked, ["a"], 2), 0.5); // 1 of 2
  assert.equal(precisionAtK(ranked, ["a"], 1), 1); // 1 of 1
  assert.equal(precisionAtK(ranked, ["x"], 3), 0);
});

test("reciprocalRank uses the rank of the first relevant doc", () => {
  assert.equal(reciprocalRank(["a", "b", "c"], ["a"]), 1);
  assert.equal(reciprocalRank(["a", "b", "c"], ["b"]), 0.5);
  assert.equal(reciprocalRank(["a", "b", "c"], ["c"]), 1 / 3);
  assert.equal(reciprocalRank(["a", "b", "c"], ["x"]), 0);
});

test("ndcgAtK is 1 when the only relevant doc is ranked first", () => {
  assert.equal(ndcgAtK(["a", "b", "c"], ["a"], 3), 1);
});

test("ndcgAtK discounts a relevant doc ranked lower", () => {
  // single relevant doc at rank 2: DCG = 1/log2(3), IDCG = 1/log2(2) = 1
  const expected = (1 / Math.log2(3)) / 1;
  assert.ok(Math.abs(ndcgAtK(["a", "b", "c"], ["b"], 3) - expected) < 1e-9);
});

test("ndcgAtK stays within [0, 1] with multiple relevant docs", () => {
  const value = ndcgAtK(["a", "b", "c", "d"], ["a", "c"], 4);
  assert.ok(value > 0 && value <= 1);
});

test("ndcgAtK returns 0 when no relevant docs are present", () => {
  assert.equal(ndcgAtK(["a", "b"], [], 3), 0);
});

test("mean averages finite numbers and ignores empty input", () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(mean([]), 0);
  assert.equal(mean([0.5, 1]), 0.75);
});
