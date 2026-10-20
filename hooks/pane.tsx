import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import { toggleHide } from './command'
import { EMPTY_OVERVIEW, fmtTime, refreshOverview } from './overview'
import { reviveSession } from './revive'

// Same reference as overview.ts writes; declared here because the state library reads it from this file.
const overviewAtom = atom({ plugin: 'clock-out', key: 'overview' } as const, EMPTY_OVERVIEW)

// The /clock-out pane: one block per session (state, next run), one line per job, buttons for what the
// reader can do from here. Reading the atom subscribes the drawing: every refreshOverview redraws it.
export function registerPane(on: On): void {
  on('ui.render', { component: 'Pane', requestId: 'schedule' }, async ($, e) => {   // literal: the scan lists the pane by it (= PANE_ID)
    const { Box, Text, Button } = $.ui.resolve(e)
    const overview = await read($, overviewAtom)
    const now = await $.clock.now()
    const width = e.props.bodyColumns

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold>Scheduled jobs</Text>
          <Text dimColor>{String(overview.jobCount)} live · built {fmtTime(overview.builtAt || now, now)}</Text>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => { void refreshOverview($) }} />
        </Box>
        {overview.sessions.length === 0 && <Text dimColor>No scheduled jobs in any session.</Text>}
        {overview.sessions.map(s => (
          <Box key={`s-${s.shortId}`} flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color={s.isAlive ? 'green' : 'yellow'}>{s.isAlive ? '●' : '○'}</Text>
              <Text bold>{s.label}</Text>
              <Text dimColor>{s.shortId}</Text>
              <Text>{s.isAlive ? 'running' : 'stopped'}{s.isOwn ? ' (this session)' : ''}</Text>
              <Text dimColor>next {fmtTime(s.nextAt, now)}</Text>
              {!s.isAlive && (
                <Button key={`revive-${s.shortId}`} plain label="Revive" onPress={() => { void reviveSession($, s.sessionId).then(message => refreshOverview($, message)) }} />
              )}
            </Box>
            {s.jobs.map(j => (
              <Box key={`j-${j.id}`} flexDirection="row" gap={1}>
                <Text dimColor={j.isDismissed} color={j.isExpiringSoon && !j.isDismissed ? 'yellow' : undefined} wrap="truncate-end">
                  {'  - '}[{j.id}] {j.humanSchedule} · next {fmtTime(j.nextAt, now)}
                  {j.isExpiringSoon && j.expiresInDays !== undefined ? ` · expires in ${j.expiresInDays}d` : ''}
                  {j.lastRun !== undefined ? ` · last ${j.lastRun.reason === 'answer' ? 'answered (unverified)' : j.lastRun.reason} ${fmtTime(j.lastRun.finishedAt, now)}` : ''}
                  {j.isDismissed ? ' · hidden' : ''}
                  {width > 90 ? ` | ${j.prompt.replace(/\s+/g, ' ').slice(0, Math.max(10, width - 70))}` : ''}
                </Text>
                {!s.isAlive && (
                  <Button key={`hide-${j.id}`} plain label={j.isDismissed ? 'Unhide' : 'Hide'} onPress={() => { void toggleHide($, j.id) }} />
                )}
              </Box>
            ))}
          </Box>
        ))}
        {overview.message !== undefined && <Text dimColor>{overview.message}</Text>}
      </Box>
    )
  })
}
