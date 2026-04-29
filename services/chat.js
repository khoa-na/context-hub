const config = require("../config");
const { semanticSearch, bm25Search, hybridSearch } = require("../db");
const { getApiKeyForProvider, getProviderForModel } = require("../lib/model-providers");
const { loadWikiContext, loadAllDocumentsWithMarkdown } = require("../lib/storage");
const { loadSessionWebPagesWithMarkdown } = require("../lib/web-pages");
const { truncateToTokenBudget } = require("../lib/text");
const { splitIntoChunks, getDocumentSections, splitContentIntoSlices } = require("../lib/chunking");
const { getGeminiEmbedding, getGeminiEmbeddingBatch } = require("../embedding");
const {
  buildSchemaPresetInstruction,
  normalizeForScoring,
  selectFullDocumentSchemaPreset,
} = require("../lib/full-document-schemas");
const {
  buildGeminiSystemInstruction,
  buildFullDocumentSystemInstruction,
  buildDocumentSliceSystemInstruction,
  buildDocumentReduceSystemInstruction,
  buildRerankSystemInstruction,
  buildGeminiUserPrompt,
  buildDirectFullDocumentPrompt,
  buildDocumentSlicePrompt,
  buildDocumentSummaryPrompt,
  buildWholeDocumentSummaryPrompt,
  buildCompressedSummariesPrompt,
  buildFullDocumentSynthesisPrompt,
  generateGeminiAnswer,
  generateStructuredGeminiAnswer,
} = require("./gemini");

function normalizeRetrievalMode(value) {
  return ["bm25", "semantic", "hybrid"].includes(value) ? value : "hybrid";
}

function retrievalUsesEmbedding(retrievalMode) {
  return retrievalMode === "semantic" || retrievalMode === "hybrid";
}

function normalizeChatMode(value) {
  if (value === "full-document" || value === "web-pages") {
    return value;
  }
  return "qa";
}

function normalizeWebPageReadMode(value) {
  return ["auto", "fast", "full-scan"].includes(value) ? value : "auto";
}

function buildFullDocumentSource(document) {
  return {
    id: document.id,
    title: document.title,
    filename: document.filename,
    content: document.markdown.slice(0, 2400),
    childContent: "",
    score: null,
    retrieval: {
      sources: ["full-document"],
    },
  };
}

function buildWebPageDocument(page) {
  return {
    id: `web:${page.id}`,
    title: page.title,
    filename: page.url,
    markdown: page.markdown,
  };
}

function buildWebPageSource(page) {
  return {
    id: `web:${page.id}`,
    title: page.title,
    filename: page.url,
    content: page.markdown.slice(0, 2400),
    childContent: "",
    score: null,
    retrieval: {
      sources: ["web-page"],
    },
  };
}

function isBroadWebPageQuestion(question) {
  const normalized = normalizeForScoring(question);
  return [
    "tom tat",
    "tong quan",
    "noi dung chinh",
    "toan trang",
    "summary",
    "overview",
  ].some((marker) => normalized.includes(marker));
}

function isThoroughWebPageQuestion(question) {
  const normalized = normalizeForScoring(question);
  return [
    "day du",
    "chi tiet",
    "liet ke",
    "toan bo",
    "doc het",
    "quet het",
    "tat ca",
    "trich xuat het",
    "khong bo sot",
    "khong thieu",
    "full scan",
  ].some((marker) => normalized.includes(marker));
}

const WEB_PAGE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "ai",
  "bi",
  "boi",
  "cac",
  "cho",
  "co",
  "cua",
  "da",
  "de",
  "den",
  "du",
  "dua",
  "duoc",
  "hay",
  "khi",
  "la",
  "lieu",
  "mot",
  "nao",
  "nay",
  "nhung",
  "tai",
  "theo",
  "thi",
  "tu",
  "va",
  "ve",
  "viec",
]);

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom ? dot / denom : 0;
}

function buildFocusedWebPageTerms(question, schemaPreset) {
  const questionTerms = normalizeForScoring(question)
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2 && !WEB_PAGE_STOP_WORDS.has(term));
  const terms = new Set(questionTerms);
  const phrases = new Set();

  for (let index = 0; index < questionTerms.length - 1; index += 1) {
    phrases.add(`${questionTerms[index]} ${questionTerms[index + 1]}`);
  }

  for (let index = 0; index < questionTerms.length - 2; index += 1) {
    phrases.add(`${questionTerms[index]} ${questionTerms[index + 1]} ${questionTerms[index + 2]}`);
  }

  for (const value of [
    ...(schemaPreset?.keywords || []),
    ...(schemaPreset?.fields || []),
    ...(schemaPreset?.focus || []),
  ]) {
    normalizeForScoring(value)
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 3)
      .forEach((term) => terms.add(term));
  }

  return {
    terms: [...terms],
    phrases: [...phrases],
  };
}

function scoreWebPageChunk(chunk, query) {
  const title = normalizeForScoring(chunk.title || "");
  const text = normalizeForScoring(`${chunk.title || ""}\n${chunk.text || ""}`);
  const terms = query?.terms || [];
  const phrases = query?.phrases || [];
  if (!text || !terms.length) {
    return 0;
  }

  const termScore = terms.reduce((score, term) => {
    if (!text.includes(term)) {
      return score;
    }
    const occurrences = text.split(term).length - 1;
    return score + Math.min(occurrences, 4) + (title.includes(term) ? 4 : 0);
  }, 0);
  const phraseScore = phrases.reduce((score, phrase) => {
    if (!text.includes(phrase)) {
      return score;
    }
    const occurrences = text.split(phrase).length - 1;
    return score + 8 + Math.min(occurrences, 3) * 3 + (title.includes(phrase) ? 6 : 0);
  }, 0);

  return termScore + phraseScore;
}

