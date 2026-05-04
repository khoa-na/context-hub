const config = require("../config");
const { callGoogleGenAI } = require("../lib/google-genai-client");
const { callDashScopeChatCompletion } = require("../lib/dashscope-client");
const { getDefaultModelForProvider, getProviderForModel } = require("../lib/model-providers");

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorStatusCode(err) {
  const directStatus = Number(err?.statusCode);
  if (Number.isFinite(directStatus) && directStatus > 0) {
    return directStatus;
  }

  const causeStatus = Number(err?.cause?.statusCode);
  if (Number.isFinite(causeStatus) && causeStatus > 0) {
    return causeStatus;
  }

  const message = String(err?.message || err?.cause?.message || "");
  const match = message.match(/\b(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

function isRetryableModelError(err) {
  const statusCode = getErrorStatusCode(err);
  return statusCode ? RETRYABLE_STATUS_CODES.has(statusCode) : false;
}

function shouldSkipSchemaStructuredAttempt(model, provider = "google") {
  return provider !== "google" || model === "gemma-4-26b-a4b-it";
}

function extractGeminiText(payload) {
  try {
    if (typeof payload?.text === "string" && payload.text.trim()) {
      return payload.text.trim();
    }
  } catch {}

  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const texts = [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) {
        texts.push(part.text.trim());
      }
    }
  }

  return texts.join("\n").trim();
}

function isLeakedMetaLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return [
    /^thinking\s*:?/i,
    /^analysis\s*:?/i,
    /^reasoning\s*:?/i,
    /^deliberation\s*:?/i,
    /^reflection\s*:?/i,
    /^scratchpad\s*:?/i,
    /^final answer\s*:?/i,
    /^[-*]\s*Task:/i,
    /^[-*]\s*Constraint\b/i,
    /^[-*]\s*Language:/i,
    /^[-*]\s*\[C\d+\]/,
    /^Question:/i,
    /^Context:/i,
    /^Conversation so far:/i,
    /^[-*]\s*\*What is it\?\*/i,
    /^[-*]\s*\*What does it do\?\*/i,
    /^[-*]\s*\*Key Technical Features:/i,
    /^[-*]\s*\*Benefits:/i,
    /^[-*]\s*\*Goal:/i,
  ].some((pattern) => pattern.test(trimmed));
}

