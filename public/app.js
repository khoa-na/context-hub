const state = {
  documents: [],
  history: [],
};

const fileInput = document.querySelector("#file-input");
const selectedFileName = document.querySelector("#selected-file-name");
const uploadButton = document.querySelector("#upload-button");
const uploadStatus = document.querySelector("#upload-status");
const documentList = document.querySelector("#document-list");
const apiKeyInput = document.querySelector("#api-key-input");
const saveKeyButton = document.querySelector("#save-key-button");
const showKeyToggle = document.querySelector("#show-key-toggle");
const keyStatus = document.querySelector("#key-status");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatLog = document.querySelector("#chat-log");
const sourceList = document.querySelector("#source-list");
const sourcesToggle = document.querySelector("#sources-toggle");
const sourcesCount = document.querySelector("#sources-count");
const settingsToggle = document.querySelector("#settings-toggle");
const settingsPanel = document.querySelector("#settings-panel");
const wikiFileInput = document.querySelector("#wiki-file-input");
const wikiFileName = document.querySelector("#wiki-file-name");
const wikiUploadButton = document.querySelector("#wiki-upload-button");
const wikiUploadStatus = document.querySelector("#wiki-upload-status");
const wikiList = document.querySelector("#wiki-list");

let sessionApiKey = "";

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
      <div class="doc-card">
        <span class="doc-title">${escapeHtml(doc.title)}</span>
        <span class="doc-meta">${escapeHtml(doc.filename)} · ${doc.chunkCount} chunks</span>
      </div>
    `)
    .join("");
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
      (chunk) => `
        <div class="source-item">
          <strong>${escapeHtml(chunk.id)} · ${escapeHtml(chunk.title)}</strong>
          <p class="source-file">${escapeHtml(chunk.filename || "")}</p>
          <details>
            <summary>Matched passage</summary>
            <p>${escapeHtml((chunk.childContent || "").slice(0, 300))}</p>
          </details>
          <details>
            <summary>Full section context</summary>
            <p>${escapeHtml((chunk.content || "").slice(0, 600))}</p>
          </details>
        </div>
      `
    )
    .join("");
}

function resetConversation() {
  state.history = [];
  chatLog.innerHTML = `
    <div class="msg msg-system">
      <span class="msg-avatar">&#9670;</span>
      <div class="msg-body"><p>Hi! Upload a document or ask a question. I search across all your docs using hybrid retrieval.</p></div>
    </div>
  `;
  renderSources([]);
}

function saveApiKey() {
  const value = apiKeyInput.value.trim();
  if (!value) {
    sessionApiKey = "";
    keyStatus.textContent = "Session key cleared.";
    return "";
  }
  sessionApiKey = value;
  keyStatus.textContent = "Key saved for this session.";
  return value;
}

function hydrateApiKey() {
  sessionApiKey = "";
  apiKeyInput.value = "";
  keyStatus.textContent = "No session key. Server .env will be used if available.";
}

async function loadDocuments() {
  const response = await fetch("/api/documents");
  const payload = await response.json();
  state.documents = payload.documents || [];
  renderDocuments();
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

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : {};
    if (!response.ok) {
      throw new Error(payload.error || "Upload failed.");
    }

    uploadStatus.textContent = `Indexed ${payload.document.filename} (${payload.document.chunkCount} chunks)`;
    await loadDocuments();
    resetConversation();
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

showKeyToggle.addEventListener("change", () => {
  apiKeyInput.type = showKeyToggle.checked ? "text" : "password";
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
  if (!state.documents.length) {
    renderChatMessage("assistant", "Please upload at least one document first.");
    return;
  }
  if (!question) return;

  renderChatMessage("user", question);
  chatInput.value = "";
  chatInput.style.height = "auto";

  try {
    const apiKey = apiKeyInput.value.trim() || sessionApiKey;

    renderChatMessage("assistant", "Thinking...");

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history: state.history, apiKey }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Chat failed.");
    }

    const lastMsg = chatLog.querySelector(".msg:last-child .msg-body p");
    if (lastMsg) lastMsg.textContent = payload.answer;

    state.history.push({ role: "user", content: question });
    state.history.push({ role: "assistant", content: payload.answer });
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

hydrateApiKey();
updateSelectedFileUI();
loadDocuments().catch((error) => { uploadStatus.textContent = error.message; });
loadWikiFiles();