const path = require("path");

module.exports = {
  WIKI_TOKEN_BUDGET: 30000,
  RAG_TOKEN_BUDGET: 10000,
  RERANK_CANDIDATES: 12,
  WIKI_DIR: path.join(__dirname, "wiki"),
  LANCEDB_DIR: path.join(__dirname, "data", "lancedb"),
  GEMINI_EMBEDDING_MODEL: "gemini-embedding-001",
  EMBEDDING_DIMENSION: 768,
  EMBEDDING_BATCH_SIZE: 10,
  EMBEDDING_BATCH_DELAY_MS: 2000,

  MODELS: [
    { id: "gemma-4-27b-it", name: "Gemma 4 27B", provider: "google" },
    { id: "gemma-3-27b-it", name: "Gemma 3 27B", provider: "google" },
    { id: "gemma-3-12b-it", name: "Gemma 3 12B", provider: "google" },
    { id: "gemma-4-1b-it", name: "Gemma 4 1B", provider: "google" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", provider: "google" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google" },
  ],

  DEFAULT_MODEL: "gemma-4-27b-it",

  TASKS: [
    { id: "qa", name: "Q&A", description: "Answer questions based on documents" },
    { id: "summarize", name: "Summarize", description: "Generate concise summaries" },
    { id: "extract", name: "Extract", description: "Extract key entities and facts" },
    { id: "compare", name: "Compare", description: "Compare and contrast topics" },
    { id: "evaluate", name: "Evaluate", description: "Evaluate and score responses" },
  ],

  STRUCTURED_OUTPUT_SCHEMA: {
    type: "object",
    properties: {
      answer: {
        type: "string",
        description: "The main answer or response",
      },
      confidence: {
        type: "number",
        description: "Confidence score from 1 to 5",
        minimum: 1,
        maximum: 5,
      },
      key_points: {
        type: "array",
        items: { type: "string" },
        description: "Key points or takeaways",
      },
      word_count: {
        type: "number",
        description: "Approximate word count of the answer",
      },
      sources_used: {
        type: "array",
        items: { type: "string" },
        description: "Document sources referenced",
      },
    },
    required: ["answer", "confidence", "key_points"],
  },
};
