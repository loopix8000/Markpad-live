# Markpad Live

Markpad Live is a desktop Markdown editor for Windows, macOS and Linux. Open a Markdown file and type in the rendered document. Save writes Markdown through the same Rust file and encoding routines used by the original Markpad.

## Editing documents

Use the existing formatting toolbar or keyboard shortcuts for headings, bold, italic, underline, strikethrough, lists, quotes, links, inline code, fenced code and tables. Click a task checkbox to update it. Type an image in Markdown, paste an image, or drop an image from your file manager. Saved documents use their configured image directory. Untitled documents embed image data directly in Markdown. Double-click an image to edit its destination.

Tabs keep their own selections and undo history while they are open. Recent files, window and session restoration, external file changes, the outline, Zen mode, themes, fonts, HTML export and PDF printing use Markpad's document and preview infrastructure.

| View | Working with a document |
| --- | --- |
| Live editing | Edit rendered CommonMark and GFM with Milkdown. |
| Reading preview (file-opening preference) | Read the document with Markpad's Rust renderer, including KaTeX and Mermaid. |
| Split | Edit the rendered document on the left or its Markdown source on the right. Both panes share the tab’s file buffer. |
| Source editing | Edit Markdown directly. The code icon opens this mode. |

GitHub-style tables, task lists, strikethrough and footnotes have editor nodes. Mermaid remains an editable fenced code block. Blocks containing YAML front matter, math, wikilinks, callouts, reference definitions or unsupported HTML can be edited as Markdown text. The editor context menu also lets you edit the current block as Markdown, including the syntax for a new extension. Use Preview to see Markpad's rendering of these extensions. Non-Markdown files use literal text editing.

The editor retains the original spelling of untouched blocks, including setext headings, reference definitions and line endings. Editing a formatted block can change its delimiters or spacing when Milkdown serializes it. Open and close a document without editing to retain its original source. Vim mode, the Monaco minimap and source-language IntelliSense are outside this editor.

## Development

The desktop shell uses Tauri 2 and Rust. SvelteKit, Svelte 5, TypeScript and Vite implement the interface. Milkdown Kit 7.23 uses ProseMirror with the CommonMark and GFM presets. The application uses the existing Markpad toolbar, theme and file handling. Comrak, KaTeX and Mermaid power the reading and export views.

Install Node.js 24, Rust stable and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
npm ci
npm run tauri dev
```

```sh
npm run check
npm run lint
npm test
npm run test:vitest
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

For a local installer without updater signing, build with the Tauri configuration override `{"bundle":{"createUpdaterArtifacts":false}}`. Distribution and signing setup are in [RELEASING.md](RELEASING.md).

## Origin and license

Markpad Live is a fork of [Markpad](https://github.com/sftwrdotdev/Markpad) by Alec Ames and contributors. It retains the original BSD 3-Clause license and copyright notice in [LICENSE](LICENSE). The live editor uses the MIT-licensed [Milkdown](https://github.com/Milkdown/milkdown).
