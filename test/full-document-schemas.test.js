const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeForScoring,
  selectFullDocumentSchemaPreset,
  buildSchemaPresetInstruction,
} = require("../lib/full-document-schemas");

test("normalizeForScoring strips Vietnamese diacritics and lowercases", () => {
  assert.equal(normalizeForScoring("Doanh Thu"), "doanh thu");
  assert.equal(normalizeForScoring("Rủi Ro"), "rui ro");
  assert.equal(normalizeForScoring("LỢI NHUẬN"), "loi nhuan");
});

test("selects the financial preset for revenue/profit questions", () => {
  const preset = selectFullDocumentSchemaPreset("Tóm tắt doanh thu và lợi nhuận năm nay");
  assert.equal(preset.id, "financial");
});

test("selects the risk preset for risk questions", () => {
  const preset = selectFullDocumentSchemaPreset("Liệt kê các rủi ro chính trong báo cáo");
  assert.equal(preset.id, "risk");
});

test("selects the operational preset for KPI/operations questions", () => {
  const preset = selectFullDocumentSchemaPreset("Các KPI vận hành và khách hàng thế nào");
  assert.equal(preset.id, "operational");
});

test("falls back to the generic preset when no keywords match", () => {
  const preset = selectFullDocumentSchemaPreset("hello world general question");
  assert.equal(preset.id, "generic");
});

test("buildSchemaPresetInstruction includes the preset id and fields", () => {
  const preset = selectFullDocumentSchemaPreset("doanh thu");
  const instruction = buildSchemaPresetInstruction(preset);
  assert.ok(instruction.includes("Schema preset: financial"));
  assert.ok(instruction.includes("revenue"));
});

test("buildSchemaPresetInstruction defaults to generic when preset is missing", () => {
  const instruction = buildSchemaPresetInstruction(null);
  assert.ok(instruction.includes("Schema preset: generic"));
});
