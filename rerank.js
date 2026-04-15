const DEFAULT_JINA_MODEL = process.env.JINA_RERANK_MODEL || "jina-reranker-v2-base-multilingual";

function buildJinaDocument(chunk) {
  const parts = [];
  if (chunk.title) {
    parts.push(`Title: ${chunk.title}`);
  }
  if (chunk.childContent) {
    parts.push(`Matched passage:\n${chunk.childContent.slice(0, 800)}`);
  } else if (chunk.content) {
    parts.push(`Section:\n${chunk.content.slice(0, 800)}`);
  }
  return parts.join("\n\n");
}

async function rerankWithJina({ query, chunks, apiKey, topK = 5, model = DEFAULT_JINA_MODEL }) {
  if (!apiKey) {
    throw new Error("Missing JINA_API_KEY for reranking.");
  }

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return [];
  }

  const response = await fetch("https://api.jina.ai/v1/rerank", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      query,
      top_n: Math.min(topK, chunks.length),
      documents: chunks.map(buildJinaDocument),
    }),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {}

  if (!response.ok) {
    const message = payload?.detail || payload?.message || payload?.error || "Jina rerank request failed.";
    throw new Error(`Jina API error (${response.status}): ${message}`);
  }

  const results = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.data) ? payload.data : [];
  const ranked = [];

  for (let i = 0; i < results.length; i += 1) {
    const item = results[i] || {};
    const index = Number.isInteger(item.index) ? item.index : null;
    if (index === null || !chunks[index]) {
      continue;
    }

    const chunk = chunks[index];
    ranked.push({
      ...chunk,
      score: typeof item.relevance_score === "number" ? item.relevance_score : chunk.score,
      retrieval: {
        ...(chunk.retrieval || {}),
        rerankRank: i + 1,
        rerankScore: typeof item.relevance_score === "number" ? item.relevance_score : null,
        rerankProvider: "jina",
      },
    });
  }

  if (!ranked.length) {
    throw new Error("Jina rerank returned no usable ranking results.");
  }

  return ranked;
}

module.exports = {
  rerankWithJina,
};
