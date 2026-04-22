const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const config = require("../config");
const { ROOT, DOCS_DIR } = require("../constants");
const { getDocChunkCounts, removeDocumentChunks, createIndexes } = require("../db");
const { sendJson, parseJson, parseBoolean } = require("../lib/http");
const { ensureSession, rotateSession, writeSession } = require("../lib/session");
const { parseMultipartFile } = require("../lib/uploads");
const { convertToMarkdown, convertUploadToMarkdown, slugify, repairTextEncoding } = require("../lib/markdown");
const { readIndex, writeIndex, saveEnvValue } = require("../lib/storage");
const { splitIntoChunks } = require("../lib/chunking");
const { indexDocumentContent, rebuildAllIndexes } = require("../services/indexing");
const {
  normalizeChatMode,
  normalizeRetrievalMode,
  retrievalUsesEmbedding,
  retrieveRelevantChunks,
  serializeChunk,
  maybeRerankChunks,
  answerWithFullDocument,
  callGemini,
} = require("../services/chat");
const { runModelComparison } = require("../services/compare");

async function handleUpload(req, res) {
  const contentType = String(req.headers["content-type"] || "");
  const requestApiKey = String(req.headers["x-api-key"] || "").trim();
  let filename = "";
  let markdown = "";

  if (contentType.includes("multipart/form-data")) {
    const upload = await parseMultipartFile(req);
    filename = upload.filename;
    markdown = await convertUploadToMarkdown(upload);
  } else {
    const body = await parseJson(req);
    filename = String(body.filename || "").trim();
    const text = typeof body.text === "string" ? body.text : "";

    if (!filename || !text.trim()) {
      return sendJson(res, 400, { error: "filename and text are required." });
    }

    markdown = convertToMarkdown({ filename, text });
  }

  const id = `${slugify(path.basename(filename, path.extname(filename)))}-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  const filePath = path.join(DOCS_DIR, `${id}.md`);
  const safeFilename = repairTextEncoding(filename);
  const safeTitle = repairTextEncoding(path.basename(filename, path.extname(filename)));
  const chunkCount = splitIntoChunks(markdown).length;

  await fs.writeFile(filePath, markdown, "utf8");

  const index = await readIndex();
  const entry = {
    id,
    filename: safeFilename,
    title: safeTitle,
    markdownPath: `data/documents/${id}.md`,
    createdAt,
    chunkCount,
  };
  index.unshift(entry);
  await writeIndex(index);

  let indexingStatus = "not_indexed";
  try {
    const apiKey = requestApiKey || process.env.GEMINI_API_KEY || "";
    if (apiKey) {
      const { chunkCount } = await indexDocumentContent({
        id,
        filename: safeFilename,
        title: safeTitle,
        markdown,
        apiKey,
      });
      entry.chunkCount = chunkCount;
      await writeIndex(index);
      indexingStatus = "indexed";
    }
  } catch (err) {
    console.error("Embedding indexing failed:", err.message);
    indexingStatus = "failed";
  }

  try {
    await createIndexes();
  } catch {}

  return sendJson(res, 201, {
    document: entry,
    indexingStatus,
  });
}

async function handleDocuments(_req, res) {
  const docs = await readIndex();

  let chunkCounts = {};
  try {
    chunkCounts = await getDocChunkCounts();
  } catch {}

  let updated = false;
  for (const doc of docs) {
    const nextChunkCount = chunkCounts[doc.id] || doc.chunkCount || 0;
    if (doc.chunkCount !== nextChunkCount) {
      doc.chunkCount = nextChunkCount;
      updated = true;
    }
    doc.filename = repairTextEncoding(doc.filename);
    doc.title = repairTextEncoding(doc.title);
  }

  if (updated) {
    await writeIndex(docs);
  }

  return sendJson(res, 200, { documents: docs });
}

async function handleDeleteDocument(_req, res, docId) {
  const index = await readIndex();
  const entry = index.find((item) => item.id === docId);
  if (!entry) {
    return sendJson(res, 404, { error: "Document not found." });
  }

  const updated = index.filter((item) => item.id !== docId);
  const rollbackErrors = [];
  let originalMarkdownPath = null;
  let trashMarkdownPath = null;

  if (entry.markdownPath) {
    originalMarkdownPath = path.join(ROOT, entry.markdownPath);
    try {
      await fs.access(originalMarkdownPath);
      const trashDir = path.join(DOCS_DIR, ".trash");
      await fs.mkdir(trashDir, { recursive: true });
      trashMarkdownPath = path.join(trashDir, `${entry.id}-${Date.now()}.md`);
      await fs.rename(originalMarkdownPath, trashMarkdownPath);
    } catch (err) {
      if (err.code !== "ENOENT") {
        return sendJson(res, 500, {
          error: "Document cleanup failed.",
          details: [`markdown file: ${err.message}`],
        });
      }
    }
  }

  try {
    await writeIndex(updated);
  } catch (err) {
    if (trashMarkdownPath && originalMarkdownPath) {
      try {
        await fs.rename(trashMarkdownPath, originalMarkdownPath);
      } catch (restoreErr) {
        rollbackErrors.push(`restore markdown file: ${restoreErr.message}`);
      }
    }

    return sendJson(res, 500, {
      error: "Document cleanup failed.",
      details: [`metadata: ${err.message}`, ...rollbackErrors],
    });
  }

  try {
    await removeDocumentChunks(docId);
  } catch (err) {
    try {
      await writeIndex(index);
    } catch (rollbackErr) {
      rollbackErrors.push(`restore metadata: ${rollbackErr.message}`);
    }

    if (trashMarkdownPath && originalMarkdownPath) {
      try {
        await fs.rename(trashMarkdownPath, originalMarkdownPath);
      } catch (restoreErr) {
        rollbackErrors.push(`restore markdown file: ${restoreErr.message}`);
      }
    }

    return sendJson(res, 500, {
      error: "Document cleanup failed.",
      details: [`vector DB: ${err.message}`, ...rollbackErrors],
    });
  }

  const warnings = [];
  if (trashMarkdownPath) {
    try {
      await fs.unlink(trashMarkdownPath);
    } catch (err) {
      warnings.push(`trash cleanup: ${err.message}`);
    }
  }

  return sendJson(res, 200, {
    deleted: docId,
    warnings,
  });
}

async function handleChat(req, res) {
  const body = await parseJson(req);
  const session = await ensureSession(req, res);
  const question = String(body.question || "").trim();
  const apiKey = String(body.apiKey || "").trim();
  const chatMode = normalizeChatMode(String(body.chatMode || "qa").trim().toLowerCase());
  const documentId = String(body.documentId || "").trim();
  const documentIds = Array.isArray(body.documentIds) ? body.documentIds : [];
  const retrievalMode = normalizeRetrievalMode(String(body.retrievalMode || "hybrid").trim().toLowerCase());

  if (!question) {
    return sendJson(res, 400, { error: "question is required." });
  }

  const result = chatMode === "full-document"
    ? await answerWithFullDocument({ question, history: session.history, apiKey, documentId, documentIds })
    : await callGemini({ question, history: session.history, apiKey, tenantId: "default", retrievalMode });

  session.history.push(
    { role: "user", content: question },
    { role: "assistant", content: result.answer }
  );
  await writeSession(session);

  return sendJson(res, 200, {
    answer: result.answer,
    chatMode: result.chatMode || chatMode,
    retrievalMode: result.retrievalMode,
    sessionId: session.id,
    document: result.document || null,
    documents: result.documents || [],
    sliceCount: result.sliceCount || null,
    chunks: result.chunks.map(serializeChunk),
  });
}

async function handleSearch(req, res) {
  const body = await parseJson(req);
  const question = String(body.question || body.query || "").trim();
  const apiKey = String(body.apiKey || "").trim() || process.env.GEMINI_API_KEY || "";
  const retrievalMode = normalizeRetrievalMode(String(body.retrievalMode || "hybrid").trim().toLowerCase());
  const topK = Math.min(Math.max(Number(body.topK) || 5, 1), 20);
  const useRerank = parseBoolean(body.rerank);
  const rerankProvider = String(body.rerankProvider || process.env.RERANK_PROVIDER || "jina").trim().toLowerCase();
  const rerankApiKey = String(body.rerankApiKey || "").trim() || process.env.JINA_API_KEY || "";
  const retrievalTopK = useRerank ? Math.max(topK, config.RERANK_CANDIDATES || topK) : topK;

  if (!question) {
    return sendJson(res, 400, { error: "question is required." });
  }

  if (retrievalUsesEmbedding(retrievalMode) && !apiKey) {
    return sendJson(res, 400, { error: "API key required for semantic or hybrid debug search." });
  }

  if (useRerank && !rerankApiKey) {
    return sendJson(res, 400, { error: "JINA_API_KEY is required for rerank debug mode." });
  }

  const initialChunks = await retrieveRelevantChunks({
    question,
    tenantId: "default",
    apiKey,
    retrievalMode,
    topK: retrievalTopK,
  });

  const rerankResult = await maybeRerankChunks({
    question,
    chunks: initialChunks,
    rerank: useRerank
      ? {
          provider: rerankProvider,
          apiKey: rerankApiKey,
          topK,
        }
      : null,
  });

  const chunks = useRerank ? rerankResult.chunks : initialChunks;

  return sendJson(res, 200, {
    query: question,
    retrievalMode,
    usesEmbedding: retrievalUsesEmbedding(retrievalMode),
    rerankApplied: rerankResult.rerankApplied,
    rerankProvider: rerankResult.rerankProvider,
    topK,
    chunkCount: chunks.length,
    initialChunkCount: initialChunks.length,
    wikiInjectedSeparately: true,
    chunks: chunks.map(serializeChunk),
  });
}

async function handleSessionReset(req, res) {
  const session = await rotateSession(req, res);
  return sendJson(res, 200, {
    reset: true,
    sessionId: session.id,
  });
}

async function handleReindex(req, res) {
  const body = await parseJson(req);
  const apiKey = String(body.apiKey || "").trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return sendJson(res, 400, { error: "API key required for reindexing." });
  }

  const result = await rebuildAllIndexes({
    apiKey,
    skipTitles: body.skipTitles === true,
  });

  return sendJson(res, 200, result);
}

async function handleWikiUpload(req, res) {
  const contentType = String(req.headers["content-type"] || "");
  let filename = "";
  let content = "";

  if (contentType.includes("multipart/form-data")) {
    const upload = await parseMultipartFile(req);
    filename = upload.filename;
    content = upload.buffer.toString("utf8");
  } else {
    const body = await parseJson(req);
    filename = String(body.filename || "").trim();
    content = typeof body.text === "string" ? body.text : "";

    if (!filename || !content.trim()) {
      return sendJson(res, 400, { error: "filename and text are required." });
    }
  }

  if (!filename.endsWith(".md")) {
    filename = filename.replace(/\.[^.]+$/, "") + ".md";
  }

  const safeName = `${slugify(path.basename(filename, path.extname(filename)))}.md`;
  const wikiDir = path.join(config.WIKI_DIR, "default");

  await fs.mkdir(wikiDir, { recursive: true });
  const filePath = path.join(wikiDir, safeName);
  await fs.writeFile(filePath, content, "utf8");

  return sendJson(res, 201, {
    filename: safeName,
    path: `wiki/default/${safeName}`,
    size: content.length,
  });
}

async function handleWikiList(_req, res) {
  const wikiDir = path.join(config.WIKI_DIR, "default");
  let files = [];
  try {
    const entries = await fs.readdir(wikiDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) {
        continue;
      }
      const stat = await fs.stat(path.join(wikiDir, entry));
      files.push({ filename: entry, size: stat.size, modified: stat.mtime.toISOString() });
    }
  } catch {}

  return sendJson(res, 200, { files });
}

async function handleSaveKey(req, res) {
  const body = await parseJson(req);
  const key = String(body.apiKey || "").trim();
  if (!key) {
    return sendJson(res, 400, { error: "apiKey is required." });
  }
  await saveEnvValue("GEMINI_API_KEY", key);
  return sendJson(res, 200, { saved: true });
}

async function handleSaveJinaKey(req, res) {
  const body = await parseJson(req);
  const key = String(body.apiKey || "").trim();
  if (!key) {
    return sendJson(res, 400, { error: "apiKey is required." });
  }
  await saveEnvValue("JINA_API_KEY", key);
  return sendJson(res, 200, { saved: true });
}

async function handleModelCompare(req, res) {
  const body = await parseJson(req);
  const question = String(body.question || "").trim();
  const apiKey = String(body.apiKey || "").trim() || process.env.GEMINI_API_KEY;
  const models = Array.isArray(body.models) && body.models.length ? body.models : [config.MODELS[0]?.id];
  const task = String(body.task || "qa").trim();
  const retrievalMode = normalizeRetrievalMode(String(body.retrievalMode || "hybrid").trim().toLowerCase());

  if (!question) {
    return sendJson(res, 400, { error: "question is required." });
  }

  if (!apiKey) {
    return sendJson(res, 400, { error: "API key is required." });
  }

  try {
    const result = await runModelComparison({ question, apiKey, models, task, retrievalMode });
    return sendJson(res, 200, result);
  } catch (err) {
    return sendJson(res, 500, { error: err.message || "Model comparison failed." });
  }
}

module.exports = {
  handleUpload,
  handleDocuments,
  handleDeleteDocument,
  handleChat,
  handleSearch,
  handleSessionReset,
  handleReindex,
  handleWikiUpload,
  handleWikiList,
  handleSaveKey,
  handleSaveJinaKey,
  handleModelCompare,
};
