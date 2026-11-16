import { readFileSync, statSync } from 'node:fs'

// In Electron 33.4.11 (Node 20.18.3) readFileSync(p, 'utf8') and existsSync(p) each keep about 190 bytes of native memory per call
// (18 MB per 100,000 calls; 0.15.0 reached 12 GB private memory in 4 days). These two do the same without it, measured at 0 MB per 100,000 calls.

// Instead of readFileSync(path, 'utf8'): reads a Buffer and decodes it. Throws like readFileSync when the file is missing
export function readText(path: string): string {
  return readFileSync(path).toString('utf8')
}

// Instead of existsSync(path)
export function exists(path: string): boolean {
  try { return statSync(path, { throwIfNoEntry: false }) !== undefined } catch { return false }
}
