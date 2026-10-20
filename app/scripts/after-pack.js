// electron-builder afterPack hook: puts the clock-out icon and version info into clock-out.exe with rcedit. No dependencies.
// Needed while build.win.signAndEditExecutable is false (this PC cannot unpack winCodeSign: no symlink permission), which leaves Electron's icon on the exe.
// rcedit comes from electron-builder's own cache (%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\*\rcedit-x64.exe); not found → one warning, build goes on.
const { execFileSync } = require('node:child_process')
const { existsSync, readdirSync, statSync } = require('node:fs')
const { join } = require('node:path')

// Newest rcedit-x64.exe under the winCodeSign cache, or null
function findRcedit() {
  const cacheRoot = process.env.ELECTRON_BUILDER_CACHE || join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache')
  const dir = join(cacheRoot, 'winCodeSign')
  if (!existsSync(dir)) return null
  const found = readdirSync(dir)
    .map(name => join(dir, name, 'rcedit-x64.exe'))
    .filter(p => existsSync(p))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return found[0] || null
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const { productFilename, version } = context.packager.appInfo
  const exe = join(context.appOutDir, `${productFilename}.exe`)
  const icon = join(context.packager.projectDir, 'resources', 'icon.ico')
  const rcedit = findRcedit()
  if (!rcedit) {
    console.warn(`  • after-pack: rcedit-x64.exe not found in the electron-builder cache — ${productFilename}.exe keeps the Electron icon`)
    return
  }
  // Windows file versions need four parts: 0.8.0 → 0.8.0.0
  const fileVersion = `${version.split('-')[0]}.0`
  execFileSync(rcedit, [
    exe,
    '--set-icon', icon,
    '--set-version-string', 'ProductName', productFilename,
    '--set-version-string', 'FileDescription', productFilename,
    '--set-file-version', fileVersion,
    '--set-product-version', version,
  ], { stdio: 'inherit' })
  console.log(`  • after-pack: icon and version ${version} set on ${productFilename}.exe`)
}
