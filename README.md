# context-hub

Document Q&A app powered by Google Gemini, LanceDB, and a small vanilla JS UI.

## Features

- Upload files (`.txt`, `.md`, `.json`, `.csv`, `.tsv`, `.html`, `.xml`, `.docx`, source code) and convert them to Markdown
- Upload `.md` / `.txt` files into `wiki/default/` as always-on context
- Retrieval modes: `hybrid`, `semantic`, `bm25`
- Parent-child retrieval: search on child chunks, answer with parent section context
- Gemini-generated chunk titles for better contextual embeddings
- Retrieval-only debug mode via `/api/search`
- Optional Jina rerank in debug mode
- Save Gemini and Jina API keys from the UI into `.env`
- LAN-friendly startup logging when the server is bound outside localhost

## Retrieval Pipeline

The app combines multiple retrieval techniques:

| Technique | Where | Purpose |
|---|---|---|
| Hybrid retrieval | `db.js` | Combine BM25 and semantic candidates |
| RRF merging | `db.js` | Merge BM25 and semantic ranks with Reciprocal Rank Fusion |
| Contextual chunking | `db.js` | Embed `title: chunk_text` so vectors carry section context |
| Parent-child retrieval | `db.js` / `server.js` | Search by child chunk, return parent section to the LLM |
| Gemini title rewriting | `server.js` | Replace generic headings with more specific chunk titles |
| Wiki injection | `server.js` | Always include static wiki Markdown in final context |
| Optional rerank | `rerank.js` / `server.js` | Reorder retrieved chunks with Jina in debug mode |

### Indexing flow

```text
Upload file
  -> convert to Markdown
  -> split into parent sections and child chunks
  -> optionally rewrite chunk titles with Gemini
  -> embed "title: child_text"
  -> store in LanceDB
  -> create FTS + vector indexes
```

### Chat flow

```text
Question
  -> retrieve with hybrid / semantic / bm25
  -> return parent section context for matched child chunks
  -> add wiki/default/*.md context
  -> truncate context to token budget
  -> send prompt to Gemini
```

### Debug retrieval flow

```text
Question
  -> /api/search
  -> retrieve with hybrid / semantic / bm25
  -> optionally rerank with Jina
  -> return ranked chunks without calling the chat model
```

## Architecture

```text
server.js                  HTTP server, APIs, chunking, prompt assembly, key persistence
db.js                      LanceDB indexing and retrieval (BM25, semantic, hybrid RRF)
embedding.js               Gemini embedding API client
rerank.js                  Jina rerank adapter for debug mode
config.js                  Token budgets and retrieval config
public/                    Frontend (HTML, CSS, vanilla JS)
wiki/default/              Static Markdown always injected into prompts
data/documents/            Uploaded Markdown files
data/lancedb/              LanceDB storage
data/index.json            Local document metadata registry
```

## Run Locally

1. Create a `.env` file in the project root.
2. Add the variables you need:

```env
GEMINI_API_KEY=your_gemini_key
JINA_API_KEY=your_jina_key
GEMINI_MODEL=gemma-4-31b-it
PORT=3000
HOST=0.0.0.0
```

3. Install dependencies:

```bash
npm install
```

4. Start the server:

```bash
npm start
```

5. Open `http://localhost:3000`.

If `HOST=0.0.0.0`, startup logs will also print LAN URLs such as `http://192.168.x.x:3000`.

## UI Notes

- If you paste a key into the UI and do not save it, it is only used in your current browser session.
- If you press `Save to .env`, the key becomes server-wide and persists across restarts.
- `Debug retrieval only` uses `/api/search` and does not call the chat generation model.
- `Rerank with Jina` currently applies only in debug mode.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/upload` | POST | Upload a file, convert to Markdown, chunk it, and optionally index it |
| `/api/chat` | POST | Retrieve context and ask Gemini for an answer |
| `/api/search` | POST | Retrieval-only debug endpoint with optional Jina rerank |
| `/api/documents` | GET | List uploaded document metadata |
| `/api/documents/:id` | DELETE | Delete a document and remove its indexed chunks |
| `/api/wiki-upload` | POST | Upload a `.md` / `.txt` file into `wiki/default/` |
| `/api/wiki-list` | GET | List wiki files |
| `/api/reindex` | POST | Re-index all documents |
| `/api/save-key` | POST | Save `GEMINI_API_KEY` into `.env` |
| `/api/save-jina-key` | POST | Save `JINA_API_KEY` into `.env` |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | — | Required for semantic retrieval, indexing, and chat generation |
| `JINA_API_KEY` | — | Optional. Required only for Jina rerank |
| `GEMINI_MODEL` | `gemma-4-31b-it` | Chat model used in `/api/chat` |
| `JINA_RERANK_MODEL` | `jina-reranker-v2-base-multilingual` | Jina rerank model |
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` for local-only access |
| `RERANK_CANDIDATES` | `12` | Number of initial candidates fetched before rerank |

## Notes

- Semantic and hybrid retrieval require Gemini embeddings.
- BM25 mode can work without Gemini embeddings, but chat still needs Gemini for final answer generation.
- Wiki files are injected directly into the prompt and are not returned by `/api/search`.
- Jina rerank currently runs on top of retrieved child chunks and returns reordered parent-section results.
- `data/index.json` is local metadata and may change during testing; document content and LanceDB storage stay local on each machine.
- The repo includes `so-tay-tram-khi-tuong-bien-sau.md` as a long retrieval test document outside `data/`.
