const state = {
  documents: [],
  history: [],
  models: [],
  selectedModels: new Set(),
  selectedDocIds: new Set(),
};

const fileInput = document.querySelector("#file-input");
const selectedFileName = document.querySelector("#selected-file-name");
const uploadButton = document.querySelector("#upload-button");
const uploadStatus = document.querySelector("#upload-status");
const documentList = document.querySelector("#document-list");
const apiKeyInput = document.querySelector("#api-key-input");
const saveKeyButton = document.querySelector("#save-key-button");
const jinaApiKeyInput = document.querySelector("#jina-api-key-input");
const saveJinaKeyButton = document.querySelector("#save-jina-key-button");
const showKeyToggle = document.querySelector("#show-key-toggle");
const keyStatus = document.querySelector("#key-status");
const jinaKeyStatus = document.querySelector("#jina-key-status");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatModeSelect = document.querySelector("#chat-mode");
const retrievalModeSelect = document.querySelector("#retrieval-mode");
const debugSearchToggle = document.querySelector("#debug-search-toggle");
const rerankToggle = document.querySelector("#rerank-toggle");
const documentFocusRow = document.querySelector("#document-focus-row");
const docPickerList = document.querySelector("#doc-picker-list");
const docSelectAllBtn = document.querySelector("#doc-select-all-btn");
const docClearAllBtn = document.querySelector("#doc-clear-all-btn");
const modelCompareRow = document.querySelector("#model-compare-row");
const modelSelectList = document.querySelector("#model-select-list");
const taskSelect = document.querySelector("#task-select");
const compareResults = document.querySelector("#compare-results");
const chatLog = document.querySelector("#chat-log");
const sourceList = document.querySelector("#source-list");
const sourcesToggle = document.querySelector("#sources-toggle");
const sourcesCount = document.querySelector("#sources-count");
const newSessionButton = document.querySelector("#new-session-button");
const settingsToggle = document.querySelector("#settings-toggle");
const settingsPanel = document.querySelector("#settings-panel");
const wikiFileInput = document.querySelector("#wiki-file-input");
const wikiFileName = document.querySelector("#wiki-file-name");
const wikiUploadButton = document.querySelector("#wiki-upload-button");
const wikiUploadStatus = document.querySelector("#wiki-upload-status");
const wikiList = document.querySelector("#wiki-list");

let sessionApiKey = "";
let sessionJinaApiKey = "";

const dropzone = fileInput.closest(".dropzone");
const wikiDropzone = wikiFileInput.closest(".dropzone");

function setupDropzone(zone, input, onFile) {
  ["dragenter", "dragover"].forEach((evt) => {
    zone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add("dragover"); });
  });
  ["dragleave", "drop"].forEach((evt) => {
    zone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove("dragover"); });
  });
  zone.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length) {
      input.files = files;
      onFile();
    }
  });
}

setupDropzone(dropzone, fileInput, updateSelectedFileUI);
setupDropzone(wikiDropzone, wikiFileInput, updateWikiFileUI);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

sourcesToggle.addEventListener("click", () => {
  sourceList.classList.toggle("collapsed");
});

function updateSelectedFileUI() {
  const file = fileInput.files[0];
  if (!file) {
    selectedFileName.textContent = "Drop a file or click to browse";
    uploadButton.disabled = true;
    return;
  }
  selectedFileName.textContent = `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`;
  uploadButton.disabled = false;
}

function renderDocuments() {
  if (!state.documents.length) {
    documentList.innerHTML = '<p class="empty-state">No documents yet.</p>';
    return;
  }

  documentList.innerHTML = state.documents
    .map((doc) => `
      <div class="doc-card" data-id="${escapeHtml(doc.id)}">
        <div class="doc-card-row">
          <div>
            <span class="doc-title">${escapeHtml(doc.title)}</span>
            <span class="doc-meta">${escapeHtml(doc.filename)} · ${doc.chunkCount} chunks</span>
          </div>
          <button class="doc-delete-btn" data-id="${escapeHtml(doc.id)}" title="Delete document">&times;</button>
        </div>
      </div>
    `)
    .join("");

  documentList.querySelectorAll(".doc-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.currentTarget.dataset.id;
      if (!confirm("Delete this document and remove it from the search index?")) return;
      try {
        const resp = await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!resp.ok) {
          const err = await resp.json();
          throw new Error(err.error || "Delete failed");
        }
        state.documents = state.documents.filter((d) => d.id !== id);
        state.selectedDocIds.delete(id);
        renderDocuments();
        renderDocumentPicker();
        updateChatModeUI();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function renderDocumentPicker() {
  if (!state.documents.length) {
    docPickerList.innerHTML = '<p class="empty-state">No documents available</p>';
    return;
  }

  docPickerList.innerHTML = state.documents
    .map((doc) => {
      const checked = state.selectedDocIds.has(doc.id) ? "checked" : "";
      return `
        <label class="doc-picker-item">
          <input type="checkbox" value="${escapeHtml(doc.id)}" ${checked} />
          <span class="doc-picker-title">${escapeHtml(doc.title)}</span>
          <span class="doc-picker-meta">${escapeHtml(doc.filename)} · ${doc.chunkCount} chunks</span>
        </label>
      `;
    })
    .join("");

  docPickerList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) {
        state.selectedDocIds.add(cb.value);
      } else {
        state.selectedDocIds.delete(cb.value);
      }
    });
  });
}

