import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exists, readText } from './fsSafe'

describe('fsSafe', () => {
  it('readText reads UTF-8 text as readFileSync(p, "utf8") does and throws on a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clockout-fssafe-'))
    const path = join(dir, 'a.json')
    writeFileSync(path, '﻿{"title":"주간 보고"}', 'utf8')
    expect(readText(path)).toBe('﻿{"title":"주간 보고"}')
    expect(() => readText(join(dir, 'none.json'))).toThrow()
  })

  it('exists is true for a file or folder and false for a missing path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clockout-fssafe-'))
    writeFileSync(join(dir, 'a.json'), '{}')
    expect(exists(dir)).toBe(true)
    expect(exists(join(dir, 'a.json'))).toBe(true)
    expect(exists(join(dir, 'none.json'))).toBe(false)
    expect(exists('')).toBe(false)
  })

  // the app's main process runs these on a timer over every session file: the leaking calls must not come back
  it('main-process code uses readText / exists instead of readFileSync(p, "utf8") / existsSync', () => {
    const offenders: string[] = []
    for (const name of readdirSync(__dirname)) {
      if (!name.endsWith('.ts') || name.endsWith('.spec.ts') || name === 'fsSafe.ts') continue
      const text = readFileSync(join(__dirname, name), 'utf8')
      if (/\bexistsSync\b/.test(text) || /\breadFileSync\([^\n]*['"]utf-?8['"]/.test(text) || /\breadFileSync\([^\n]*encoding/.test(text)) offenders.push(name)
    }
    expect(offenders).toEqual([])
  })
})
