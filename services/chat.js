const config = require("../config");
const { semanticSearch, bm25Search, hybridSearch } = require("../db");
const { loadWikiContext, loadAllDocumentsWithMarkdown } = require("../lib/storage");
const { truncateToTokenBudget } = require("../lib/text");
const { getDocumentSections, splitContentIntoSlices } = require("../lib/chunking");
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
  return value === "full-document" ? "full-document" : "qa";
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

async function summarizeLongDocumentWithSlices({ document, question, apiKey, model, modelConcurrency, schemaPreset, schemaInstruction }) {
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
  model,
  directCharBudget,
  modelConcurrency,
  schemaPreset,
  schemaInstruction,
}) {
  if (document.markdown.length <= directCharBudget) {
    const summary = await generateGeminiAnswer({
      apiKey,
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

async function answerWithFullDocument({ question, history, apiKey: requestApiKey, model, documentId, documentIds = [] }) {
  const apiKey = requestApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing Gemini API key. Add GEMINI_API_KEY to the environment or paste a key into the app.");
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
      model,
      maxOutputTokens: 900,
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

async function callGemini({ question, history, apiKey: requestApiKey, model, tenantId = "default", retrievalMode = "hybrid" }) {
  const apiKey = requestApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing Gemini API key. Add GEMINI_API_KEY to the environment or paste a key into the app.");
  }

  const wikiContext = await loadWikiContext(tenantId);
  const selectedRetrievalMode = normalizeRetrievalMode(retrievalMode);

  let ragChunks = [];
  try {
    ragChunks = await retrieveRelevantChunks({
      question,
      tenantId,
      apiKey,
      retrievalMode: selectedRetrievalMode,
      topK: 5,
    });
  } catch (err) {
    console.error(`${selectedRetrievalMode} search failed, falling back to full context:`, err.message);
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
    retrievalMode: selectedRetrievalMode,
  };
}

module.exports = {
  normalizeRetrievalMode,
  retrievalUsesEmbedding,
  normalizeChatMode,
  retrieveRelevantChunks,
  serializeChunk,
  answerWithFullDocument,
  callGemini,
};
