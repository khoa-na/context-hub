const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const config = require("../config");
const { ROOT, DOCS_DIR } = require("../constants");
const { getDocChunkCounts, removeDocumentChunks, createIndexes } = require("../db");
const { sendJson, parseJson } = require("../lib/http");
const { getApiKeyForProvider, getProviderForModel } = require("../lib/model-providers");
const { ensureSession, rotateSession, writeSession } = require("../lib/session");
const { parseMultipartFile } = require("../lib/uploads");
const { convertToMarkdown, convertUploadToMarkdown, slugify, repairTextEncoding } = require("../lib/markdown");
const { readIndex, writeIndex, saveEnvValue } = require("../lib/storage");
const { getTodayAssistanceBrief } = require("../lib/assistance");
const {
  renderWebPageToMarkdown,
  saveSessionWebPage,
  pruneMissingSessionWebPages,
  deleteSessionWebPage,
} = require("../lib/web-pages");
const { splitIntoChunks } = require("../lib/chunking");
const { indexDocumentContent, rebuildAllIndexes } = require("../services/indexing");
const {
  buildFullDocumentSystemInstruction,
  generateStructuredGeminiAnswer,
  normalizeModelText,
} = require("../services/gemini");
const {
  normalizeChatMode,
  normalizeRetrievalMode,
  retrievalUsesEmbedding,
  retrieveRelevantChunks,
  serializeChunk,
  answerWithFullDocument,
  answerWithWebPages,
  answerWithAssistance,
  callGemini,
  callGeminiStream,
} = require("../services/chat");

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
  const apiKeys = body.apiKeys && typeof body.apiKeys === "object" ? body.apiKeys : {};
  const model = String(body.model || "").trim();
  const chatMode = normalizeChatMode(String(body.chatMode || "qa").trim().toLowerCase());
  const documentId = String(body.documentId || "").trim();
  const documentIds = Array.isArray(body.documentIds) ? body.documentIds : [];
  const webPageId = String(body.webPageId || "").trim();
  const webPageIds = Array.isArray(body.webPageIds) ? body.webPageIds : [];
  const webPageReadMode = String(body.webPageReadMode || "auto").trim().toLowerCase();
  const retrievalMode = normalizeRetrievalMode(String(body.retrievalMode || "hybrid").trim().toLowerCase());

  if (!question) {
    return sendJson(res, 400, { error: "question is required." });
  }

  let result;
  if (chatMode === "full-document") {
    result = await answerWithFullDocument({ question, history: session.history, apiKey, apiKeys, model, documentId, documentIds });
  } else if (chatMode === "web-pages") {
    result = await answerWithWebPages({ question, history: session.history, apiKey, apiKeys, model, session, webPageId, webPageIds, webPageReadMode });
  } else if (chatMode === "assistance") {
    result = await answerWithAssistance({ question, history: session.history, apiKey, apiKeys, model });
  } else {
    result = await callGemini({ question, history: session.history, apiKey, apiKeys, model, tenantId: "default", retrievalMode, session });
  }

  session.history.push(
    { role: "user", content: question },
    { role: "assistant", content: result.answer }
  );
  await writeSession(session);

  return sendJson(res, 200, {
    answer: result.answer,
    structured: result.structured || null,
    rawModelText: result.rawModelText || "",
    chatMode: result.chatMode || chatMode,
    retrievalMode: result.retrievalMode,
    sessionId: session.id,
    document: result.document || null,
    documents: result.documents || [],
    sliceCount: result.sliceCount || null,
    totalSliceCount: result.totalSliceCount || null,
    processingMode: result.processingMode || null,
    documentCount: result.documentCount || null,
    compressionPasses: result.compressionPasses || 0,
    schemaPreset: result.schemaPreset || null,
    chunks: result.chunks.map(serializeChunk),
  });
}

async function handleAssistanceToday(_req, res) {
  const brief = await getTodayAssistanceBrief();
  return sendJson(res, 200, brief);
}

