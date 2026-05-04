const { GoogleGenAI } = require("@google/genai");

const DEFAULT_TIMEOUT_MS = 90000;

function getErrorStatusCode(error) {
  const directStatus = Number(error?.status);
  if (Number.isFinite(directStatus) && directStatus > 0) {
    return directStatus;
  }

  const statusCode = Number(error?.statusCode);
  if (Number.isFinite(statusCode) && statusCode > 0) {
    return statusCode;
  }

  const causeStatus = Number(error?.cause?.status || error?.cause?.statusCode);
  if (Number.isFinite(causeStatus) && causeStatus > 0) {
    return causeStatus;
  }

  const message = String(error?.message || error?.cause?.message || "");
  const match = message.match(/\b(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function wrapGenAIError(error, fallbackMessage) {
  const wrapped = new Error(error?.message || fallbackMessage);
  wrapped.statusCode = getErrorStatusCode(error);
  wrapped.cause = error;
  throw wrapped;
}

function getClient(apiKey) {
  return new GoogleGenAI({ apiKey });
}

function buildGenerateConfig({ maxOutputTokens, systemInstruction, responseMimeType, responseJsonSchema }) {
  const config = {
    temperature: 0.2,
  };

  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  if (maxOutputTokens) {
    config.maxOutputTokens = maxOutputTokens;
  }

  if (responseMimeType) {
    config.responseMimeType = responseMimeType;
  }

  if (responseJsonSchema) {
    config.responseSchema = responseJsonSchema;
  }

  return config;
}

async function callGoogleGenAI({
  apiKey,
  model,
  prompt,
  maxOutputTokens,
  systemInstruction,
  responseMimeType,
  responseJsonSchema,
  timeoutMs = Number(process.env.GOOGLE_GENAI_NODE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
}) {
  try {
    const response = await withTimeout(
      getClient(apiKey).models.generateContent({
        model,
        contents: prompt,
        config: buildGenerateConfig({
          maxOutputTokens,
          systemInstruction,
          responseMimeType,
          responseJsonSchema,
        }),
      }),
      timeoutMs,
      "Google GenAI Node SDK generateContent"
    );

    return {
      text: response?.text || "",
      candidates: response?.candidates || [],
      promptFeedback: response?.promptFeedback,
      usageMetadata: response?.usageMetadata,
      nodeSdk: true,
    };
  } catch (error) {
    wrapGenAIError(error, "Google GenAI Node SDK generateContent failed.");
  }
}

async function* callGoogleGenAIStream({
  apiKey,
  model,
  prompt,
  maxOutputTokens,
  systemInstruction,
}) {
  try {
    const stream = await getClient(apiKey).models.generateContentStream({
      model,
      contents: prompt,
      config: buildGenerateConfig({ maxOutputTokens, systemInstruction }),
    });
    for await (const chunk of stream) {
      const text = chunk.text || "";
      if (text) yield text;
    }
  } catch (error) {
    wrapGenAIError(error, "Google GenAI Node SDK generateContentStream failed.");
  }
}

async function callGoogleGenAIEmbed({
  apiKey,
  model,
  contents,
  taskType,
  outputDimensionality,
  timeoutMs = Number(process.env.GOOGLE_GENAI_NODE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
}) {
  const config = {};
  if (taskType) {
    config.taskType = taskType;
  }
  if (outputDimensionality) {
    config.outputDimensionality = outputDimensionality;
  }

  try {
    const response = await withTimeout(
      getClient(apiKey).models.embedContent({
        model,
        contents,
        config,
      }),
      timeoutMs,
      "Google GenAI Node SDK embedContent"
    );

    return {
      embeddings: (response?.embeddings || []).map((embedding) => embedding?.values || []),
      metadata: response?.metadata,
      nodeSdk: true,
    };
  } catch (error) {
    wrapGenAIError(error, "Google GenAI Node SDK embedContent failed.");
  }
}

module.exports = {
  callGoogleGenAI,
  callGoogleGenAIStream,
  callGoogleGenAIEmbed,
};
