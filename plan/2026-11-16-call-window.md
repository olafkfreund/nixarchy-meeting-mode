---
status: draft
issue: none (issues are disabled on this repo)
spec: spec/2026-11-16-call-window.md
coders:
  1: codex   # small, tricky pure logic (binding, confirmation, aggregation) with many edge cases
  2: coder   # a short bash subcommand and its fake-/proc test
  3: coder   # QML wiring in Service.qml against step 1's functions
  4: coder   # Settings row, hint text, README
reviewers:
  - codex   # read-only review of the diff against this plan
  - agy     # read-only review of the diff against this plan
---

# Plan: name the meeting's window, and end the call when the meeting ends

Implements meetingai's approved contract (its spec, section A) here. Branch
`feat/call-window-schema-2`.

## Approved decisions (copied from the spec)

- **Ancestry:** `bin/meeting-mode-actions ancestors <pid>` prints the pid,
  then each parent, one per line. The parent is the second field after the
  *last* `)` of `/proc/<pid>/stat`. It stops after 8 steps, at pid 1, or when a
  read fails, and exits 0. `MEETING_MODE_PROC` overrides `/proc` for tests.
- **Ancestry runs off the tick,** in a separate `ancestryProc`: a FIFO of
  `{key, pid}`, one run at a time, each result tagged with its key and dropped
  when that key is no longer a live stream. Never through `runHelper`.
- **Stream key** `id + ":" + pid` (`application.process.id`) for *all*
  per-stream state: `heldAt`, `confirmed`, `bindings`, `ended`, `chains`.
  Pids are compared as numbers.
- **Windows:** a `windows` binding over `Hyprland.toplevels.values` reading
  `lastIpcObject` (`pid`, `stableId`, `class`) and `title`; `onWindowsChanged`
  recomputes. When a toplevel lacks `pid` or `stableId`, call
  `Hyprland.refreshToplevels()` once per change of `values`; after a refresh
  answers with one still missing, once more. **No new binding while any
  toplevel is unrefreshed;** existing bindings hold.
- **`candidates(chain, windows, s)`:** the first pid in the chain that owns
  windows; with several, only those whose title matches `meetingTitles`.
- **`bind(prev, candidates, windows)`:** a previous `stableId` holds while
  that window exists, through title changes, never moves; else exactly one
  candidate binds, two or more are `ambiguous`, none is unbound.
- **Streams looked at:** every ready capture stream passing
  `isCallStream(props, ".")`. Kind, in order: `native` (name or binary matches
  `nativeApps`), `webapp` (bound window class matches `webApps`), `browser`
  (name or binary matches `browsers`), else none.
- **`webApps`:** new setting, default `omateams|teams-for-linux`. Empty means
  off; `normalize()` keeps `""`; never match an empty pattern or empty class.
- **`decide`:** `native` and `webapp`: a call after 3 s. `browser`: `none`
  before 3 s; then a call when its *own* bound window's title matches
  `meetingTitles` (`by: "title"`) or after `maybeDelay` (`by: "fallback"`);
  `maybe` in between. Another window's title and screen sharing confirm
  nothing.
- **Kept confirmation:** `confirmed` maps stream key → `by`, kept while the
  stream stays a call; `fallback` may upgrade to `title` or `webapp`, nothing
  downgrades.
- **The end:** a stream whose bound window closes is `ended` (counts as
  `none`) until the stream goes away; a new window does not revive it. A never
  bound stream ends when it goes away. A lost title ends nothing.
- **Patterns:** remove `\| Microsoft Teams`; `^Zoom( Meeting| Workplace)?`
  becomes `^Zoom Meeting`. `normalize()` migrates only a `meetingTitles` equal
  to the old default.
- **State file, `schema: 2`,** from a pure `windowFields(streams, prev)`:
  - `callWindowState`: `none` without a call stream; `ambiguous` when a call
    stream is ambiguous or two are bound to different windows; `bound` when
    every call stream is bound to the same window; else `none`.
  - `callWindow` (`stableId`), `callWindowClass`: set only when `bound`.
  - `callWindowShowing`: `false` unless `bound`; native or `webapp`: `true`;
    browser: its title matches `meetingTitles` now.
  - `callBy`: the kept `by` of the stream that sets `call`; non-`fallback`
    outranks `fallback`, then the one confirmed first; `""` without a call.
  - `callWindowSeq`: previous + 1 when `callWindow` or `callWindowShowing`
    changed, else the same.
  - `writeState()` runs on a change of any of these.
