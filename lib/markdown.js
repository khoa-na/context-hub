const path = require("path");
const mammoth = require("mammoth");
const { TEXT_EXTENSIONS, BINARY_EXTENSIONS } = require("../constants");

function looksLikeMojibake(value) {
  return /(?:Ã.|Â.|Ä.|Æ.|Ð.|Ñ.|â.|�)/.test(value);
}

function repairTextEncoding(value) {
  const input = String(value || "");
  if (!input || !looksLikeMojibake(input)) {
    return input;
  }

  try {
    const repaired = Buffer.from(input, "latin1").toString("utf8");
    if (!repaired || repaired.includes("\uFFFD")) {
      return input;
    }
    return repaired;
  } catch {
    return input;
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "document";
}

function normalizeText(value) {
  return value.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

function isLikelyBinary(text) {
  const sample = text.slice(0, 1500);
  if (!sample) {
    return false;
  }

  let weird = 0;
  for (const char of sample) {
    const code = char.charCodeAt(0);
    const printable = code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) || code > 159;
    if (!printable) {
      weird += 1;
    }
  }

  return weird / sample.length > 0.12;
}

function escapePipe(value) {
  return String(value).replace(/\|/g, "\\|").trim();
}

function codeFenceLanguage(ext) {
  return ext.replace(/^\./, "") || "text";
}

function tableFromDelimited(text, delimiter) {
  const lines = normalizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return "";
  }

  const rows = lines.slice(0, 100).map((line) => line.split(delimiter).map((cell) => escapePipe(cell)));
  const width = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] || ""));
  const header = normalizedRows[0];
  const divider = Array.from({ length: width }, () => "---");
  const body = normalizedRows.slice(1);

  return [
    `| ${header.join(" | ")} |`,
    `| ${divider.join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function stripHtml(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function plainTextToMarkdown(filename, text) {
  const title = path.basename(filename, path.extname(filename));
  const body = normalizeText(text)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n");

  return `# ${title}\n\n${body}\n`;
}

async function docxToMarkdown(filename, buffer) {
  const title = path.basename(filename, path.extname(filename));
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      includeDefaultStyleMap: true,
    }
  );

  const body = stripHtml(result.value || "");
  if (!body) {
    throw new Error("Could not extract readable text from this DOCX file.");
  }

  return `# ${title}\n\n${body}\n`;
}

function convertToMarkdown({ filename, text }) {
  const ext = path.extname(filename).toLowerCase();
  const cleanText = normalizeText(text);

  if (!TEXT_EXTENSIONS.has(ext)) {
    throw new Error(`File type ${ext || "(unknown)"} is not supported yet. Try .txt, .md, .json, .csv, .html, or source code files.`);
  }

  if (isLikelyBinary(cleanText)) {
    throw new Error("The uploaded file looks binary. This starter app currently supports text-based files only.");
  }

  if (ext === ".md" || ext === ".mdx") {
    return `${cleanText}\n`;
  }

  if (ext === ".txt" || ext === ".text" || ext === ".log") {
    return plainTextToMarkdown(filename, cleanText);
  }

  if (ext === ".json") {
    let parsed = cleanText;
    try {
      parsed = JSON.stringify(JSON.parse(cleanText), null, 2);
    } catch {
      parsed = cleanText;
    }

    return `# ${path.basename(filename)}\n\n\`\`\`json\n${parsed}\n\`\`\`\n`;
  }

  if (ext === ".csv") {
    return `# ${path.basename(filename)}\n\n${tableFromDelimited(cleanText, ",")}\n`;
  }

  if (ext === ".tsv") {
    return `# ${path.basename(filename)}\n\n${tableFromDelimited(cleanText, "\t")}\n`;
  }

  if (ext === ".html" || ext === ".htm" || ext === ".xml") {
    return `# ${path.basename(filename)}\n\n${stripHtml(cleanText)}\n`;
  }

  if ([".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".go", ".rb", ".rs", ".sql", ".css", ".yaml", ".yml"].includes(ext)) {
    return `# ${path.basename(filename)}\n\n\`\`\`${codeFenceLanguage(ext)}\n${cleanText}\n\`\`\`\n`;
  }

  return plainTextToMarkdown(filename, cleanText);
}

async function convertUploadToMarkdown({ filename, buffer }) {
  const ext = path.extname(filename).toLowerCase();

  if (BINARY_EXTENSIONS.has(ext) && ext === ".docx") {
    return docxToMarkdown(filename, buffer);
  }

  return convertToMarkdown({ filename, text: buffer.toString("utf8") });
}

module.exports = {
  repairTextEncoding,
  slugify,
  normalizeText,
  convertToMarkdown,
  convertUploadToMarkdown,
};
