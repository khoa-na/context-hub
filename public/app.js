const state = {
  documents: [],
  webPages: [],
  history: [],
  providers: [],
  models: [],
  selectedModel: "",
  selectedDocIds: new Set(),
  selectedWebPageIds: new Set(),
};

const fileInput = document.querySelector("#file-input");
const selectedFileName = document.querySelector("#selected-file-name");
const uploadButton = document.querySelector("#upload-button");
const uploadStatus = document.querySelector("#upload-status");
const documentList = document.querySelector("#document-list");
const webUrlInput = document.querySelector("#web-url-input");
const webSummarizeButton = document.querySelector("#web-summarize-button");
const webStatus = document.querySelector("#web-status");
const webPageList = document.querySelector("#web-page-list");
const apiKeyInput = document.querySelector("#api-key-input");
const saveKeyButton = document.querySelector("#save-key-button");
const dashscopeApiKeyInput = document.querySelector("#dashscope-api-key-input");
const saveDashscopeKeyButton = document.querySelector("#save-dashscope-key-button");
const showKeyToggle = document.querySelector("#show-key-toggle");
const keyStatus = document.querySelector("#key-status");
const dashscopeKeyStatus = document.querySelector("#dashscope-key-status");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatModeSelect = document.querySelector("#chat-mode");
const modelSelect = document.querySelector("#model-select");
const retrievalModeSelect = document.querySelector("#retrieval-mode");
const debugSearchToggle = document.querySelector("#debug-search-toggle");
const documentFocusRow = document.querySelector("#document-focus-row");
const docPickerList = document.querySelector("#doc-picker-list");
const docSelectAllBtn = document.querySelector("#doc-select-all-btn");
const docClearAllBtn = document.querySelector("#doc-clear-all-btn");
const webPageFocusRow = document.querySelector("#web-page-focus-row");
const webPagePickerList = document.querySelector("#web-page-picker-list");
const webPageSelectAllBtn = document.querySelector("#web-page-select-all-btn");
const webPageClearAllBtn = document.querySelector("#web-page-clear-all-btn");
const webPageReadModeSelect = document.querySelector("#web-page-read-mode");
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

const sessionApiKeys = {
  google: "",
  dashscope: "",
};
const FULL_DOCUMENT_MAX_SELECTED_DOCS = 5;

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
  const files = Array.from(fileInput.files || []);
  if (!files.length) {
    selectedFileName.textContent = "Drop one or more files or click to browse";
    uploadButton.disabled = true;
    return;
  }

  if (files.length === 1) {
    const file = files[0];
    selectedFileName.textContent = `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`;
  } else {
    const totalSizeKb = Math.max(1, Math.round(files.reduce((sum, file) => sum + file.size, 0) / 1024));
    const previewNames = files.slice(0, 3).map((file) => file.name).join(", ");
    const suffix = files.length > 3 ? ` +${files.length - 3} more` : "";
    selectedFileName.textContent = `${files.length} files · ${totalSizeKb} KB · ${previewNames}${suffix}`;
  }

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

function renderWebPages() {
  if (!state.webPages.length) {
    webPageList.innerHTML = '<p class="empty-state">No session pages yet.</p>';
    webPagePickerList.innerHTML = '<p class="empty-state">No session pages available</p>';
    return;
  }

  webPageList.innerHTML = state.webPages
    .map((page) => `
      <div class="doc-card" data-id="${escapeHtml(page.id)}">
        <div class="doc-card-row">
          <div>
            <span class="doc-title">${escapeHtml(page.title || "Web page")}</span>
            <span class="doc-meta">${escapeHtml(page.url || "")}</span>
          </div>
          <button class="doc-delete-btn" data-id="${escapeHtml(page.id)}" title="Remove session page">&times;</button>
        </div>
      </div>
    `)
    .join("");

  webPageList.querySelectorAll(".doc-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.currentTarget.dataset.id;
      try {
        const resp = await fetch(`/api/web-pages/${encodeURIComponent(id)}`, { method: "DELETE" });
        const payload = await resp.json();
        if (!resp.ok) {
          throw new Error(payload.error || "Delete failed");
        }
        state.webPages = state.webPages.filter((page) => page.id !== id);
        state.selectedWebPageIds.delete(id);
        renderWebPages();
        renderWebPagePicker();
      } catch (err) {
        webStatus.textContent = err.message;
      }
    });
  });
}

