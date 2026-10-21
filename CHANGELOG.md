# Changelog

One version for the plugin and the desktop app. `node scripts/version.js <x.y.z>` sets it everywhere,
`node scripts/version.js --check` verifies it. Each release is tagged `v<x.y.z>`.
Versioning: **minor** for new features, **patch** for fixes only.

## 0.14.0 (2026-10-21)

- **Move the status bar by dragging anywhere but its buttons**, not only the grip (⋮⋮). A drag starts after 4 px, so a click still clicks; the hover tooltips and the right-click menu keep working.
- **Hide the status bar from its right-click menu.** It stays hidden until the clock-out tray icon is clicked; a notice says where that icon is.
- **New-version notice.** Once a day the app reads the latest release number from GitHub and shows a notice when it is newer; clicking it opens the release page. Nothing is downloaded or installed. Settings › Display can turn it off.
- **Reset times read 10/24(Sat) 05:00** (month/day, weekday, 24-hour) in the usage tooltips.
- **Usage after a PC start or a wake from sleep**: a failed fetch (for example 401 before the login token is refreshed) is tried once more after 1 minute instead of waiting 5 minutes, and the usage is fetched 10 seconds after the PC wakes.

## 0.13.1 (2026-10-21)

- **Fixed: right-click and the reset-time tooltip worked only on part of the status bar.** The usage and next-job cells sat in the window's drag region, which takes no hover or right-click (measured with WM_NCHITTEST: 30–800 px of the bar answered HTCAPTION). The info row is now a normal area; drag the bar by the grip (⋮⋮) at its left end.
- **The status bar says whether remote monitoring is on**, in words with a phone icon (Remote on / starting / address pending / error) rather than a colour only; click it to open the session. Nothing is shown while the setting is off.
- **Wording that did not match what the app does**: the work-end wake skips jobs set to No auto-wake and blocked or warned sessions (it said "every stopped session"); bypass still stops the blocked tools (it said "any command"); the usage server's limit is an observed value, not a published rule.
- **Development: isolated captures.** `npm run capture` builds the app and captures its windows from a fresh fake folder. In capture mode the app sends no usage request, runs no `claude`, opens no browser, leaves the Windows autostart entry and the shared usage cache alone, and refuses to start without a fake `CLAUDE_CONFIG_DIR`. `scripts/shot.ps1`, which read the real config folder, is removed.
- Tests: app 101 → 105.

## 0.13.0 (2026-10-20)

Reliability and safety work after an external review of 0.12.0 (71/100). Three issues it reproduced are fixed (F-01, F-07, F-08 below).