function buildWebPageSummaryPrompt({ question, page, markdown }) {
  return [
    "Summarize this rendered public web page for the user.",
    "Use only the supplied web page markdown.",
    "Answer in the same language as the user.",
    "",
    `Web page title: ${page.title}`,
    `Source URL: ${page.url}`,
    "",
    "=== WEB PAGE MARKDOWN ===",
    markdown,
    "",
    `=== USER REQUEST ===\n${question || "Tom tat trang web nay"}`,
  ].join("\n");
}

function buildWebPageSource({ page, markdown }) {
  return {
    id: `web:${page.id}`,
    title: page.title,
    filename: page.url,
    content: markdown.slice(0, 2400),
    childContent: "",
    score: null,
    retrieval: {
      sources: ["web-page"],
    },
  };
}

async function handleCreateWebPage(req, res) {
  const body = await parseJson(req);
  const session = await ensureSession(req, res);
  const urls = Array.isArray(body.urls) ? body.urls : [body.url];
  const normalizedUrls = urls.map((url) => String(url || "").trim()).filter(Boolean);
  const apiKeys = body.apiKeys && typeof body.apiKeys === "object" ? body.apiKeys : {};
  const legacyApiKey = String(body.apiKey || "").trim();
  const model = String(body.model || "").trim();
  const question = String(body.question || "Tóm tắt trang web này").trim();
  const shouldSummarize = body.summarize === true;

  if (!normalizedUrls.length) {
    return sendJson(res, 400, { error: "url is required." });
  }

  const provider = getProviderForModel(model);
  const apiKey = getApiKeyForProvider({ provider, apiKeys, legacyApiKey });
  if (shouldSummarize && !apiKey) {
    return sendJson(res, 400, { error: `Missing ${provider} API key. Add it to the environment or paste a key into the app.` });
  }

  const imported = [];
  const failures = [];
  for (const url of normalizedUrls) {
    try {
      const rendered = await renderWebPageToMarkdown(url);
      const page = await saveSessionWebPage({ session, rendered });
      imported.push({ page, rendered });
    } catch (error) {
      failures.push({ url, error: error.message || "Failed to import this URL." });
    }
  }

  if (!imported.length) {
    return sendJson(res, 400, {
      error: failures[0]?.error || "Could not import any web pages.",
      failures,
    });
  }

  if (!shouldSummarize) {
    await writeSession(session);
    return sendJson(res, 201, {
      pages: imported.map((item) => item.page),
      page: imported[0]?.page || null,
      importedCount: imported.length,
      failures,
      sessionId: session.id,
    });
  }

  if (imported.length > 1) {
    await writeSession(session);
    return sendJson(res, 201, {
      pages: imported.map((item) => item.page),
      page: imported[0]?.page || null,
      importedCount: imported.length,
      failures,
      sessionId: session.id,
      warning: "Multiple pages were imported. Ask about them in Web pages mode.",
    });
  }

  const { page, rendered } = imported[0];
  const response = await generateStructuredGeminiAnswer({
    apiKey,
    provider,
    model,
    maxOutputTokens: 700,
    systemInstruction: buildFullDocumentSystemInstruction(),
    prompt: buildWebPageSummaryPrompt({ question, page, markdown: rendered.markdown }),
    useResponseSchema: false,
  });

  session.history.push(
    { role: "user", content: `${question}\n${page.url}` },
    { role: "assistant", content: response.answer }
  );
  await writeSession(session);

  const source = buildWebPageSource({ page, markdown: rendered.markdown });
  return sendJson(res, 201, {
    page,
    answer: response.answer,
    structured: response.structured || null,
    rawModelText: response.rawText || "",
    chatMode: "web-page",
    retrievalMode: "web-page",
    sessionId: session.id,
    chunks: [serializeChunk(source)],
  });
}

async function handleWebPages(req, res) {
  const session = await ensureSession(req, res);
  const changed = await pruneMissingSessionWebPages(session);
  if (changed) {
    await writeSession(session);
  }
  return sendJson(res, 200, { pages: session.webPages || [] });
}

