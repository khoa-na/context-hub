const config = require("../config");
const { semanticSearch, bm25Search, hybridSearch } = require("../db");
const { loadWikiContext, loadAllDocumentsWithMarkdown } = require("../lib/storage");
const { truncateToTokenBudget } = require("../lib/text");
const { getDocumentSections, splitContentIntoSlices } = require("../lib/chunking");
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

async function summarizeLongDocumentWithSlices({ document, question, apiKey, model, modelConcurrency }) {
  const slices = buildDocumentSlices([document]);
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
    }),
  });

  return {
    summary,
    sliceCount: slices.length,
  };
}

async function summarizeDocumentForFullDocumentMode({ document, question, apiKey, model, directCharBudget, modelConcurrency }) {
  if (document.markdown.length <= directCharBudget) {
    const summary = await generateGeminiAnswer({
      apiKey,
      model,
      maxOutputTokens: 900,
      systemInstruction: buildDocumentReduceSystemInstruction(),
      prompt: buildWholeDocumentSummaryPrompt({
        question,
        document,
      }),
    });

    return {
      summary,
      sliceCount: 1,
    };
  }

  return summarizeLongDocumentWithSlices({
    document,
    question,
    apiKey,
    model,
    modelConcurrency,
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
  const synthesisCharBudget = config.FULL_DOCUMENT_SYNTHESIS_CHAR_BUDGET || 22000;
  const modelConcurrency = config.FULL_DOCUMENT_MODEL_CONCURRENCY || 3;
  const combinedMarkdownLength = selectedDocuments.reduce((sum, doc) => sum + doc.markdown.length, 0);
  let answer;
  let structured = null;
  let rawModelText = "";
  let sliceCount = 1;
  let processingMode = "direct";
  let compressionPasses = 0;

  if (selectedDocuments.length === 1 && combinedMarkdownLength <= directCharBudget) {
    const response = await generateStructuredGeminiAnswer({
      apiKey,
      model,
      maxOutputTokens: 900,
      systemInstruction: buildFullDocumentSystemInstruction(),
      prompt: buildDirectFullDocumentPrompt({ question, history, documents: selectedDocuments }),
    });
    answer = response.answer;
    structured = response.structured;
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
      });
    });
    sliceCount = documentResults.reduce((sum, result) => sum + result.sliceCount, 0);
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
      }),
    });
    answer = response.answer;
    structured = response.structured;
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
    processingMode,
    documentCount: selectedDocuments.length,
    compressionPasses,
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