- **Instructions are not lost (F-01).** A message in a session's inbox is marked delivered only after it was submitted. A failed submit is retried (15 s, 60 s, 5 min; failed after 5 tries); one whose submit was cut off half-way is kept as "unknown" and not sent again. Each message and request has an id, the receiver ignores an id it already took, and requests are one file each (two requests for the same session no longer overwrite each other). Failed and unknown instructions show on the session in the jobs panel.
- **"Answered" is not "succeeded" (F-02).** A run where Claude answered shows as "answered · success not verified"; a run that ended in an error shows as failed. "Failures only" notices go out for failed runs only. clock-out does not check build results yet.
- **Renewal before the 7-day expiry can recover (F-03).** The job is written down before it is deleted; if the session stops between delete and create, the next start re-creates it. A job you deleted in the meantime is not brought back.
- **The app no longer writes the plugin's session files (F-04).** Its own state (woken in the background, remote, hidden jobs, wake attempts, the permissions a session started with) lives in `app-state.json`, written atomically.
- **Narrower default permissions (F-05).** New installs allow reading, editing and `git status/diff/log/fetch/pull`, `npm run build`, `npm test`, `npm ci`; `git push`, `git reset --hard`, `git clean`, `npm publish` and `rm -rf` are blocked (`--disallowedTools`). Saved settings are kept; Settings has "Use recommended defaults" and a block list editor. The jobs panel shows the permissions a session actually started with and warns when they differ from the settings.
- **Fixed: the first message of a woken session could be eaten.** `--allowedTools` takes several values, so the message placed right after it was read as a tool name (measured with `claude -p`: "Input must be provided"). The permission mode now closes the lists.
- **Waking retries (F-06).** A failed wake is retried after 5, 15, 45 and 120 s (then 10 min); a login or permission failure stops automatic waking and says why. Wakes of one session from the timer, the panel, the remote session and deletion run once.
- **Same prompt, two jobs (F-07).** A run goes to the job whose time was within 2 minutes; otherwise it is recorded as ambiguous instead of being given to the first job.
- **Fixed: weekday ranges ending in 7 (F-08)** such as `5-7` were rejected; app and plugin now share the same rule.
- **Usage alignment is an experiment (F-09).** The ping is off on new installs and labelled experimental: the 5-hour window rule is observed, not guaranteed. The usage query times out after 15 s, a failed query only greys out the usage (jobs keep running), and the log records the kind of failure, never the error text of the credentials file.
- **Missed jobs (REQ-06).** After sleep or a restart, jobs whose time passed while the PC was off are listed with Run now / Dismiss; they are not re-run automatically.
- **"Hide" is now "No auto-wake" (F-10)**, which is what it does.
- **Development**: `npm run types` / `npm run check` make the root type check reproducible on a fresh clone; GitHub Actions CI (app type check, tests and build; plugin tests on Claude Code 2.1.304, latest as a preview); SECURITY.md, CONTRIBUTING.md, issue and PR templates; the README lists the Claude Code versions this was checked with.
- Tests: plugin 40 → 69, app 64 → 101.

## 0.12.0 (2026-10-20)

- **Clear from list asks first**: one confirmation with the session's name and id, what happens (clear / stop and clear), why a terminal or remote session is only hidden, the warnings (waiting for an answer, an attach window) and the 7-day note — no second question after it.
- **Turn remote monitoring off from where you turned it on**: while the remote jobs session runs, the footer button has a green dot and asks [Open on phone/web] [Turn remote off]; the bar's right-click menu shows "Open remote monitoring" and "Turn remote monitoring off". Turning off saves remote off (so the app does not start it again) and stops the session; turning on again resumes the same session and its conversation (measured: same id, the same Remote Control address).

## 0.11.0 (2026-10-20)

- **Clear a session from the list**, also a stopped one: "Clear from list" in its Done section hides its done records (a running background session with no jobs left is stopped first; terminal and remote sessions are only hidden; disabled while a job runs). A session with nothing else left leaves the list. Done records also disappear by themselves after 7 days, as the panel says; the session file and the conversation stay, so the session id's command still reopens it. "Tidy n" in the footer now also clears stopped done-only sessions (each line says stop and clear / clear).
- **Smaller status bar** (1238 → 986 px in the capture): refresh, remote monitoring, settings and the guide moved to a right-click menu on the bar (refresh / open jobs panel / monitor remotely / settings / integration check / guide / quit — the tray menu uses the same items, now in Korean too). The usage cells show the bar, percent and time left; the reset time is in the hover tooltip ("5시간 · 13:00 에 초기화").

## 0.10.0 (2026-10-20)

- **Stopping a session actually works now.** Waiting for your answer and an open `claude attach` window no longer block Stop; they are shown as warnings in a confirmation instead. `claude agents`' "working" state is not used any more (it also reports stopped sessions as working). Only the remote jobs session, a terminal session and a job running now (the plugin's `running` record) block it. Automatic cleanup still skips sessions that wait for an answer or have an attach window.
- **Click a session id to copy the command that reopens it**: `claude attach <id>` for a background session, `cd "<folder>"; claude --resume <id>` (PowerShell) or `cd /d "<folder>" && claude --resume <id>` (cmd) otherwise; Copy shows "copied".
- **Done jobs take less room**: one line each, the latest 3 with "n more"; folded to a one-line header for sessions that still have jobs; sessions with only done jobs are grouped, folded, at the bottom of the list.
- **Tidy up in one step**: "Tidy n" in the panel footer lists the finished background sessions (no jobs left, nothing running; sessions linked to Remote Control are left out) with their warnings, and stops them all; a one-line summary says what was stopped and what was skipped. Done records stay and expire after 7 days.

