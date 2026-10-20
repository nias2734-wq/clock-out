// Lays the plugin API types (.claude-plugin/types/, git-ignored) that the root `tsc -p .` needs.
//   node scripts/types.js        (npm run types)
// Claude Code writes them itself each time it loads a plugin from a folder; there is no dedicated command.
// So this starts `claude --plugin-dir . -p` once under an empty, signed-out CLAUDE_CONFIG_DIR:
// the hooks load and the types are written, then the run stops at "Not logged in" before any prompt goes to the model.
// CLAUDE_CODE_PLUGIN_DIR_WATCH=1 is needed because -p mode skips the folder watch that lays the types.
// Nothing under the real ~/.claude is read or written, and no login or token is needed (works in CI).
const { spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const root = join(__dirname, '..')
const typesDir = join(root, '.claude-plugin', 'types')
const entry = join(typesDir, 'claude-code', 'index.d.ts')

// Environment of the run: drop the parent session's and the user's Claude/Anthropic settings
// | CLAUDE_CODE_PLUGIN_DIRS of a running session would load the same plugin first and skip this folder
const env = {}
for (const [k, v] of Object.entries(process.env)) {
  if (/^(CLAUDE|ANTHROPIC_)/i.test(k) && k.toUpperCase() !== 'CLAUDE_CODE_GIT_BASH_PATH') continue
  env[k] = v
}
const config = mkdtempSync(join(tmpdir(), 'clock-out-types-'))
env.CLAUDE_CONFIG_DIR = config
env.CLAUDE_CODE_PLUGIN_DIR_WATCH = '1'
// Guard in case some login is still found: requests go to a closed local port, not to the API
env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9'
// Skips Claude Code's optional traffic (telemetry, error reports) for this run
env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'

// Claude Code leaves an identical file untouched, so the old folder goes first to tell a fresh write from a stale one
rmSync(typesDir, { recursive: true, force: true })
// One command line through the shell: npm's global install puts claude.cmd on PATH, which Windows only starts via a shell
const run = spawnSync('claude --plugin-dir . --no-session-persistence -p types', {
  cwd: root,
  env,
  encoding: 'utf8',
  timeout: 120000,
  shell: true,
})
rmSync(config, { recursive: true, force: true })

// The run itself exits 1 ("Not logged in"); success is judged by the file it leaves behind
if (!existsSync(entry)) {
  console.error('Claude Code did not write ' + entry)
  console.error((run.error ? String(run.error) + '\n' : '') + (run.stdout || '') + (run.stderr || ''))
  console.error('Is claude (Claude Code CLI) on PATH? Install: npm i -g @anthropic-ai/claude-code')
  process.exit(1)
}
const firstLine = readFileSync(entry, 'utf8').split('\n', 1)[0]
console.log('ok   .claude-plugin/types/ laid (' + firstLine.replace(/^\/\/\s*/, '') + ')')