function buildWebPageExcerptBlock(excerpt) {
  return [
    `Source ID: ${excerpt.sourceId}`,
    `Page title: ${excerpt.page.title}`,
    `Source URL: ${excerpt.page.url}`,
    `Section: ${excerpt.chunk.title || "Overview"}`,
    `Excerpt index: ${excerpt.index + 1}`,
    "",
    excerpt.chunk.text,
  ].join("\n");
}

function selectFocusedWebPageExcerpts({ pages, question, schemaPreset }) {
  const broadQuestion = isBroadWebPageQuestion(question);
  const thoroughQuestion = broadQuestion || isThoroughWebPageQuestion(question);
  const charBudget = config.WEB_PAGE_CONTEXT_CHAR_BUDGET || (thoroughQuestion ? 22000 : 14000);
  const maxExcerpts = config.WEB_PAGE_CONTEXT_MAX_EXCERPTS || (thoroughQuestion ? 18 : 12);
  const query = buildFocusedWebPageTerms(question, schemaPreset);
  const scored = [];

  for (const page of pages) {
    const chunks = splitIntoChunks(page.markdown);
    chunks.forEach((chunk, index) => {
      scored.push({
        page,
        chunk,
        index,
        sourceId: `web:${page.id}:C${index + 1}`,
        score: scoreWebPageChunk(chunk, query),
      });
    });
  }

  const selected = new Map();
  function add(item) {
    if (item) {
      selected.set(`${item.page.id}:${item.index}`, item);
    }
  }

  function addWithNeighbors(pageItems, item) {
    add(item);
    const radius = thoroughQuestion ? 2 : 1;
    for (let offset = 1; offset <= radius; offset += 1) {
      add(pageItems[item.index - offset]);
      add(pageItems[item.index + offset]);
    }
  }

  for (const page of pages) {
    const pageItems = scored.filter((item) => item.page.id === page.id);
    const hasPositiveScore = pageItems.some((item) => item.score > 0);
    if (pageItems.length && (broadQuestion || !hasPositiveScore)) {
      add(pageItems[0]);
    }
    if (broadQuestion && pageItems.length > 1) {
      const targetCount = Math.min(4, pageItems.length);
      for (let position = 0; position < targetCount; position += 1) {
        const index = Math.round((position * (pageItems.length - 1)) / Math.max(1, targetCount - 1));
        add(pageItems[index]);
      }
    }
  }

  const sortedByScore = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  for (const item of sortedByScore) {
    if (selected.size >= maxExcerpts) {
      break;
    }
    if (item.score <= 0 && selected.size >= pages.length) {
      break;
    }
    const pageItems = scored.filter((candidate) => candidate.page.id === item.page.id);
    addWithNeighbors(pageItems, item);
  }

  let totalChars = 0;
  const excerpts = [];
  for (const item of [...selected.values()].sort((a, b) => a.page.id.localeCompare(b.page.id) || a.index - b.index)) {
    const blockLength = buildWebPageExcerptBlock(item).length;
    if (excerpts.length && totalChars + blockLength > charBudget) {
      continue;
    }
    excerpts.push(item);
    totalChars += blockLength;
    if (excerpts.length >= maxExcerpts) {
      break;
    }
  }

  return excerpts;
}

async function selectSemanticWebPageExcerpts({ pages, question, schemaPreset, apiKey }) {
  const broadQuestion = isBroadWebPageQuestion(question);
  const thoroughQuestion = broadQuestion || isThoroughWebPageQuestion(question);
  const charBudget = config.WEB_PAGE_CONTEXT_CHAR_BUDGET || (thoroughQuestion ? 22000 : 14000);
  const maxExcerpts = config.WEB_PAGE_CONTEXT_MAX_EXCERPTS || (thoroughQuestion ? 18 : 12);

  const allChunks = [];
  for (const page of pages) {
    const chunks = splitIntoChunks(page.markdown);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const title = chunk.title || "Overview";
      const text = `${title}: ${chunk.text || ""}`;
      allChunks.push({
        page,
        chunk,
        index: i,
        sourceId: `web:${page.id}:C${i + 1}`,
        text,
      });
    }
  }

  if (!allChunks.length) return [];

  const questionEmbedding = await getGeminiEmbedding(question, apiKey, "RETRIEVAL_QUERY");
  const texts = allChunks.map((c) => c.text);
  const chunkEmbeddings = await getGeminiEmbeddingBatch(texts, apiKey, "RETRIEVAL_DOCUMENT");

  for (let i = 0; i < allChunks.length; i++) {
    allChunks[i].score = cosineSimilarity(questionEmbedding, chunkEmbeddings[i]);
  }

  const selected = new Map();
  function add(item) {
    if (item) selected.set(`${item.page.id}:${item.index}`, item);
  }
  function addWithNeighbors(pageItems, item) {
    add(item);
    const radius = thoroughQuestion ? 2 : 1;
    for (let offset = 1; offset <= radius; offset += 1) {
      add(pageItems[item.index - offset]);
      add(pageItems[item.index + offset]);
    }
  }

  for (const page of pages) {
    const pageItems = allChunks.filter((item) => item.page.id === page.id);
    const hasRelevantScore = pageItems.some((item) => item.score > 0.35);
    if (pageItems.length && (broadQuestion || !hasRelevantScore)) {
      add(pageItems[0]);
    }
    if (broadQuestion && pageItems.length > 1) {
      const targetCount = Math.min(4, pageItems.length);
      for (let position = 0; position < targetCount; position += 1) {
        const idx = Math.round((position * (pageItems.length - 1)) / Math.max(1, targetCount - 1));
        add(pageItems[idx]);
      }
    }
  }

  const sortedByScore = [...allChunks].sort((a, b) => b.score - a.score || a.index - b.index);
  for (const item of sortedByScore) {
    if (selected.size >= maxExcerpts) break;
    if (item.score <= 0.25 && selected.size >= pages.length) break;
    const pageItems = allChunks.filter((candidate) => candidate.page.id === item.page.id);
    addWithNeighbors(pageItems, item);
  }

  let totalChars = 0;
  const excerpts = [];
  for (const item of [...selected.values()].sort((a, b) => a.page.id.localeCompare(b.page.id) || a.index - b.index)) {
    const blockLength = buildWebPageExcerptBlock(item).length;
    if (excerpts.length && totalChars + blockLength > charBudget) continue;
    excerpts.push(item);
    totalChars += blockLength;
    if (excerpts.length >= maxExcerpts) break;
  }

  return excerpts;
}