## 0.9.1 (2026-10-20)

- **Fixed: the jobs panel's close button could not be clicked** (since 0.8.0). The status bar became a transparent window to drop the 7 px strip, but Windows makes such a window 64 px tall for a 32 px bar, and its clear lower half took the clicks meant for the panel header under it. The window is now cut to the bar itself (`setShape`), so clicks below the bar reach the window there (measured with WindowFromPoint: below the bar, before → the bar, after → not the bar).

## 0.9.0 (2026-10-20)

- **How a job runs: quiet / notify / open.** quiet runs in the background as before; notify also shows a desktop notification when the job starts and when it waits for your answer (click it to open the session); open shows the session in a terminal window at the job's time (`claude attach` if it already runs in the background). Per job (the plugin's new `job_mode` tool — Claude picks open for reminders and questions right after CronCreate and tells you), per session (jobs panel), or the default in settings (notify). A job renewed before its 7-day expiry keeps its mode.
- **Done jobs stay visible for 7 days**: a "Done · last 7 days" section per session with time, result and the answer's head, and Open session. A session whose one-shot job already ran stays in the list (dimmed, "done n") instead of disappearing.
- **Tidy up finished background sessions** (about 0.5 GB of memory each): a Stop session (tidy) button, enabled only when no job runs, it does not wait for your answer and no `claude attach` window is open; and automatic stop 30 minutes after the last run for background sessions with no jobs left (setting, on by default; sessions with jobs left, terminal sessions and the remote jobs session are never stopped automatically). Done records are kept and expire after 7 days.
- **Fixed: "ran in the background before" was always false** — `claude agents --json` prints multi-line JSON and only the first line was parsed, so waking such a session passed flags and started a copy.
- **Fixed: a copy of the remote jobs session was left running** when resuming it produced another id; the copy is now stopped and removed (copies made while waking ordinary sessions are removed too).

## 0.8.0 (2026-10-19)

- **Fixed: usage was fetched again every time.** The log and the usage cache wrote their time in UTC but read it as local time, so on a UTC+9 PC the cache always looked 9 hours old. Both now use local time.
- **No more 7 px strip** under the status bar: the window is transparent, so only the bar shows.
- **New icon** — a white clock at 6 o'clock with a crescent moon on a night-sky rounded square — on the windows, the tray (simplified at 16/24/32 px), the installer and `clock-out.exe` itself (set after packing with rcedit from electron-builder's cache while exe editing stays off on this build PC).
- **Readability**: dark-theme buttons have more contrast, warnings and the integration check are in Korean, job cards have a time column.
- **Integration check**: when `claude` cannot be run it shows the real error instead of an empty one, and a plugin that is listed but failed to load counts as an error, not ok.
- **Ready to publish**: README rewritten (*Why clock-out*, the two install paths and not mixing them, permissions, where data lives, known limits, removal, development), screenshots in `docs/screenshots`, `<owner>` placeholders in package metadata, `.gitignore` for screenshots and icons, development notes moved to `docs/dev-notes`.
- Measured end to end in a test session: a scheduled job is recorded, an instruction gets its reply in the remote inbox, a finished job's notice arrives, deleting a job (running 18.7 s / stopped 8.3 s) leaves the others, and a stopped session wakes as itself with its jobs.

## 0.7.5 (2026-10-19)

- **Delete a job** from its card: a confirmation names the job (id, time, what it does); the session that owns it deletes it with CronDelete — a running session with the plugin through its inbox, a stopped one woken with the instruction, a background one without the plugin stopped and woken with it. A terminal session without the plugin cannot be reached, and you are told to type it there. When the job has left the list: "Deleted the job: [id] …", and for a background session "Stop the session too?".
- Fixed: waking a session that had been started in the background outside clock-out passed flags and started a copy, so the session itself was not woken (seen while testing deletion). The session file's `kind: background` now counts as "ran in the background", and if a copy still appears it is stopped and the session is woken again without flags.

