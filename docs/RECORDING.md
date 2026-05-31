# Recording the demo GIF

The README references `docs/demo.gif`. Record a short clip that shows the core
loop, export it as a GIF, drop it here, then uncomment the image tag in the
`## Demo` section of `README.md`.

## What to show (~15–20 seconds)

Keep it tight and let the value land in the first few seconds:

1. Upload a document (drag a `.md`/`.pdf`-style file into the dropzone) and let
   it index.
2. Type a question in **Q&A** mode.
3. Show the answer **streaming in** token by token.
4. Briefly expand the **Retrieved sources** panel so the grounding/citations are
   visible.

Optional second clip ideas: **Full document** mode summarizing a long file, or
**Web pages** mode answering about an imported URL.

## Tips for a clean recording

- Resize the browser to ~1280×800 so the GIF isn't huge.
- Use a sample file from `samples/` so you don't need private data.
- Hide secrets: don't show the API-key settings panel with a real key.
- Trim dead time — start recording right before the action.

## Tools

- **Windows:** [ScreenToGif](https://www.screentogif.com/) (free, records a region straight to GIF).
- **macOS:** [Kap](https://getkap.co/) or QuickTime → convert to GIF.
- **Cross-platform:** record an `.mp4`, then convert with ffmpeg:

  ```bash
  ffmpeg -i demo.mp4 -vf "fps=12,scale=1000:-1:flags=lanczos" -loop 0 docs/demo.gif
  ```

## Keep the file small

Aim for **under ~5 MB** so the README loads quickly on GitHub:

- 10–12 fps is plenty for a UI demo.
- Cap the width around 1000px.
- Keep it short; loop instead of recording multiple takes.

## Finish

1. Save the file as `docs/demo.gif`.
2. In `README.md`, uncomment:
   ```markdown
   ![context-hub demo](docs/demo.gif)
   ```
3. Remove the placeholder note line beneath it.
