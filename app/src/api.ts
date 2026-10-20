import type { ClockOutApi } from '@shared/types'

declare global {
  interface Window { clockOut: ClockOutApi }
}

export const api: ClockOutApi = window.clockOut
