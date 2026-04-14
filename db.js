const lancedb = require("@lancedb/lancedb");
const config = require("./config");
const { getGeminiEmbeddingBatch } = require("./embedding");

const EMBEDDING_DIMENSION = config.EMBEDDING_DIMENSION || 768;
const TABLE_NAME = "chunks";

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
  return rows.length;
}

async function hybridSearch(query, tenantId, apiKey, topK = 5) {
  if (!apiKey) {
    throw new Error("API key required for search.");
  }

  const table = await getTable();

  const [queryEmbedding] = await getGeminiEmbeddingBatch(
    [query],
    apiKey,
    "RETRIEVAL_QUERY"
  );

  const fetchLimit = topK * 3;

  const vectorResults = await table
    .query()
    .nearestTo(queryEmbedding)
    .column("embedding")
    .limit(fetchLimit)
    .withRowId()
    .toArray();

  let ftsResults = [];
  try {
    ftsResults = await table
      .query()
      .fullTextSearch(query, { columns: ["content", "parentContent"] })
      .limit(fetchLimit)
      .withRowId()
      .toArray();
  } catch (err) {
    console.error("[lancedb] FTS search failed, using vector only:", err.message);
  }

  const scored = new Map();
  const ftsIds = new Set();

  for (const row of vectorResults) {
    scored.set(row.id, {
      id: row.id,
      content: row.content,
      parentContent: row.parentContent,
      filename: row.filename,
      title: row.title,
      chunkIndex: row.chunkIndex,
      docId: row.docId,
      vectorDistance: row._distance != null ? row._distance : null,
      ftsHit: false,
    });
  }

  for (const row of ftsResults) {
    ftsIds.add(row.id);
    if (scored.has(row.id)) {
      scored.get(row.id).ftsHit = true;
    } else {
      scored.set(row.id, {
        id: row.id,
        content: row.content,
        parentContent: row.parentContent,
        filename: row.filename,
        title: row.title,
        chunkIndex: row.chunkIndex,
        docId: row.docId,
        vectorDistance: null,
        ftsHit: true,
      });
    }
  }

  const candidates = [...scored.values()];

  const withVector = candidates.filter((c) => c.vectorDistance != null);
  const withFts = candidates.filter((c) => c.ftsHit);
  const vectorDistances = withVector.map((c) => c.vectorDistance);

  let normVector = () => 0;
  if (vectorDistances.length > 0) {
    const minDist = Math.min(...vectorDistances);
    const maxDist = Math.max(...vectorDistances);
    const range = maxDist - minDist || 1;
    normVector = (d) => (d != null ? 1 - (d - minDist) / range : 0);
  }

  for (const c of candidates) {
    const vScore = normVector(c.vectorDistance);
    const fScore = c.ftsHit ? 1 : 0;
    c.hybridScore = 0.6 * vScore + 0.4 * fScore;
  }

  candidates.sort((a, b) => b.hybridScore - a.hybridScore);

  return candidates.slice(0, topK).map((row) => ({
    id: row.id,
    score: row.hybridScore,
    content: row.parentContent || row.content,
    childContent: row.content,
    filename: row.filename,
    title: row.title,
    chunkIndex: row.chunkIndex,
    docId: row.docId,
  }));
}

async function removeDocumentChunks(docId) {
  const table = await getTable();
  try {
    await table.delete(`docId = '${docId}'`);
  } catch (err) {
    console.error("[lancedb] Delete failed:", err.message);
  }
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
  hybridSearch,
  removeDocumentChunks,
  getChunkCount,
};