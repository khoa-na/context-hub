const { indexDocumentChunks, createIndexes, getIndexedDocIds, clearTable } = require("../db");
const { splitIntoChunks } = require("../lib/chunking");
const { generateChunkTitles } = require("./gemini");
const { loadAllDocumentsWithMarkdown, readIndex, writeIndex } = require("../lib/storage");

async function indexDocumentContent({ id, filename, title, markdown, apiKey, tenantId = "default", skipTitles = false }) {
  const chunks = splitIntoChunks(markdown);

  if (apiKey && !skipTitles) {
    await generateChunkTitles(chunks, apiKey);
  }

  if (apiKey) {
    await indexDocumentChunks(chunks, filename, title, id, tenantId, apiKey);
  }

  return {
    chunks,
    chunkCount: chunks.length,
  };
}

async function rebuildAllIndexes({ apiKey, skipTitles = false, tenantId = "default" }) {
  try {
    await clearTable();
  } catch (err) {
    console.error("Failed to clear old index:", err.message);
  }

  const docs = await loadAllDocumentsWithMarkdown();
  let totalChunks = 0;
  const results = [];
  const index = await readIndex();

  for (const doc of docs) {
    try {
      const { chunkCount } = await indexDocumentContent({
        id: doc.id,
        filename: doc.filename,
        title: doc.title,
        markdown: doc.markdown,
        apiKey,
        tenantId,
        skipTitles,
      });

      totalChunks += chunkCount;
      results.push({ id: doc.id, chunks: chunkCount, status: "ok" });

      const entry = index.find((item) => item.id === doc.id);
      if (entry) {
        entry.chunkCount = chunkCount;
      }
    } catch (err) {
      results.push({ id: doc.id, status: "failed", error: err.message });
    }
  }

  await writeIndex(index);

  try {
    await createIndexes();
  } catch (err) {
    console.error("Index creation failed after reindex:", err.message);
  }

  return {
    reindexed: results.length,
    totalChunks,
    results,
  };
}

async function autoIndexUnindexedDocs() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("[auto-index] No GEMINI_API_KEY, skipping auto-index.");
    return;
  }

  const docs = await loadAllDocumentsWithMarkdown();
  if (!docs.length) {
    console.log("[auto-index] No documents found, skipping.");
    return;
  }

  const indexedDocIds = await getIndexedDocIds();
  const unindexedDocs = docs.filter((doc) => !indexedDocIds.includes(doc.id));

  if (!unindexedDocs.length) {
    console.log(`[auto-index] All ${docs.length} document(s) already indexed, skipping.`);
    return;
  }

  console.log(`[auto-index] Found ${unindexedDocs.length} unindexed document(s) out of ${docs.length} total. Indexing...`);

  for (const doc of unindexedDocs) {
    try {
      const { chunkCount } = await indexDocumentContent({
        id: doc.id,
        filename: doc.filename,
        title: doc.title,
        markdown: doc.markdown,
        apiKey,
      });

      console.log(`[auto-index] Indexed "${doc.filename}" (${chunkCount} chunks)`);

      const index = await readIndex();
      const entry = index.find((item) => item.id === doc.id);
      if (entry) {
        entry.chunkCount = chunkCount;
        await writeIndex(index);
      }
    } catch (err) {
      console.error(`[auto-index] Failed to index "${doc.filename}":`, err.message);
    }
  }

  try {
    await createIndexes();
    console.log("[auto-index] Indexes created.");
  } catch (err) {
    console.error("[auto-index] Index creation failed:", err.message);
  }

  console.log("[auto-index] Done.");
}

module.exports = {
  indexDocumentContent,
  rebuildAllIndexes,
  autoIndexUnindexedDocs,
};
