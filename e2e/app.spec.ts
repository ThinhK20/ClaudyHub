import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Drives the built app (out/) end to end with a throwaway profile and deterministic stub AI engines.
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])

let root: string
let workspace: string
let codebase: string
let app: ElectronApplication
let page: Page

async function write(base: string, relative: string, content: string): Promise<void> {
  const full = path.join(base, ...relative.split('/'))
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, content)
}

test.beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'qa-hub-e2e-'))
  workspace = path.join(root, 'qa-repo')
  codebase = path.join(root, 'product-src')
  await write(
    workspace,
    'qa/test-cases/settings/Reject invalid settings.md',
    '---\nid: "000120"\ntitle: Reject invalid settings\nstatus: passed\n---\n\n## Summary\n\nInvalid values are refused.\n'
  )
  await write(workspace, 'qa/regression-assets/forms/Form checklist.md', '# Form checklist\n\n- [x] Submit works\n- [ ] Validation works\n')
  await write(workspace, 'qa/regression-assets/forms/AI structure.md', '# AI structure\n\nAlpha first line.\n\nBeta second line.\n\n```sh\n# keep comment\necho hi\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n')
  await write(codebase, 'src/settings.ts', 'export const validate = () => true\n')

  app = await electron.launch({
    args: ['.'],
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, QA_HUB_USER_DATA: path.join(root, 'profile'), QA_HUB_AI_STUB: '1' }
  })
  // Answer the native folder dialogs in order: workspace first, then codebase.
  await app.evaluate(({ dialog }, folders) => {
    const queue = [...folders]
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [queue.shift() ?? ''] })) as typeof dialog.showOpenDialog
  }, [workspace, codebase])
  page = await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true })
})

