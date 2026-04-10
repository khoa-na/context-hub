const state = {
  documents: [],
  history: [],
};

const fileInput = document.querySelector("#file-input");
const pickFileButton = document.querySelector("#pick-file-button");
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
let sessionApiKey = "";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function updateSelectedFileUI() {
  const file = fileInput.files[0];
  if (!file) {
    selectedFileName.textContent = "No file selected yet";
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
    .map((document) => {
      return `
        <article class="doc-card">
          <span class="doc-title">${escapeHtml(document.title)}</span>
          <span class="doc-meta">${escapeHtml(document.filename)} · ${document.chunkCount} chunks</span>
        </article>
      `;
    })
    .join("");
}

function renderChatMessage(role, content) {
  const article = document.createElement("article");
  article.className = `bubble ${role}`;
  article.innerHTML = `<strong>${role === "assistant" ? "Assistant" : "You"}</strong><p>${escapeHtml(content)}</p>`;
  chatLog.append(article);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderSources(chunks) {
  if (!chunks || !chunks.length) {
    sourceList.textContent = "No retrieval yet.";
    return;
  }

  sourceList.innerHTML = chunks
    .map(
      (chunk) => `
        <article class="source-item">
          <strong>${escapeHtml(chunk.id)} · ${escapeHtml(chunk.documentTitle || "Document")} · ${escapeHtml(chunk.title)}</strong>
          <p>${escapeHtml(chunk.filename || "")}</p>
          <p>${escapeHtml(chunk.preview)}...</p>
        </article>
      `
    )
    .join("");
}

function resetConversation() {
  state.history = [];
  chatLog.innerHTML = `
    <article class="bubble assistant">
      <strong>Assistant</strong>
      <p>Ask about any uploaded file. I will search across all uploaded documents.</p>
    </article>
  `;
  renderSources([]);
}

function saveApiKey() {
  const value = apiKeyInput.value.trim();
  if (!value) {
    sessionApiKey = "";
    keyStatus.textContent = "Session key cleared. The app will fall back to `.env` if available.";
    return "";
  }

  sessionApiKey = value;
  keyStatus.textContent = "Gemini API key saved only for this session. Reloading or closing the app will clear it.";
  return value;
}

function hydrateApiKey() {
  sessionApiKey = "";
  apiKeyInput.value = "";
  keyStatus.textContent = "No session key saved. The app will use `.env` if the server has one.";
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
  uploadStatus.textContent = "Converting and saving...";

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

    uploadStatus.textContent = `Saved ${payload.document.filename} as Markdown.`;
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

pickFileButton.addEventListener("click", () => {
  fileInput.click();
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

  if (!question) {
    return;
  }

  renderChatMessage("user", question);
  chatInput.value = "";

  try {
    const apiKey = apiKeyInput.value.trim() || sessionApiKey;

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question,
        history: state.history,
        apiKey,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Chat failed.");
    }

    state.history.push({ role: "user", content: question });
    state.history.push({ role: "assistant", content: payload.answer });
    renderChatMessage("assistant", payload.answer);
    renderSources(payload.chunks);
  } catch (error) {
    renderChatMessage("assistant", error.message);
  }
});

apiKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveApiKey();
  }
});

hydrateApiKey();
updateSelectedFileUI();
loadDocuments().catch((error) => {
  uploadStatus.textContent = error.message;
});
