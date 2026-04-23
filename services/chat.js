const config = require("../config");
const { semanticSearch, bm25Search, hybridSearch } = require("../db");
const { rerankWithJina } = require("../rerank");
const { loadWikiContext, loadAllDocumentsWithMarkdown } = require("../lib/storage");
const { truncateToTokenBudget } = require("../lib/text");
const { getDocumentSections } = require("../lib/chunking");
const {
  buildGeminiSystemInstruction,
  buildFullDocumentSystemInstruction,
  buildDocumentSliceSystemInstruction,
  buildGeminiUserPrompt,
  buildDirectFullDocumentPrompt,
  buildDocumentSlicePrompt,
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

function buildDocumentSliceBlocks(documents) {
  const blocks = [];

  for (const document of documents) {
    const sections = getDocumentSections(document.markdown);
    if (!sections.length) {
      blocks.push(`## ${document.title} (${document.filename})\n${document.markdown}`);
      continue;
    }

    for (const section of sections) {
      blocks.push(
        [
          `## ${document.title} (${document.filename})`,
          `Document ID: ${document.id}`,
          section.text,
        ].join("\n")
      );
    }
  }

  return blocks;
}

function packDocumentBlocksIntoSlices(blocks, maxChars = 12000) {
  const slices = [];
  let current = "";

  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > maxChars && current) {
      slices.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }

  if (current) {
    slices.push(current);
  }

  return slices;
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

async function maybeRerankChunks({ question, chunks, rerank }) {
  if (!rerank || !chunks.length) {
    return {
      chunks,
      rerankApplied: false,
      rerankProvider: null,
    };
  }

  const provider = String(rerank.provider || "").trim().toLowerCase();
  if (provider !== "jina") {
    throw new Error(`Unsupported rerank provider: ${provider}`);
  }

  const reranked = await rerankWithJina({
    query: question,
    chunks,
    apiKey: rerank.apiKey,
    topK: rerank.topK,
  });

  return {
    chunks: reranked,
    rerankApplied: true,
    rerankProvider: provider,
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

  if (selectedDocuments.length > 5) {
    throw new Error("Please select at most 5 documents at a time for full-document mode.");
  }

  const fullDocCharBudget = config.RAG_TOKEN_BUDGET * 4;
  const combinedMarkdownLength = selectedDocuments.reduce((sum, doc) => sum + doc.markdown.length, 0);
  let answer;
  let structured = null;
  let sliceCount = 1;

  if (combinedMarkdownLength <= fullDocCharBudget) {
    const response = await generateStructuredGeminiAnswer({
      apiKey,
      model,
      maxOutputTokens: 900,
      systemInstruction: buildFullDocumentSystemInstruction(),
      prompt: buildDirectFullDocumentPrompt({ question, history, documents: selectedDocuments }),
    });
    answer = response.answer;
    structured = response.structured;
  } else {
    const blocks = buildDocumentSliceBlocks(selectedDocuments);
    const slices = packDocumentBlocksIntoSlices(blocks);
    sliceCount = slices.length;
    const sliceSummaries = [];

    for (let i = 0; i < slices.length; i += 1) {
      const sliceSummary = await generateGeminiAnswer({
        apiKey,
        model,
        maxOutputTokens: 500,
        systemInstruction: buildDocumentSliceSystemInstruction(),
        prompt: buildDocumentSlicePrompt({
          question,
          documents: selectedDocuments,
          sliceText: slices[i],
          sliceIndex: i + 1,
          totalSlices: slices.length,
        }),
      });
      sliceSummaries.push(sliceSummary);
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
        sliceSummaries,
      }),
    });
    answer = response.answer;
    structured = response.structured;
  }

  return {
    answer,
    structured,
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
  maybeRerankChunks,
  answerWithFullDocument,
  callGemini,
};
