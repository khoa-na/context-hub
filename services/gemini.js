const config = require("../config");
const { getGoogleGenAI, getGoogleErrorStatus, getGoogleErrorMessage } = require("../lib/google-genai");
const { callPythonGenAI } = require("../lib/python-genai-bridge");

function shouldUsePythonGenAI(model) {
  const transport = String(process.env.GOOGLE_GENAI_TRANSPORT || "auto").trim().toLowerCase();
  if (transport === "python") {
    return true;
  }

  if (transport === "node" || transport === "js" || transport === "javascript") {
    return false;
  }

  return model === "gemma-4-26b-a4b-it" || model === "gemma-4-31b-it";
}

function shouldSkipSchemaStructuredAttempt(model) {
  return model === "gemma-4-26b-a4b-it";
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

function buildDocumentSliceSystemInstruction() {
  return [
    "Summarize only the supplied slice.",
    "Use only information in the slice.",
    "Be concise.",
    "Use the same language as the user.",
  ].join("\n");
}

function buildGeminiUserPrompt({ question, contextText, history }) {
  const historyLines = (history || [])
    .slice(-4)
    .map((entry) => `${entry.role === "assistant" ? "Assistant" : "User"}: ${entry.content}`)
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

function buildDirectFullDocumentPrompt({ question, history, documents }) {
  const historyLines = (history || [])
    .slice(-4)
    .map((entry) => `${entry.role === "assistant" ? "Assistant" : "User"}: ${entry.content}`)
    .join("\n");

  return [
    historyLines ? `Conversation so far:\n${historyLines}` : "",
    `=== SELECTED DOCUMENTS ===\n${buildDocumentListHeader(documents)}`,
    `=== FULL DOCUMENT MARKDOWN ===\n${buildDocumentsMarkdownBlock(documents)}`,
    `=== USER REQUEST ===\n${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildDocumentSlicePrompt({ question, documents, sliceText, sliceIndex, totalSlices }) {
  return [
    "Selected documents:",
    buildDocumentListHeader(documents),
    `Slice ${sliceIndex} of ${totalSlices}`,
    `User request: ${question}`,
    "Summarize this slice for later whole-document synthesis.",
    `=== DOCUMENT SLICE ===\n${sliceText}`,
  ].join("\n\n");
}

function buildFullDocumentSynthesisPrompt({ question, history, documents, sliceSummaries }) {
  const historyLines = (history || [])
    .slice(-4)
    .map((entry) => `${entry.role === "assistant" ? "Assistant" : "User"}: ${entry.content}`)
    .join("\n");

  return [
    historyLines ? `Conversation so far:\n${historyLines}` : "",
    `=== SELECTED DOCUMENTS ===\n${buildDocumentListHeader(documents)}`,
    "=== WHOLE-DOCUMENT SLICE SUMMARIES ===",
    sliceSummaries.map((summary, index) => `Slice ${index + 1}:\n${summary}`).join("\n\n"),
    `=== USER REQUEST ===\n${question}`,
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
  if (shouldUsePythonGenAI(model)) {
    try {
      return await callPythonGenAI({
        apiKey,
        model,
        prompt,
        maxOutputTokens,
        systemInstruction: systemInstruction || buildGeminiSystemInstruction(),
        responseMimeType,
        responseJsonSchema,
      });
    } catch (err) {
      const error = new Error(`Python Gemini SDK error: ${err.message}`);
      error.statusCode = 500;
      error.cause = err;
      throw error;
    }
  }

  const ai = getGoogleGenAI(apiKey);

  try {
    const requestConfig = {
      systemInstruction: systemInstruction || buildGeminiSystemInstruction(),
      maxOutputTokens,
      temperature: 0.2,
    };

    if (responseMimeType) {
      requestConfig.responseMimeType = responseMimeType;
    }

    if (responseJsonSchema) {
      requestConfig.responseJsonSchema = responseJsonSchema;
    }

    return await ai.models.generateContent({
      model,
      contents: prompt,
      config: requestConfig,
    });
  } catch (err) {
    const status = getGoogleErrorStatus(err);
    const message = getGoogleErrorMessage(err, "Gemini request failed.");
    const error = new Error(status ? `Gemini API error (${status}): ${message}` : `Gemini API error: ${message}`);
    error.statusCode = status || 500;
    error.cause = err;
    throw error;
  }
}

async function generateGeminiAnswer({ apiKey, model: requestedModel, prompt, maxOutputTokens = 700, systemInstruction = buildGeminiSystemInstruction() }) {
  const model = requestedModel || process.env.GEMINI_MODEL || config.DEFAULT_MODEL || "gemma-4-31b-it";
  const payload = await postGeminiGenerateContent({
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
      throw new Error(`Gemini blocked this request: ${blockReason}`);
    }

    throw new Error("Gemini returned an empty answer for this request.");
  }

  return answer;
}

async function generateStructuredGeminiAnswer({ apiKey, model: requestedModel, prompt, maxOutputTokens = 700, systemInstruction = buildGeminiSystemInstruction() }) {
  const model = requestedModel || process.env.GEMINI_MODEL || config.DEFAULT_MODEL || "gemma-4-31b-it";
  let payload;
  let rawText = "";
  let structured = null;

  if (!shouldSkipSchemaStructuredAttempt(model)) {
    try {
      payload = await postGeminiGenerateContent({
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

  if (!structured) {
    try {
      payload = await postGeminiGenerateContent({
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
    payload = await postGeminiGenerateContent({
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
        throw new Error(`Gemini blocked this request: ${blockReason}`);
      }

      throw new Error("Gemini returned an empty answer for this request.");
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

async function generateChunkTitles(chunks, apiKey) {
  if (!apiKey || !chunks.length) {
    return chunks;
  }

  const batchSize = 10;
  const model = process.env.GEMINI_MODEL || config.DEFAULT_MODEL || "gemma-4-31b-it";

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const previewLines = batch.map((chunk, idx) => `[${idx}] Title: "${chunk.title}"\nContent:\n${chunk.text.slice(0, 400)}`).join("\n\n");

    const prompt = [
      "Below are text chunks from a document. Each has a current title (extracted from headings, may be generic like 'Overview').",
      "Generate a concise Vietnamese title (5-10 words) for EACH chunk that captures its SPECIFIC topic.",
      "If the existing title is already specific and accurate, keep it.",
      "If the existing title is generic (e.g. 'Overview') or missing context, replace it.",
      "Return a JSON array of objects with fields: index (number, relative to this batch starting at 0) and title (string).",
      "Return ONLY the JSON array, no other text.",
      "",
      "Chunks:",
      previewLines,
    ].join("\n");

    try {
      const payload = await postGeminiGenerateContent({
        apiKey,
        model,
        prompt,
        maxOutputTokens: 1024,
      });

      const rawText = extractGeminiText(payload);
      const answer = rawText;

      let titles;
      try {
        const jsonMatch = answer.match(/\[[\s\S]*\]/);
        titles = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(answer);
      } catch {
        continue;
      }

      if (!Array.isArray(titles)) {
        continue;
      }

      for (const item of titles) {
        const idx = typeof item.index === "number" ? item.index : null;
        const newTitle = typeof item.title === "string" ? item.title.trim() : null;
        if (idx !== null && newTitle && i + idx < chunks.length) {
          chunks[i + idx].title = newTitle;
        }
      }
    } catch (err) {
      console.error("Chunk title generation failed:", err.message);
    }
  }

  return chunks;
}

module.exports = {
  buildGeminiSystemInstruction,
  buildFullDocumentSystemInstruction,
  buildDocumentSliceSystemInstruction,
  buildGeminiUserPrompt,
  buildDirectFullDocumentPrompt,
  buildDocumentSlicePrompt,
  buildFullDocumentSynthesisPrompt,
  generateGeminiAnswer,
  generateStructuredGeminiAnswer,
  generateChunkTitles,
  postGeminiGenerateContent,
  extractGeminiText,
  sanitizeModelAnswer,
  normalizeModelText,
};