function sanitizeModelAnswer(answer) {
  const normalized = String(answer || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return normalized;
  }

  const hasLeakMarkers = /(Thinking:|Analysis:|Reasoning:|Task:|Constraint\b|Conversation so far:|Question:|Context:|Final Answer:)/i.test(normalized);
  if (!hasLeakMarkers) {
    return normalized
      .replace(/```+/g, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .trim();
  }

  const lines = normalized.split("\n");
  let sawMeta = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (isLeakedMetaLine(line)) {
      sawMeta = true;
      continue;
    }

    if (sawMeta) {
      return lines
        .slice(index)
        .join("\n")
        .replace(/```+/g, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .trim();
    }
  }

  return normalized
    .replace(/```+/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .trim();
}

function normalizeModelText(text) {
  return sanitizeModelAnswer(text)
    .replace(/\$?\\?right\s*arrow\$?/gi, "->")
    .replace(/\$?\\?to\$?/gi, "->")
    .replace(/\$?\\?left\s*arrow\$?/gi, "<-")
    .replace(/\$?\\?geq\$?/gi, ">=")
    .replace(/\$?\\?leq\$?/gi, "<=")
    .replace(/\$?\\?times\$?/gi, "x")
    .replace(/\$?\\?approx\$?/gi, "~")
    .replace(/\$?\\?Delta\$?/g, "Delta")
    .replace(/\$?\\?delta\$?/g, "delta")
    .replace(/\$/g, "")
    .trim();
}

function extractFirstJsonObject(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  if (start === -1) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  return "";
}

function normalizeStructuredCitations(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());
}

function normalizeStructuredFollowUpQuestions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());
}

function isMeaningfulStructuredAnswer(value) {
  const answer = sanitizeModelAnswer(value);
  if (!answer) {
    return false;
  }

  if (!/[0-9A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/u.test(answer)) {
    return false;
  }

  if (/^[\[\]{}()",.:;\-_\s]+$/.test(answer)) {
    return false;
  }

  return true;
}

function parseStructuredAnswerPayload(text) {
  const jsonText = extractFirstJsonObject(text);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const answer = typeof parsed.answer === "string" ? normalizeModelText(parsed.answer) : "";
    if (!isMeaningfulStructuredAnswer(answer)) {
      return null;
    }

    return {
      answer,
      citations: normalizeStructuredCitations(parsed.citations),
      follow_up_questions: normalizeStructuredFollowUpQuestions(parsed.follow_up_questions),
    };
  } catch {
    return null;
  }
}

function buildStructuredAnswerPrompt(prompt) {
  return [
    "You must return exactly one valid JSON object.",
    "The JSON object must be parseable by JSON.parse.",
    "Do not return Markdown, code fences, prose, comments, or any text outside the JSON object.",
    "The JSON must contain exactly these keys: answer, citations, follow_up_questions.",
    "The answer value must be a complete Vietnamese plain-text answer, not a placeholder and not a single symbol.",
    "The citations value must be an array of source document ids or chunk ids.",
    "The follow_up_questions value must be an array of useful Vietnamese follow-up questions.",
    "",
    prompt,
    "",
    "Return this exact JSON shape:",
    "{",
    '  "answer": "cau tra loi cuoi cung bang tieng Viet",',
    '  "citations": ["source-id-1", "source-id-2"],',
    '  "follow_up_questions": ["cau hoi tiep theo 1", "cau hoi tiep theo 2"]',
    "}",
    "",
    'If no citation is available, set "citations" to [].',
    'If no useful follow-up question is available, set "follow_up_questions" to [].',
  ].join("\n");
}

function buildStructuredAnswerJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: {
        type: "string",
      },
      citations: {
        type: "array",
        items: {
          type: "string",
        },
      },
      follow_up_questions: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: ["answer", "citations", "follow_up_questions"],
  };
}

function buildStructuredSystemInstruction(baseInstruction) {
  return [
    baseInstruction,
    "Return one valid JSON object only.",
    "No Markdown or extra text.",
  ].join("\n");
}

function buildGeminiSystemInstruction() {
  return [
    "You are a document assistant.",
    "Answer in the same language as the user.",
    "Use only the provided context.",
    "Return only the final answer in plain text.",
    "Do not show reasoning or repeat the prompt.",
    "If the context is incomplete, answer with the best supported summary and note what is uncertain.",
  ].join("\n");
}

function buildFullDocumentSystemInstruction() {
  return [
    "You are a document assistant.",
    "Answer in the same language as the user.",
    "Use only the supplied documents.",
    "Return only the final answer in plain text.",
    "Do not show reasoning or repeat the prompt.",
    "For summaries, cover the whole selected document set.",
    "If some details are missing, give the best supported summary and note what is uncertain.",
  ].join("\n");
}

function buildQwenFormalStyleInstruction() {
  return [
    "Style requirements for Qwen models:",
    "Use a formal, neutral, professional register.",
    "When answering in Vietnamese, prefer precise Vietnamese terms and avoid casual phrasing.",
    "Use a short opening sentence when helpful, followed by numbered points or concise paragraphs for multi-part answers.",
    "Avoid dense single-paragraph responses; add clear line breaks between major ideas.",
    "Do not use emojis, exclamation marks, conversational filler, or promotional language.",
    "Keep claims tightly grounded in the provided context and state uncertainty formally when evidence is incomplete.",
    "Place citations at the end of the relevant sentence, separated by a space, for example: noi dung cau tra loi [source-id].",
  ].join("\n");
}

function withProviderSystemInstruction({ provider, model, systemInstruction }) {
  const baseInstruction = systemInstruction || buildGeminiSystemInstruction();
  const modelId = String(model || "").toLowerCase();
  const isQwen = provider === "dashscope" || modelId.includes("qwen");

  if (!isQwen) {
    return baseInstruction;
  }

  return [
    baseInstruction,
    buildQwenFormalStyleInstruction(),
  ].join("\n\n");
}

function buildDocumentSliceSystemInstruction() {
  return [
    "Extract only information from the supplied slice that may help answer the user's request.",
    "Use only information in the slice.",
    "Prefer concise bullets with exact numbers, units, percentages, periods, KPI names, risks, anomalies, and trend signals.",
    "Preserve source labels such as document id, filename, section, and slice index when present.",
    "If the slice has no relevant information, say: No directly relevant information in this slice.",
    "Use the same language as the user.",
  ].join("\n");
}

function buildGeminiUserPrompt({ question, contextText, history }) {
  const historyLines = (history || [])
    .slice(-16)
    .map((entry) => `[${entry.role === "assistant" ? "Assistant" : "User"}]: ${entry.content}`)
    .join("\n");

  return [
    historyLines ? `Conversation so far:\n${historyLines}` : "",
    `=== COMPANY KNOWLEDGE ===\n${contextText}`,
    `=== QUESTION ===\n${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeDocumentsInput(documentsOrDocument) {
  return Array.isArray(documentsOrDocument) ? documentsOrDocument : [documentsOrDocument];
}

function buildDocumentListHeader(documents) {
  return normalizeDocumentsInput(documents)
    .map((document, index) => `Document ${index + 1} ID: ${document.id}\nTitle: ${document.title}\nFilename: ${document.filename}`)
    .join("\n\n");
}

function buildDocumentsMarkdownBlock(documents) {
  return normalizeDocumentsInput(documents)
    .map((document, index) => `=== DOCUMENT ${index + 1} ===\nDocument ID: ${document.id}\nTitle: ${document.title}\nFilename: ${document.filename}\n\n${document.markdown}`)
    .join("\n\n");
}

function buildDirectFullDocumentPrompt({ question, history, documents, schemaInstruction }) {
  const historyLines = (history || [])
    .slice(-16)
    .map((entry) => `[${entry.role === "assistant" ? "Assistant" : "User"}]: ${entry.content}`)
    .join("\n");

  return [
    historyLines ? `Conversation so far:\n${historyLines}` : "",
    `=== SELECTED DOCUMENTS ===\n${buildDocumentListHeader(documents)}`,
    schemaInstruction ? `=== EXTRACTION FOCUS ===\n${schemaInstruction}` : "",
    `=== FULL DOCUMENT MARKDOWN ===\n${buildDocumentsMarkdownBlock(documents)}`,
    `=== USER REQUEST ===\n${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildDocumentSlicePrompt({ question, documents, sliceText, sliceIndex, totalSlices, schemaInstruction }) {
  return [
    "Selected documents:",
    buildDocumentListHeader(documents),
    schemaInstruction ? `Extraction schema:\n${schemaInstruction}` : "",
    `Slice ${sliceIndex} of ${totalSlices}`,
    `User request: ${question}`,
    "Extract facts from this slice for later whole-document synthesis and cross-document comparison.",
    "Return a compact JSON object when possible with keys: relevant, facts, metrics, trends, risks, anomalies, missing_or_uncertain_data, sources.",
    "If this slice is not relevant to the request, return a very short object or sentence saying it has no directly relevant information.",
    "Keep exact numbers, units, currencies, percentages, periods, KPI names, risks, drivers, and notable exceptions.",
    "Every fact should include the document id and section/slice source label when present.",
    "Do not invent missing values.",
    `=== DOCUMENT SLICE ===\n${sliceText}`,
  ].filter(Boolean).join("\n\n");
}

function buildDocumentSummaryPrompt({ question, document, sliceSummaries, schemaInstruction }) {
  return [
    "Build a compact document-level summary from the slice extractions.",
    `User request: ${question}`,
    schemaInstruction ? `Extraction schema:\n${schemaInstruction}` : "",
    "Preserve exact numbers, units, periods, KPI names, risks, anomalies, and trend signals.",
    "Keep citations/source labels from the slice extractions.",
    "If a metric is missing or uncertain, say so briefly.",
    "",
    `=== DOCUMENT ===\n${buildDocumentListHeader([document])}`,
    "=== SLICE EXTRACTIONS ===",
    sliceSummaries.map((summary, index) => `Slice ${index + 1}:\n${summary}`).join("\n\n"),
  ].filter(Boolean).join("\n");
}

function buildWholeDocumentSummaryPrompt({ question, document, schemaInstruction }) {
  return [
    "Build a compact document-level summary from the full document markdown.",
    `User request: ${question}`,
    schemaInstruction ? `Extraction schema:\n${schemaInstruction}` : "",
    "Preserve exact numbers, units, periods, KPI names, risks, anomalies, and trend signals.",
    "Keep source labels using the document id, title, and filename.",
    "If a metric is missing or uncertain, say so briefly.",
    "Do not invent missing values.",
    "",
    `=== DOCUMENT ===\n${buildDocumentListHeader([document])}`,
    `=== FULL DOCUMENT MARKDOWN ===\n${document.markdown}`,
  ].filter(Boolean).join("\n");
}

function buildDocumentReduceSystemInstruction() {
  return [
    "Create compact intermediate summaries for later synthesis.",
    "Use only the supplied extracted facts or summaries.",
    "Preserve exact numbers, units, periods, document ids, source labels, risks, anomalies, and trend signals.",
    "Do not invent missing values.",
    "Use the same language as the user.",
  ].join("\n");
}

function buildRerankSystemInstruction() {
  return [
    "You rank document chunks by relevance to a question.",
    "Return only the most relevant chunk numbers in order, comma-separated. Example: 3, 7, 1, 12",
    "If NO chunk in the set is relevant to the question, return only the word: NONE",
    "Rank by factual relevance: does the chunk directly help answer the question?",
    "Prefer chunks with concrete data, dates, names, figures over generic overviews.",
    "Do not include explanation, just comma-separated numbers or NONE.",
  ].join("\n");
}

function buildCompressedSummariesPrompt({ question, documents, summaries, batchIndex, totalBatches, schemaInstruction }) {
  return [
    "Compress these document summaries for final synthesis.",
    `User request: ${question}`,
    schemaInstruction ? `Extraction schema:\n${schemaInstruction}` : "",
    `Batch ${batchIndex} of ${totalBatches}`,
    "Keep only information needed for answering the request and comparing selected documents.",
    "Preserve exact numbers, units, document ids, periods, and source labels.",
    "Do not invent missing values.",
    "",
    `=== SELECTED DOCUMENTS ===\n${buildDocumentListHeader(documents)}`,
    "=== SUMMARIES TO COMPRESS ===",
    summaries.map((summary, index) => `Summary ${index + 1}:\n${summary}`).join("\n\n"),
  ].filter(Boolean).join("\n");
}

function buildFullDocumentSynthesisPrompt({ question, history, documents, sliceSummaries, documentSummaries, schemaInstruction }) {
  const historyLines = (history || [])
    .slice(-16)
    .map((entry) => `[${entry.role === "assistant" ? "Assistant" : "User"}]: ${entry.content}`)
    .join("\n");
  const summaries = documentSummaries || sliceSummaries || [];

  return [
    historyLines ? `Conversation so far:\n${historyLines}` : "",
    `=== SELECTED DOCUMENTS ===\n${buildDocumentListHeader(documents)}`,
    schemaInstruction ? `=== EXTRACTION SCHEMA ===\n${schemaInstruction}` : "",
    "=== DOCUMENT-LEVEL SUMMARIES ===",
    summaries.map((summary, index) => `Document summary ${index + 1}:\n${summary}`).join("\n\n"),
    `=== USER REQUEST ===\n${question}`,
    "Answer from the summaries only. Compare documents explicitly when the request asks for comparison.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function postGeminiGenerateContent({
  apiKey,
  model,
  prompt,
  maxOutputTokens,
  systemInstruction,
  responseMimeType,
  responseJsonSchema,
}) {
  const attempts = 3;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await callGoogleGenAI({
        apiKey,
        model,
        prompt,
        maxOutputTokens,
        systemInstruction: systemInstruction || buildGeminiSystemInstruction(),
        responseMimeType,
        responseJsonSchema,
      });
    } catch (err) {
      const statusCode = getErrorStatusCode(err) || 500;
      const isLastAttempt = attempt === attempts - 1;

      if (!isLastAttempt && isRetryableModelError(err)) {
        const backoffMs = 1200 * (attempt + 1);
        console.warn(`[genai] ${model} request failed with ${statusCode}. Retrying in ${backoffMs}ms... (${attempt + 1}/${attempts - 1})`);
        await sleep(backoffMs);
        continue;
      }

      const error = new Error(`Google GenAI Node SDK error: ${err.message}`);
      error.statusCode = statusCode;
      error.cause = err;
      throw error;
    }
  }
}

function resolveGenerationTarget({ model: requestedModel, provider: requestedProvider }) {
  const provider = requestedProvider || getProviderForModel(requestedModel);
  const model = requestedModel
    || (provider === "google" ? process.env.GEMINI_MODEL : "")
    || getDefaultModelForProvider(provider)
    || config.DEFAULT_MODEL
    || "gemma-4-31b-it";

  return { model, provider };
}

async function postModelGenerateContent({
  provider = "google",
  apiKey,
  model,
  prompt,
  maxOutputTokens,
  systemInstruction,
  responseMimeType,
  responseJsonSchema,
}) {
  if (provider === "dashscope") {
    return callDashScopeChatCompletion({
      apiKey,
      model,
      prompt,
      maxOutputTokens,
      systemInstruction: withProviderSystemInstruction({ provider, model, systemInstruction }),
    });
  }

  return postGeminiGenerateContent({
    apiKey,
    model,
    prompt,
    maxOutputTokens,
    systemInstruction: withProviderSystemInstruction({ provider, model, systemInstruction }),
    responseMimeType,
    responseJsonSchema,
  });
}

async function generateGeminiAnswer({ apiKey, provider: requestedProvider, model: requestedModel, prompt, maxOutputTokens = 700, systemInstruction = buildGeminiSystemInstruction() }) {
  const { model, provider } = resolveGenerationTarget({ model: requestedModel, provider: requestedProvider });
  const payload = await postModelGenerateContent({
    provider,
    apiKey,
    model,
    prompt,
    maxOutputTokens,
    systemInstruction,
  });

  const rawText = extractGeminiText(payload);
  const answer = normalizeModelText(rawText);
  if (!answer) {
    const blockReason = payload?.promptFeedback?.blockReason;
    if (blockReason) {
      throw new Error(`${provider} blocked this request: ${blockReason}`);
    }

    throw new Error(`${provider} returned an empty answer for this request.`);
  }

  return answer;
}

async function generateStructuredGeminiAnswer({
  apiKey,
  provider: requestedProvider,
  model: requestedModel,
  prompt,
  maxOutputTokens = 700,
  systemInstruction = buildGeminiSystemInstruction(),
  useResponseSchema = true,
  usePromptJsonFallback = true,
}) {
  const { model, provider } = resolveGenerationTarget({ model: requestedModel, provider: requestedProvider });
  let payload;
  let rawText = "";
  let structured = null;

  if (useResponseSchema && !shouldSkipSchemaStructuredAttempt(model, provider)) {
    try {
      payload = await postModelGenerateContent({
        provider,
        apiKey,
        model,
        prompt,
        maxOutputTokens,
        systemInstruction: buildStructuredSystemInstruction(systemInstruction),
        responseMimeType: "application/json",
        responseJsonSchema: buildStructuredAnswerJsonSchema(),
      });

      rawText = extractGeminiText(payload);
      structured = parseStructuredAnswerPayload(rawText);
    } catch {}
  }

  if (!structured && usePromptJsonFallback) {
    try {
      payload = await postModelGenerateContent({
        provider,
        apiKey,
        model,
        prompt: buildStructuredAnswerPrompt(prompt),
        maxOutputTokens,
        systemInstruction: buildStructuredSystemInstruction(systemInstruction),
      });

      rawText = extractGeminiText(payload);
      structured = parseStructuredAnswerPayload(rawText);
    } catch {}
  }

  if (structured?.answer) {
    return {
      answer: structured.answer,
      structured,
      rawText,
    };
  }

  try {
    payload = await postModelGenerateContent({
      provider,
      apiKey,
      model,
      prompt,
      maxOutputTokens,
      systemInstruction,
    });

    rawText = extractGeminiText(payload);
    const answer = normalizeModelText(rawText);

    if (!answer) {
      const blockReason = payload?.promptFeedback?.blockReason;
      if (blockReason) {
        throw new Error(`${provider} blocked this request: ${blockReason}`);
      }

      throw new Error(`${provider} returned an empty answer for this request.`);
    }

    return {
      answer,
      structured,
      rawText,
    };
  } catch (err) {
    throw err;
  }
}

function buildChunkTitlePrompt(batch) {
  const previewLines = batch
    .map((chunk, idx) => `[${idx}] Current title: "${chunk.title}"\nContent preview:\n${chunk.text.slice(0, 320)}`)
    .join("\n\n");

  return [
    "Generate concise Vietnamese titles for these document chunks.",
    "Keep an existing title if it is already specific.",
    "Replace generic titles with something more specific.",
    "Return only a JSON array.",
    'Each item must have: {"index": number, "title": string}.',
    "",
    "Chunks:",
    previewLines,
  ].join("\n");
}

function parseChunkTitleResponse(answer) {
  const raw = String(answer || "").trim();
  if (!raw) {
    return null;
  }

  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function requestChunkTitles({ apiKey, model, batch }) {
  const payload = await postGeminiGenerateContent({
    apiKey,
    model,
    prompt: buildChunkTitlePrompt(batch),
    maxOutputTokens: 512,
    systemInstruction: "Return concise Vietnamese chunk titles. Return JSON only.",
  });

  const rawText = extractGeminiText(payload);
  return parseChunkTitleResponse(rawText);
}

async function applyChunkTitlesForBatch({ chunks, startIndex, apiKey, model }) {
  if (!chunks.length) {
    return;
  }

  try {
    const titles = await requestChunkTitles({ apiKey, model, batch: chunks });
    if (!titles) {
      throw new Error("Model returned invalid chunk title JSON.");
    }

    for (const item of titles) {
      const idx = typeof item.index === "number" ? item.index : null;
      const newTitle = typeof item.title === "string" ? item.title.trim() : null;
      if (idx !== null && newTitle && idx >= 0 && idx < chunks.length) {
        chunks[idx].title = newTitle;
      }
    }
    return;
  } catch (err) {
    if (chunks.length === 1) {
      return;
    }
  }

  const midpoint = Math.ceil(chunks.length / 2);
  await applyChunkTitlesForBatch({
    chunks: chunks.slice(0, midpoint),
    startIndex,
    apiKey,
    model,
  });
  await applyChunkTitlesForBatch({
    chunks: chunks.slice(midpoint),
    startIndex: startIndex + midpoint,
    apiKey,
    model,
  });
}

async function generateChunkTitles(chunks, apiKey) {
  if (!apiKey || !chunks.length) {
    return chunks;
  }

  const batchSize = 6;
  const model = process.env.GEMINI_MODEL || config.DEFAULT_MODEL || "gemma-4-31b-it";

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    await applyChunkTitlesForBatch({ chunks: batch, startIndex: i, apiKey, model });
  }

  return chunks;
}

module.exports = {
  buildGeminiSystemInstruction,
  buildFullDocumentSystemInstruction,
  buildDocumentSliceSystemInstruction,
  buildDocumentReduceSystemInstruction,
  buildRerankSystemInstruction,
  buildGeminiUserPrompt,
  buildDirectFullDocumentPrompt,
  buildDocumentSlicePrompt,
  buildDocumentSummaryPrompt,
  buildWholeDocumentSummaryPrompt,
  buildCompressedSummariesPrompt,
  buildFullDocumentSynthesisPrompt,
  generateGeminiAnswer,
  generateStructuredGeminiAnswer,
  generateChunkTitles,
  postGeminiGenerateContent,
  postModelGenerateContent,
  extractGeminiText,
  sanitizeModelAnswer,
  normalizeModelText,
};
