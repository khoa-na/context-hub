const config = require("./config");

async function getGeminiEmbedding(text, apiKey, taskType = "RETRIEVAL_DOCUMENT", retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${config.GEMINI_EMBEDDING_MODEL}`,
          content: { parts: [{ text: text }] },
          taskType,
          outputDimensionality: 768,
        }),
      }
    );

    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { raw };
    }

    if (response.status === 429 && attempt < retries) {
      const retryAfter = 30 + Math.random() * 5;
      console.log(`[embed] Rate limited (429), retrying in ${retryAfter.toFixed(1)}s... (attempt ${attempt + 1}/${retries})`);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    if (!response.ok) {
      const message = payload?.error?.message || payload?.raw || "Embedding request failed.";
      throw new Error(`Gemini Embedding API error (${response.status}): ${message}`);
    }

    const values = payload?.embedding?.values;
    if (!values || !values.length) {
      throw new Error("No embedding values returned from Gemini API.");
    }

    return values;
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