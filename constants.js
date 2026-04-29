const path = require("path");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DOCS_DIR = path.join(DATA_DIR, "documents");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const SESSION_WEB_DIR = path.join(DATA_DIR, "session-web");
const INDEX_PATH = path.join(DATA_DIR, "index.json");
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const SESSION_COOKIE_NAME = "context_hub_session";
const SESSION_HISTORY_LIMIT = 24;
const SESSION_WEB_PAGES_LIMIT = 8;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
};

const TEXT_EXTENSIONS = new Set([
  ".csv",
  ".css",
  ".go",
  ".html",
  ".htm",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".mdx",
  ".py",
  ".rb",
  ".rs",
  ".sql",
  ".text",
  ".ts",
  ".tsx",
  ".tsv",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const BINARY_EXTENSIONS = new Set([".docx"]);

module.exports = {
  ROOT,
  PUBLIC_DIR,
  DATA_DIR,
  DOCS_DIR,
  SESSIONS_DIR,
  SESSION_WEB_DIR,
  INDEX_PATH,
  MAX_UPLOAD_BYTES,
  SESSION_COOKIE_NAME,
  SESSION_HISTORY_LIMIT,
  SESSION_WEB_PAGES_LIMIT,
  MIME_TYPES,
  TEXT_EXTENSIONS,
  BINARY_EXTENSIONS,
};