test('onboarding connects a workspace and a codebase', async () => {
  await page.getByRole('button', { name: 'Choose folder' }).click()
  await expect(page.getByText(workspace)).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Connect codebase' }).click()
  await expect(page.getByText('product-src', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Finish setup' }).click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
})

test('library lists and searches workspace documents', async () => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Library' }).click()
  await expect(page.getByText('Reject invalid settings').first()).toBeVisible()
  await page.keyboard.press('Control+K')
  await page.getByPlaceholder('Search documents, runs and pages').fill('invalid')
  await page.getByRole('option', { name: /Reject invalid settings/ }).click()
  await expect(page.getByRole('heading', { name: 'Reject invalid settings' }).first()).toBeVisible()
  await expect(page.getByText('Invalid values are refused.')).toBeVisible()
})

test('the right-click menu copies as Markdown in read mode and pastes plain text in edit mode', async () => {
  const clipboardText = (): Promise<string> => app.evaluate(({ clipboard }) => clipboard.readText())
  const openMenu = async (selector: string): Promise<void> => {
    const box = await page.locator(selector).first().boundingBox()
    await page.locator(selector).first().dispatchEvent('contextmenu', { clientX: (box?.x ?? 0) + 20, clientY: (box?.y ?? 0) + 20, button: 2 })
  }
  const menuItem = (name: RegExp): ReturnType<Page['getByRole']> => page.getByRole('menuitem', { name })

  await page.getByRole('button', { name: /^Search/ }).click()
  await page.getByPlaceholder('Search documents, runs and pages').fill('checklist')
  await page.getByRole('option', { name: /Form checklist/ }).click()
  await expect(page.getByText('Validation works')).toBeVisible()

  // Read mode: editing actions are disabled, and Copy as Markdown keeps the checklist syntax.
  await page.evaluate("window.getSelection().selectAllChildren(document.querySelector('article .prose-qa'))")
  await openMenu('article')
  await expect(menuItem(/^Cut/)).toHaveAttribute('data-disabled', '')
  await expect(menuItem(/^Paste/).first()).toHaveAttribute('data-disabled', '')
  await expect(menuItem(/Search for “Form checklist/)).toBeVisible()
  await menuItem(/Copy as Markdown/).click()
  await expect.poll(clipboardText).toContain('- [x] Submit works')
  expect(await clipboardText()).toContain('- [ ] Validation works')

  // Edit mode: the editor selection copies as Markdown too, and plain-text paste replaces it.
  await page.getByRole('button', { name: 'Edit' }).click()
  const editor = page.getByLabel('Document content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await openMenu('.doc-editor')
  await menuItem(/Copy as Markdown/).click()
  await expect.poll(clipboardText).toContain('- [ ] Validation works')
  await app.evaluate(({ clipboard }) => clipboard.writeText('Pasted plain line'))
  await openMenu('.doc-editor')
  await menuItem(/Paste as plain text/).click()
  await expect(editor).toHaveText('Pasted plain line')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page.getByText('Validation works')).toBeVisible()
})

test('the AI assistant shows a result and applies it only on Replace', async () => {
  const editor = page.getByLabel('Document content')
  const panel = page.getByRole('dialog', { name: 'AI assistant' })
  const selectText = async (text: string): Promise<void> => {
    await page.getByLabel('Document content').locator('p', { hasText: text }).selectText()
  }
  const askAi = async (): Promise<void> => {
    await page.locator('.doc-editor').dispatchEvent('contextmenu', { clientX: 200, clientY: 200, button: 2 })
    await page.getByRole('menuitem', { name: 'AI assistant' }).hover()
    await page.getByRole('menuitem', { name: 'Ask AI…' }).click()
  }

  await page.getByRole('button', { name: 'Edit' }).click()
  await expect(editor).toContainText('Validation works')

  // The result is shown first; nothing changes until Replace.
  await selectText('Validation works')
  await askAi()
  await panel.getByLabel('AI request').fill('make it shorter')
  await panel.getByLabel('AI request').press('Enter')
  await expect(panel.getByTestId('ai-result')).toContainText('Stub edit: make it shorter')
  await expect(editor).toContainText('Validation works')
  await panel.getByRole('button', { name: 'Replace' }).click()
  await expect(panel).toBeHidden()
  await expect(editor).toContainText('Stub edit: make it shorter')
  await expect(editor).not.toContainText('Validation works')
  await expect(page.getByText('Unsaved changes')).toBeVisible()

  // Without a selection the shortcuts are disabled and the result can only be inserted.
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.locator('.doc-editor').dispatchEvent('contextmenu', { clientX: 200, clientY: 200, button: 2 })
  await page.getByRole('menuitem', { name: 'AI assistant' }).hover()
  await expect(page.getByRole('menuitem', { name: 'Fix typos' })).toHaveAttribute('data-disabled', '')
  await page.getByRole('menuitem', { name: 'Ask AI…' }).click()
  await panel.getByLabel('AI request').fill('FAIL please')
  await panel.getByLabel('AI request').press('Enter')
  await expect(panel.getByRole('alert')).toContainText('Stub failure')
  await expect(panel.getByLabel('AI request')).toHaveValue('FAIL please')
  await panel.getByLabel('AI request').fill('add a note')
  await panel.getByLabel('AI request').press('Enter')
  await expect(panel.getByTestId('ai-result')).toContainText('Stub edit: add a note')
  await expect(panel.getByRole('button', { name: 'Replace' })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Close AI assistant' }).click()

  // Editing the document while the panel is open still replaces the original selection.
  await selectText('Submit works')
  await askAi()
  await panel.getByLabel('AI request').fill('reword')
  await panel.getByLabel('AI request').press('Enter')
  await expect(panel.getByTestId('ai-result')).toContainText('Stub edit: reword')
  await editor.locator('h1').click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.type('X')
  await panel.getByRole('button', { name: 'Replace' }).click()
  await expect(editor).toContainText('Stub edit: reword')
  await expect(editor).not.toContainText('Submit works')
  await expect(editor).toContainText('XForm checklist')

  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page.getByText('Validation works')).toBeVisible()
})

test('AI Replace keeps the structure around the selection', async () => {
  const editor = page.getByLabel('Document content')
  const panel = page.getByRole('dialog', { name: 'AI assistant' })
  const ask = async (request: string): Promise<void> => {
    await page.locator('.doc-editor').dispatchEvent('contextmenu', { clientX: 200, clientY: 200, button: 2 })
    await page.getByRole('menuitem', { name: 'AI assistant' }).hover()
    await page.getByRole('menuitem', { name: 'Ask AI…' }).click()
    await panel.getByLabel('AI request').fill(request)
    await panel.getByLabel('AI request').press('Enter')
    await expect(panel.getByTestId('ai-result')).toContainText('Stub edit:')
  }

  await page.getByRole('button', { name: /^Search/ }).click()
  await page.getByPlaceholder('Search documents, runs and pages').fill('AI structure')
  await page.getByRole('option', { name: /^AI structure/ }).click()
  await page.getByRole('button', { name: 'Edit' }).click()
  await expect(editor).toContainText('Beta second line.')

  // A selection across two paragraphs replaces both paragraphs whole, leaving no split-off fragments.
  await page.evaluate(`(() => {
    const [alpha, beta] = [...document.querySelectorAll('.doc-editor > p')]
    const range = document.createRange()
    range.setStart(alpha.firstChild, 6)
    range.setEnd(beta.firstChild, 4)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
  })()`)
  await ask('merge them')
  await panel.getByRole('button', { name: 'Replace' }).click()
  await expect(editor).toContainText('Stub edit: merge them')
  await expect(editor).not.toContainText('Alpha')
  await expect(editor).not.toContainText('second line')

  // Inside a code block the answer goes in as literal text, not parsed Markdown.
  await editor.locator('pre').getByText('keep comment').selectText()
  await ask('**bold**')
  await panel.getByRole('button', { name: 'Replace' }).click()
  await expect(editor.locator('pre')).toContainText('Stub edit: **bold**')

  // Several table cells can only be inserted below, never replaced into the first cell.
  const first = await editor.locator('td', { hasText: '1' }).boundingBox()
  const last = await editor.locator('td', { hasText: '4' }).boundingBox()
  await page.mouse.move((first?.x ?? 0) + 5, (first?.y ?? 0) + 5)
  await page.mouse.down()
  await page.mouse.move((last?.x ?? 0) + 5, (last?.y ?? 0) + 5, { steps: 5 })
  await page.mouse.up()
  await ask('as table')
  await expect(panel.getByRole('button', { name: 'Insert below' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Replace' })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Close AI assistant' }).click()

  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Discard changes' }).click()
})

test('the explorer layout opens documents from the folder tree as tabs', async () => {
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByLabel('Layout').selectOption('explorer')

  const tree = page.getByRole('tree', { name: 'Workspace documents' })
  await tree.getByRole('treeitem', { name: 'qa', exact: true }).click()
  await tree.getByRole('treeitem', { name: 'regression-assets' }).click()
  await tree.getByRole('treeitem', { name: 'forms' }).click()
  await tree.getByRole('treeitem', { name: 'Form checklist' }).click()
  await expect(page.getByRole('heading', { name: 'Form checklist', level: 1 }).first()).toBeVisible()

  await page.getByLabel('Filter documents').first().fill('reject')
  await tree.getByRole('treeitem', { name: 'Reject invalid settings' }).click()
  const tabs = page.getByRole('tablist', { name: 'Open documents' })
  await expect(tabs.getByRole('tab')).toHaveText(['Form checklist', 'Reject invalid settings'])
  await expect(tree.getByRole('treeitem', { name: 'test-cases' })).toHaveAttribute('aria-expanded', 'true')

  await page.getByRole('button', { name: 'Close Reject invalid settings' }).click()
  await expect(page.getByRole('heading', { name: 'Form checklist', level: 1 }).first()).toBeVisible()
  await expect(tabs.getByRole('tab')).toHaveText(['Form checklist'])

  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByLabel('Layout').selectOption('classic')
  await expect(page.getByRole('tree', { name: 'Workspace documents' })).toBeHidden()
})

test('a run goes from AI-drafted cases to a completed verdict with evidence', async () => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Test runs' }).click()
  await page.getByRole('button', { name: 'New run' }).first().click()
  await page.getByLabel('Title').fill('Settings validation')
  await page.getByRole('button', { name: 'Create draft' }).click()

  await page.getByRole('button', { name: 'Ask AI to add cases' }).click()
  await page.getByLabel('What should the new cases cover?').fill('happy path')
  await page.getByRole('button', { name: 'Propose cases' }).click()
  await expect(page.getByText('Stub generated case')).toBeVisible()

  await page.getByRole('button', { name: 'Approve cases' }).click()
  await page.getByRole('button', { name: 'Start testing' }).click()
  await expect(page.getByRole('heading', { name: 'Stub generated case' })).toBeVisible()

  await page.locator('input[type=file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByRole('img', { name: 'shot.png' })).toBeVisible()
  await page.getByRole('radio', { name: 'Passed' }).click()
  await page.getByLabel('Notes').fill('Saved and reloaded fine.')
  await page.getByRole('button', { name: 'Save result' }).click()

  await page.getByRole('button', { name: 'Finish test window' }).click()
  await expect(page.getByText('Finished', { exact: false })).toBeVisible()
  await expect(page.getByRole('img', { name: '1 passed' }).first()).toBeVisible()
})

test('the chosen codebase reaches the AI engine', async () => {
  const question = page.getByLabel('Question')
  await question.fill('Where is validation?')
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect(page.getByText(`Codebase: product-src (${codebase})`)).toBeVisible()

  await page.getByLabel('Codebase').last().selectOption({ label: 'No codebase' })
  await question.fill('And without code?')
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect(page.getByText('Codebase: none.')).toBeVisible()
})
