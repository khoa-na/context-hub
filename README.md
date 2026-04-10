# llm-wiki

Simple app to:

- upload your own files
- convert it into a stored `.md` file
- ask questions across all uploaded documents via the Google Gemini API

## What this starter supports

- `.txt`, `.md`, `.json`
- `.csv`, `.tsv`, `.html`, `.xml`
- `.docx`
- source code files like `.js`, `.ts`, `.py`, `.java`

This version is intentionally small, chat-first, and supports `.docx` in addition to text-like files.

## Run locally

1. Optional: copy `.env.example` to `.env` and set `GEMINI_API_KEY`.
2. Start the app:

```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000).
4. Paste your Gemini API key into the settings box in the UI, or rely on `.env`.

If you enter the key in the UI, it is kept only in the current in-memory browser session. Reloading the page or closing the app clears it.

By default, the app uses `gemma-4-31b-it`. You can override it with `GEMINI_MODEL` in `.env`.

## How it works

1. The browser uploads the selected file as-is.
2. The server converts that content into Markdown and saves it under `data/documents/`.
3. When you ask a question, the server chunks all uploaded documents, retrieves the most relevant sections with simple keyword scoring, and sends only those chunks to the model.
4. The model answers using just that retrieved context.

## UI behavior

- The chat area is the main workspace.
- Questions search across all uploaded documents by default.
- `Enter` sends a message.
- `Shift + Enter` inserts a new line.
- Uploaded documents are shown as a reference list only; the app no longer previews stored Markdown in the main UI.

## Notes

- The app uses Gemini's `generateContent` REST API with `systemInstruction` and `contents`, matching Google's current API docs.
- If the answer is not present in the uploaded document, the prompt tells the model to say it does not know based on the file.
- `.docx` conversion is handled by `mammoth`.
- For PDFs, the next step would be adding a document parsing layer before Markdown conversion.
- Uploaded documents are stored only under `data/`, and `data/` is gitignored so each person can keep their own local document library without pushing it to GitHub.
