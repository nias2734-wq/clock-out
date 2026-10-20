// One version for the whole repository (plugin + desktop app).
//   node scripts/version.js 0.3.0   set it everywhere (source of truth: package.json at the root)
//   node scripts/version.js --check fail when any file disagrees or CHANGELOG.md has no "## <version>" section
// Files kept in step: package.json, package-lock.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json,
// app/package.json, app/package-lock.json. After setting: write the CHANGELOG section, commit, tag v<version>.
const { readFileSync, writeFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const files = {
  'package.json': j => [j, 'version'],
  'package-lock.json': j => [j, 'version', j.packages?.[''], 'version'],
  '.claude-plugin/plugin.json': j => [j, 'version'],
  '.claude-plugin/marketplace.json': j => [j.plugins?.[0], 'version'],
  'app/package.json': j => [j, 'version'],
  'app/package-lock.json': j => [j, 'version', j.packages?.[''], 'version'],
}

const read = f => JSON.parse(readFileSync(join(root, f), 'utf8'))
const write = (f, j) => writeFileSync(join(root, f), JSON.stringify(j, null, 2) + '\n')

function versionsIn(f) {
  const j = read(f)
  const spots = files[f](j)
  const out = []
  for (let i = 0; i < spots.length; i += 2) if (spots[i] !== undefined) out.push(spots[i][spots[i + 1]])
  return out
}

const arg = process.argv[2]
if (arg === undefined || arg === '--check') {
  const want = read('package.json').version
  let bad = 0
  for (const f of Object.keys(files)) {
    if (!existsSync(join(root, f))) continue
    const got = versionsIn(f)
    const ok = got.every(v => v === want)
    if (!ok) bad++
    console.log(`${ok ? 'ok  ' : 'DIFF'} ${f}: ${got.join(', ')}`)
  }
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  const hasSection = new RegExp(`^## ${want.replace(/\./g, '\\.')}\\b`, 'm').test(changelog)
  console.log(`${hasSection ? 'ok  ' : 'MISS'} CHANGELOG.md: ## ${want}`)
  if (bad > 0 || !hasSection) process.exit(1)
  console.log(`version ${want} consistent`)
} else {
  if (!/^\d+\.\d+\.\d+$/.test(arg)) { console.error('usage: node scripts/version.js <major.minor.patch> | --check'); process.exit(2) }
  for (const f of Object.keys(files)) {
    if (!existsSync(join(root, f))) continue
    const j = read(f)
    const spots = files[f](j)
    for (let i = 0; i < spots.length; i += 2) if (spots[i] !== undefined) spots[i][spots[i + 1]] = arg
    write(f, j)
    console.log(`set ${f} → ${arg}`)
  }
  console.log(`next: add "## ${arg} (date)" to CHANGELOG.md, commit, then: git tag -a v${arg} -m "clock-out ${arg}"`)
}
