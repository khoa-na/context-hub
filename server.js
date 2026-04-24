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

async function router(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/documents") {
      return handleDocuments(req, res);
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/documents/")) {
      const docId = url.pathname.slice("/api/documents/".length);
      return handleDeleteDocument(req, res, docId);
    }

    if (req.method === "POST" && url.pathname === "/api/upload") {
      return handleUpload(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/wiki-upload") {
      return handleWikiUpload(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/wiki-list") {
      return handleWikiList(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/save-key") {
      return handleSaveKey(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      return handleChat(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/session/reset") {
      return handleSessionReset(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/search") {
      return handleSearch(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/reindex") {
      return handleReindex(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/models") {
      return sendJson(res, 200, { models: config.MODELS, defaultModel: config.DEFAULT_MODEL });
    }

    if (req.method === "GET") {
      return serveStatic(req, res, url.pathname);
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

async function start() {
  await ensureStorage();
  await autoIndexUnindexedDocs();

  const server = http.createServer(router);
  server.listen(PORT, HOST, () => {
    console.log(`context-hub running at http://localhost:${PORT}`);
    if (HOST === "0.0.0.0") {
      const networkUrls = getNetworkUrls(PORT);
      for (const url of networkUrls) {
        console.log(`LAN access: ${url}`);
      }
    } else if (HOST !== "127.0.0.1" && HOST !== "localhost") {
      console.log(`Bound to: http://${HOST}:${PORT}`);
    }
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
