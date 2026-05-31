# context-hub

[![CI](https://github.com/khoa-na/context-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/khoa-na/context-hub/actions/workflows/ci.yml)

Document Q&A app powered by Gemini, DashScope/Qwen, LanceDB, and a small vanilla JS UI.

This branch includes:
- modularized server-side code (`handlers/`, `services/`, `lib/`)
- retrieval-based Q&A across uploaded documents
- full-document mode for one or more selected documents
- session-scoped web page import and Q&A
- streaming Q&A responses for the default retrieval chat mode

## Features

- Upload one or more files (`.txt`, `.md`, `.json`, `.csv`, `.tsv`, `.html`, `.xml`, `.docx`, source code) and convert them to Markdown
- Upload `.md` / `.txt` files into `wiki/default/` as always-on context
- Retrieval modes: `hybrid`, `semantic`, `bm25`
- Parent-child retrieval: search on child chunks, answer with parent section context
- Gemini-generated chunk titles for better contextual embeddings
- Model-assisted reranking over retrieved chunks before final answer generation
- Full-document mode for up to 5 selected documents at a time
- Full-document and web-page answers can return structured payloads with citations and follow-up questions
- Schema-aware synthesis presets for financial, operational, risk, and generic report questions
- Chat model selector with Gemini and DashScope/Qwen options
- Paste one or more public web page URLs, render them with Chromium, then ask about selected pages in Web pages mode with fast, automatic, or full-scan reading
- Cookie-backed local sessions with preserved chat history and session web pages
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
  -> rerank retrieved chunks with the selected chat model
  -> return parent section context for matched child chunks
  -> add wiki/default/*.md context
  -> truncate context to token budget
  -> send prompt to the selected Gemini or DashScope/Qwen chat model
```

### Full-document flow

```text
Question + selected documents
  -> select a schema focus preset from the question
  -> load full Markdown for selected docs
  -> if content fits budget, send directly to the selected chat model
  -> otherwise split into slices
  -> summarize each slice
  -> synthesize a final whole-document answer
```

### Web pages flow

```text
Public URLs
  -> validate as public http/https URLs
  -> render with Playwright/Chromium
  -> extract readable Markdown
  -> save under the current session
  -> answer over selected pages with fast, automatic, or full-scan reading
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
services/gemini.js         Prompt builders and chat model generation calls
services/indexing.js       Document indexing and reindexing workflow
db.js                      LanceDB indexing and retrieval (BM25, semantic, hybrid RRF)
embedding.js               Gemini embedding API client
lib/markdown.js            File-to-Markdown conversion helpers
lib/chunking.js            Chunking and document section slicing
lib/full-document-schemas.js Schema focus presets for synthesis prompts
lib/web-pages.js           Public URL validation, browser rendering, session web page storage
lib/storage.js             Local metadata, wiki loading, env persistence
lib/session.js             Cookie-backed session history storage
lib/http.js                JSON/body parsing helpers
lib/uploads.js             Multipart upload parsing
lib/google-genai-client.js Google GenAI SDK wrapper
lib/dashscope-client.js    DashScope OpenAI-compatible chat wrapper
config.js                  Retrieval budgets, embedding settings, local paths
constants.js               Paths, MIME types, upload/session constants
public/                    Frontend (HTML, CSS, vanilla JS)
wiki/default/              Static Markdown always injected into prompts
data/documents/            Uploaded Markdown files
data/lancedb/              LanceDB storage
data/index.json            Local document metadata registry
data/sessions/             Session history JSON files
data/session-web/          Rendered web pages for active sessions
```

## Retrieval Notes

| Technique | Where | Purpose |
|---|---|---|
| Hybrid retrieval | `db.js` | Combine BM25 and semantic candidates |
| RRF merging | `db.js` | Merge BM25 and semantic ranks with Reciprocal Rank Fusion |
| Contextual chunking | `db.js` | Embed `title: chunk_text` so vectors carry section context |
| Parent-child retrieval | `db.js` / `services/chat.js` | Search by child chunk, answer with parent section context |
| Model reranking | `services/chat.js` | Ask the selected chat model to choose the most relevant retrieved chunks |
| Gemini title rewriting | `services/gemini.js` | Replace generic headings with more specific chunk titles |
| Wiki injection | `lib/storage.js` / `services/chat.js` | Always include static wiki Markdown in final context |
| Schema focus presets | `lib/full-document-schemas.js` | Steer full-document and web-page synthesis toward financial, operational, risk, or generic fields |

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
- Streams answers in the UI via `/api/chat/stream`
- Uses the selected model to rerank retrieved chunks before answering
- Returns cited answers grounded in retrieved context when structured output is available

### Full document

- Works on selected uploaded documents instead of retrieval hits
- Useful for summaries, synthesis, and cross-document analysis
- Current server-side limit: 5 selected documents
- Uses slice-and-synthesize for long documents and returns read-process metadata

### Web pages

- Works on selected pages imported into the current browser session
- Supports `Auto`, `Fast`, and `Full scan` read depth
- Uses focused excerpts, semantic excerpt selection when possible, or full page chunk scanning for thorough requests

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/upload` | POST | Upload a file, convert to Markdown, and optionally index it |
| `/api/web-pages` | GET/POST | List or import public web pages for the current session |
| `/api/web-pages/:id` | DELETE | Remove a web page from the current session |
| `/api/chat` | POST | Retrieval Q&A or full-document answer generation |
| `/api/chat/stream` | POST | Streaming retrieval Q&A with Server-Sent Events |
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
  "webPageIds": [],
  "webPageReadMode": "auto",
  "retrievalMode": "hybrid"
}
```

### `/api/chat/stream`

Uses the same request shape as `/api/chat` for default Q&A mode and returns Server-Sent Events:

- `start`: retrieved chunks and actual retrieval mode
- `token`: streamed answer text
- `done`: session id
- `error`: error message

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | — | Required for semantic retrieval, indexing, Gemini chat generation, and web-page semantic excerpt selection |
| `DASHSCOPE_API_KEY` | — | Required for DashScope/Qwen chat generation |
| `DASHSCOPE_BASE_URL` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | Optional DashScope OpenAI-compatible base URL override |
| `GEMINI_MODEL` | `gemma-4-31b-it` | Default answer-generation model used by `services/gemini.js` |
| `WEB_PAGE_FETCH_TIMEOUT_MS` | `30000` | Browser navigation timeout when importing web pages |
| `WEB_PAGE_NETWORK_IDLE_TIMEOUT_MS` | `8000` | Optional network-idle wait after web page rendering |
| `WEB_PAGE_SCROLL_DELAY_MS` | `400` | Delay between automatic scroll steps while rendering web pages |
| `WEB_PAGE_MAX_SCROLL_COUNT` | `30` | Maximum scroll steps while rendering web pages |
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` for local-only access |

Code-level config in `config.js`:
- `WIKI_TOKEN_BUDGET`
- `RAG_TOKEN_BUDGET`
- `FULL_DOCUMENT_DIRECT_CHAR_BUDGET`
- `FULL_DOCUMENT_MULTI_DIRECT_CHAR_BUDGET`
- `FULL_DOCUMENT_SLICE_CHAR_BUDGET`
- `FULL_DOCUMENT_SYNTHESIS_CHAR_BUDGET`
- `FULL_DOCUMENT_MODEL_CONCURRENCY`
- `FULL_DOCUMENT_MAX_SLICES_PER_DOC`
- `RERANK_FETCH_COUNT`
- `RERANK_TOP_K`
- `MODELS`
- `DEFAULT_MODEL`
- embedding settings and paths

## Notes

- Semantic and hybrid retrieval require Gemini embeddings. If a selected chat model uses DashScope but no Google key is available for embeddings, Q&A falls back to BM25 retrieval.
- BM25 mode can work without Gemini embeddings, but answer generation still needs the selected provider's API key.
- Wiki files are injected directly into prompts and are not returned by `/api/search`.
- Web pages are rendered with Playwright/Chromium, saved under `data/session-web/`, selectable in Web pages mode, and cleaned up on server restart/shutdown.
- Each session keeps up to 8 imported web pages and the last 24 chat history entries.
- Web pages support `Auto`, `Fast`, and `Full scan` read depth. Full scan reads every page chunk before synthesis, which is slower but reduces missed details on long pages.
- Web page URLs must be public `http`/`https`; localhost and private-network URLs are rejected.
- Full-document mode falls back to slice-and-synthesize when selected content exceeds the token budget.
- Full-document and web-page modes select a schema focus preset from the question, but they still answer in natural language.
- `data/index.json` is local metadata and may change during testing; document content and LanceDB storage stay local on each machine.
- Unit tests live in `test/` and run with Node's built-in test runner via `npm test` (also run in CI on every push and pull request).