function renderModelPicker() {
  if (!state.models.length) {
    modelSelectList.innerHTML = '<p class="empty-state">No models available</p>';
    return;
  }

  modelSelectList.innerHTML = state.models
    .map((model) => {
      const checked = state.selectedModels.has(model.id) ? "checked" : "";
      return `
        <label class="model-picker-item">
          <input type="checkbox" value="${escapeHtml(model.id)}" ${checked} />
          <span class="model-picker-name">${escapeHtml(model.name)}</span>
          <span class="model-picker-provider">${escapeHtml(model.provider)}</span>
        </label>
      `;
    })
    .join("");

  modelSelectList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) {
        state.selectedModels.add(cb.value);
      } else {
        state.selectedModels.delete(cb.value);
      }
    });
  });
}

function selectAllDocuments() {
  state.documents.forEach((doc) => state.selectedDocIds.add(doc.id));
  renderDocumentPicker();
}

function clearAllDocuments() {
  state.selectedDocIds.clear();
  renderDocumentPicker();
}

function selectAllModels() {
  state.models.forEach((model) => state.selectedModels.add(model.id));
  renderModelPicker();
}

function clearAllModels() {
  state.selectedModels.clear();
  renderModelPicker();
}

docSelectAllBtn.addEventListener("click", selectAllDocuments);
docClearAllBtn.addEventListener("click", clearAllDocuments);

function getSelectedDocumentIds() {
  return Array.from(state.selectedDocIds);
}

function getSelectedModelIds() {
  return Array.from(state.selectedModels);
}

function updateChatModeUI() {
  const isFullDocumentMode = chatModeSelect.value === "full-document";
  const isCompareMode = chatModeSelect.value === "compare";

  documentFocusRow.hidden = !isFullDocumentMode;
  modelCompareRow.hidden = !isCompareMode;
  retrievalModeSelect.disabled = isCompareMode;
  debugSearchToggle.disabled = isCompareMode;
  rerankToggle.disabled = isCompareMode;

  if (isFullDocumentMode) {
    debugSearchToggle.checked = false;
    rerankToggle.checked = false;
    chatInput.placeholder = "Ask for a summary or analysis of the selected document...";
  } else if (isCompareMode) {
    chatInput.placeholder = "Enter a question to compare across selected models...";
  } else {
    chatInput.placeholder = "Ask anything about your documents...";
  }
}

