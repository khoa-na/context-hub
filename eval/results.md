# RAG Retrieval Evaluation

_Generated: 2026-05-31T11:07:40.238Z_

Corpus: 4 documents (72 chunks) · Questions: 24 · top-k: 10

Document-level retrieval quality per mode (higher is better):

| Mode | Recall@1 | Recall@3 | MRR | nDCG@3 |
|---|---:|---:|---:|---:|
| bm25 | 0.625 | 0.917 | 0.764 | 0.787 |
| semantic | 0.792 | 1.000 | 0.889 | 0.918 |
| hybrid | 0.833 | 1.000 | 0.903 | 0.928 |

- **Recall@1** — fraction of questions whose top-ranked document is the correct quarterly report.
- **Recall@3** — the correct report appears within the top 3 distinct documents.
- **MRR** — mean reciprocal rank of the correct report.
- **nDCG@3** — rank-discounted gain over the top 3 distinct documents.

> Corpus: the four Northstar quarterly reports. They share an identical structure and terminology and differ mainly in their numbers, so disambiguating the correct quarter is a genuine ranking challenge. Regenerate with `npm run eval`.