function renderWebPagePicker() {
  if (!state.webPages.length) {
    webPagePickerList.innerHTML = '<p class="empty-state">No session pages available</p>';
    return;
  }

  webPagePickerList.innerHTML = state.webPages
    .map((page) => {
      const checked = state.selectedWebPageIds.has(page.id) ? "checked" : "";
      return `
        <label class="doc-picker-item">
          <input type="checkbox" value="${escapeHtml(page.id)}" ${checked} />
          <span class="doc-picker-title">${escapeHtml(page.title || "Web page")}</span>
          <span class="doc-picker-meta">${escapeHtml(page.url || "")}</span>
        </label>
      `;
    })
    .join("");

  webPagePickerList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) {
        state.selectedWebPageIds.add(cb.value);
      } else {
        state.selectedWebPageIds.delete(cb.value);
      }
      renderWebPagePicker();
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
      const disabled = !checked && state.selectedDocIds.size >= FULL_DOCUMENT_MAX_SELECTED_DOCS ? "disabled" : "";
      return `
        <label class="doc-picker-item">
          <input type="checkbox" value="${escapeHtml(doc.id)}" ${checked} ${disabled} />
          <span class="doc-picker-title">${escapeHtml(doc.title)}</span>
          <span class="doc-picker-meta">${escapeHtml(doc.filename)} · ${doc.chunkCount} chunks</span>
        </label>
      `;
    })
    .join("");

  docPickerList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) {
        if (state.selectedDocIds.size >= FULL_DOCUMENT_MAX_SELECTED_DOCS) {
          cb.checked = false;
          return;
        }
        state.selectedDocIds.add(cb.value);
      } else {
        state.selectedDocIds.delete(cb.value);
      }
      renderDocumentPicker();
    });
  });
}

function selectAllDocuments() {
  state.selectedDocIds.clear();
  state.documents
    .slice(0, FULL_DOCUMENT_MAX_SELECTED_DOCS)
    .forEach((doc) => state.selectedDocIds.add(doc.id));
  renderDocumentPicker();
}

function selectAllWebPages() {
  state.selectedWebPageIds.clear();
  state.webPages.forEach((page) => state.selectedWebPageIds.add(page.id));
  renderWebPagePicker();
}

function clearAllWebPages() {
  state.selectedWebPageIds.clear();
  renderWebPagePicker();
}

function renderModelOptions() {
  if (!state.models.length) {
    modelSelect.innerHTML = '<option value="">No models available</option>';
    modelSelect.disabled = true;
    return;
  }

  modelSelect.disabled = false;
  const providerNames = new Map(state.providers.map((provider) => [provider.id, provider.name]));
  const grouped = state.models.reduce((groups, model) => {
    const provider = model.provider || "google";
    if (!groups.has(provider)) {
      groups.set(provider, []);
    }
    groups.get(provider).push(model);
    return groups;
  }, new Map());

  modelSelect.innerHTML = Array.from(grouped.entries())
    .map(([provider, models]) => {
      const label = providerNames.get(provider) || provider;
      const options = models
        .map((model) => {
          const selected = model.id === state.selectedModel ? "selected" : "";
          const badge = model.badge ? ` · ${model.badge}` : "";
          return `<option value="${escapeHtml(model.id)}" ${selected}>${escapeHtml(model.name)}${escapeHtml(badge)}</option>`;
        })
        .join("");
      return `<optgroup label="${escapeHtml(label)}">${options}</optgroup>`;
    })
    .join("");
}

function clearAllDocuments() {
  state.selectedDocIds.clear();
  renderDocumentPicker();
}

docSelectAllBtn.addEventListener("click", selectAllDocuments);
docClearAllBtn.addEventListener("click", clearAllDocuments);
webPageSelectAllBtn.addEventListener("click", selectAllWebPages);
webPageClearAllBtn.addEventListener("click", clearAllWebPages);

function getSelectedDocumentIds() {
  return Array.from(state.selectedDocIds).slice(0, FULL_DOCUMENT_MAX_SELECTED_DOCS);
}

function getSelectedWebPageIds() {
  return Array.from(state.selectedWebPageIds);
}

