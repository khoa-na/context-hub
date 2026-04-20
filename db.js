const lancedb = require("@lancedb/lancedb");
const config = require("./config");
const { getGeminiEmbeddingBatch } = require("./embedding");

const EMBEDDING_DIMENSION = config.EMBEDDING_DIMENSION || 768;
const TABLE_NAME = "chunks";
const DEFAULT_FETCH_MULTIPLIER = 3;
const DEFAULT_RRF_K = 60;

let dbInstance = null;
let tableInstance = null;

async function getDB() {
  if (!dbInstance) {
    dbInstance = await lancedb.connect(config.LANCEDB_DIR);
  }
  return dbInstance;
}

async function getTable() {
  if (tableInstance) {
    return tableInstance;
  }

  const db = await getDB();
  const tableNames = await db.tableNames();

  if (tableNames.includes(TABLE_NAME)) {
    tableInstance = await db.openTable(TABLE_NAME);
  } else {
    const initialData = [
      {
        id: "__init__",
        content: "",
        parentContent: "",
        embedding: new Float32Array(EMBEDDING_DIMENSION).fill(0),
        filename: "",
        title: "",
        chunkIndex: 0,
        docId: "__init__",
      },
    ];
    tableInstance = await db.createTable(TABLE_NAME, initialData);
    await tableInstance.delete("id = '__init__'");
  }

  return tableInstance;
}

async function refreshTable() {
  const db = await getDB();
  const tableNames = await db.tableNames();
  if (!tableNames.includes(TABLE_NAME)) {
    tableInstance = null;
    return null;
  }

  tableInstance = await db.openTable(TABLE_NAME);
  return tableInstance;
}

async function createIndexes() {
  const table = await getTable();
  let rowCount = 0;
  try {
    rowCount = await table.countRows();
  } catch {
    return;
  }

  if (rowCount < 1) {
    return;
  }

  try {
    await table.createIndex("content", {
      config: lancedb.Index.fts(),
    });
  } catch (err) {
    if (!/already exists/i.test(err.message)) {
      console.error("[lancedb] FTS index creation failed:", err.message);
    }
  }

  if (rowCount >= 256) {
    try {
      await table.createIndex("embedding", {
        config: lancedb.Index.ivfPq({
          numPartitions: Math.min(Math.max(Math.floor(rowCount / 2), 2), 64),
          numSubVectors: 48,
        }),
      });
    } catch (err) {
      if (!/already exists/i.test(err.message)) {
        console.error("[lancedb] Vector index creation failed:", err.message);
      }
    }
  } else {
    console.log(`[lancedb] Only ${rowCount} rows, vector index requires 256+. Skipping.`);
  }

  await refreshTable();
}

async function indexDocumentChunks(chunks, filename, title, docId, tenantId, apiKey) {
  if (!apiKey) {
    throw new Error("API key required for embedding documents.");
  }

  const table = await getTable();
  const contextualTexts = chunks.map((c) => `${c.title}: ${c.text}`);
  const embeddings = await getGeminiEmbeddingBatch(contextualTexts, apiKey, "RETRIEVAL_DOCUMENT");

  const rows = chunks.map((chunk, i) => ({
    id: `${docId}_${chunk.id}`,
    content: chunk.text,
    parentContent: chunk.parentText || chunk.text,
    embedding: embeddings[i],
    filename,
    title,
    chunkIndex: chunk.id ? parseInt(chunk.id.replace("C", ""), 10) || i : i,
    docId,
  }));

  await table.add(rows);
  await refreshTable();
  return rows.length;
}

function buildResultRow(row) {
  return {
    id: row.id,
    content: row.content,
    parentContent: row.parentContent,
    filename: row.filename,
    title: row.title,
    chunkIndex: row.chunkIndex,
    docId: row.docId,
  };
}

function parentSectionKey(row) {
  return `${row.docId}::${row.parentContent || row.content || row.id}`;
}

function finalizeResults(candidates, topK) {
  const seenParents = new Set();
  const results = [];

  for (const candidate of candidates) {
    const parentKey = parentSectionKey(candidate);
    if (seenParents.has(parentKey)) {
      continue;
    }

    seenParents.add(parentKey);
    results.push({
      id: candidate.id,
      score: candidate.hybridScore,
      content: candidate.parentContent || candidate.content,
      childContent: candidate.content,
      filename: candidate.filename,
      title: candidate.title,
      chunkIndex: candidate.chunkIndex,
      docId: candidate.docId,
      retrieval: {
        semanticRank: candidate.semanticRank || null,
        bm25Rank: candidate.bm25Rank || null,
        sources: candidate.sources,
      },
    });

    if (results.length >= topK) {
      break;
    }
  }

  return results;
}

