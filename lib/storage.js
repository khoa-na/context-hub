const fs = require("fs/promises");
const path = require("path");
const config = require("../config");
const { PUBLIC_DIR, DOCS_DIR, SESSIONS_DIR, INDEX_PATH, ROOT } = require("../constants");
const { repairTextEncoding } = require("./markdown");
const { truncateToTokenBudget } = require("./text");

async function writeTextAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );

  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

async function ensureStorage() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.mkdir(DOCS_DIR, { recursive: true });
  await fs.mkdir(SESSIONS_DIR, { recursive: true });

  try {
    await fs.access(INDEX_PATH);
  } catch {
    await fs.writeFile(INDEX_PATH, "[]\n", "utf8");
  }
}

async function readIndex() {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await fs.readFile(INDEX_PATH, "utf8");
      return JSON.parse(raw);
    } catch (err) {
      lastError = err;
      if (err instanceof SyntaxError) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Failed to parse ${INDEX_PATH}: ${lastError.message}`);
}

async function writeIndex(entries) {
  await writeTextAtomic(INDEX_PATH, `${JSON.stringify(entries, null, 2)}\n`);
}

async function saveEnvValue(name, value) {
  const envPath = path.join(ROOT, ".env");
  let envContent = "";
  try {
    envContent = await fs.readFile(envPath, "utf8");
  } catch {}

  const lines = envContent ? envContent.split("\n") : [];
  let found = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith(`${name}=`)) {
      lines[i] = `${name}=${value}`;
      found = true;
      break;
    }
  }

  if (!found) {
    lines.push(`${name}=${value}`);
  }

  await writeTextAtomic(envPath, lines.join("\n"));
  process.env[name] = value;
}

async function loadWikiContext(tenantId) {
  const wikiPath = path.join(config.WIKI_DIR, tenantId);
  try {
    await fs.access(wikiPath);
  } catch {
    return "";
  }

  try {
    const files = await fs.readdir(wikiPath);
    const mdFiles = files.filter((file) => file.endsWith(".md"));
    let context = "";

    for (const file of mdFiles) {
      const content = await fs.readFile(path.join(wikiPath, file), "utf8");
      context += `\n\n### ${file}\n${content}`;
    }

    return truncateToTokenBudget(context, config.WIKI_TOKEN_BUDGET);
  } catch (err) {
    console.error("Error loading wiki context:", err);
    return "";
  }
}

async function loadAllDocumentsWithMarkdown() {
  const index = await readIndex();
  const results = await Promise.all(
    index.map(async (entry) => {
      try {
        const markdown = await fs.readFile(path.join(ROOT, entry.markdownPath), "utf8");
        return {
          ...entry,
          filename: repairTextEncoding(entry.filename),
          title: repairTextEncoding(entry.title),
          markdown,
        };
      } catch {
        return null;
      }
    })
  );

  const valid = results.filter(Boolean);
  if (valid.length < index.length) {
    await writeIndex(valid);
  }
  return valid;
}

module.exports = {
  ensureStorage,
  readIndex,
  writeIndex,
  saveEnvValue,
  loadWikiContext,
  loadAllDocumentsWithMarkdown,
};
