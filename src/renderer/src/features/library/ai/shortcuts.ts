/** A one-click AI request. It behaves exactly as if the user typed `prompt` into the panel. */
export interface AiShortcut {
  id: string
  label: string
  prompt: string
  /** Commentary rather than an edit: offered only as Insert below. */
  insertOnly?: boolean
}

export interface AiShortcutGroup {
  label: string
  items: AiShortcut[]
}

/** What the panel opens with. "Ask AI…" starts empty and waits for the user. */
export interface AiRequest {
  prompt: string
  insertOnly: boolean
  autoSubmit: boolean
}

export const ASK_AI: AiRequest = { prompt: '', insertOnly: false, autoSubmit: false }

export const AI_SHORTCUTS: AiShortcut[] = [
  { id: 'fix-typos', label: 'Fix typos', prompt: 'Fix spelling, typos and grammar mistakes. Change nothing else.' },
  { id: 'improve', label: 'Improve writing', prompt: 'Improve the writing: clearer, more precise wording, same meaning and structure.' },
  { id: 'summarize', label: 'Summarize', prompt: 'Summarize the selected text in a few sentences.', insertOnly: true },
  { id: 'explain', label: 'Explain', prompt: 'Explain the selected text in plain words for a QA engineer.', insertOnly: true },
  { id: 'continue', label: 'Continue writing', prompt: 'Keep the selected text and continue writing after it in the same style.' }
]

const translate = (language: string): AiShortcut => ({
  id: `translate-${language.toLowerCase()}`,
  label: language,
  prompt: `Translate the selected text into ${language}. Keep the Markdown formatting.`
})

export const AI_SHORTCUT_GROUPS: AiShortcutGroup[] = [
  {
    label: 'Adjust',
    items: [
      { id: 'shorter', label: 'Shorter', prompt: 'Make it shorter while keeping every important point.' },
      { id: 'longer', label: 'Longer', prompt: 'Make it longer with more useful detail.' },
      { id: 'simpler', label: 'Simpler', prompt: 'Rewrite it in simpler language.' }
    ]
  },
  {
    label: 'Change tone',
    items: [
      { id: 'tone-professional', label: 'Professional', prompt: 'Rewrite it in a professional tone.' },
      { id: 'tone-casual', label: 'Casual', prompt: 'Rewrite it in a casual tone.' },
      { id: 'tone-direct', label: 'Direct', prompt: 'Rewrite it in a direct, concise tone.' }
    ]
  },
  {
    label: 'Reformat',
    items: [
      { id: 'as-checklist', label: 'As checklist', prompt: 'Reformat it as a Markdown checklist (- [ ] items).' },
      { id: 'as-table', label: 'As table', prompt: 'Reformat it as a Markdown table with sensible columns.' },
      { id: 'as-bullets', label: 'As bullet list', prompt: 'Reformat it as a bullet list.' },
      { id: 'as-steps', label: 'As numbered steps', prompt: 'Reformat it as numbered steps.' }
    ]
  },
  {
    label: 'Translate',
    items: ['English', 'Vietnamese', 'Japanese', 'Chinese', 'Korean', 'French', 'German', 'Spanish'].map(translate)
  }
]

export function shortcutRequest(shortcut: AiShortcut): AiRequest {
  return { prompt: shortcut.prompt, insertOnly: Boolean(shortcut.insertOnly), autoSubmit: true }
}
