const config = require("./config");
const { getGoogleGenAI, getGoogleErrorStatus, getGoogleErrorMessage } = require("./lib/google-genai");

async function getGeminiEmbedding(text, apiKey, taskType = "RETRIEVAL_DOCUMENT", retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ai = getGoogleGenAI(apiKey);

    try {
      const response = await ai.models.embedContent({
        model: config.GEMINI_EMBEDDING_MODEL,
        contents: text,
        config: {
          taskType,
          outputDimensionality: config.EMBEDDING_DIMENSION || 768,
        },
      });

      const values = response?.embeddings?.[0]?.values;
      if (!values || !values.length) {
        throw new Error("No embedding values returned from Google GenAI SDK.");
      }

      return values;
    } catch (err) {
      const status = getGoogleErrorStatus(err);
      if (status === 429 && attempt < retries) {
        const retryAfter = 30 + Math.random() * 5;
        console.log(`[embed] Rate limited (429), retrying in ${retryAfter.toFixed(1)}s... (attempt ${attempt + 1}/${retries})`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      const message = getGoogleErrorMessage(err, "Embedding request failed.");
      throw new Error(status ? `Gemini Embedding API error (${status}): ${message}` : `Gemini Embedding API error: ${message}`);
    }
  }

  throw new Error("Gemini Embedding API: max retries exceeded for rate limit.");
}

async function getGeminiEmbeddingBatch(texts, apiKey, taskType = "RETRIEVAL_DOCUMENT") {
  const results = [];
  const { EMBEDDING_BATCH_SIZE: batchSize, EMBEDDING_BATCH_DELAY_MS: delay } = config;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((text) => getGeminiEmbedding(text, apiKey, taskType))
    );
    results.push(...batchResults);

    if (i + batchSize < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return results;
}

module.exports = { getGeminiEmbedding, getGeminiEmbeddingBatch };