function renderChatMessage(role, content) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = `
    <span class="msg-avatar">${role === "assistant" ? "&#9670;" : "&#128100;"}</span>
    <div class="msg-body"><p>${escapeHtml(content)}</p></div>
  `;
  chatLog.append(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderSources(chunks) {
  if (!chunks || !chunks.length) {
    sourceList.textContent = "No retrieval yet.";
    sourcesToggle.classList.add("hidden");
    return;
  }

  sourcesToggle.classList.remove("hidden");
  sourcesCount.textContent = chunks.length;

  sourceList.innerHTML = chunks
    .map(
      (chunk) => {
        const retrievalMeta = [];
        const retrieval = chunk.retrieval || {};
        if (Array.isArray(retrieval.sources) && retrieval.sources.length) {
          retrievalMeta.push(retrieval.sources.join(" + "));
        }
        if (retrieval.semanticRank) {
          retrievalMeta.push(`semantic #${retrieval.semanticRank}`);
        }
        if (retrieval.bm25Rank) {
          retrievalMeta.push(`bm25 #${retrieval.bm25Rank}`);
        }
        if (retrieval.rerankRank) {
          retrievalMeta.push(`rerank #${retrieval.rerankRank}`);
        }
        if (typeof retrieval.rerankScore === "number") {
          retrievalMeta.push(`rerank score ${retrieval.rerankScore.toFixed(3)}`);
        }
        const matchedPassage = (chunk.childContent || "").trim();
        const fullContext = (chunk.content || "").trim();

        return `
        <div class="source-item">
          <strong>${escapeHtml(chunk.id)} · ${escapeHtml(chunk.title)}</strong>
          <p class="source-file">${escapeHtml(chunk.filename || "")}</p>
          ${retrievalMeta.length ? `<p class="source-retrieval">${escapeHtml(retrievalMeta.join(" · "))}</p>` : ""}
          ${matchedPassage ? `<details>
            <summary>Matched passage</summary>
            <p>${escapeHtml(matchedPassage.slice(0, 300))}</p>
          </details>` : ""}
          ${fullContext ? `<details>
            <summary>Full section context</summary>
            <p>${escapeHtml(fullContext.slice(0, 600))}</p>
          </details>` : ""}
        </div>
      `;
      }
    )
    .join("");
}

function buildSearchDebugSummary(payload) {
  const mode = payload.retrievalMode || retrievalModeSelect.value;
  const lines = [
    `Debug retrieval mode: ${mode}`,
    `Matched chunks: ${payload.chunkCount || 0}`,
    payload.usesEmbedding ? "Embedding: Gemini embedding was used." : "Embedding: not used (BM25 only).",
  ];

  if (payload.rerankApplied) {
    lines.push(`Rerank: ${payload.rerankProvider || "jina"} was applied on ${payload.initialChunkCount || payload.chunkCount || 0} candidates.`);
  }

  if (payload.wikiInjectedSeparately) {
    lines.push("Wiki files are not shown here because they are injected separately at answer time.");
  }

  return lines.join("\n");
}

async function resetSessionOnServer() {
  const response = await fetch("/api/session/reset", {
    method: "POST",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to reset session.");
  }

  return payload;
}

function resetConversation(resetServer = false) {
  state.history = [];
  chatLog.innerHTML = `
    <div class="msg msg-system">
      <span class="msg-avatar">&#9670;</span>
      <div class="msg-body"><p>Hi! Upload a document, ask a question, or switch to Full document mode to summarize one selected file.</p></div>
    </div>
  `;
  renderSources([]);

  if (resetServer) {
    resetSessionOnServer().catch((error) => {
      console.error("Failed to reset session:", error.message);
    });
  }
}

async function saveApiKey() {
  const value = apiKeyInput.value.trim();
  if (!value) {
    sessionApiKey = "";
    keyStatus.textContent = "Key cleared.";
    return "";
  }

  try {
    const response = await fetch("/api/save-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: value }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to save key.");
    }
    sessionApiKey = value;
    keyStatus.textContent = "Key saved to .env. It will persist across restarts.";
  } catch (err) {
    sessionApiKey = value;
    keyStatus.textContent = "Saved for this session only. Server error: " + err.message;
  }
  return sessionApiKey;
}

async function saveJinaApiKey() {
  const value = jinaApiKeyInput.value.trim();
  if (!value) {
    sessionJinaApiKey = "";
    jinaKeyStatus.textContent = "Key cleared.";
    return "";
  }

  try {
    const response = await fetch("/api/save-jina-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: value }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to save key.");
    }
    sessionJinaApiKey = value;
    jinaKeyStatus.textContent = "Jina key saved to .env. It will persist across restarts.";
  } catch (err) {
    sessionJinaApiKey = value;
    jinaKeyStatus.textContent = "Saved for this session only. Server error: " + err.message;
  }
  return sessionJinaApiKey;
}

function hydrateApiKey() {
  sessionApiKey = "";
  sessionJinaApiKey = "";
  apiKeyInput.value = "";
  jinaApiKeyInput.value = "";
  keyStatus.textContent = "No session key. Enter your Gemini API key above.";
  jinaKeyStatus.textContent = "No session key. Enter your Jina API key above for rerank.";
}

async function loadDocuments() {
  const response = await fetch("/api/documents");
  const payload = await response.json();
  state.documents = payload.documents || [];
  renderDocuments();
  renderDocumentPicker();
  updateChatModeUI();
}

