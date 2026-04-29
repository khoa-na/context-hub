require("dotenv").config();
const http = require("http");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const config = require("./config");
const { MIME_TYPES, PUBLIC_DIR } = require("./constants");
const { sendJson } = require("./lib/http");
const { ensureStorage } = require("./lib/storage");
const { autoIndexUnindexedDocs } = require("./services/indexing");
const {
  handleUpload,
  handleDocuments,
  handleDeleteDocument,
  handleChat,
  handleSearch,
  handleSessionReset,
  handleReindex,
  handleWikiUpload,
  handleWikiList,
  handleSaveKey,
} = require("./handlers/api");

const PORT = Number(process.env.PORT || 3000);
const HOST = String(process.env.HOST || "0.0.0.0").trim();

const ROUTES = [
  ["GET", "/api/documents", handleDocuments],
  ["POST", "/api/upload", handleUpload],
  ["POST", "/api/wiki-upload", handleWikiUpload],
  ["GET", "/api/wiki-list", handleWikiList],
  ["POST", "/api/save-key", handleSaveKey],
  ["POST", "/api/chat", handleChat],
  ["POST", "/api/session/reset", handleSessionReset],
  ["POST", "/api/search", handleSearch],
  ["POST", "/api/reindex", handleReindex],
];

function findRoute(method, pathname) {
  return ROUTES.find(([routeMethod, routePath]) => routeMethod === method && routePath === pathname);
}

async function serveStatic(_req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

function sendModelOptions(_req, res) {
  return sendJson(res, 200, {
    providers: config.PROVIDERS,
    models: config.MODELS,
    defaultModel: config.DEFAULT_MODEL,
  });
}

async function router(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = findRoute(req.method, url.pathname);

    if (route) {
      const [, , handler] = route;
      return await handler(req, res);
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/documents/")) {
      const docId = url.pathname.slice("/api/documents/".length);
      return await handleDeleteDocument(req, res, docId);
    }

    if (req.method === "GET" && url.pathname === "/api/models") {
      return sendModelOptions(req, res);
    }

    if (req.method === "GET") {
      return await serveStatic(req, res, url.pathname);
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || "Internal server error." });
  }
}

function getNetworkUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal) {
        continue;
      }

      if (entry.family === "IPv4") {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }

  return [...new Set(urls)];
}

function logStartupUrls(port, host) {
  console.log(`context-hub running at http://localhost:${port}`);

  if (host === "0.0.0.0") {
    for (const url of getNetworkUrls(port)) {
      console.log(`LAN access: ${url}`);
    }
    return;
  }

  if (host !== "127.0.0.1" && host !== "localhost") {
    console.log(`Bound to: http://${host}:${port}`);
  }
}

async function start() {
  await ensureStorage();
  await autoIndexUnindexedDocs();

  const server = http.createServer(router);
  server.listen(PORT, HOST, () => {
    logStartupUrls(PORT, HOST);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
