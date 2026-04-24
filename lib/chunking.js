const { normalizeText } = require("./markdown");

function tokenize(value) {
  return (value.toLowerCase().match(/[a-z0-9\u00C0-\u024F]{2,}/g) || []).filter((token) => token.length > 1);
}

function splitIntoChunks(markdown) {
  const normalized = normalizeText(markdown);
  const lines = normalized.split("\n");
  const sections = [];
  let currentTitle = "Overview";
  let buffer = [];

  function pushSection() {
    const text = buffer.join("\n").trim();
    if (text) {
      sections.push({ title: currentTitle, text });
    }
    buffer = [];
  }

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      pushSection();
      currentTitle = line.replace(/^#{1,6}\s+/, "").trim();
      buffer.push(line);
    } else {
      buffer.push(line);
    }
  }
  pushSection();

  const chunks = [];
  let counter = 1;

  for (const section of sections) {
    const paragraphs = section.text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    let chunkText = "";

    for (const paragraph of paragraphs) {
      const candidate = chunkText ? `${chunkText}\n\n${paragraph}` : paragraph;
      if (candidate.length > 1200 && chunkText) {
        chunks.push({ id: `C${counter++}`, title: section.title, text: chunkText.trim(), parentText: section.text.trim() });
        chunkText = paragraph;
      } else {
        chunkText = candidate;
      }
    }

    if (chunkText) {
      chunks.push({ id: `C${counter++}`, title: section.title, text: chunkText.trim(), parentText: section.text.trim() });
    }
  }

  return chunks.length ? chunks : [{ id: "C1", title: "Overview", text: normalized, parentText: normalized }];
}

function getDocumentSections(markdown) {
  const chunks = splitIntoChunks(markdown);
  const sections = [];
  const seen = new Set();

  for (const chunk of chunks) {
    const key = `${chunk.title}\n${chunk.parentText}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    sections.push({
      id: `S${sections.length + 1}`,
      title: chunk.title,
      text: chunk.parentText,
    });
  }

  return sections;
}

function packSectionsIntoSlices(sections, maxChars = 12000) {
  const slices = [];
  let current = "";

  for (const section of sections) {
    const block = `## ${section.id}: ${section.title}\n${section.text}`;
    const candidate = current ? `${current}\n\n${block}` : block;

    if (candidate.length > maxChars && current) {
      slices.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }

  if (current) {
    slices.push(current);
  }

  return slices;
}

function isMarkdownTableRow(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.includes("|", 1);
}

function isMarkdownTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitLongLine(line, maxChars) {
  const pieces = [];
  for (let index = 0; index < line.length; index += maxChars) {
    pieces.push(line.slice(index, index + maxChars));
  }
  return pieces;
}

function packUnitsIntoSlices(units, maxChars) {
  const slices = [];
  let current = "";

  for (const unit of units) {
    if (!unit) {
      continue;
    }

    if (unit.length > maxChars) {
      if (current) {
        slices.push(current.trim());
        current = "";
      }
      slices.push(...splitLongLine(unit, maxChars).map((piece) => piece.trim()).filter(Boolean));
      continue;
    }

    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (candidate.length > maxChars && current) {
      slices.push(current.trim());
      current = unit;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    slices.push(current.trim());
  }

  return slices;
}

function splitPlainTextIntoSlices(text, maxChars) {
  const paragraphs = normalizeText(text)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const units = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      units.push(paragraph);
      continue;
    }

    units.push(
      ...paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    );
  }

  return packUnitsIntoSlices(units, maxChars);
}

function splitMarkdownTableIntoSlices(lines, maxChars) {
  const trimmedLines = lines.map((line) => line.trim()).filter(Boolean);
  if (!trimmedLines.length) {
    return [];
  }

  const hasHeader = trimmedLines.length >= 2 && isMarkdownTableSeparator(trimmedLines[1]);
  if (!hasHeader) {
    return packUnitsIntoSlices(trimmedLines, maxChars);
  }

  const header = trimmedLines[0];
  const separator = trimmedLines[1];
  const rows = trimmedLines.slice(2);
  const prefix = `${header}\n${separator}`;
  const slices = [];
  let currentRows = [];

  for (const row of rows) {
    const candidateRows = [...currentRows, row];
    const candidate = `${prefix}\n${candidateRows.join("\n")}`;

    if (candidate.length > maxChars && currentRows.length) {
      slices.push(`${prefix}\n${currentRows.join("\n")}`);
      currentRows = [row];
      continue;
    }

    if (candidate.length > maxChars) {
      const rowBudget = Math.max(200, maxChars - prefix.length - 1);
      slices.push(...splitLongLine(row, rowBudget).map((piece) => `${prefix}\n${piece}`));
      currentRows = [];
      continue;
    }

    currentRows = candidateRows;
  }

  if (currentRows.length) {
    slices.push(`${prefix}\n${currentRows.join("\n")}`);
  }

  if (!rows.length) {
    slices.push(prefix);
  }

  return slices;
}

function splitContentIntoSlices(text, maxChars = 7500) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const lines = normalized.split("\n");
  const slices = [];
  let plainBuffer = [];
  let tableBuffer = [];

  function flushPlain() {
    const plainText = plainBuffer.join("\n").trim();
    if (plainText) {
      slices.push(...splitPlainTextIntoSlices(plainText, maxChars));
    }
    plainBuffer = [];
  }

  function flushTable() {
    if (tableBuffer.length) {
      slices.push(...splitMarkdownTableIntoSlices(tableBuffer, maxChars));
    }
    tableBuffer = [];
  }

  for (const line of lines) {
    if (isMarkdownTableRow(line)) {
      flushPlain();
      tableBuffer.push(line);
    } else {
      flushTable();
      plainBuffer.push(line);
    }
  }

  flushPlain();
  flushTable();

  return packUnitsIntoSlices(slices, maxChars);
}

module.exports = {
  tokenize,
  splitIntoChunks,
  getDocumentSections,
  packSectionsIntoSlices,
  splitContentIntoSlices,
};
