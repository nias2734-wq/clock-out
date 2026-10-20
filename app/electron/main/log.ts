import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { formatLocalStamp } from '@shared/time'

import { paths } from './paths'

// One line per event. Never the OAuth token, never a prompt body.
export function log(line: string): void {
  try {
    mkdirSync(dirname(paths.log), { recursive: true })
    appendFileSync(paths.log, `${formatLocalStamp(Date.now())} ${line}\n`, 'utf8')
  } catch {
    // logging must never break the app
  }
}