function updateChatModeUI() {
  const isFullDocumentMode = chatModeSelect.value === "full-document";
  const isWebPageMode = chatModeSelect.value === "web-pages";

  documentFocusRow.hidden = !isFullDocumentMode;
  webPageFocusRow.hidden = !isWebPageMode;
  retrievalModeSelect.disabled = isFullDocumentMode || isWebPageMode;
  debugSearchToggle.disabled = isFullDocumentMode || isWebPageMode;

  if (isFullDocumentMode || isWebPageMode) {
    debugSearchToggle.checked = false;
  }

  if (isFullDocumentMode) {
    chatInput.placeholder = "Ask for a summary, comparison, or analysis of the selected documents...";
  } else if (isWebPageMode) {
    chatInput.placeholder = "Ask about the selected web pages...";
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

function buildStructuredAnswerHtml(payload) {
  const answer = extractRenderedAnswer(payload);
  const rawModelText = typeof payload?.rawModelText === "string" ? payload.rawModelText.trim() : "";
  const citations = Array.isArray(payload?.structured?.citations) ? payload.structured.citations : [];
  const followUpQuestions = Array.isArray(payload?.structured?.follow_up_questions) ? payload.structured.follow_up_questions : [];
  const processMeta = [];
  if (payload?.processingMode) {
    processMeta.push(payload.processingMode);
  }
  if (payload?.sliceCount && payload?.totalSliceCount) {
    processMeta.push(`${payload.sliceCount}/${payload.totalSliceCount} slices`);
  }

  if (!answer && rawModelText) {
    return `<p>${escapeHtml(rawModelText)}</p>`;
  }

  let html = `<p>${escapeHtml(answer)}</p>`;

  if (processMeta.length) {
    html += `
      <div class="structured-chat-section">
        <div class="structured-chat-label">Read Process</div>
        <div class="structured-chat-tags">
          ${processMeta.map((item) => `<span class="structured-chat-tag">${escapeHtml(item)}</span>`).join("")}
        </div>
      </div>
    `;
  }

  if (citations.length) {
    html += `
      <div class="structured-chat-section">
        <div class="structured-chat-label">Citations</div>
        <div class="structured-chat-tags">
          ${citations.map((item) => `<span class="structured-chat-tag">${escapeHtml(item)}</span>`).join("")}
        </div>
      </div>
    `;
  }

  if (followUpQuestions.length) {
    html += `
      <div class="structured-chat-section">
        <div class="structured-chat-label">Follow-up Questions</div>
        <ul class="structured-chat-list">
          ${followUpQuestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  return html;
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
  if (payload.wikiInjectedSeparately) {
    lines.push("Wiki files are not shown here because they are injected separately at answer time.");
  }

  return lines.join("\n");
}

function extractRenderedAnswer(payload) {
  if (typeof payload?.structured?.answer === "string" && payload.structured.answer.trim()) {
    return payload.structured.answer.trim();
  }

  return typeof payload?.answer === "string" ? payload.answer : "";
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
      <div class="msg-body"><p>Hi! Upload a document, ask a question, or switch to Full document mode to summarize one or more selected files.</p></div>
    </div>
  `;
  renderSources([]);

  if (resetServer) {
    resetSessionOnServer().catch((error) => {
      console.error("Failed to reset session:", error.message);
    });
  }
}

function getApiKeys() {
  return {
    google: apiKeyInput.value.trim() || sessionApiKeys.google,
    dashscope: dashscopeApiKeyInput.value.trim() || sessionApiKeys.dashscope,
  };
}

async function saveApiKey(provider, input, statusEl) {
  const value = input.value.trim();
  if (!value) {
    sessionApiKeys[provider] = "";
    statusEl.textContent = "Key cleared.";
    return "";
  }

  try {
    const response = await fetch("/api/save-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey: value }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to save key.");
    }
    sessionApiKeys[provider] = value;
    statusEl.textContent = "Key saved to .env. It will persist across restarts.";
  } catch (err) {
    sessionApiKeys[provider] = value;
    statusEl.textContent = "Saved for this session only. Server error: " + err.message;
  }
  return sessionApiKeys[provider];
}

function hydrateApiKey() {
  sessionApiKeys.google = "";
  sessionApiKeys.dashscope = "";
  apiKeyInput.value = "";
  dashscopeApiKeyInput.value = "";
  keyStatus.textContent = "No session key. Enter your Gemini API key above.";
  dashscopeKeyStatus.textContent = "No session key. Enter your DashScope API key above.";
}

async function loadDocuments() {
  const response = await fetch("/api/documents");
  const payload = await response.json();
  state.documents = payload.documents || [];
  renderDocuments();
  renderDocumentPicker();
  updateChatModeUI();
}

async function loadWebPages() {
  try {
    const response = await fetch("/api/web-pages");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load session pages.");
    }
    state.webPages = payload.pages || [];
    state.selectedWebPageIds = new Set(
      Array.from(state.selectedWebPageIds).filter((id) => state.webPages.some((page) => page.id === id))
    );
    renderWebPages();
    renderWebPagePicker();
  } catch (error) {
    webPageList.innerHTML = '<p class="empty-state">Could not load session pages.</p>';
  }
}

async function uploadSingleDocument(file, apiKey) {
  const formData = new FormData();
  formData.append("file", file);

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

  return payload;
}

uploadButton.addEventListener("click", async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) {
    uploadStatus.textContent = "Choose one or more files first.";
    return;
  }

  uploadButton.disabled = true;
  uploadStatus.textContent = files.length === 1 ? "Converting and indexing..." : `Uploading and indexing ${files.length} files...`;

  try {
    const apiKey = getApiKeys().google;
    const results = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      uploadStatus.textContent = files.length === 1
        ? `Converting and indexing ${file.name}...`
        : `Uploading ${index + 1}/${files.length}: ${file.name}`;

      try {
        const payload = await uploadSingleDocument(file, apiKey);
        results.push({
          filename: payload.document?.filename || file.name,
          indexingStatus: payload.indexingStatus || "unknown",
          ok: true,
        });
      } catch (error) {
        results.push({
          filename: file.name,
          ok: false,
          error: error.message,
        });
      }
    }

    const indexedCount = results.filter((item) => item.ok && item.indexingStatus === "indexed").length;
    const uploadedOnlyCount = results.filter((item) => item.ok && item.indexingStatus !== "indexed").length;
    const failedCount = results.filter((item) => !item.ok).length;

    const statusParts = [];
    if (indexedCount) {
      statusParts.push(`${indexedCount} indexed`);
    }
    if (uploadedOnlyCount) {
      statusParts.push(`${uploadedOnlyCount} uploaded with indexing pending/failed`);
    }
    if (failedCount) {
      statusParts.push(`${failedCount} failed`);
    }

    uploadStatus.textContent = statusParts.length
      ? `Batch complete: ${statusParts.join(" · ")}`
      : "No files were processed.";

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

function parseWebUrls(value) {
  return [...new Set(
    String(value || "")
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter((part) => /^https?:\/\//i.test(part))
  )];
}

webSummarizeButton.addEventListener("click", async () => {
  const urls = parseWebUrls(webUrlInput.value);
  if (!urls.length) {
    webStatus.textContent = "Paste one or more public URLs first.";
    return;
  }

  webSummarizeButton.disabled = true;
  webStatus.textContent = `Opening ${urls.length} page${urls.length === 1 ? "" : "s"}...`;

  try {
    const response = await fetch("/api/web-pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls,
        summarize: false,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Web page import failed.");
    }

    const pages = payload.pages || (payload.page ? [payload.page] : []);
    const existingIds = new Set(state.webPages.map((page) => page.id));
    state.webPages = [
      ...pages.filter((page) => !existingIds.has(page.id)),
      ...state.webPages,
    ];
    pages.forEach((page) => state.selectedWebPageIds.add(page.id));
    renderWebPages();
    renderWebPagePicker();
    const failedCount = Array.isArray(payload.failures) ? payload.failures.length : 0;
    webStatus.textContent = failedCount
      ? `Added ${pages.length} page${pages.length === 1 ? "" : "s"}. ${failedCount} URL${failedCount === 1 ? "" : "s"} failed.`
      : `Added ${pages.length} page${pages.length === 1 ? "" : "s"} for this session.`;
    webUrlInput.value = "";
  } catch (error) {
    webStatus.textContent = error.message;
  } finally {
    webSummarizeButton.disabled = false;
  }
});

saveKeyButton.addEventListener("click", () => {
  saveApiKey("google", apiKeyInput, keyStatus);
});

saveDashscopeKeyButton.addEventListener("click", () => {
  saveApiKey("dashscope", dashscopeApiKeyInput, dashscopeKeyStatus);
});

showKeyToggle.addEventListener("change", () => {
  const inputType = showKeyToggle.checked ? "text" : "password";
  apiKeyInput.type = inputType;
  dashscopeApiKeyInput.type = inputType;
});

modelSelect.addEventListener("change", () => {
  state.selectedModel = modelSelect.value;
});

chatModeSelect.addEventListener("change", () => {
  updateChatModeUI();
  if (chatModeSelect.value === "full-document") {
    selectAllDocuments();
  } else if (chatModeSelect.value === "web-pages") {
    selectAllWebPages();
  }
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

async function* parseSSEStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try { yield JSON.parse(line.slice(6)); } catch {}
    }
  }
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = chatInput.value.trim();
  if (!question) return;
  const chatMode = chatModeSelect.value;
  const isDebugSearch = debugSearchToggle.checked;

  if (chatMode === "full-document" && !state.documents.length) {
    renderChatMessage("assistant", "Please upload at least one document first before using Full document mode.");
    return;
  }

  if (chatMode === "full-document" && state.selectedDocIds.size === 0) {
    renderChatMessage("assistant", "Select one or more target documents before using Full document mode.");
    return;
  }

  if (chatMode === "web-pages" && !state.webPages.length) {
    renderChatMessage("assistant", "Add one or more web pages first before using Web pages mode.");
    return;
  }

  if (chatMode === "web-pages" && state.selectedWebPageIds.size === 0) {
    renderChatMessage("assistant", "Select one or more target web pages before using Web pages mode.");
    return;
  }

  const selectedDocumentIds = chatMode === "full-document" ? getSelectedDocumentIds() : [];
  const selectedWebPageIds = chatMode === "web-pages" ? getSelectedWebPageIds() : [];

  renderChatMessage("user", question);
  chatInput.value = "";
  chatInput.style.height = "auto";

  try {
    const apiKeys = getApiKeys();
    const webPageReadMode = webPageReadModeSelect?.value || "auto";
    const useStreaming = chatMode === "qa" && !isDebugSearch;

    const loadingText = isDebugSearch
      ? "Searching..."
      : chatMode === "web-pages" && webPageReadMode === "full-scan"
        ? "Scanning every selected web page chunk..."
        : chatMode === "web-pages"
          ? "Reading the selected web pages..."
          : chatMode === "full-document"
            ? "Reading the full document..."
            : "Generating answer...";

    renderChatMessage("assistant", loadingText);

    const requestBody = {
      question,
      history: state.history,
      apiKey: apiKeys.google,
      apiKeys,
      model: state.selectedModel,
      chatMode,
      documentId: chatMode === "full-document" ? (selectedDocumentIds[0] || "") : "",
      documentIds: selectedDocumentIds,
      webPageId: chatMode === "web-pages" ? (selectedWebPageIds[0] || "") : "",
      webPageIds: selectedWebPageIds,
      webPageReadMode: chatMode === "web-pages" ? webPageReadMode : "auto",
      retrievalMode: retrievalModeSelect.value,
    };

    if (useStreaming) {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok || !response.body) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.error || "Streaming request failed.");
      }

      const msgBody = chatLog.querySelector(".msg:last-child .msg-body");
      const msgPara = msgBody?.querySelector("p");
      let streamedText = "";

      for await (const event of parseSSEStream(response)) {
        if (event.type === "error") throw new Error(event.error || "Streaming error.");
        if (event.type === "start") renderSources(event.chunks || []);
        if (event.type === "token") {
          streamedText += event.text;
          if (msgPara && streamedText) msgPara.textContent = streamedText;
          chatLog.scrollTop = chatLog.scrollHeight;
        }
      }

      if (streamedText) {
        state.history.push({ role: "user", content: question });
        state.history.push({ role: "assistant", content: streamedText });
      }
    } else {
      const requestPath = isDebugSearch ? "/api/search" : "/api/chat";
      const response = await fetch(requestPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Chat failed.");
      }

      const renderedAnswer = extractRenderedAnswer(payload);
      const lastMsgBody = chatLog.querySelector(".msg:last-child .msg-body");
      const lastMsg = lastMsgBody?.querySelector("p");
      if (lastMsgBody) {
        if (isDebugSearch) {
          lastMsgBody.innerHTML = `<p>${escapeHtml(buildSearchDebugSummary(payload))}</p>`;
        } else if (payload.structured || (typeof payload.rawModelText === "string" && payload.rawModelText.trim())) {
          lastMsgBody.innerHTML = buildStructuredAnswerHtml(payload);
        } else if (lastMsg) {
          lastMsg.textContent = renderedAnswer;
        } else {
          lastMsgBody.innerHTML = `<p>${escapeHtml(renderedAnswer)}</p>`;
        }
      }

      if (!isDebugSearch) {
        state.history.push({ role: "user", content: question });
        state.history.push({ role: "assistant", content: renderedAnswer });
      }

      renderSources(payload.chunks);
    }
  } catch (error) {
    const lastMsg = chatLog.querySelector(".msg:last-child .msg-body p");
    if (lastMsg) lastMsg.textContent = error.message;
  }
});

chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + "px";
});

async function loadModels() {
  try {
    const response = await fetch("/api/models");
    const payload = await response.json();
    state.providers = payload.providers || [];
    state.models = payload.models || [];
    state.selectedModel = payload.defaultModel || state.models[0]?.id || "";
    renderModelOptions();
  } catch (error) {
    console.error("Failed to load models:", error.message);
    renderModelOptions();
  }
}

hydrateApiKey();
updateChatModeUI();
updateSelectedFileUI();
loadDocuments().catch((error) => { uploadStatus.textContent = error.message; });
loadWebPages();
loadWikiFiles();
loadModels();
