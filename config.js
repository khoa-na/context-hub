const path = require("path");

module.exports = {
  WIKI_TOKEN_BUDGET: 30000,
  RAG_TOKEN_BUDGET: 10000,
  FULL_DOCUMENT_DIRECT_CHAR_BUDGET: 50000,
  FULL_DOCUMENT_MULTI_DIRECT_CHAR_BUDGET: 80000,
  FULL_DOCUMENT_SLICE_CHAR_BUDGET: 7500,
  FULL_DOCUMENT_SYNTHESIS_CHAR_BUDGET: 22000,
  FULL_DOCUMENT_MAX_SELECTED_DOCS: 5,
  FULL_DOCUMENT_MODEL_CONCURRENCY: 2,
  FULL_DOCUMENT_MAX_SLICES_PER_DOC: 10,
  RERANK_FETCH_COUNT: 50,
  RERANK_TOP_K: 10,
  RERANK_MAX_BATCHES: 4,
  WIKI_DIR: path.join(__dirname, "wiki"),
  LANCEDB_DIR: path.join(__dirname, "data", "lancedb"),
  GEMINI_EMBEDDING_MODEL: "gemini-embedding-001",
  EMBEDDING_DIMENSION: 768,
  EMBEDDING_BATCH_SIZE: 10,
  EMBEDDING_BATCH_DELAY_MS: 2000,
  PROVIDERS: [
    { id: "google", name: "Gemini", apiKeyEnv: "GEMINI_API_KEY" },
    { id: "dashscope", name: "DashScope", apiKeyEnv: "DASHSCOPE_API_KEY" },
  ],
  MODELS: [
    { id: "gemma-4-31b-it", name: "Gemma 4 31B IT", provider: "google" },
    { id: "gemma-4-26b-a4b-it", name: "Gemma 4 26B A4B IT", provider: "google" },
    { id: "qwen3.6-35b-a3b", name: "Qwen3.6 35B A3B", provider: "dashscope" },
    { id: "qwen3.6-27b", name: "Qwen3.6 27B", provider: "dashscope" },
  ],
  DEFAULT_MODEL: "gemma-4-26b-a4b-it",
};