async function handleDeleteWebPage(req, res, pageId) {
  const session = await ensureSession(req, res);
  const deleted = await deleteSessionWebPage(session, pageId);
  if (!deleted) {
    return sendJson(res, 404, { error: "Web page not found." });
  }
  await writeSession(session);
  return sendJson(res, 200, { deleted: pageId });
}

async function handleSearch(req, res) {
  const body = await parseJson(req);
  const question = String(body.question || body.query || "").trim();
  const apiKeys = body.apiKeys && typeof body.apiKeys === "object" ? body.apiKeys : {};
  const apiKey = getApiKeyForProvider({
    provider: "google",
    apiKeys,
    legacyApiKey: String(body.apiKey || "").trim(),
  });
  const retrievalMode = normalizeRetrievalMode(String(body.retrievalMode || "hybrid").trim().toLowerCase());
  const topK = Math.min(Math.max(Number(body.topK) || 5, 1), 20);

  if (!question) {
    return sendJson(res, 400, { error: "question is required." });
  }

  if (retrievalUsesEmbedding(retrievalMode) && !apiKey) {
    return sendJson(res, 400, { error: "API key required for semantic or hybrid debug search." });
  }

  const initialChunks = await retrieveRelevantChunks({
    question,
    tenantId: "default",
    apiKey,
    retrievalMode,
    topK,
  });

  const chunks = initialChunks;

  return sendJson(res, 200, {
    query: question,
    retrievalMode,
    usesEmbedding: retrievalUsesEmbedding(retrievalMode),
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
  const apiKeys = body.apiKeys && typeof body.apiKeys === "object" ? body.apiKeys : {};
  const apiKey = getApiKeyForProvider({
    provider: "google",
    apiKeys,
    legacyApiKey: String(body.apiKey || "").trim(),
  });
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
  const provider = String(body.provider || "google").trim();
  const providerConfig = (config.PROVIDERS || []).find((item) => item.id === provider);
  if (!key) {
    return sendJson(res, 400, { error: "apiKey is required." });
  }
  if (!providerConfig) {
    return sendJson(res, 400, { error: "Unsupported provider." });
  }

  await saveEnvValue(providerConfig.apiKeyEnv, key);
  return sendJson(res, 200, { saved: true, provider });
}

async function handleChatStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  function writeEvent(data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const body = await parseJson(req);
    const session = await ensureSession(req, res);
    const question = String(body.question || "").trim();
    const apiKey = String(body.apiKey || "").trim();
    const apiKeys = body.apiKeys && typeof body.apiKeys === "object" ? body.apiKeys : {};
    const model = String(body.model || "").trim();
    const retrievalMode = normalizeRetrievalMode(String(body.retrievalMode || "hybrid").trim().toLowerCase());

    if (!question) {
      writeEvent({ type: "error", error: "question is required." });
      res.end();
      return;
    }

    const { chunks, retrievalMode: actualRetrievalMode, stream } = await callGeminiStream({
      question, history: session.history, apiKey, apiKeys, model,
      tenantId: "default", retrievalMode,
    });

    writeEvent({ type: "start", chunks: chunks.map(serializeChunk), retrievalMode: actualRetrievalMode });

    let fullText = "";
    for await (const token of stream) {
      fullText += token;
      writeEvent({ type: "token", text: token });
    }

    const answer = normalizeModelText(fullText) || fullText;
    session.history.push({ role: "user", content: question }, { role: "assistant", content: answer });
    await writeSession(session);

    writeEvent({ type: "done", sessionId: session.id });
    res.end();
  } catch (err) {
    console.error(err);
    writeEvent({ type: "error", error: err.message || "Internal server error." });
    res.end();
  }
}

module.exports = {
  handleUpload,
  handleDocuments,
  handleDeleteDocument,
  handleCreateWebPage,
  handleWebPages,
  handleDeleteWebPage,
  handleAssistanceToday,
  handleChat,
  handleChatStream,
  handleSearch,
  handleSessionReset,
  handleReindex,
  handleWikiUpload,
  handleWikiList,
  handleSaveKey,
};