- **Removed:** `screenShared`, `videoSources` and its tracker entries, the
  global `confirmTitle(root.titles)` confirmation, and "or screen share" in the
  `browsers` hint.
- Titles stay in memory and the 0600 file; nothing new is logged or notified.

## Repo traps

- Tests: `node tests/model.test.js`, `node tests/qml-text.test.js`,
  `bash tests/actions.test.sh`; all three run in `nix flake check`.
- `tests/model.test.js` loads only `SettingsModel.js`: logic that needs a test
  must live there, exported in `module.exports`.
- `SettingsModel.js` is `.pragma library`: no QML types, plain JS only.
- `omarchy-plugin-validate` refuses symlinks in the plugin folder.
- Never start Quickshell from a coder or reviewer.
- Coders do not stage or commit; the lead commits each step.

## Steps

1. **`SettingsModel.js` and `tests/model.test.js`: the pure logic.**
   - Add `webApps` to `DEFAULTS` and `normalize()` (empty kept, invalid regex →
     default); the `meetingTitles` default change and its old-default
     migration.
   - Add, and export: `parentFromStat(text)` (for symmetry with the helper's
     test), `streamKey(id, pid)`, `candidates`, `bind`, `kindOf(props, cls, s)`,
     extended `decide({kind, heldMs, windowTitle, windowClass, prevBy}, s)`
     returning `{call, by, title}`, `aggregate(streams)`, `windowFields`.
   - Tests: every case in the spec's Verification list for model.test.js.

   → verify: `node tests/model.test.js`.
   Traps: `matches()` with an empty pattern returns true; guard it for
   `webApps`.

2. **`bin/meeting-mode-actions ancestors` and `tests/actions.test.sh`.**
   - The subcommand, reading `${MEETING_MODE_PROC:-/proc}/<pid>/stat`.
   - Tests with fake stat files: a name with `) (` and spaces, the 8-step
     limit, pid 1, a missing file, a loop.

   → verify: `bash tests/actions.test.sh`.
   Traps: keep the `status` default and the other subcommands unchanged.

3. **`Service.qml`: wiring.**
   - `ancestryProc` and its queue; `windows` binding and the refresh logic;
     stream keys everywhere; per-stream `bindings`, `confirmed` (by), `ended`;
     `recompute()` using step 1's functions; remove `screenShared`,
     `videoSources`, `titles` confirmation.
   - `stateObject()` adds `schema: 2` and `windowFields`; `writeState()` on
     their change.

   → verify: `node tests/qml-text.test.js` (extend it: no title in
   `console.*` or `notify-send`, `runHelper` not used for `ancestors`), and
   `node tests/model.test.js`.
   Traps: the 1 s `Timer` only calls `recompute()`; no `Process` starts from
   it.

4. **`Settings.qml` and README.**
   - A `webApps` row after `nativeApps` ("Web app windows", regex on the
     window class, empty means off), validated like the others; drop "or
     screen share" from the `browsers` hint.
   - README: `webApps`, the new state fields, that a browser call is confirmed
     only by its own window's title, and the end on window close.

   → verify: `node tests/qml-text.test.js`, `nix flake check`.

5. **Build and live check** (lead).
   - `nix flake check`.
   - With meetingai #102 deployed on p620: Teams (`omateams`), a Meet tab, a
     Meet PWA, Discord and Zoom. Record the window state, class, `callBy` and
     the end on leaving, with meetingai's sampler (no titles). Results go into
     meetingai PR #102.
   - Deploying needs the owner's OK.

## Tests

- `node tests/model.test.js`, `node tests/qml-text.test.js`,
  `bash tests/actions.test.sh`, `nix flake check`: all pass.
- Live: the step 5 table, each row as expected.

## Rollback

Revert the branch's commits. The state file's new fields are additive, so
meetingai falls back to schema 1 (auto screenshots unavailable, ownership by
#64's rule).
