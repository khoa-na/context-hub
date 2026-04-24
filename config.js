const path = require("path");

module.exports = {
  WIKI_TOKEN_BUDGET: 30000,
  RAG_TOKEN_BUDGET: 10000,
  WIKI_DIR: path.join(__dirname, "wiki"),
  LANCEDB_DIR: path.join(__dirname, "data", "lancedb"),
  GEMINI_EMBEDDING_MODEL: "gemini-embedding-001",
  EMBEDDING_DIMENSION: 768,
  EMBEDDING_BATCH_SIZE: 10,
  EMBEDDING_BATCH_DELAY_MS: 2000,
  MODELS: [
    { id: "gemma-4-31b-it", name: "Gemma 4 31B IT", provider: "google" },
    { id: "gemma-4-26b-a4b-it", name: "Gemma 4 26B A4B IT", provider: "google" },
  ],
  DEFAULT_MODEL: "gemma-4-31b-it",
};
