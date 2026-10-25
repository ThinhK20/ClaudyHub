# Editor AI assistant: design

Date: 2026-10-25 · Status: draft for approval

## Intent

While editing a workspace document (test case, checklist, regression asset), the user can ask AI to change or add
content in their own words, using the whole document as context, and decide what to do with the answer before
anything touches the document. Inspired by the Notion-style flow: right-click → AI assistant → Ask AI… → floating
panel → reviewed result → Insert below / Replace.

The assistant is freeform: "do whatever the user wants" with the current file as context. It is not a fixed set of
transformations.

## Goals

- **Entry point:** the editor's right-click menu (built in the previous change, `components/text-context-menu.tsx`)
  gains an **AI assistant** submenu at the top, available **only in edit mode**. Read mode's menu is unchanged.
- **Submenu contents:**
  - **Ask AI…** opens the panel with an empty prompt.
  - One-click shortcuts that behave exactly like typing that request into the panel. They open the panel and submit
    immediately: Fix typos, Improve writing, Summarize, Explain, Continue writing, plus submenus Adjust (Shorter /
    Longer / Simpler), Change tone (Professional / Casual / Direct), Reformat (As checklist / As table / As bullet
    list / As numbered steps) and Translate (a short list of languages: English, Vietnamese, Japanese, Chinese,
    Korean, French, German, Spanish).
  - **Engine: …**, a submenu showing the configured AI engines (see Constraints). It picks the engine used by the
    next request and shows the current one.
- **Floating panel** (Image 2 and 3 in the conversation):
  - Header "AI assistant" with a close button.
  - A prompt box ("Describe a change then press Enter"). Enter submits and Shift+Enter adds a newline. The engine
    picker sits below the box and the submit button on its right.
  - While running: the streamed text so far and a Stop button, which cancels through the existing `ai:cancel`.
  - When done:
    - A **Result** tab renders the proposal with the app's Markdown renderer (`components/markdown.tsx`), so tables,
      checklists and Mermaid diagrams look as they will in the document.
    - A **Changes** tab shows the original selection against the proposal as a line-level diff with additions and
      removals marked. It is hidden when there was no selection.
    - The header line shows the engine/model and token count from `AiUsage`, plus a Regenerate button that re-runs
      the same prompt.
  - A follow-up prompt box under the result refines it ("shorter", "add a negative case"). Each follow-up sends the
    previous proposal plus the new instruction, and the result replaces the shown proposal.
  - Actions: **Insert below**, which inserts after the selection (or at the cursor with no selection), and
    **Replace**, which replaces the selection and is hidden with no selection. Either action closes the panel.
  - Escape or the close button discards the proposal. Nothing is applied.
- **Applying** a result parses its Markdown into editor content through Tiptap's Markdown support, so headings, lists,
  checklists, tables and Mermaid code blocks become real document structure. Applying is one undoable editor step.
  It marks the document as having unsaved changes and never saves on its own.

## Non-goals

- No AI in read mode (the user's decision).
- No codebase access: the request is document-only, so answers stay fast. The codebase can be added later.
- No chat history persistence. A panel session lives until the panel closes.
- No automatic saving and no direct file writes.
- No inline "ghost text" or autocomplete.

## Anti-goals (failure even if it "works")

- AI output landing in the document without the user choosing Insert or Replace.
- Applying a result that loses structure (tables flattened to text, checklists turned into plain bullets) when the
  same Markdown would load correctly from a file.
- A request that silently uses a different engine or model than the panel shows.
- Document text treated as instructions: the document and selection are untrusted data (same rule as
  `TEXT_INSTRUCTION`).

## Constraints / existing pieces to build on

- **AI engines:** `main/modules/ai/provider.ts` (`AiProvider`, `executeJob`, `JobRegistry`). Engines are `claude` (Agent
  SDK with an API key, model from `settings.claudeModel`) and `copilot` (GitHub Copilot subscription). `ai:providers`
  reports which are available, and `settings.defaultProvider` is the default.
- **Streaming:** the renderer's `useAiJob` with `ai:event` deltas and status. Cancel goes through `ai:cancel`.
- **New IPC:** add one call, e.g. `ai:editDoc`, with input `{ jobId, provider, docPath, document, selection, prompt,
  previous? }` and output `{ text, usage }`. It runs with `codebase: null` and `output: 'text'`, validated with zod
  like the other channels in `shared/ipc.ts`.
- **Prompt contract:** the instruction tells the model to return only the replacement or insertion Markdown for the
  selection (or for the cursor position), without commentary or fences around the whole answer, and to keep the
  document's existing conventions (heading levels, checklist style). The document is sent in full. Above a size
  limit, such as 60k characters, it is trimmed around the selection, and the prompt says so.
- **Selection source:** when the panel opens, capture the editor selection's Markdown (`editorSelectionMarkdown` from
  `features/library/selection-markdown.ts`) and its ProseMirror range. The range is mapped through later
  transactions, so applying still hits the right place if the user edited meanwhile. If the selected content was
  deleted, Replace falls back to Insert at the mapped position.
- **Desktop app conventions:** Radix UI (`radix-ui`), Tailwind tokens (`bg-surface`, `border-line`, `text-muted`…),
  lucide icons, sonner toasts for errors, React Query for `ai:providers`.

## Decided by the user

- Freeform assistant using the current file as context, with shortcuts as one-click prompts.
- Results are shown first (Result and Changes) and never inserted automatically. Insert below, Replace and Regenerate
  are available, plus a follow-up prompt.
- Uses the configured provider (API key or subscription).
- Edit mode only.
- With no selection, every shortcut is greyed out. Only **Ask AI…** works then, and its result can only be inserted at
  the cursor.

## Calls made by Claude (please check)

- The "model picker" is an **engine picker** (Claude · <configured model> / Copilot), because the app stores one
  Claude model in Settings and Copilot picks its own. A per-request model list is left for later.
- Panel placement: anchored below the selection's bounding box and flipped above when there is no room, using Radix
  Popover with a virtual anchor. It is draggable-free and about 520px wide.
- Translate languages and the Adjust, Tone and Reformat options listed above.
- Changes tab: a line-level diff of the selection's Markdown against the proposal, written in-house (an LCS over
  lines) rather than a new dependency.
- With no selection, "Insert below" inserts at the cursor's block end.
- **Partial-block selections:** when the selection sits inside one textblock (a few words of a paragraph, list item or
  table cell), Replace puts the result back inline. The prompt tells the model it is replacing inline text, and a
  one-paragraph answer is inserted as inline content, so the paragraph or table is not split. Selections spanning
  blocks are replaced as blocks.
- **Summarize and Explain** produce commentary, so they offer only Insert below (no Replace). Every other shortcut and
  freeform prompt offers both.
- **Engine choice** is panel state, shared by the submenu and the panel picker, and remembered in `localStorage` for
  convenience. It never writes `settings.defaultProvider`, which still provides the initial value.
- **"The document"** is the live editor content (`editor.getMarkdown()`, including unsaved edits) plus the file's
  frontmatter as read-only context. Each follow-up resends the document, the original selection and the previous
  proposal. The Changes tab always diffs against the original selection.
- If an engine reports no token counts, the header shows the elapsed time instead.

## Left to the builder

- Exact prompt wording and the trim size.
- Component split, styling details and the stub-provider behaviour for e2e (the `QA_HUB_AI_STUB` engine must return a
  deterministic proposal so an e2e test can cover Ask AI → Result → Replace).
- Unit tests for the prompt builder and diff, and one e2e test for the flow.
