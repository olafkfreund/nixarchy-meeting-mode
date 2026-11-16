---
status: draft
issue: none (issues are disabled on this repo)
intent: intent/2026-11-16-call-window.md
related: olafkfreund/nixarchy-meetingai spec/2026-11-16-101-meeting-end-and-window-shots.md section A (approved), PR #102
---

# Spec: name the meeting's window, and end the call when the meeting ends

## Design

The contract is meetingai's approved spec, section A (A1–A6). This is how it
lands in this repository. Pure decisions go into `SettingsModel.js`, so
`tests/model.test.js` covers them; `Service.qml` only gathers inputs and
writes the file.

### 1. Process ancestry (A1), off the tick

- **`bin/meeting-mode-actions ancestors <pid>`**, a new helper subcommand,
  prints the pid chain, one per line: the pid, then each parent.
  - The parent comes from `/proc/<pid>/stat`: the text after the *last* `)`,
    second field (the name may contain `)` and spaces).
  - It stops after 8 steps, at pid 1, or when a read fails. It exits 0 with
    whatever it found.
  - `tests/actions.test.sh` covers it with fake `stat` files (a name with
    `) (`, a loop, a missing file). The helper takes its proc root from
    `MEETING_MODE_PROC` for that test.
- **`Service.qml`** runs it once per stream through the existing `runHelper`
  path (a `Process`, asynchronous), keyed by `id + ":" + pid`, where `pid` is
  the stream's `application.process.id`.
  - The result is cached in `chains` under that key. A reused stream id with a
    new pid is a new key.
  - The cache keeps the *chain*, not the window: a window that opens after its
    stream still binds when the toplevels change.
  - Entries for streams that are gone are dropped in `recompute()`.
  - A stream with no `application.process.id` has no chain: no window.
  - Nothing here runs on the 1 s tick. The tick only re-runs `recompute()`,
    which reads the cache.

### 2. Windows (A1, A2)

- **The window list** comes from `Hyprland.toplevels`: for each, `pid`,
  `stableId` and class from `lastIpcObject`, and the title.
  - When any toplevel lacks `pid` or `stableId`, `Service.qml` calls
    `Hyprland.refreshToplevels()` once per change of the toplevel list (not per
    tick), and recomputes when it answers.
  - `onToplevelsChanged` (open, close) and title changes trigger
    `recompute()`; today only browser titles do (`Service.qml:78-89`).
- **`SettingsModel.candidates(chain, windows, s)`** (pure): the first pid in
  the chain that owns any windows gives the candidates. With more than one,
  only those whose title matches `meetingTitles` remain.
- **`SettingsModel.bind(prev, candidates, windows)`** (pure), per stream:
  - a previous binding holds while a window with that `stableId` exists, through
    title changes, and never moves;
  - otherwise exactly one candidate binds; two or more give `ambiguous`; none
    gives unbound.
- Bindings live in `bindings` (stream id → `stableId`), dropped with the
  stream.

### 3. Kind and confirmation (A3, A5)

- **`webApps`**, a new setting, default `omateams|teams-for-linux`: a regex on
  the bound window's class.
- **`SettingsModel.decide()`** takes, per stream, `kind`, `heldMs`, and the
  stream's own `windowClass` and `windowTitle`:
  - `native` (app name or binary matches `nativeApps`): a call after 3 s, as
    today; `by: "native"`.
  - a bound window whose class matches `webApps`: a call after 3 s;
    `by: "webapp"`. This covers Teams as `omateams`, whose stream is "Chromium
    input".
  - `browser`: a call once its *own* bound window's title matches
    `meetingTitles` (`by: "title"`), or after `maybeDelay` (`by: "fallback"`);
    `maybe` before.
- **Removed:** the global `confirmTitle(root.titles)` and `screenShared`
  confirmation (`Service.qml:68-76`, `:126-127`). A title in another window and
  a screen share confirm nothing.
- **Patterns:** `\| Microsoft Teams` is removed from the defaults;
  `^Zoom( Meeting| Workplace)?` becomes `^Zoom Meeting`.
  - `normalize()` migrates only a value equal to the old default, so a user's
    own list is kept.

### 4. The end (A4)