uploadButton.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    uploadStatus.textContent = "Choose a file first.";
    return;
  }

  uploadButton.disabled = true;
  uploadStatus.textContent = "Converting and indexing...";

  try {
    const formData = new FormData();
    formData.append("file", file);
    const apiKey = apiKeyInput.value.trim() || sessionApiKey;

    const response = await fetch("/api/upload", {
      method: "POST",
      headers: apiKey ? { "x-api-key": apiKey } : undefined,
      body: formData,
    });

    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : {};
    if (!response.ok) {
      throw new Error(payload.error || "Upload failed.");
    }

    if (payload.indexingStatus === "indexed") {
      uploadStatus.textContent = `Indexed ${payload.document.filename} (${payload.document.chunkCount} chunks)`;
    } else if (payload.indexingStatus === "failed") {
      uploadStatus.textContent = `Uploaded ${payload.document.filename}, but indexing failed.`;
    } else {
      uploadStatus.textContent = `Uploaded ${payload.document.filename}, but it was not indexed yet.`;
    }

    await loadDocuments();
    resetConversation(true);
    fileInput.value = "";
    updateSelectedFileUI();
  } catch (error) {
    uploadStatus.textContent = error.message;
  } finally {
    updateSelectedFileUI();
  }
});

fileInput.addEventListener("change", () => {
  uploadStatus.textContent = "";
  updateSelectedFileUI();
});

saveKeyButton.addEventListener("click", () => {
  saveApiKey();
});

saveJinaKeyButton.addEventListener("click", () => {
  saveJinaApiKey();
});

showKeyToggle.addEventListener("change", () => {
  apiKeyInput.type = showKeyToggle.checked ? "text" : "password";
  jinaApiKeyInput.type = showKeyToggle.checked ? "text" : "password";
});

chatModeSelect.addEventListener("change", () => {
  updateChatModeUI();
  resetConversation(true);
});

newSessionButton.addEventListener("click", () => {
  resetConversation(true);
});

function updateWikiFileUI() {
  const file = wikiFileInput.files[0];
  if (!file) {
    wikiFileName.textContent = "Drop .md or .txt";
    wikiUploadButton.disabled = true;
    return;
  }
  wikiFileName.textContent = `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`;
  wikiUploadButton.disabled = false;
}

async function loadWikiFiles() {
  try {
    const response = await fetch("/api/wiki-list");
    const payload = await response.json();
    const files = payload.files || [];
    if (!files.length) {
      wikiList.innerHTML = '<p class="empty-state">No wiki files yet.</p>';
      return;
    }
    wikiList.innerHTML = files.map((f) => `
      <div class="doc-card">
        <span class="doc-title">${escapeHtml(f.filename)}</span>
        <span class="doc-meta">${Math.max(1, Math.round(f.size / 1024))} KB · ${new Date(f.modified).toLocaleDateString()}</span>
      </div>
    `).join("");
  } catch {
    wikiList.innerHTML = '<p class="empty-state">Could not load wiki files.</p>';
  }
}

wikiFileInput.addEventListener("change", () => {
  wikiUploadStatus.textContent = "";
  updateWikiFileUI();
});

