const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  splitIntoChunks,
  getDocumentSections,
  splitContentIntoSlices,
  packSectionsIntoSlices,
} = require("../lib/chunking");

test("splitIntoChunks keeps a short section as a single chunk titled by its heading", () => {
  const chunks = splitIntoChunks("# Title\n\npara1\n\npara2");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].title, "Title");
  assert.equal(chunks[0].id, "C1");
  assert.ok(chunks[0].text.includes("para1"));
});

test("splitIntoChunks returns an Overview fallback for empty input", () => {
  const chunks = splitIntoChunks("   ");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].title, "Overview");
});

test("splitIntoChunks splits long sections into multiple chunks sharing the parent text", () => {
  const para = "a".repeat(700);
  const markdown = `# Big\n\n${para}\n\n${para}\n\n${para}`;
  const chunks = splitIntoChunks(markdown);
  assert.ok(chunks.length >= 2, `expected multiple chunks, got ${chunks.length}`);
  assert.ok(chunks.every((c) => c.title === "Big"));
  // every child chunk carries the full section text as its parent
  assert.ok(chunks.every((c) => c.parentText.includes(para)));
});

test("getDocumentSections deduplicates sections and assigns S-prefixed ids", () => {
  const sections = getDocumentSections("# A\n\ntext a\n\n# B\n\ntext b");
  assert.equal(sections.length, 2);
  assert.equal(sections[0].id, "S1");
  assert.equal(sections[1].id, "S2");
  assert.equal(sections[0].title, "A");
});

test("splitContentIntoSlices returns the whole text when within budget", () => {
  assert.deepEqual(splitContentIntoSlices("hello world", 1000), ["hello world"]);
});

test("splitContentIntoSlices returns an empty array for empty input", () => {
  assert.deepEqual(splitContentIntoSlices("", 1000), []);
});

test("splitContentIntoSlices respects the char budget on long plain text", () => {
  const text = Array(10).fill("x".repeat(900)).join("\n\n");
  const slices = splitContentIntoSlices(text, 2000);
  assert.ok(slices.length > 1);
  assert.ok(slices.every((s) => s.length <= 2000));
});

test("splitContentIntoSlices repeats the table header across table slices", () => {
  const rows = Array(50).fill("| aaaa | bbbb |").join("\n");
  const table = `| h1 | h2 |\n| --- | --- |\n${rows}`;
  const slices = splitContentIntoSlices(table, 200);
  assert.ok(slices.length > 1);
  assert.ok(slices.every((s) => s.includes("| h1 | h2 |")));
});

test("packSectionsIntoSlices combines small sections into one slice", () => {
  const sections = [
    { id: "S1", title: "A", text: "short a" },
    { id: "S2", title: "B", text: "short b" },
  ];
  const slices = packSectionsIntoSlices(sections, 12000);
  assert.equal(slices.length, 1);
  assert.ok(slices[0].includes("S1"));
  assert.ok(slices[0].includes("S2"));
});
