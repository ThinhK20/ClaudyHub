# QA Hub

Desktop successor to `qa-portal`: a workspace for QA testers to browse the regression library, run test windows, and ask AI assistants that can read the product's codebase.

Built with Electron, React 19, TypeScript, Tailwind CSS v4 and SQLite (Node's built-in `node:sqlite`).

## Getting started

```powershell
cd qa-hub
npm install
npm run dev        # start the app with hot reload
```

On first launch QA Hub asks for:

1. **A QA workspace**: the folder with your test cases and checklists (a checkout of `qa-regression-management`). It is indexed read-only.
2. **Codebases**: source folders the AI assistants may read. Connect as many as you like; one is the default.
3. **An AI engine**: GitHub Copilot CLI (uses your existing `copilot` sign-in) or Claude (needs an Anthropic API key, stored with the OS secure storage).

## Connecting codebases

The **Codebases** page registers local folders (native folder picker), shows their git branch and HEAD, and marks one as the default. Every run stores its own codebase, and each AI question can switch codebase (or use none).

AI access is always read-only:

| Engine | How read-only is enforced |
| --- | --- |
| GitHub Copilot CLI | `--add-dir <codebase>`, `--deny-tool=write`, `--disable-builtin-mcps`, and only read-only shell tools allowed (`rg`, `grep`, `cat`, `ls`, `git log/show/diff/grep/blame`). |
| Claude Agent SDK | Only the `Read`, `Glob` and `Grep` tools exist (`tools` option), `permissionMode: 'dontAsk'`, no settings loaded from disk, and a `PreToolUse` hook that denies any path outside the codebase. |

## Features (v1)

- **Library**: test cases, regression checklists, releases, run reports and guides from the workspace, with full-text search (SQLite FTS5), live re-indexing when files change, Mermaid diagrams, and workspace images.
- **Test runs**: draft → ready → testing → completed (or rejected).
  - Edit cases, or have the AI add up to five.
  - Approve, which assigns six-digit case numbers above every number already used.
  - Record passed/failed/blocked with notes, evidence links and screenshots or recordings.
  - Finish with a computed outcome.
- **Ask AI** and **Test Assistant**:
  - Streaming answers, cancellation and saved history.
  - Usage shown per answer.
  - A codebase and engine picker on every question.
- **Import from qa-portal**: Settings → Import copies runs, results, evidence and chats from `qa-portal/.data`.

Planned next: GitHub ticket sync and assignment polling, report-PR publishing, issue comments and project-board updates, the bug-report dialog, related cards, the repository file editor, and an MCP bridge for `create_qa_run_draft`.

## Project layout

```
src/shared/     IPC contract (zod input schemas + output types) and domain types
src/preload/    contextBridge: invoke(channel, input) and on(event) only
src/main/       Electron main process
  app-context.ts    composition root: services + one handler per IPC channel
  db/               node:sqlite connection and append-only migrations
  modules/          workspaces, codebases, docs, runs, evidence, ai, settings, import
src/renderer/   React UI (TanStack Router + Query, Tailwind, Radix)
tests/          Vitest unit and integration tests
e2e/            Playwright tests that drive the built Electron app
```

Data lives in the Electron `userData` folder: `qa-hub.db` (SQLite) and `evidence/<runId>/`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app in development |
| `npm run typecheck` | Type-check main/preload and renderer |
| `npm run lint` | ESLint |
| `npm test` / `npm run test:coverage` | Unit and integration tests (coverage threshold 80%) |
| `npm run test:e2e` | Build, then drive the app with Playwright (stub AI engines) |
| `npm run build:win` | Build a Windows installer into `dist/` |

## Security model

- `contextIsolation`, `sandbox` and no `nodeIntegration`.
- Strict Content Security Policy; no remote content.
- Every IPC call is zod-validated in the main process and only accepted from the app's own window.
- Navigation and new windows are blocked; web links open in the system browser.
- Evidence and workspace images are served through `qa-evidence://` and `qa-workspace://`, which only resolve known attachments or image files inside the active workspace.
"# ClaudyHub" 
