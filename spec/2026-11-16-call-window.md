---
status: approved
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
- **`Service.qml`** runs it once per stream through a separate
  `ancestryProc` (a `Process`, asynchronous), not `runHelper`: that one parses
  status JSON, overwrites `changed`, and has a single queued slot
  (`Service.qml:191-215`).
  - Requests go into a FIFO array, one run at a time; each result carries its
    key. A result whose key is no longer a live stream is dropped.
  - **The stream key** is `id + ":" + pid`, where `pid` is the stream's
    `application.process.id`. *All* per-stream state uses this key:
    `heldAt`, `confirmed`, `bindings`, `ended` and `chains`. A reused stream
    id with a new pid starts fresh: no inherited window, hold time or
    confirmation.
  - The chain is cached in `chains` under that key.
  - The cache keeps the *chain*, not the window: a window that opens after its
    stream still binds when the toplevels change.
  - Entries for streams that are gone are dropped in `recompute()`.
  - A stream with no `application.process.id` has no chain: no window.
  - Nothing here runs on the 1 s tick. The tick only re-runs `recompute()`,
    which reads the cache.

### 2. Windows (A1, A2)

- **The window list** is a binding, `windows`, over
  `Hyprland.toplevels.values`: for each toplevel, `pid`, `stableId` and class
  from `lastIpcObject`, and the title. It re-evaluates when a window opens or
  closes (`values`), a title changes, or a refresh updates `lastIpcObject`.
  `onWindowsChanged` calls `recompute()`. (`Hyprland.toplevels` itself is a
  constant model object, so `onToplevelsChanged` would never fire.) Today only
  browser titles are watched (`Service.qml:78-89`).
  - A newly opened toplevel has an empty `lastIpcObject` until
    `Hyprland.refreshToplevels()` answers. When any toplevel lacks `pid` or
    `stableId`, `Service.qml` calls it once per change of `values` (not per
    tick). Quickshell drops a refresh asked for while one is in flight, so when
    a refresh answers and a toplevel still lacks them, it asks once more.
  - **No new binding while any toplevel is unrefreshed:** otherwise a stream
    whose process already owns a window ("Zoom Workplace") could bind to it
    before the new call window ("Zoom Meeting") shows its pid, and a binding
    never moves. Existing bindings still hold and still end on close.
  - **Pids are compared as numbers:** PipeWire gives
    `application.process.id` as a string, Hyprland's `pid` is a number, and
    the helper prints text.
- **`SettingsModel.candidates(chain, windows, s)`** (pure): the first pid in
  the chain that owns any windows gives the candidates. With more than one,
  only those whose title matches `meetingTitles` remain.
- **`SettingsModel.bind(prev, candidates, windows)`** (pure), per stream:
  - a previous binding holds while a window with that `stableId` exists, through
    title changes, and never moves, with one exception (*amended by the owner,
    2026-11-16*): a binding made because it was the process's **only** window
    (no title filter applied) may move **once** to another window of the same
    owning pid whose title matches `meetingTitles`, when that is the only
    such window. A binding chosen by title never moves. (Zoom opening the mic
    while Zoom Workplace is its only window, then opening "Zoom Meeting".)
  - otherwise exactly one candidate binds; two or more give `ambiguous`; none
    gives unbound.
- Bindings live in `bindings` (stream id → `stableId`), dropped with the
  stream.

### 3. Kind and confirmation (A3, A5)

- **Which streams are looked at:** every ready capture stream that passes
  `isCallStream(props, ".")` gets a chain and a binding, so a `webApps` window
  can make a stream a call even when its app name matches neither list. Today
  such a stream is dropped before any decision (`Service.qml:62`,
  `SettingsModel.js:165`). Its kind is then, in order: `native` (name or
  binary), `webapp` (bound window class), `browser` (name or binary), or
  nothing.

- **`webApps`**, a new setting, default `omateams|teams-for-linux`: a regex on
  the bound window's class. Empty means off (an empty regex would match every
  class), as an empty `meetingTitles` does; `normalize()` keeps `""`.
- **`SettingsModel.decide()`** takes, per stream, `kind`, `heldMs`, and the
  stream's own `windowClass` and `windowTitle`:
  - `native` (app name or binary matches `nativeApps`): a call after 3 s, as
    today; `by: "native"`.
  - a bound window whose class matches `webApps`: a call after 3 s;
    `by: "webapp"`. This covers Teams as `omateams`, whose stream is "Chromium
    input".
  - `browser`: after the same 3 s hold, a call once its *own* bound window's
    title matches `meetingTitles` (`by: "title"`), or after `maybeDelay`
    (`by: "fallback"`); `maybe` between 3 s and then, `none` before 3 s.