## 0.7.4 (2026-10-19)

- A running session now says where it runs: *running in the background* or *running in a terminal* (from Claude Code's own live record). A background session goes on after its window is closed or `/exit` is typed in it (that only detaches), and its jobs still fire — which looked like "it says running although I exited". The tooltip says so.
- *Stop session* for a background session (`claude stop`). If jobs remain, clock-out wakes it again before the next one, and the message says so (hide the jobs to keep it off).
- Wording: "떠 있음" → "실행 중".

## 0.7.3 (2026-10-19)

- Fixed: job notices and replies to instructions did not reach the remote jobs session. Claude Code holds a cross-session message when the two sessions run in different permission modes, and a background session cannot approve it (measured). Messages now go through per-session inbox files (`<config>/clock-out/inbox/<sessionId>/`): each session's plugin reads its own every 15 s and submits what it finds as its own prompt, after its running scheduled job if there is one. The app's results (woke / attached a session) arrive the same way; it clears delivered messages.
- A session found only in its transcript (no plugin) still gets Claude Code's cross-session message, with a note that it may need approval there.
- Measured end to end: instruction → job session (11 s) → reply in the remote session; a finished job → `[clock-out] ✓ …` in the remote session → PushNotification ("Mobile push requested").

## 0.7.2 (2026-10-19)

- Fixed: the remote jobs session counted fewer jobs than the app (9 against 12). The app also lists sessions found only in transcripts (setting *Also read transcripts of sessions that ran without the plugin*), which the plugin cannot see. The app now writes the list it shows to `<config>/clock-out/overview.json`, and the remote session's `status` and `send` use it (the plugin's own list only when the app is not running, and it says so). Instructions now reach those sessions too.

## 0.7.1 (2026-10-19)

- **One button opens it**: *Monitor jobs remotely* under the jobs panel (and the phone icon on the status bar) starts the remote jobs session that oversees every job, or reuses it, and opens its address when ready. It was only a checkbox in Settings before.
- **No automatic Remote Control on other sessions**: a session gets it only when the remote jobs session is asked to attach it (`open_remote`). 0.7.0 added it to every first background start.
- The per-session *Open remotely* button in the jobs panel is gone (attaching is done from the remote jobs session); *Open on phone / web* stays for a session already attached.

## 0.7.0 (2026-10-19)

**Remote jobs session (원격 예약 작업 세션).** After work, see every scheduled job and give its session instructions or changes from the Claude mobile app or claude.ai/code. Jobs stay in their own sessions.

### Desktop app
- Settings → *Remote jobs session*: on/off, job result notices (off / failures only / every run), the session's permission (work mode by default). The app starts one background session with `--remote-control` in `<config>/clock-out/remote`, writes its role into a CLAUDE.md there, keeps it running (same address on every restart), and leaves it out of the normal revive.
- With remote on, the first background start of any session carries `--remote-control`: every later wake reconnects to the phone at the same address (measured: flags again would start a copy, so one that already ran in the background without it cannot get it).
- Jobs panel: *job running* badge, *Open on phone / web* while a session runs under Remote Control, and *Open remotely* (after the running job, or now) for a session that never ran in the background. Status bar: a phone icon for the remote jobs session.
- Carries out the plugin's requests: wake a stopped session with a forwarded instruction as its first message; stop a session and start it again under Remote Control.

