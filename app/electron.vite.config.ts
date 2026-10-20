import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Layout differs from electron-vite's default (src/main …), so every entry is named here.
// main / preload: Node 환경. renderer: 브라우저 환경(React). shared 는 셋이 같이 쓰는 순수 코드
const shared = { '@shared': resolve(__dirname, 'shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: { lib: { entry: resolve(__dirname, 'electron/main/index.ts') } },
  },
  preload: {
    resolve: { alias: shared },
    build: { lib: { entry: resolve(__dirname, 'electron/preload/index.ts') } },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    resolve: { alias: { ...shared, '@': resolve(__dirname, 'src') } },
    plugins: [react()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/index.html') } },
  },
})
