# llm-wiki

Document Q&A application powered by Google Gemini API with hybrid RAG retrieval.

## Features

- Upload files (`.txt`, `.md`, `.json`, `.csv`, `.tsv`, `.html`, `.xml`, `.docx`, source code) and convert to Markdown
- Upload `.md`/`.txt` files to the **wiki** folder (always included in context)
- Ask questions across all uploaded documents
- Answers grounded only in the provided context

## Retrieval Pipeline

The app combines **5 techniques** for accurate retrieval:

| # | Technique | Where | Purpose |
|---|---|---|---|
| 1 | **Hybrid search** | `db.js` | BM25 (full-text) + vector cosine similarity via LanceDB |
| 2 | **Contextual chunking** | `db.js` | Embed `"title: chunk_text"` so vectors carry section context |
| 3 | **Two-level retrieval** | `db.js` / `server.js` | Search by child chunk, return parent section to the LLM |
| 4 | **LLM-generated titles** | `server.js` | Gemini rewrites generic headings into specific topic descriptions |
| 5 | **Wiki context** | `server.js` | Static `.md` files always injected, no retrieval needed |

### How it works

```
Upload file
  → convertToMarkdown()
  → splitIntoChunks()          (heading-based, max 1200 chars/child, parent = full section)
  → generateChunkTitles()     (Gemini rewrites generic headings)
  → embed("title: text")      (contextual chunking)
  → insert into LanceDB       (BM25 + vector index)

Chat question
  → hybridSearch()            (BM25 + cosine, merge scored 0.6/0.4)
  → return parentContent      (two-level: search child, serve parent)
  → + wiki context            (always included)
  → send to Gemini
```

## Architecture

```
server.js          HTTP server, upload/chat/reindex/wiki APIs, chunking, Gemini prompt
db.js              LanceDB: hybrid search (BM25 + vector), indexing, FTS
embedding.js       Gemini embedding API (gemini-embedding-001, 768-dim)
config.js          Token budgets, paths, model config
wiki/default/      Static knowledge base (.md files, always in context)
data/documents/    Uploaded documents (Markdown, indexed into LanceDB)
data/lancedb/       LanceDB storage (vector + FTS indexes)
public/            Frontend (HTML + CSS + vanilla JS)
```

## Run locally

1. Copy `.env.example` to `.env` and set `GEMINI_API_KEY`.
2. Start the app:

```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000).
4. Optionally paste your Gemini API key in the UI settings.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/upload` | POST | Upload a file → convert to Markdown → chunk → embed → index |
| `/api/chat` | POST | Ask a question → hybrid search → Gemini answer |
| `/api/documents` | GET | List all uploaded documents |
| `/api/reindex` | POST | Re-index all documents (delete old + rebuild) |
| `/api/wiki-upload` | POST | Upload .md/.txt to wiki folder (always in context) |
| `/api/wiki-list` | GET | List wiki files |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | — | Required. Get from [Google AI Studio](https://aistudio.google.com/) |
| `GEMINI_MODEL` | `gemma-4-31b-it` | Gemini model for chat |
| `PORT` | `3000` | Server port |

## Auto-Indexing

On startup, the app checks for documents in `data/documents/` that haven't been embedded yet and indexes them automatically. This requires `GEMINI_API_KEY` to be set.

## Notes

- LanceDB is used for hybrid search (BM25 + vector). Vector index requires 256+ rows; below that, flat search is used.
- Wiki files are injected directly into every prompt (up to 30K tokens). Document chunks are retrieved via RAG (top 5).
- The app uses Gemini's `generateContent` REST API with structured JSON output.
- `data/` is gitignored; each person keeps their own local document library.