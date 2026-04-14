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
};