- A stream stays a call while it exists *and* its bound window exists
  (`confirmedIds` stays, `Service.qml:133`).
- When its bound window closes, the stream is marked `ended` until the stream
  goes away, and counts as `none`. A new window does not revive it: the call
  ends.
- A stream that was never bound keeps today's rule: it ends when it goes away.
- A lost title never ends a call.

### 5. The state file (A6)

`stateObject()` gains, with `schema: 2`:

| Field | Source |
|---|---|
| `callWindow` | the `stableId` when `callWindowState` is `bound`, else `""` |
| `callWindowState` | `SettingsModel.aggregate(streams)`: `bound` when every stream in `call` is bound to the same window; `ambiguous` when any is ambiguous or they differ; else `none` |
| `callWindowClass` | the bound window's class |
| `callWindowShowing` | `webapp`/native window: `true`; browser window: its title matches `meetingTitles` now |
| `callBy` | `native`, `webapp`, `title` or `fallback`, from the stream that set `call` |
| `callWindowSeq` | incremented in `recompute()` whenever `callWindow` or `callWindowShowing` changes |

- `writeState()` also runs when any of these change (today only `call`,
  `callApp`, `callTitle`, `active`: `Service.qml:148-166`).
- `callTitle` keeps today's meaning. Titles stay in memory and in the 0600
  file; nothing new is logged or notified.
- The bar widget and settings panel ignore the new fields (`BarWidget.qml:64`,
  `Settings.qml:102`).

### 6. Settings and README

- `Settings.qml`: a `webApps` text field next to `nativeApps`, validated with
  `regexError` like the others.
- README: what `callWindow*` and `callBy` mean, `webApps`, and that a browser
  call is confirmed only by its own window's title.

## Alternatives rejected

- **Reading `/proc` from QML with `FileView`:** synchronous reads on the UI
  thread, and a loop to write in QML. The helper is already the plugin's way
  to touch the system, and it is testable with fake files.
- **Matching windows by `application.process.id` only, no parents:** Chrome's
  and QtWebEngine's audio comes from a child process that owns no window.
- **`hyprctl clients -j` from a `Process`:** a second source of truth beside
  `Hyprland.toplevels`, and polling.
- **Keeping screen-share confirmation:** it confirmed every browser stream, and
  meetingai's spec dropped it (A3).
- **Picking the focused window among several candidates:** a guess; the
  contract says `ambiguous`.

## Risks

- **`lastIpcObject` may lack `pid` or `stableId`** until a refresh. Mitigation:
  the refresh above; until it answers, the stream is unbound (`none`), never
  wrongly bound.
- **Sandboxed apps** (Flatpak) may hide the parent chain: no window, and
  meetingai says "no meeting window".
- **Chrome reports one audio process for all tabs** (meetingai F5, accepted):
  a meeting title in a Chrome window binds it even if another tab holds the
  mic.
- **Fewer calls confirmed:** dropping screen share and other windows' titles
  means a browser call without a meeting title waits for the 60 s fallback.
  Desktop quieting starts later in that case.
- **Hosts:** p620 and razer, through the omarchy shell plugin. meetingai's
  daemon reads schema 1 and 2.

## Verification

- `node tests/model.test.js`:
  - `candidates`: first owning ancestor, title filtering, several left;
  - `bind`: held through a title change, never moved, dropped when the window
    closes, one/none/several candidates;
  - `decide`: native, `webApps` by class, browser by its own title, fallback,
    another window's title ignored;
  - `aggregate`: one window, two streams on one window, two windows, an
    ambiguous stream;
  - the end: a closed bound window gives `none`; a title change does not;
  - patterns: "Chat | Microsoft Teams" and "Zoom Workplace" no longer match;
    `normalize()` migrates only the old default;
  - `stateObject` fields and `callWindowSeq` moving on a window or showing
    change.
- `bash tests/actions.test.sh`: `ancestors` with `)` and spaces in the name,
  the 8-step limit, pid 1, a missing file.
- `node tests/qml-text.test.js` and `nix flake check`.
- **Live on p620,** with meetingai #102 and its sampler: Teams (`omateams`),
  a Meet tab, a Meet PWA, Discord and Zoom; for each, the window state, the
  class, `callBy`, and the end when leaving. Results go into meetingai's PR.