- **Removed:** the global `confirmTitle(root.titles)` and `screenShared`
  confirmation (`Service.qml:68-76`, `:126-127`), with the `videoSources`
  tracking that only fed it (`:47-54`, `:101`), and the "or screen share" in
  the `browsers` hint (`Settings.qml:41`). A title in another window and a
  screen share confirm nothing.
- **Patterns:** `\| Microsoft Teams` is removed from the defaults;
  `^Zoom( Meeting| Workplace)?` becomes `^Zoom Meeting`.
  - `normalize()` migrates only a value equal to the old default, so a user's
    own list is kept.

### 4. The end (A4)

- A stream stays a call while it exists *and* its bound window exists.
  `confirmedIds` (`Service.qml:133`, booleans) becomes `confirmed`, stream key
  → `by`: kept for as long as it stays a call, so a tab switch keeps
  `callBy: "title"` and a later `maybeDelay` does not turn it into
  `fallback`. `fallback` may still upgrade to `title` or `webapp` when its own
  window later qualifies; nothing ever downgrades.
- When its bound window closes, the stream is marked `ended` until the stream
  goes away, and counts as `none`. A new window does not revive it: the call
  ends. *Amended by the owner, 2026-11-16:* this applies to `browser` and
  `webapp` streams only. A `native` stream whose window closes (Discord or
  Slack closed to the tray) stays a call while its mic stream exists; its
  binding is cleared and it may bind again (window state `none` meanwhile, so
  meetingai pauses screenshots).
- A stream that was never bound keeps today's rule: it ends when it goes away.
- A lost title never ends a call.

### 5. The state file (A6)

`stateObject()` gains, with `schema: 2`:

| Field | Source |
|---|---|
| `callWindow` | the `stableId` when `callWindowState` is `bound`, else `""` |
| `callWindowState` | `SettingsModel.aggregate(streams)`: `none` when no stream is a call; `ambiguous` when any call stream is ambiguous or two are bound to different windows; `bound` when every call stream is bound to the same window; else (some call stream unbound) `none` |
| `callWindowClass` | the bound window's class; `""` unless `bound` |
| `callWindowShowing` | `false` unless `bound`. Native or `webapp` window: `true`; browser window: its title matches `meetingTitles` now |
| `callBy` | the kept `by` of the call stream that sets `call`: any non-`fallback` stream outranks a `fallback` one; among equals, the one confirmed first. `""` when `call` is not `call` |
| `callWindowSeq` | incremented in `recompute()` whenever `callWindow` or `callWindowShowing` changes |

- **`SettingsModel.windowFields(streams, prev)`** (pure) computes these
  fields and the next `callWindowSeq` from the previous ones, so the node
  tests cover them; `stateObject()` merges its result.
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
- **Reusing `runHelper` for ancestry:** it parses status JSON, overwrites
  `changed` and keeps one queued call, so lookups would be lost or clobber a
  pending `off`.

## Risks

- **`lastIpcObject` lacks `pid` and `stableId`** for a new window until a
  refresh answers. Mitigation: the refresh and its retry above, and no new
  binding meanwhile; the stream reads as unbound (`none`) for that moment.
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
  - stream keys: a reused stream id with a new pid inherits no window, hold
    time or confirmation; a late ancestry result for a gone key is ignored;
  - a stream unknown to both app lists becomes a call through a `webApps`
    window class;
  - `callBy` kept through a tab switch and past `maybeDelay`; `fallback`
    upgrades to `title`; a `title` stream outranks an older `fallback` one;
  - no new binding while a toplevel is unrefreshed; an existing binding holds;
  - pids compared as numbers (string from PipeWire, number from Hyprland);
  - empty `webApps` matches nothing; a browser stream is `none` before 3 s;
  - `windowFields`: class and showing empty unless `bound`; one call stream
    unbound gives `none`; `callBy` `""` without a call;
  - `decide`: native, `webApps` by class, browser by its own title, fallback,
    another window's title ignored;
  - `aggregate`: one window, two streams on one window, two windows, an
    ambiguous stream;
  - the end: a closed bound window gives `none`; a title change does not;
  - patterns: "Chat | Microsoft Teams" and "Zoom Workplace" no longer match;
    `normalize()` migrates only the old default;
  - `callWindowSeq` moving on a window or showing change, and not otherwise.
- `bash tests/actions.test.sh`: `ancestors` with `)` and spaces in the name,
  the 8-step limit, pid 1, a missing file.
- `node tests/qml-text.test.js` and `nix flake check`.
- **Live on p620,** with meetingai #102 and its sampler: Teams (`omateams`),
  a Meet tab, a Meet PWA, Discord and Zoom; for each, the window state, the
  class, `callBy`, and the end when leaving. Results go into meetingai's PR.
