// Stand-in for the GitHub Copilot CLI in integration tests. Mode comes from FAKE_COPILOT_MODE.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const value = (flag) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

if (args.includes('--version')) {
  process.stdout.write('1.2.3\n')
  process.exit(0)
}

const mode = process.env.FAKE_COPILOT_MODE ?? 'ok'
if (mode === 'fail') {
  process.stderr.write('not signed in')
  process.exit(2)
}
if (mode === 'no-usage-flag' && args.includes('--usage-output-file')) {
  process.stderr.write("error: unknown option '--usage-output-file'\nTry 'copilot --help' for more information.")
  process.exit(1)
}
if (mode === 'slow') {
  setTimeout(() => process.exit(0), 30_000)
} else {
  const prompt = readFileSync(path.join(value('-C'), 'prompt.md'), 'utf8')
  const usageFile = value('--usage-output-file')
  if (usageFile) {
    writeFileSync(
      usageFile,
      JSON.stringify({
        modelMetrics: { 'gpt-x': { usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 } } },
        providerModelMetrics: [{ modelId: 'gpt-x', modelDisplayName: 'GPT X' }],
        totalPremiumRequestCost: 1
      })
    )
  }
  process.stdout.write('ANSWER ')
  process.stdout.write(
    `codebase=${value('--add-dir') ?? 'none'} denyWrite=${args.includes('--deny-tool=write')} promptBytes=${prompt.length}`
  )
}