async function semanticSearch(query, tenantId, apiKey, topK = 5, options = {}) {
  if (!apiKey) {
    throw new Error("API key required for search.");
  }

  const table = await getTable();
  const fetchLimit = Math.max(topK, topK * (options.fetchMultiplier || DEFAULT_FETCH_MULTIPLIER));

  const [queryEmbedding] = await getGeminiEmbeddingBatch(
    [query],
    apiKey,
    "RETRIEVAL_QUERY"
  );

  const vectorResults = await table
    .query()
    .nearestTo(queryEmbedding)
    .column("embedding")
    .limit(fetchLimit)
    .withRowId()
    .toArray();

  return finalizeResults(
    vectorResults.map((row, index) => ({
      ...buildResultRow(row),
      semanticRank: index + 1,
      bm25Rank: null,
      hybridScore: 1 / (DEFAULT_RRF_K + index + 1),
      sources: ["semantic"],
    })),
    topK
  );
}

async function runBm25Query(table, query, fetchLimit) {
  return table
    .query()
    .fullTextSearch(query, { columns: ["content", "parentContent"] })
    .limit(fetchLimit)
    .withRowId()
    .toArray();
}

async function bm25Search(query, tenantId, topK = 5, options = {}) {
  const table = await getTable();
  const fetchLimit = Math.max(topK, topK * (options.fetchMultiplier || DEFAULT_FETCH_MULTIPLIER));

  let ftsResults = [];
  try {
    ftsResults = await runBm25Query(table, query, fetchLimit);

    if (!ftsResults.length && options.retryOnEmpty !== false) {
      await createIndexes();
      await new Promise((resolve) => setTimeout(resolve, 750));
      const refreshedTable = await getTable();
      ftsResults = await runBm25Query(refreshedTable, query, fetchLimit);
    }
  } catch (err) {
    console.error("[lancedb] FTS search failed:", err.message);
    return [];
  }

  return finalizeResults(
    ftsResults.map((row, index) => ({
      ...buildResultRow(row),
      semanticRank: null,
      bm25Rank: index + 1,
      hybridScore: 1 / (DEFAULT_RRF_K + index + 1),
      sources: ["bm25"],
    })),
    topK
  );
}

async function hybridSearch(query, tenantId, apiKey, topK = 5, options = {}) {
  const fetchLimit = Math.max(topK, topK * (options.fetchMultiplier || DEFAULT_FETCH_MULTIPLIER));
  const rrfK = options.rrfK || DEFAULT_RRF_K;

  const [semanticResults, bm25Results] = await Promise.all([
    semanticSearch(query, tenantId, apiKey, fetchLimit, options),
    bm25Search(query, tenantId, fetchLimit, options),
  ]);

  const scored = new Map();

  for (const row of semanticResults) {
    scored.set(row.id, {
      id: row.id,
      content: row.childContent,
      parentContent: row.content,
      filename: row.filename,
      title: row.title,
      chunkIndex: row.chunkIndex,
      docId: row.docId,
      semanticRank: row.retrieval.semanticRank,
      bm25Rank: null,
      sources: ["semantic"],
    });
  }

  for (const row of bm25Results) {
    if (scored.has(row.id)) {
      const existing = scored.get(row.id);
      existing.bm25Rank = row.retrieval.bm25Rank;
      existing.sources = ["semantic", "bm25"];
    } else {
      scored.set(row.id, {
        id: row.id,
        content: row.childContent,
        parentContent: row.content,
        filename: row.filename,
        title: row.title,
        chunkIndex: row.chunkIndex,
        docId: row.docId,
        semanticRank: null,
        bm25Rank: row.retrieval.bm25Rank,
        sources: ["bm25"],
      });
    }
  }

  const candidates = [...scored.values()];

  for (const c of candidates) {
    const semanticScore = c.semanticRank ? 1 / (rrfK + c.semanticRank) : 0;
    const bm25Score = c.bm25Rank ? 1 / (rrfK + c.bm25Rank) : 0;
    c.hybridScore = semanticScore + bm25Score;
  }

  candidates.sort((a, b) => b.hybridScore - a.hybridScore);
  return finalizeResults(candidates, topK);
}

async function removeDocumentChunks(docId) {
  const table = await getTable();
  const safeDocId = String(docId).replace(/'/g, "\\'");
  await table.delete(`docId = '${safeDocId}'`);
  await refreshTable();
}

async function getIndexedDocIds() {
  const table = await getTable();
  try {
    const results = await table
      .query()
      .select(["docId"])
      .limit(10000)
      .toArray();
    return [...new Set(results.map((r) => r.docId))];
  } catch {
    return [];
  }
}

async function getDocChunkCounts() {
  const table = await getTable();
  try {
    const rows = await table.query().select(["docId"]).limit(100000).toArray();
    const counts = {};
    for (const row of rows) {
      counts[row.docId] = (counts[row.docId] || 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}

async function clearTable() {
  const db = await getDB();
  const tableNames = await db.tableNames();
  if (tableNames.includes(TABLE_NAME)) {
    await db.dropTable(TABLE_NAME);
  }
  tableInstance = null;
}

async function getChunkCount() {
  const table = await getTable();
  try {
    return await table.countRows();
  } catch {
    return 0;
  }
}

module.exports = {
  getDB,
  getTable,
  createIndexes,
  indexDocumentChunks,
  semanticSearch,
  bm25Search,
  hybridSearch,
  removeDocumentChunks,
  getChunkCount,
  getIndexedDocIds,
  getDocChunkCounts,
  clearTable,
};
