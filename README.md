# context-hub

Document Q&A app powered by Google Gemini, LanceDB, and a small vanilla JS UI.

This branch includes:
- modularized server-side code (`handlers/`, `services/`, `lib/`)
- retrieval-based Q&A across uploaded documents
- full-document mode for one or more selected documents

## Features

- Upload files (`.txt`, `.md`, `.json`, `.csv`, `.tsv`, `.html`, `.xml`, `.docx`, source code) and convert them to Markdown
- Upload `.md` / `.txt` files into `wiki/default/` as always-on context
- Retrieval modes: `hybrid`, `semantic`, `bm25`
- Parent-child retrieval: search on child chunks, answer with parent section context
- Gemini-generated chunk titles for better contextual embeddings
- Full-document mode for up to 5 selected documents at a time
- Chat model selector with Gemini and DashScope/Qwen options
- Retrieval-only debug mode via `/api/search`
- Save Gemini and DashScope API keys from the UI into `.env`
- LAN-friendly startup logging when the server is bound outside localhost

## Core Flows

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

### Retrieval Q&A flow

```text
Question
  -> retrieve with hybrid / semantic / bm25
  -> return parent section context for matched child chunks
  -> add wiki/default/*.md context
  -> truncate context to token budget
  -> send prompt to Gemini
```

### Full-document flow

```text
Question + selected documents
  -> load full Markdown for selected docs
  -> if content fits budget, send directly to Gemini
  -> otherwise split into slices
  -> summarize each slice
  -> synthesize a final whole-document answer
```

### Debug retrieval flow

```text
Question
  -> /api/search
  -> retrieve with hybrid / semantic / bm25
  -> return ranked chunks without calling the chat model
```

## Architecture

The app is now split by responsibility instead of keeping most logic inside one server file.

```text
server.js                  HTTP bootstrap, static serving, routing
handlers/api.js            HTTP handlers for upload, chat, search, wiki, reindex
services/chat.js           Retrieval Q&A and full-document orchestration
services/gemini.js         Prompt builders and Gemini client calls
services/indexing.js       Document indexing and reindexing workflow
db.js                      LanceDB indexing and retrieval (BM25, semantic, hybrid RRF)
embedding.js               Gemini embedding API client
lib/markdown.js            File-to-Markdown conversion helpers
lib/chunking.js            Chunking and document section slicing
lib/storage.js             Local metadata, wiki loading, env persistence
lib/session.js             Cookie-backed session history storage
lib/http.js                JSON/body parsing helpers
lib/uploads.js             Multipart upload parsing
config.js                  Retrieval budgets, embedding settings, local paths
constants.js               Paths, MIME types, upload/session constants
public/                    Frontend (HTML, CSS, vanilla JS)
wiki/default/              Static Markdown always injected into prompts
data/documents/            Uploaded Markdown files
data/lancedb/              LanceDB storage
data/index.json            Local document metadata registry
data/sessions/             Session history JSON files
```

## Retrieval Notes

| Technique | Where | Purpose |
|---|---|---|
| Hybrid retrieval | `db.js` | Combine BM25 and semantic candidates |
| RRF merging | `db.js` | Merge BM25 and semantic ranks with Reciprocal Rank Fusion |
| Contextual chunking | `db.js` | Embed `title: chunk_text` so vectors carry section context |
| Parent-child retrieval | `db.js` / `services/chat.js` | Search by child chunk, answer with parent section context |
| Gemini title rewriting | `services/gemini.js` | Replace generic headings with more specific chunk titles |
| Wiki injection | `lib/storage.js` / `services/chat.js` | Always include static wiki Markdown in final context |

## Run Locally

1. Create a `.env` file in the project root.
2. Add the variables you need:

```env
GEMINI_API_KEY=your_gemini_key
DASHSCOPE_API_KEY=your_dashscope_key
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

## UI Modes

### Q&A

- Uses retrieval over indexed chunks
- Returns cited answers grounded in retrieved context

### Full document

- Works on selected uploaded documents instead of retrieval hits
- Useful for summaries, synthesis, and cross-document analysis
- Current server-side limit: 5 selected documents

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/upload` | POST | Upload a file, convert to Markdown, and optionally index it |
| `/api/chat` | POST | Retrieval Q&A or full-document answer generation |
| `/api/search` | POST | Retrieval-only debug endpoint |
| `/api/documents` | GET | List uploaded document metadata |
| `/api/documents/:id` | DELETE | Delete a document and remove its indexed chunks |
| `/api/wiki-upload` | POST | Upload a `.md` / `.txt` file into `wiki/default/` |
| `/api/wiki-list` | GET | List wiki files |
| `/api/reindex` | POST | Re-index all documents |
| `/api/models` | GET | Return the configured chat-model options |
| `/api/save-key` | POST | Save provider API keys into `.env` |
| `/api/session/reset` | POST | Start a fresh local chat session |

## Example Request Shapes

### `/api/chat`

```json
{
  "question": "Tom tat cac rui ro chinh",
  "apiKey": "your-gemini-key",
  "apiKeys": {
    "google": "your-gemini-key",
    "dashscope": "your-dashscope-key"
  },
  "chatMode": "full-document",
  "documentIds": ["doc-a", "doc-b"],
  "retrievalMode": "hybrid"
}
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | — | Required for semantic retrieval, indexing, and chat generation |
| `DASHSCOPE_API_KEY` | — | Required for DashScope/Qwen chat generation |
| `DASHSCOPE_BASE_URL` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | Optional DashScope OpenAI-compatible base URL override |
| `GEMINI_MODEL` | `gemma-4-31b-it` | Default answer-generation model used by `services/gemini.js` |
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` for local-only access |

Code-level config in `config.js`:
- `WIKI_TOKEN_BUDGET`
- `RAG_TOKEN_BUDGET`
- `MODELS`
- `DEFAULT_MODEL`
- embedding settings and paths

## Notes

- Semantic and hybrid retrieval require Gemini embeddings.
- BM25 mode can work without Gemini embeddings, but answer generation still needs Gemini.
- Wiki files are injected directly into prompts and are not returned by `/api/search`.
- Full-document mode falls back to slice-and-synthesize when selected content exceeds the token budget.
- `data/index.json` is local metadata and may change during testing; document content and LanceDB storage stay local on each machine.
- The repo currently has no automated test suite wired into `package.json`.
