const fs = require("fs/promises");
const crypto = require("crypto");
const path = require("path");
const { SESSION_COOKIE_NAME, SESSION_HISTORY_LIMIT, SESSION_WEB_PAGES_LIMIT, SESSIONS_DIR } = require("../constants");

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const cookies = {};

  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function appendSetCookie(res, cookieValue) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookieValue);
    return;
  }

  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookieValue]);
    return;
  }

  res.setHeader("Set-Cookie", [existing, cookieValue]);
}

function setSessionCookie(res, sessionId) {
  appendSetCookie(res, `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
}

function buildSessionFilePath(sessionId) {
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

function createEmptySession(sessionId) {
  const now = new Date().toISOString();
  return {
    id: sessionId,
    createdAt: now,
    updatedAt: now,
    history: [],
    webPages: [],
  };
}

async function readSession(sessionId) {
  try {
    const raw = await fs.readFile(buildSessionFilePath(sessionId), "utf8");
    const session = JSON.parse(raw);
    if (!Array.isArray(session.history)) {
      session.history = [];
    }
    if (!Array.isArray(session.webPages)) {
      session.webPages = [];
    }
    return session;
  } catch {
    return createEmptySession(sessionId);
  }
}

async function writeSession(session) {
  session.updatedAt = new Date().toISOString();
  session.history = Array.isArray(session.history) ? session.history.slice(-SESSION_HISTORY_LIMIT) : [];
  session.webPages = Array.isArray(session.webPages) ? session.webPages.slice(-SESSION_WEB_PAGES_LIMIT) : [];
  await fs.writeFile(buildSessionFilePath(session.id), `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

async function ensureSession(req, res) {
  const cookies = parseCookies(req);
  let sessionId = String(cookies[SESSION_COOKIE_NAME] || "").trim();

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    setSessionCookie(res, sessionId);
  }

  const session = await readSession(sessionId);
  if (session.id !== sessionId) {
    session.id = sessionId;
  }
  return session;
}

async function rotateSession(req, res) {
  const cookies = parseCookies(req);
  const previousSessionId = String(cookies[SESSION_COOKIE_NAME] || "").trim();
  const previousSession = previousSessionId ? await readSession(previousSessionId) : null;
  const sessionId = crypto.randomUUID();
  const session = createEmptySession(sessionId);
  session.webPages = Array.isArray(previousSession?.webPages)
    ? previousSession.webPages.slice(-SESSION_WEB_PAGES_LIMIT)
    : [];
  await writeSession(session);
  setSessionCookie(res, sessionId);
  return session;
}

module.exports = {
  ensureSession,
  rotateSession,
  writeSession,
};