wikiUploadButton.addEventListener("click", async () => {
  const file = wikiFileInput.files[0];
  if (!file) {
    wikiUploadStatus.textContent = "Choose a file first.";
    return;
  }

  wikiUploadButton.disabled = true;
  wikiUploadStatus.textContent = "Uploading...";

  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/wiki-upload", {
      method: "POST",
      body: formData,
    });

    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : {};
    if (!response.ok) {
      throw new Error(payload.error || "Upload failed.");
    }

    wikiUploadStatus.textContent = `Saved to wiki: ${payload.filename}`;
    await loadWikiFiles();
    wikiFileInput.value = "";
    updateWikiFileUI();
  } catch (error) {
    wikiUploadStatus.textContent = error.message;
  } finally {
    updateWikiFileUI();
  }
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = chatInput.value.trim();
  if (!question) return;
  const chatMode = chatModeSelect.value;
  const isDebugSearch = debugSearchToggle.checked;

  if (chatMode === "full-document" && !state.documents.length) {
    renderChatMessage("assistant", "Please upload a document first before using Full document mode.");
    return;
  }

  if (chatMode === "full-document" && state.selectedDocIds.size === 0) {
    renderChatMessage("assistant", "Select one or more target documents before using Full document mode.");
    return;
  }

  if (chatMode === "compare" && state.selectedModels.size === 0) {
    renderChatMessage("assistant", "Select at least one model to compare.");
    return;
  }

  renderChatMessage("user", question);
  chatInput.value = "";
  chatInput.style.height = "auto";

  try {
    const apiKey = apiKeyInput.value.trim() || sessionApiKey;
    const rerankApiKey = jinaApiKeyInput.value.trim() || sessionJinaApiKey;

    if (chatMode === "compare") {
      compareResults.classList.remove("hidden");
      compareResults.innerHTML = '<p class="compare-loading">Running comparison across selected models...</p>';

      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          apiKey,
          models: getSelectedModelIds(),
          task: taskSelect.value,
          retrievalMode: retrievalModeSelect.value,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Model comparison failed.");
      }

      renderCompareResults(payload);
      return;
    }

    const requestPath = isDebugSearch ? "/api/search" : "/api/chat";

    renderChatMessage("assistant", isDebugSearch ? "Searching..." : chatMode === "full-document" ? "Reading the full document..." : "Thinking...");

    const response = await fetch(requestPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        history: state.history,
        apiKey,
        chatMode,
        documentId: chatMode === "full-document" ? (getSelectedDocumentIds()[0] || "") : "",
        retrievalMode: retrievalModeSelect.value,
        rerank: isDebugSearch && rerankToggle.checked,
        rerankApiKey,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Chat failed.");
    }

    const lastMsg = chatLog.querySelector(".msg:last-child .msg-body p");
    if (lastMsg) {
      lastMsg.textContent = isDebugSearch ? buildSearchDebugSummary(payload) : payload.answer;
    }

    if (!isDebugSearch) {
      state.history.push({ role: "user", content: question });
      state.history.push({ role: "assistant", content: payload.answer });
    }

    renderSources(payload.chunks);
  } catch (error) {
    const lastMsg = chatLog.querySelector(".msg:last-child .msg-body p");
    if (lastMsg) lastMsg.textContent = error.message;
  }
});

chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + "px";
});

function renderCompareResults(payload) {
  const results = payload.results || [];
  const question = payload.question || "";

  let html = `
    <div class="compare-header">
      <h3>Model Comparison</h3>
      <p class="compare-question">"${escapeHtml(question)}"</p>
    </div>
    <div class="compare-grid">
  `;

  for (const result of results) {
    const isError = !!result.error;
    html += `
      <div class="compare-card ${isError ? "compare-error" : ""}">
        <div class="compare-card-header">
          <strong class="compare-model-name">${escapeHtml(result.modelName || result.model)}</strong>
          <span class="compare-latency">${result.latency_ms ? `${result.latency_ms}ms` : ""}</span>
          ${result.tokens_used ? `<span class="compare-tokens">${result.tokens_used} tokens</span>` : ""}
        </div>
    `;

    if (isError) {
      html += `<p class="compare-error-text">${escapeHtml(result.error)}</p>`;
    } else {
      html += `<div class="compare-answer">${escapeHtml(result.answer)}</div>`;

      if (result.confidence) {
        const stars = "★".repeat(result.confidence) + "☆".repeat(5 - result.confidence);
        html += `<div class="compare-confidence"><span>Confidence:</span> <span class="confidence-stars">${stars}</span> <span class="confidence-value">${result.confidence}/5</span></div>`;
      }

      if (result.key_points && result.key_points.length) {
        html += `<div class="compare-key-points"><strong>Key Points:</strong><ul>${result.key_points.map((kp) => `<li>${escapeHtml(kp)}</li>`).join("")}</ul></div>`;
      }

      if (result.word_count) {
        html += `<div class="compare-meta"><span>Words: ${result.word_count}</span></div>`;
      }

      if (result.sources_used && result.sources_used.length) {
        html += `<div class="compare-meta"><span>Sources: ${result.sources_used.map((s) => escapeHtml(s)).join(", ")}</span></div>`;
      }
    }

    html += `</div>`;
  }

  html += `</div>`;
  compareResults.innerHTML = html;
}

async function loadModels() {
  try {
    const response = await fetch("/api/models");
    const payload = await response.json();
    state.models = payload.models || [];
    if (state.models.length > 0) {
      state.selectedModels.add(state.models[0].id);
    }
    renderModelPicker();
  } catch (error) {
    console.error("Failed to load models:", error.message);
  }
}
hydrateApiKey();
updateChatModeUI();
updateSelectedFileUI();
loadDocuments().catch((error) => { uploadStatus.textContent = error.message; });
loadWikiFiles();
loadModels();
