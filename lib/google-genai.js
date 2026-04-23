const { GoogleGenAI } = require("@google/genai");

const clientCache = new Map();

function normalizeApiKey(apiKey) {
  return String(apiKey || "").trim();
}

function getGoogleGenAI(apiKey) {
  const normalizedApiKey = normalizeApiKey(apiKey);
  if (!normalizedApiKey) {
    throw new Error("Missing Gemini API key.");
  }

  if (!clientCache.has(normalizedApiKey)) {
    clientCache.set(
      normalizedApiKey,
      new GoogleGenAI({
        apiKey: normalizedApiKey,
        apiVersion: "v1beta",
      })
    );
  }

  return clientCache.get(normalizedApiKey);
}

function getGoogleErrorStatus(error) {
  return error?.status || error?.statusCode || error?.cause?.status || null;
}

function getGoogleErrorMessage(error, fallback = "Google GenAI request failed.") {
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error?.cause?.message === "string" && error.cause.message.trim()) {
    return error.cause.message.trim();
  }

  return fallback;
}

module.exports = {
  getGoogleGenAI,
  getGoogleErrorStatus,
  getGoogleErrorMessage,
};
