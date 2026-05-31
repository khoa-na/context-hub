// RAG retrieval evaluation harness.
//
// Indexes the sample financial reports into an isolated LanceDB instance, then
// runs the golden question set through each retrieval mode (bm25 / semantic /
// hybrid) and reports document-level retrieval metrics.
//
// Usage: npm run eval   (requires GEMINI_API_KEY for embeddings)

const path = require("path");
const fs = require("fs/promises");

require("dotenv").config();

// Point LanceDB at an isolated directory BEFORE config/db are required, so the
// evaluation never reads or writes the app's real index.
process.env.LANCEDB_DIR = process.env.EVAL_LANCEDB_DIR || path.join(__dirname, ".eval-lancedb");

const { ROOT } = require("../constants");
const { indexDocumentContent } = require("../services/indexing");
const { clearTable, createIndexes } = require("../db");
const { retrieveRelevantChunks } = require("../services/chat");
const {
  dedupePreserveOrder,
  recallAtK,
  reciprocalRank,
  ndcgAtK,
  mean,
} = require("./metrics");
const dataset = require("./dataset.json");

const MODES = ["bm25", "semantic", "hybrid"];
const TOP_K = 10;

function fmt(n) {
  return n.toFixed(3);
}

async function indexCorpus(apiKey) {
  await clearTable();

  let totalChunks = 0;
  for (const doc of dataset.corpus) {
    const markdown = await fs.readFile(path.join(ROOT, doc.file), "utf8");
    const { chunkCount } = await indexDocumentContent({
      id: doc.docId,
      filename: doc.file,
      title: doc.title,
      markdown,
      apiKey,
      skipTitles: true, // deterministic + free: skip LLM title rewriting
    });
    totalChunks += chunkCount;
    console.log(`  indexed ${doc.docId.padEnd(8)} (${chunkCount} chunks)`);
  }

  await createIndexes();
  return totalChunks;
}

async function evaluateMode(mode, apiKey) {
  const perQuestion = [];

  for (const q of dataset.questions) {
    const chunks = await retrieveRelevantChunks({
      question: q.question,
      tenantId: "default",
      apiKey,
      retrievalMode: mode,
      topK: TOP_K,
    });
    const ranked = dedupePreserveOrder(chunks.map((c) => c.docId));
    const relevant = q.relevant_doc_ids;

    perQuestion.push({
      id: q.id,
      topDocId: ranked[0] || null,
      hit1: recallAtK(ranked, relevant, 1) === 1,
      recall1: recallAtK(ranked, relevant, 1),
      recall3: recallAtK(ranked, relevant, 3),
      mrr: reciprocalRank(ranked, relevant),
      ndcg3: ndcgAtK(ranked, relevant, 3),
    });
  }

  return {
    mode,
    recall1: mean(perQuestion.map((r) => r.recall1)),
    recall3: mean(perQuestion.map((r) => r.recall3)),
    mrr: mean(perQuestion.map((r) => r.mrr)),
    ndcg3: mean(perQuestion.map((r) => r.ndcg3)),
    perQuestion,
  };
}

function buildMarkdownReport(results, meta) {
  const lines = [
    "# RAG Retrieval Evaluation",
    "",
    `_Generated: ${meta.generatedAt}_`,
    "",
    `Corpus: ${meta.corpusSize} documents (${meta.totalChunks} chunks) · Questions: ${meta.questionCount} · top-k: ${TOP_K}`,
    "",
    "Document-level retrieval quality per mode (higher is better):",
    "",
    "| Mode | Recall@1 | Recall@3 | MRR | nDCG@3 |",
    "|---|---:|---:|---:|---:|",
    ...results.map(
      (r) => `| ${r.mode} | ${fmt(r.recall1)} | ${fmt(r.recall3)} | ${fmt(r.mrr)} | ${fmt(r.ndcg3)} |`
    ),
    "",
    "- **Recall@1** — fraction of questions whose top-ranked document is the correct quarterly report.",
    "- **Recall@3** — the correct report appears within the top 3 distinct documents.",
    "- **MRR** — mean reciprocal rank of the correct report.",
    "- **nDCG@3** — rank-discounted gain over the top 3 distinct documents.",
    "",
    `> Corpus: the four Northstar quarterly reports. They share an identical structure and terminology and differ mainly in their numbers, so disambiguating the correct quarter is a genuine ranking challenge. Regenerate with \`npm run eval\`.`,
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    console.error("GEMINI_API_KEY is required (embeddings are needed to index the corpus and run semantic/hybrid retrieval).");
    process.exit(1);
  }

  console.log("Indexing evaluation corpus into an isolated LanceDB...");
  const totalChunks = await indexCorpus(apiKey);

  const results = [];
  for (const mode of MODES) {
    console.log(`Evaluating mode: ${mode} ...`);
    results.push(await evaluateMode(mode, apiKey));
  }

  // Console summary
  console.log("\nResults (document-level, top-k = " + TOP_K + "):\n");
  console.log("Mode      Recall@1  Recall@3  MRR     nDCG@3");
  for (const r of results) {
    console.log(
      `${r.mode.padEnd(9)} ${fmt(r.recall1).padEnd(9)} ${fmt(r.recall3).padEnd(9)} ${fmt(r.mrr).padEnd(7)} ${fmt(r.ndcg3)}`
    );
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    corpusSize: dataset.corpus.length,
    totalChunks,
    questionCount: dataset.questions.length,
  };
  const reportPath = path.join(__dirname, "results.md");
  await fs.writeFile(reportPath, buildMarkdownReport(results, meta), "utf8");
  console.log(`\nWrote ${path.relative(ROOT, reportPath)}`);

  await clearTable();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
