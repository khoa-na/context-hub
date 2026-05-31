# RAG retrieval evaluation harness

Measures **retrieval quality** for the document Q&A pipeline instead of relying on
spot-checking answers. It exercises the real retrieval code (`db.js` →
`services/chat.js`) so the numbers reflect the actual system.

## Run it

```bash
npm run eval   # from the repo root; requires GEMINI_API_KEY for embeddings
```

What it does:

1. Reads `LANCEDB_DIR` from the environment and points it at an **isolated**
   index (`eval/.eval-lancedb/`) so the app's real data is never touched.
2. Indexes the four sample quarterly reports (chunk titles are skipped to keep
   the run deterministic and free of extra LLM calls).
3. Runs every question in `dataset.json` through `bm25`, `semantic`, and
   `hybrid` retrieval.
4. Computes document-level metrics, prints a summary, and writes `results.md`.

## Files

| File | Purpose |
|---|---|
| `dataset.json` | Corpus definition + golden question set (each question is labelled with the report that contains the answer). |
| `metrics.js` | Pure IR metrics: Recall@k, Precision@k, MRR, nDCG@k. Unit-tested in `test/eval-metrics.test.js`. |
| `run.js` | Indexes the corpus, runs each mode, and reports the metrics. |
| `results.md` | Generated report from the latest run. |

## Metrics

Results are scored at the **document level** — a retrieved chunk counts as a hit
when it comes from the report labelled relevant for that question. Retrieved
chunks are de-duplicated to distinct documents before scoring.

- **Recall@1 / Recall@3** — is the correct report ranked first / within the top 3?
- **MRR** — mean reciprocal rank of the correct report.
- **nDCG@3** — rank-discounted gain over the top 3 distinct documents.

## Extending it

Add documents to `corpus` and questions to `questions` in `dataset.json` (label
each question with the `docId`(s) that answer it). The harness is corpus-driven,
so no code changes are needed.
