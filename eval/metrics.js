// Pure information-retrieval metrics for the RAG evaluation harness.
//
// All functions operate on a ranked list of document ids (best first) and a
// set of relevant document ids. The runner de-duplicates retrieved chunks to
// distinct documents before calling these, so the metrics are evaluated at the
// document level.

function toRelevantSet(relevant) {
  return relevant instanceof Set ? relevant : new Set(relevant || []);
}

function dedupePreserveOrder(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids || []) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// Fraction of relevant documents that appear within the top-k results.
function recallAtK(ranked, relevant, k) {
  const relevantSet = toRelevantSet(relevant);
  if (relevantSet.size === 0) {
    return 0;
  }
  const topK = (ranked || []).slice(0, k);
  let found = 0;
  for (const id of relevantSet) {
    if (topK.includes(id)) {
      found += 1;
    }
  }
  return found / relevantSet.size;
}

// Fraction of the top-k positions that are relevant.
function precisionAtK(ranked, relevant, k) {
  const relevantSet = toRelevantSet(relevant);
  if (k <= 0) {
    return 0;
  }
  const topK = (ranked || []).slice(0, k);
  const hits = topK.filter((id) => relevantSet.has(id)).length;
  return hits / k;
}

// 1 / rank of the first relevant document (0 if none retrieved).
function reciprocalRank(ranked, relevant) {
  const relevantSet = toRelevantSet(relevant);
  const list = ranked || [];
  for (let i = 0; i < list.length; i += 1) {
    if (relevantSet.has(list[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

// Normalized Discounted Cumulative Gain at k, with binary relevance.
function ndcgAtK(ranked, relevant, k) {
  const relevantSet = toRelevantSet(relevant);
  if (relevantSet.size === 0 || k <= 0) {
    return 0;
  }
  const topK = (ranked || []).slice(0, k);

  let dcg = 0;
  for (let i = 0; i < topK.length; i += 1) {
    if (relevantSet.has(topK[i])) {
      dcg += 1 / Math.log2(i + 2); // positions are 1-indexed: log2(rank + 1)
    }
  }

  const idealHits = Math.min(k, relevantSet.size);
  let idcg = 0;
  for (let i = 0; i < idealHits; i += 1) {
    idcg += 1 / Math.log2(i + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}

function mean(nums) {
  const list = (nums || []).filter((n) => Number.isFinite(n));
  if (!list.length) {
    return 0;
  }
  return list.reduce((sum, n) => sum + n, 0) / list.length;
}

module.exports = {
  dedupePreserveOrder,
  recallAtK,
  precisionAtK,
  reciprocalRank,
  ndcgAtK,
  mean,
};
