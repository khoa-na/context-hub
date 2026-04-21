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

module.exports = {
  tokenize,
  splitIntoChunks,
  getDocumentSections,
  packSectionsIntoSlices,
};