function buildFocusedWebPagesPrompt({ question, history, documents, excerpts, schemaInstruction }) {
  const historyLines = (history || [])
    .slice(-4)
    .map((entry) => `${entry.role === "assistant" ? "Assistant" : "User"}: ${entry.content}`)
    .join("\n");

  return [
    historyLines ? `Conversation so far:\n${historyLines}` : "",
    `=== SELECTED WEB PAGES ===\n${documents.map((document) => `- ${document.id}: ${document.title} (${document.filename})`).join("\n")}`,
    schemaInstruction ? `=== EXTRACTION FOCUS ===\n${schemaInstruction}` : "",
    [
      "Use only the selected web page excerpts below.",
      "Answer in the same language as the user.",
      "Cite source IDs such as web:<page-id>:C<n> when using facts.",
      "If the excerpts do not contain enough information, say what is missing instead of guessing.",
    ].join("\n"),
    `=== RELEVANT WEB PAGE EXCERPTS ===\n${excerpts.map(buildWebPageExcerptBlock).join("\n\n---\n\n")}`,
    `=== USER REQUEST ===\n${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildWebPageScanSlices(pages, maxChars = config.WEB_PAGE_FULL_SCAN_SLICE_CHAR_BUDGET || 6000) {
  const slices = [];
  let current = "";
  let currentIds = [];
  let totalExcerptCount = 0;

  function pushCurrent() {
    if (!current.trim()) {
      return;
    }
    slices.push({
      text: current.trim(),
      sourceIds: currentIds,
    });
    current = "";
    currentIds = [];
  }

  for (const page of pages) {
    const chunks = splitIntoChunks(page.markdown);
    chunks.forEach((chunk, index) => {
      totalExcerptCount += 1;
      const excerpt = {
        page,
        chunk,
        index,
        sourceId: `web:${page.id}:C${index + 1}`,
      };
      const block = buildWebPageExcerptBlock(excerpt);
      const candidate = current ? `${current}\n\n---\n\n${block}` : block;
      if (candidate.length > maxChars && current) {
        pushCurrent();
        current = block;
        currentIds = [excerpt.sourceId];
      } else {
        current = candidate;
        currentIds.push(excerpt.sourceId);
      }
    });
  }

  pushCurrent();
  return { slices, totalExcerptCount };
}

function buildWebPageScanPrompt({ question, documents, sliceText, sliceIndex, totalSlices, schemaInstruction }) {
  return [
    "Scan this web-page slice for facts that may help answer the user request.",
    "Use only the supplied slice.",
    "Return concise Vietnamese notes.",
    "Preserve source IDs exactly, such as web:<page-id>:C<n>.",
    "If the slice has no relevant information, return: No directly relevant information in this slice.",
    "",
    `User request: ${question}`,
    `Slice ${sliceIndex} of ${totalSlices}`,
    schemaInstruction ? `Extraction focus:\n${schemaInstruction}` : "",
    `Selected web pages:\n${documents.map((document) => `- ${document.id}: ${document.title} (${document.filename})`).join("\n")}`,
    "",
    `=== WEB PAGE SLICE ===\n${sliceText}`,
  ].filter(Boolean).join("\n\n");
}

function buildWebPageScanSynthesisPrompt({ question, history, documents, scanNotes, schemaInstruction }) {
  const historyLines = (history || [])
    .slice(-4)
    .map((entry) => `${entry.role === "assistant" ? "Assistant" : "User"}: ${entry.content}`)
    .join("\n");

  return [
    historyLines ? `Conversation so far:\n${historyLines}` : "",
    `=== SELECTED WEB PAGES ===\n${documents.map((document) => `- ${document.id}: ${document.title} (${document.filename})`).join("\n")}`,
    schemaInstruction ? `=== EXTRACTION FOCUS ===\n${schemaInstruction}` : "",
    [
      "You are synthesizing results from a full scan of the selected web pages.",
      "Answer in the same language as the user.",
      "Use only the scan notes below.",
      "For list/extraction questions, include every distinct relevant item found in the scan notes.",
      "Cite source IDs such as web:<page-id>:C<n> next to the specific fact they support.",
      "If the scan notes do not contain enough information, state that limitation clearly.",
    ].join("\n"),
    `=== FULL SCAN NOTES ===\n${scanNotes.map((note, index) => `Scan slice ${index + 1}:\n${note}`).join("\n\n---\n\n")}`,
    `=== USER REQUEST ===\n${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function answerWithFullScanWebPages({ question, history, apiKey, provider, model, pages, documents, schemaPreset, schemaInstruction }) {
  const modelConcurrency = config.WEB_PAGE_FULL_SCAN_MODEL_CONCURRENCY || 1;
  const { slices, totalExcerptCount } = buildWebPageScanSlices(pages);
  if (!slices.length) {
    throw new Error("Could not extract readable slices from the selected web pages.");
  }

  const scanResults = await mapWithConcurrency(slices, modelConcurrency, async (slice, index) => {
    try {
      const note = await generateGeminiAnswer({
        apiKey,
        provider,
        model,
        maxOutputTokens: 350,
        systemInstruction: buildDocumentSliceSystemInstruction(),
        prompt: buildWebPageScanPrompt({
          question,
          documents,
          sliceText: slice.text,
          sliceIndex: index + 1,
          totalSlices: slices.length,
          schemaInstruction,
        }),
      });
      return { ok: true, note };
    } catch (error) {
      const status = Number(error?.statusCode || error?.cause?.statusCode) || null;
      console.warn(`[web-page-scan] slice ${index + 1}/${slices.length} failed${status ? ` with ${status}` : ""}: ${error.message}`);
      return {
        ok: false,
        note: `Slice ${index + 1} could not be scanned because the model request failed${status ? ` with HTTP ${status}` : ""}. Source IDs in this slice: ${slice.sourceIds.join(", ")}.`,
      };
    }
  });
  const scanNotes = scanResults.map((result) => result.note);
  const failedSliceCount = scanResults.filter((result) => !result.ok).length;
  const successfulSliceCount = scanResults.length - failedSliceCount;

  if (!successfulSliceCount) {
    throw new Error("Full scan failed because the model rejected every page slice. Try the smaller model or Fast read depth.");
  }

  const response = await generateStructuredGeminiAnswer({
    apiKey,
    provider,
    model,
    maxOutputTokens: 1000,
    systemInstruction: buildFullDocumentSystemInstruction(),
    prompt: buildWebPageScanSynthesisPrompt({
      question,
      history,
      documents,
      scanNotes,
      schemaInstruction,
    }),
    useResponseSchema: false,
  });
  const answer = response.answer;
  const fallbackStructured = buildFallbackStructuredAnswer({ answer, documents, schemaPreset });

  return {
    answer,
    structured: response.structured || {
      ...fallbackStructured,
      follow_up_questions: failedSliceCount
        ? [
          `${failedSliceCount} slice(s) could not be scanned because the model returned errors.`,
          "Try the smaller model or Fast read depth if this happens again.",
        ]
        : fallbackStructured.follow_up_questions,
    },
    rawModelText: response.rawText || "",
    sliceCount: slices.length,
    totalSliceCount: totalExcerptCount,
    processingMode: failedSliceCount ? `full-page-scan-partial-${failedSliceCount}-failed` : "full-page-scan",
  };
}

function normalizeDocumentSelection(documentIds = [], documentId = "") {
  const ids = Array.isArray(documentIds) ? documentIds : [];
  const normalized = ids
    .map((id) => String(id || "").trim())
    .filter(Boolean);

  if (!normalized.length && documentId) {
    normalized.push(String(documentId).trim());
  }

  return [...new Set(normalized)];
}

function buildSliceHeader({ document, section, localSliceIndex }) {
  return [
    `Document ID: ${document.id}`,
    `Filename: ${document.filename}`,
    `Title: ${document.title}`,
    `Section ID: ${section.id}`,
    `Section title: ${section.title}`,
    `Document slice: ${localSliceIndex}`,
  ].join("\n");
}

function buildDocumentSlices(documents, maxChars = config.FULL_DOCUMENT_SLICE_CHAR_BUDGET || 7500) {
  const slices = [];

  for (const document of documents) {
    const sections = getDocumentSections(document.markdown);
    const documentSections = sections.length
      ? sections
      : [{ id: "S1", title: document.title || "Document", text: document.markdown }];
    let localSliceIndex = 1;

    for (const section of documentSections) {
      const provisionalHeader = buildSliceHeader({ document, section, localSliceIndex });
      const contentBudget = Math.max(1000, maxChars - provisionalHeader.length - 64);
      const contentSlices = splitContentIntoSlices(section.text, contentBudget);

      for (const contentSlice of contentSlices) {
        const header = buildSliceHeader({ document, section, localSliceIndex });
        slices.push({
          document,
          section,
          text: `${header}\n\n${contentSlice}`,
        });
        localSliceIndex += 1;
      }
    }
  }

  return slices;
}

function packSummariesIntoBatches(summaries, maxChars) {
  const batches = [];
  let current = "";

  for (const summary of summaries) {
    const candidate = current ? `${current}\n\n${summary}` : summary;
    if (candidate.length > maxChars && current) {
      batches.push(current);
      current = summary;
    } else {
      current = candidate;
    }
  }

  if (current) {
    batches.push(current);
  }

  return batches;
}

function totalSummaryLength(summaries) {
  return summaries.reduce((sum, summary) => sum + String(summary || "").length, 0);
}

function buildSliceScoringTerms(question, schemaPreset) {
  const terms = new Set(
    normalizeForScoring(question)
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 3)
  );

  for (const value of [
    ...(schemaPreset?.keywords || []),
    ...(schemaPreset?.fields || []),
    ...(schemaPreset?.focus || []),
  ]) {
    normalizeForScoring(value)
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 3)
      .forEach((term) => terms.add(term));
  }

  return [...terms];
}

function scoreSliceForQuestion(slice, terms) {
  const sectionTitle = normalizeForScoring(slice.section?.title || "");
  const text = normalizeForScoring(`${slice.section?.title || ""}\n${slice.text || ""}`);
  if (!text || !terms.length) {
    return 0;
  }

  return terms.reduce((score, term) => {
    if (!text.includes(term)) {
      return score;
    }
    return score + (sectionTitle.includes(term) ? 3 : 1);
  }, 0);
}

function isBroadFullDocumentQuestion(question) {
  const normalized = normalizeForScoring(question);
  return [
    "tom tat",
    "tong quan",
    "tinh hinh",
    "ca nam",
    "1 nam",
    "mot nam",
    "summary",
    "overview",
    "compare",
    "comparison",
    "so sanh",
  ].some((marker) => normalized.includes(marker));
}

function addEvenlySpacedSlices(selected, scoredSlices, targetCount) {
  if (!scoredSlices.length || targetCount <= 0) {
    return;
  }

  if (targetCount === 1) {
    selected.set(scoredSlices[0].index, scoredSlices[0]);
    return;
  }

  for (let position = 0; position < targetCount; position += 1) {
    const index = Math.round((position * (scoredSlices.length - 1)) / (targetCount - 1));
    selected.set(scoredSlices[index].index, scoredSlices[index]);
  }
}

function selectRelevantDocumentSlices({ slices, question, schemaPreset, maxSlices }) {
  if (!Number.isFinite(maxSlices) || maxSlices <= 0 || slices.length <= maxSlices) {
    return slices;
  }

  const terms = buildSliceScoringTerms(question, schemaPreset);
  const scoredSlices = slices.map((slice, index) => ({
    slice,
    index,
    score: scoreSliceForQuestion(slice, terms),
  }));
  const selected = new Map();
  selected.set(0, scoredSlices[0]);

  if (isBroadFullDocumentQuestion(question)) {
    addEvenlySpacedSlices(selected, scoredSlices, Math.ceil(maxSlices / 2));
  }

  for (const item of [...scoredSlices].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (selected.size >= maxSlices) {
      break;
    }
    selected.set(item.index, item);
  }

  return [...selected.values()]
    .sort((a, b) => a.index - b.index)
    .map((item) => item.slice);
}

function buildFallbackFollowUpQuestions(schemaPreset) {
  if (schemaPreset?.id === "financial") {
    return [
      "Bạn muốn tách riêng doanh thu, lợi nhuận và dòng tiền theo từng báo cáo không?",
      "Bạn muốn xem các nguyên nhân chính làm kết quả tăng hoặc giảm không?",
    ];
  }

  if (schemaPreset?.id === "operational") {
    return [
      "Bạn muốn so sánh riêng các KPI vận hành theo từng kỳ không?",
      "Bạn muốn xem các điểm nghẽn vận hành quan trọng nhất không?",
    ];
  }

  if (schemaPreset?.id === "risk") {
    return [
      "Bạn muốn nhóm các rủi ro theo mức độ ảnh hưởng không?",
      "Bạn muốn xem rủi ro nào lặp lại qua nhiều báo cáo không?",
    ];
  }

  return [
    "Bạn muốn đào sâu phần chỉ số, rủi ro hay xu hướng theo từng báo cáo?",
    "Bạn muốn so sánh các điểm khác biệt chính giữa các tài liệu không?",
  ];
}

function buildFallbackStructuredAnswer({ answer, documents, schemaPreset }) {
  return {
    answer,
    citations: documents.map((document) => document.id),
    follow_up_questions: buildFallbackFollowUpQuestions(schemaPreset),
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const limit = Math.max(1, Number(concurrency) || 1);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function summarizeLongDocumentWithSlices({ document, question, apiKey, provider, model, modelConcurrency, schemaPreset, schemaInstruction }) {
  const allSlices = buildDocumentSlices([document]);
  const slices = selectRelevantDocumentSlices({
    slices: allSlices,
    question,
    schemaPreset,
    maxSlices: config.FULL_DOCUMENT_MAX_SLICES_PER_DOC || 10,
  });
  const sliceSummaries = await mapWithConcurrency(slices, modelConcurrency, async (slice, index) => {
    return generateGeminiAnswer({
      apiKey,
      provider,
      model,
      maxOutputTokens: 500,
      systemInstruction: buildDocumentSliceSystemInstruction(),
      prompt: buildDocumentSlicePrompt({
        question,
        documents: [document],
        sliceText: slice.text,
        sliceIndex: index + 1,
        totalSlices: slices.length,
        schemaInstruction,
      }),
    });
  });

  const summary = await generateGeminiAnswer({
    apiKey,
    provider,
    model,
    maxOutputTokens: 700,
    systemInstruction: buildDocumentReduceSystemInstruction(),
    prompt: buildDocumentSummaryPrompt({
      question,
      document,
      sliceSummaries,
      schemaInstruction,
    }),
  });

  return {
    summary,
    sliceCount: slices.length,
    totalSliceCount: allSlices.length,
  };
}

async function summarizeDocumentForFullDocumentMode({
  document,
  question,
  apiKey,
  provider,
  model,
  directCharBudget,
  modelConcurrency,
  schemaPreset,
  schemaInstruction,
}) {
  if (document.markdown.length <= directCharBudget) {
    const summary = await generateGeminiAnswer({
      apiKey,
      provider,
      model,
      maxOutputTokens: 900,
      systemInstruction: buildDocumentReduceSystemInstruction(),
      prompt: buildWholeDocumentSummaryPrompt({
        question,
        document,
        schemaInstruction,
      }),
    });

    return {
      summary,
      sliceCount: 1,
      totalSliceCount: 1,
    };
  }

  return summarizeLongDocumentWithSlices({
    document,
    question,
    apiKey,
    provider,
    model,
    modelConcurrency,
    schemaPreset,
    schemaInstruction,
  });
}

async function retrieveRelevantChunks({ question, tenantId, apiKey, retrievalMode, topK = 5 }) {
  if (retrievalMode === "semantic") {
    return semanticSearch(question, tenantId, apiKey, topK);
  }

  if (retrievalMode === "bm25") {
    return bm25Search(question, tenantId, topK);
  }

  return hybridSearch(question, tenantId, apiKey, topK);
}

function serializeChunk(chunk) {
  return {
    id: chunk.id,
    title: chunk.title,
    filename: chunk.filename,
    content: chunk.content,
    childContent: chunk.childContent || "",
    score: chunk.score,
    retrieval: chunk.retrieval || null,
  };
}

async function answerWithFullDocument({ question, history, apiKey: legacyApiKey, apiKeys = {}, model, documentId, documentIds = [] }) {
  const provider = getProviderForModel(model);
  const apiKey = getApiKeyForProvider({ provider, apiKeys, legacyApiKey });
  if (!apiKey) {
    throw new Error(`Missing ${provider} API key. Add it to the environment or paste a key into the app.`);
  }

  const selectedDocumentIds = normalizeDocumentSelection(documentIds, documentId);
  if (!selectedDocumentIds.length) {
    throw new Error("At least one document must be selected for full-document mode.");
  }

  const docs = await loadAllDocumentsWithMarkdown();
  const selectedDocuments = selectedDocumentIds
    .map((id) => docs.find((doc) => doc.id === id))
    .filter(Boolean);

  if (selectedDocuments.length !== selectedDocumentIds.length) {
    throw new Error("One or more selected documents were not found.");
  }

  const maxSelectedDocs = config.FULL_DOCUMENT_MAX_SELECTED_DOCS || 5;
  if (selectedDocuments.length > maxSelectedDocs) {
    throw new Error(`Please select at most ${maxSelectedDocs} documents at a time for full-document mode.`);
  }

  const directCharBudget = config.FULL_DOCUMENT_DIRECT_CHAR_BUDGET || 18000;
  const multiDirectCharBudget = config.FULL_DOCUMENT_MULTI_DIRECT_CHAR_BUDGET || directCharBudget;
  const synthesisCharBudget = config.FULL_DOCUMENT_SYNTHESIS_CHAR_BUDGET || 22000;
  const modelConcurrency = config.FULL_DOCUMENT_MODEL_CONCURRENCY || 3;
  const schemaPreset = selectFullDocumentSchemaPreset(question);
  const schemaInstruction = buildSchemaPresetInstruction(schemaPreset);
  const combinedMarkdownLength = selectedDocuments.reduce((sum, doc) => sum + doc.markdown.length, 0);
  let answer;
  let structured = null;
  let rawModelText = "";
  let sliceCount = 1;
  let totalSliceCount = 1;
  let processingMode = "direct";
  let compressionPasses = 0;
  const canUseDirectFullDocuments = selectedDocuments.length === 1
    ? combinedMarkdownLength <= directCharBudget
    : combinedMarkdownLength <= multiDirectCharBudget;

  if (canUseDirectFullDocuments) {
    const response = await generateStructuredGeminiAnswer({
      apiKey,
      provider,
      model,
      maxOutputTokens: 700,
      systemInstruction: buildFullDocumentSystemInstruction(),
      prompt: buildDirectFullDocumentPrompt({
        question,
        history,
        documents: selectedDocuments,
        schemaInstruction,
      }),
      useResponseSchema: false,
    });
    answer = response.answer;
    structured = response.structured || buildFallbackStructuredAnswer({ answer, documents: selectedDocuments, schemaPreset });
    rawModelText = response.rawText || "";
  } else {
    processingMode = "staged";
    const documentResults = await mapWithConcurrency(selectedDocuments, modelConcurrency, async (document) => {
      const sliceConcurrency = selectedDocuments.length > 1 ? 1 : modelConcurrency;
      return summarizeDocumentForFullDocumentMode({
        document,
        question,
        apiKey,
        provider,
        model,
        directCharBudget,
        modelConcurrency: sliceConcurrency,
        schemaPreset,
        schemaInstruction,
      });
    });
    sliceCount = documentResults.reduce((sum, result) => sum + result.sliceCount, 0);
    totalSliceCount = documentResults.reduce((sum, result) => sum + (result.totalSliceCount || result.sliceCount), 0);
    let documentSummaries = documentResults.map((result) => result.summary);

    while (totalSummaryLength(documentSummaries) > synthesisCharBudget && compressionPasses < 4) {
      const batches = packSummariesIntoBatches(documentSummaries, synthesisCharBudget);
      const compressed = await mapWithConcurrency(batches, modelConcurrency, async (batch, index) => {
        return generateGeminiAnswer({
          apiKey,
          provider,
          model,
          maxOutputTokens: 700,
          systemInstruction: buildDocumentReduceSystemInstruction(),
          prompt: buildCompressedSummariesPrompt({
            question,
            documents: selectedDocuments,
            summaries: [batch],
            batchIndex: index + 1,
            totalBatches: batches.length,
            schemaInstruction,
          }),
        });
      });

      compressionPasses += 1;
      if (totalSummaryLength(compressed) >= totalSummaryLength(documentSummaries)) {
        documentSummaries = compressed;
        break;
      }
      documentSummaries = compressed;
    }

    const response = await generateStructuredGeminiAnswer({
      apiKey,
      provider,
      model,
      maxOutputTokens: 900,
      systemInstruction: buildFullDocumentSystemInstruction(),
      prompt: buildFullDocumentSynthesisPrompt({
        question,
        history,
        documents: selectedDocuments,
        documentSummaries,
        schemaInstruction,
      }),
      useResponseSchema: false,
    });
    answer = response.answer;
    structured = response.structured || buildFallbackStructuredAnswer({ answer, documents: selectedDocuments, schemaPreset });
    rawModelText = response.rawText || "";
  }

  return {
    answer,
    structured,
    rawModelText,
    chunks: selectedDocuments.map(buildFullDocumentSource),
    retrievalMode: "full-document",
    chatMode: "full-document",
    document: selectedDocuments.length === 1 ? {
      id: selectedDocuments[0].id,
      title: selectedDocuments[0].title,
      filename: selectedDocuments[0].filename,
    } : null,
    documents: selectedDocuments.map((document) => ({
      id: document.id,
      title: document.title,
      filename: document.filename,
    })),
    sliceCount,
    totalSliceCount,
    processingMode,
    documentCount: selectedDocuments.length,
    compressionPasses,
    schemaPreset: schemaPreset.id,
  };
}

async function answerWithWebPages({ question, history, apiKey: legacyApiKey, apiKeys = {}, model, session, webPageId = "", webPageIds = [], webPageReadMode = "auto" }) {
  const provider = getProviderForModel(model);
  const apiKey = getApiKeyForProvider({ provider, apiKeys, legacyApiKey });
  if (!apiKey) {
    throw new Error(`Missing ${provider} API key. Add it to the environment or paste a key into the app.`);
  }

  const pages = await loadSessionWebPagesWithMarkdown(session, webPageIds, webPageId);
  if (!pages.length) {
    throw new Error("Select one or more session web pages first.");
  }

  const documents = pages.map(buildWebPageDocument);
  const combinedMarkdownLength = documents.reduce((sum, doc) => sum + doc.markdown.length, 0);
  const directCharBudget = config.FULL_DOCUMENT_DIRECT_CHAR_BUDGET || 18000;
  const multiDirectCharBudget = config.FULL_DOCUMENT_MULTI_DIRECT_CHAR_BUDGET || directCharBudget;
  const schemaPreset = selectFullDocumentSchemaPreset(question);
  const schemaInstruction = buildSchemaPresetInstruction(schemaPreset);
  const readMode = normalizeWebPageReadMode(webPageReadMode);
  const shouldFullScan = readMode === "full-scan" || (readMode === "auto" && isThoroughWebPageQuestion(question));
  const canUseDirect = documents.length === 1
    ? combinedMarkdownLength <= directCharBudget
    : combinedMarkdownLength <= multiDirectCharBudget;
  let answer;
  let structured = null;
  let rawModelText = "";
  let processingMode = "direct";
  let sliceCount = 1;
  let totalSliceCount = 1;

  if (canUseDirect && readMode !== "full-scan") {
    const response = await generateStructuredGeminiAnswer({
      apiKey,
      provider,
      model,
      maxOutputTokens: 900,
      systemInstruction: buildFullDocumentSystemInstruction(),
      prompt: buildDirectFullDocumentPrompt({
        question,
        history,
        documents,
        schemaInstruction,
      }),
      useResponseSchema: false,
    });
    answer = response.answer;
    structured = response.structured || buildFallbackStructuredAnswer({ answer, documents, schemaPreset });
    rawModelText = response.rawText || "";
  } else if (shouldFullScan) {
    const result = await answerWithFullScanWebPages({
      question,
      history,
      apiKey,
      provider,
      model,
      pages,
      documents,
      schemaPreset,
      schemaInstruction,
    });
    answer = result.answer;
    structured = result.structured;
    rawModelText = result.rawModelText;
    sliceCount = result.sliceCount;
    totalSliceCount = result.totalSliceCount;
    processingMode = result.processingMode;
  } else {
    processingMode = "semantic-excerpts";
    const allExcerptCount = pages.reduce((sum, page) => sum + splitIntoChunks(page.markdown).length, 0);
    let excerpts = [];
    try {
      excerpts = await selectSemanticWebPageExcerpts({ pages, question, schemaPreset, apiKey });
    } catch (err) {
      console.warn(`[web-pages] Semantic excerpt selection failed (${err.message}). Falling back to keyword matching.`);
    }
    if (!excerpts.length) {
      processingMode = "focused-excerpts";
      excerpts = selectFocusedWebPageExcerpts({ pages, question, schemaPreset });
    }
    if (!excerpts.length) {
      throw new Error("Could not extract readable excerpts from the selected web pages.");
    }
    sliceCount = excerpts.length;
    totalSliceCount = allExcerptCount;

    const response = await generateStructuredGeminiAnswer({
      apiKey,
      provider,
      model,
      maxOutputTokens: 900,
      systemInstruction: buildFullDocumentSystemInstruction(),
      prompt: buildFocusedWebPagesPrompt({
        question,
        history,
        documents,
        excerpts,
        schemaInstruction,
      }),
      useResponseSchema: false,
    });
    answer = response.answer;
    structured = response.structured || {
      ...buildFallbackStructuredAnswer({ answer, documents, schemaPreset }),
      citations: excerpts.map((excerpt) => excerpt.sourceId),
    };
    rawModelText = response.rawText || "";
  }

  return {
    answer,
    structured,
    rawModelText,
    chunks: pages.map(buildWebPageSource),
    retrievalMode: "web-pages",
    chatMode: "web-pages",
    documents: pages.map((page) => ({
      id: page.id,
      title: page.title,
      filename: page.url,
    })),
    sliceCount,
    totalSliceCount,
    processingMode,
    documentCount: pages.length,
    compressionPasses: 0,
    schemaPreset: schemaPreset.id,
  };
}

async function llmRerankChunks({ question, chunks, topK, apiKey, provider, model }) {
  if (!chunks.length || chunks.length <= topK) return { chunks, none: false };

  const lines = chunks.map((c, j) => {
    const title = c.title || c.filename || "";
    const text = (c.content || "").slice(0, 350).replace(/\n/g, " ");
    return `[${j + 1}] (${title}) ${text}`;
  });

  const prompt = [
    `Question: ${question}`,
    "",
    `=== CHUNKS ===`,
    lines.join("\n"),
    "",
    `Return the ${topK} most relevant chunk numbers, comma-separated.`,
    "If no chunk is relevant, return: NONE",
  ].join("\n");

  try {
    const text = await generateGeminiAnswer({
      apiKey,
      provider,
      model,
      maxOutputTokens: 80,
      systemInstruction: buildRerankSystemInstruction(),
      prompt,
    });

    if (/^\s*none\s*$/i.test(text.trim())) {
      return { chunks: chunks.slice(0, topK), none: true };
    }

    const numbers = (text.match(/\d+/g) || [])
      .map(Number)
      .filter((n) => n >= 1 && n <= chunks.length);
    const ranked = [...new Set(numbers)].slice(0, topK).map((n) => chunks[n - 1]).filter(Boolean);
    return { chunks: ranked.length ? ranked : chunks.slice(0, topK), none: false };
  } catch (err) {
    console.warn(`[re-rank] Failed (${err.message}), falling back to top-${topK}.`);
    return { chunks: chunks.slice(0, topK), none: false };
  }
}

async function callGemini({ question, history, apiKey: legacyApiKey, apiKeys = {}, model, tenantId = "default", retrievalMode = "hybrid", session = null }) {
  const provider = getProviderForModel(model);
  const apiKey = getApiKeyForProvider({ provider, apiKeys, legacyApiKey });
  const embeddingApiKey = getApiKeyForProvider({ provider: "google", apiKeys, legacyApiKey });
  if (!apiKey) {
    throw new Error(`Missing ${provider} API key. Add it to the environment or paste a key into the app.`);
  }

  const wikiContext = await loadWikiContext(tenantId);
  const selectedRetrievalMode = normalizeRetrievalMode(retrievalMode);
  const searchRetrievalMode = retrievalUsesEmbedding(selectedRetrievalMode) && !embeddingApiKey
    ? "bm25"
    : selectedRetrievalMode;

  let initialChunks = [];
  try {
    initialChunks = await retrieveRelevantChunks({
      question,
      tenantId,
      apiKey: embeddingApiKey,
      retrievalMode: searchRetrievalMode,
      topK: config.RERANK_FETCH_COUNT || 50,
    });
  } catch (err) {
    console.error(`${searchRetrievalMode} search failed, falling back to full context:`, err.message);
  }

  let ragChunks = initialChunks;
  try {
    const fetcher = async (skip) => retrieveRelevantChunks({
      question, tenantId, apiKey: embeddingApiKey, retrievalMode: searchRetrievalMode,
      topK: (config.RERANK_FETCH_COUNT || 50) * 2,
    }).then((all) => all.slice(skip));

    const result = await llmRerankChunks({
      question,
      chunks: initialChunks,
      topK: config.RERANK_TOP_K || 10,
      apiKey,
      provider,
      model,
    });

    if (result.none && initialChunks.length < ((config.RERANK_FETCH_COUNT || 50) * 2)) {
      const moreChunks = await fetcher(initialChunks.length);
      if (moreChunks.length) {
        const combined = [...initialChunks, ...moreChunks];
        const retry = await llmRerankChunks({
          question, chunks: combined, topK: config.RERANK_TOP_K || 10, apiKey, provider, model,
        });
        ragChunks = retry.chunks;
      } else {
        ragChunks = result.chunks;
      }
    } else {
      ragChunks = result.chunks;
    }
  } catch (err) {
    console.warn(`[re-rank] Skipped: ${err.message}`);
  }

  let ragContext = "";
  if (ragChunks.length > 0) {
    ragContext = ragChunks
      .map((chunk) => `[${chunk.id}] (${chunk.title || chunk.filename})\n${chunk.content}`)
      .join("\n\n---\n\n");
  } else {
    const uploadedDocs = await loadAllDocumentsWithMarkdown();
    ragContext = uploadedDocs.map((doc) => `### ${doc.title}\n${doc.markdown}`).join("\n\n");
  }

  ragContext = truncateToTokenBudget(ragContext, config.RAG_TOKEN_BUDGET);

  const fullContext = [wikiContext, ragContext].filter(Boolean).join("\n\n");
  if (!fullContext.trim()) {
    throw new Error("No documents are available yet. Please upload a file or add .md files to wiki/default/");
  }

  const response = await generateStructuredGeminiAnswer({
    apiKey,
    provider,
    model,
    maxOutputTokens: 700,
    systemInstruction: buildGeminiSystemInstruction(),
    prompt: buildGeminiUserPrompt({ question, contextText: fullContext, history }),
  });

  return {
    answer: response.answer,
    structured: response.structured,
    rawModelText: response.rawText || "",
    chunks: ragChunks,
    retrievalMode: searchRetrievalMode,
  };
}

module.exports = {
  normalizeRetrievalMode,
  retrievalUsesEmbedding,
  normalizeChatMode,
  retrieveRelevantChunks,
  serializeChunk,
  llmRerankChunks,
  answerWithFullDocument,
  answerWithWebPages,
  callGemini,
};