### Plugin
- Tools in the remote jobs session only: `status` (every job, what runs now, last result with the answer's start, phone address), `send` (forward an instruction; a stopped session is woken for it), `open_remote` (while a job runs it first answers that the job may be cancelled or run twice, and asks).
- Every session: marks a running scheduled job in its file; answers a forwarded instruction back to the remote jobs session (`[clock-out 응답]`); reports finished jobs as the notice setting says (`[clock-out]`, which the remote session pushes to the phone).
- `/clock-out revive` also adds `--remote-control` on a first background start when remote is on.

## 0.6.0 (2026-10-19)

### Desktop app
- **Choose your reset times.** Settings → *Reset times*: *Auto* (lunch end and 5 hours later, as before) or *Choose* any whole hours (a window always starts on the hour). The align ping goes out 5 hours before each chosen reset. The chosen times show as chips; one less than 5 hours after the previous reset cannot happen and is struck through in red.
- The timeline marks a chosen reset that does not happen with a red dashed badge, and says why and when the resets actually are.
- The setting replaces the unused `alignPing.manualHours` (ping hours) with `alignPing.resetHours`; the plugin's check uses the same plan.

## 0.5.0 (2026-10-19)

Wording everywhere is information, not orders: the zones are *no effect* / *affects work* / *shares your limit*.

### Plugin
- **A new job in the hours that affect the work day is refused once** (09:00 start, lunch 12–13 → 04:00 ~ 09:00). The model reads why (the 13:00 / 18:00 token resets would move, or work would not start at 0 %) and the hours with no effect, as information rather than a rule, and asks the user. The same cron asked again within 30 minutes goes through. Work hours come from the app (`app-settings.json`); without them nothing is checked. Jobs during work hours pass as they are.
- `hooks/timeline.ts` is the app's `shared/timeline.ts`, byte for byte (an app test fails when they differ).

### Desktop app
- Jobs in those hours are **red**: on the timeline (with a sentence on what they move, and which hours have no effect) and on their card in the jobs panel.
- **Status bar order**: 5h · weekly · model weekly · refresh · next job · Jobs n · settings · guide (icon only) · quit.

## 0.4.1 (2026-10-19)

- A short product intro at the top of the README and the user guide: what clock-out is for (Claude Code jobs scheduled in a terminal, VS Code, JetBrains or Cursor live only in their session and do not show in the Claude app) and the three things it does.

## 0.4.0 (2026-10-19)

### Desktop app
- **The timeline answers "when may my jobs run?"** For every 5 minutes of a work day the app adds a test job and simulates the day again, then colours that time: **OK** (green), **keep empty** (red stripes: the job would open a 5-hour window still open at the align ping and move the planned resets, or it would run before work inside the window work starts in, so work would not start at 0 %), **shares your limit** (amber: inside a window that covers work). With 09:00–18:00 and lunch 12:00–13:00: OK 18:00 ~ 04:00, keep empty 04:00 ~ 09:00, shared 09:00 ~ 18:00.
- Three plain sentences above the line say the same (*예약은 18:00 ~ 04:00 에 거세요* …).
- The line has times again: hours every 2 h with an hour grid, row names (jobs OK? / windows / work / jobs), each window as *08–13* with what opened it (⚡ ping, 💼 work, 📅 job), the reset badges, work start and end, job times, and now. The sky gradient stays as a thin band; long explanations stay in the hover tooltip, which now always shows the time under the mouse.
- Always drawn as a work day (it is the plan, not today's calendar).

## 0.3.0 (2026-10-19)

### Desktop app
- **Work hours and token resets** are one settings section now, with a line saying why the app asks for them.
- **24-hour timeline** of today as a sky: night with stars and the moon, sunrise, the sun at noon, sunset, and night again, as one gradient. Below it, icons only — work and lunch, the 5-hour usage windows as they will actually open (simulated over yesterday and today: align pings, working hours, and every scheduled job), a round ↻ badge where each window resets (green = planned, orange = off-plan during work, grey = outside work), the align pings (⚡, orange when before work: the PC must be on), the jobs (red and pulsing when a job opens a window first and shifts a planned reset), and a red line for now. No text on the line: hovering any icon explains it, and moving the mouse anywhere on the line shows that time, whether it is work, lunch or off, and which window is open. Planned resets that happen are small chips under it; only problems are written out.
- **Settings stay short**: when every setup check is green it folds to one line of chips (*Details* opens the list), and the quick start folds away.
- **Job cards read the schedule in words** when Claude Code gave none (`3 21 * * *` → *매일 21:03*, `40 19 19 10 *` → *10-19 19:40*); the cron stays beside it in small type.
- **Job cards lead with the next run**: a large time, today / tomorrow / date, and how long until it. The status bar shows the next job as a highlighted pill.

### Fixed
- The align-ping plan now follows the **lunch end**: pings at (lunch-end hour − 5 h) and the lunch-end hour, so the afternoon and the evening each start with a fresh window (09–18, lunch 12–13 → pings 08:05 and 13:05, resets 13:00 and 18:00).
- A ping before the work start is no longer moved to the start hour (that made the second ping land inside the first window and do nothing); it stays, with a warning that the PC must be on then.

## 0.2.0 (2026-10-19)

### Desktop app
- **Setup check** window (`Get started · setup check`), opened by itself on the first run after the safety notice: Claude Code, sign-in, plugin, sessions reporting, Windows Terminal, overlapping programs — each with a one-click fix (install the plugin from the copy bundled with the app, enable it, turn the old widget/service off, sign in, …).
- The setup check and the quick start are also at the **top of Settings** and of the user guide.
- **User guide** window (features, how it works with Claude Code, troubleshooting, data); only the long explanations are collapsible.
- The guide is reachable without digging: a labelled **Guide** button on the status bar, and a footer under the jobs panel with **Setup check · Settings · Guide**.
- "Attach" renamed **Open session** (예약 세션 확인하기).
- The jobs panel is its **own window docked right under the status bar** (left edges aligned; right-aligned or above the bar when there is no room). The bar no longer moves or resizes when the panel opens, and the panel follows the bar when it is dragged.
- Setup check: **sleep turned off** — reads the plugged-in sleep and hibernate timeouts (`powercfg`) and sets both to *never* with one button (no admin needed; the screen still turns off).
- **Theme**: follow Windows (default), light, dark.
- **Per-model weekly limits** (e.g. *Fable 7d 100%*) on the status bar, red when the API marks them critical. The v1 widget shows them too.
- Fixed: the status bar's buttons were cut off when the jobs panel was open (panel width now follows the bar), and by 1–2 px at fractional display scaling.
- Friendlier panel: state pills, job counts, recurring/one-shot pills, remaining time, two-line prompt preview, empty states, toast shadows.
- The app version is shown in Settings, the guide, the setup window, the jobs panel footer and the status bar tooltip.
- Installer bundles the plugin (`resources/plugin`).

### Repository
- `scripts/version.js` keeps one version across the plugin, the marketplace entry and the app.
- App tests renamed `*.spec.ts` (vitest) so `claude plugin test` only runs the plugin tests.

### Known issue (fixed in 0.3.0)
- The align-ping plan ignored the lunch time and moved a pre-work ping to the start hour.

## 0.1.0 (2026-10-19)

### Plugin `clock-out`
- Records `CronCreate` / `CronDelete` / `CronList` into one file per session, heartbeat, end marker.
- `/clock-out` command and pane: every session's jobs with real next run, expiry, last run; `hide`, `revive`, `reregister`.
- Run log from scheduled-trigger prompts; automatic re-registration of recurring jobs 24 h before the 7-day expiry.
- Windows PowerShell service (`service/windows`) and `/clock-out:install`, posix outline.

### Desktop app (Electron)
- Status bar: usage bars with reset countdowns, next job, jobs panel, tray icon, first-run safety notice.
- Jobs panel from session files (and transcripts for sessions without the plugin), validation, hide.
- Revival with `claude --bg --resume` (work mode by default, bypass behind a warning), scheduler: 10 min before a job, a day before expiry, daily sweep at work end.
- Settings: work hours → ping plan, revive leads, permissions, language, start with Windows.
- Windows installer (NSIS).
