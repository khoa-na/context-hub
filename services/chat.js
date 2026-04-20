const config = require("../config");
const { semanticSearch, bm25Search, hybridSearch } = require("../db");
const { rerankWithJina } = require("../rerank");
const { loadWikiContext, loadAllDocumentsWithMarkdown } = require("../lib/storage");
const { truncateToTokenBudget } = require("../lib/text");
const { getDocumentSections, packSectionsIntoSlices } = require("../lib/chunking");
const {
  buildGeminiSystemInstruction,
  buildFullDocumentSystemInstruction,
  buildDocumentSliceSystemInstruction,
  buildGeminiUserPrompt,
  buildDirectFullDocumentPrompt,
  buildDocumentSlicePrompt,
  buildFullDocumentSynthesisPrompt,
  generateGeminiAnswer,
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

async function answerWithFullDocument({ question, history, apiKey: requestApiKey, documentId }) {
  const apiKey = requestApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing Gemini API key. Add GEMINI_API_KEY to the environment or paste a key into the app.");
  }

  if (!documentId) {
    throw new Error("documentId is required for full-document mode.");
  }

  const docs = await loadAllDocumentsWithMarkdown();
  const document = docs.find((doc) => doc.id === documentId);
  if (!document) {
    throw new Error("Selected document was not found.");
  }

  const fullDocCharBudget = config.RAG_TOKEN_BUDGET * 4;
  let answer;
  let sliceCount = 1;

  if (document.markdown.length <= fullDocCharBudget) {
    answer = await generateGeminiAnswer({
      apiKey,
      maxOutputTokens: 900,
      systemInstruction: buildFullDocumentSystemInstruction(),
      prompt: buildDirectFullDocumentPrompt({ question, history, document }),
    });
  } else {
    const sections = getDocumentSections(document.markdown);
    const slices = packSectionsIntoSlices(sections);
    sliceCount = slices.length;
    const sliceSummaries = [];

    for (let i = 0; i < slices.length; i += 1) {
      const sliceSummary = await generateGeminiAnswer({
        apiKey,
        maxOutputTokens: 500,
        systemInstruction: buildDocumentSliceSystemInstruction(),
        prompt: buildDocumentSlicePrompt({
          question,
          document,
          sliceText: slices[i],
          sliceIndex: i + 1,
          totalSlices: slices.length,
        }),
      });
      sliceSummaries.push(sliceSummary);
    }

    answer = await generateGeminiAnswer({
      apiKey,
      maxOutputTokens: 900,
      systemInstruction: buildFullDocumentSystemInstruction(),
      prompt: buildFullDocumentSynthesisPrompt({
        question,
        history,
        document,
        sliceSummaries,
      }),
    });
  }

  return {
    answer,
    chunks: [buildFullDocumentSource(document)],
    retrievalMode: "full-document",
    chatMode: "full-document",
    document: {
      id: document.id,
      title: document.title,
      filename: document.filename,
    },
    sliceCount,
  };
}

async function callGemini({ question, history, apiKey: requestApiKey, tenantId = "default", retrievalMode = "hybrid" }) {
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

  const answer = await generateGeminiAnswer({
    apiKey,
    maxOutputTokens: 700,
    systemInstruction: buildGeminiSystemInstruction(),
    prompt: buildGeminiUserPrompt({ question, contextText: fullContext, history }),
  });

  return {
    answer,
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
