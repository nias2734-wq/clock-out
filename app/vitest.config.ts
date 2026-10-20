import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// App tests are *.spec.ts so the plugin's own runner (`claude plugin test`, which collects every *.test.ts in the
// repository) never picks them up.
export default defineConfig({
  // same '@shared' alias as electron.vite.config.ts, so main-process code that imports shared values can be tested
  resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
  test: { include: ['shared/**/*.spec.ts', 'electron/**/*.spec.ts'] },
})
