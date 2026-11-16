---
status: approved
issue: none (issues are disabled on this repo)
spec: spec/2026-11-16-call-window.md
coders:
  1: codex   # small, tricky pure logic (the step reducer: binding, confirmation, end, aggregation) with many edge cases
  2: coder   # a short bash subcommand and its fake-/proc test
  3: coder   # QML wiring in Service.qml around step 1's reducer
  4: coder   # Settings row, hint text, README
reviewers:
  - codex   # read-only review of the diff against this plan
  - agy     # read-only review of the diff against this plan
---

# Plan: name the meeting's window, and end the call when the meeting ends

Implements meetingai's approved contract (its spec, section A) here. Branch
`feat/call-window-schema-2`. Every decision a coder needs is below; the spec
need not be opened.

## Approved decisions (copied from the spec)

### Ancestry
- `bin/meeting-mode-actions ancestors <pid>` prints the pid, then each parent,
  one per line. The parent is the second field after the *last* `)` of
  `${MEETING_MODE_PROC:-/proc}/<pid>/stat` (names may contain `)` and spaces).
  Stops after 8 steps, at pid 1, at a repeated pid, or when a read fails;
  exits 0 with what it found.
- It runs **once per stream key**, off the tick, in a separate `ancestryProc`:
  a FIFO of `{key, pid}`, one run at a time, no duplicate key queued or in
  flight. Never through `runHelper` (that one parses status JSON, overwrites
  `changed`, and keeps one queued call).
- A result is stored in `chains[key]` only if `key` is still a live stream;
  then `recompute()`.
- The cache holds the **chain**, not a window, so a window that opens later
  still binds.
- A stream whose `application.process.id` is missing or not a positive number
  gets no lookup and no chain: it never binds.

### Streams and state
- **Stream key** `id + ":" + pid`. *All* per-stream state uses it: `heldAt`,
  `confirmed`, `bindings`, `ended`, `chains`. A reused id with a new pid
  starts fresh. Entries for keys that are gone are dropped on every
  `recompute()`.
- Pids are compared as numbers.
- **Streams looked at:** every ready capture stream passing
  `isCallStream(props, ".")`. Kind, in order: `native` (app name or binary
  matches `nativeApps`), `webapp` (bound window class matches `webApps`),
  `browser` (name or binary matches `browsers`), else `""`.
- **The 1 s timer** runs only while some stream that is not `ended` has a
  kind (native, webapp or browser); not for an idle wake-word recorder.
  Window changes already trigger `recompute()`.

### Windows and binding
- `windows`: a binding over `Hyprland.toplevels.values`, giving per toplevel
  `{pid, stableId, cls, title, refreshed}` from `lastIpcObject` and `title`.
  `refreshed` is false while `lastIpcObject.pid === undefined` or
  `!lastIpcObject.stableId` (an XWayland window may keep `pid` −1 or 0 after a
  refresh: that counts as refreshed, and matches no stream).
  `onWindowsChanged` → `recompute()`.
- When any toplevel is unrefreshed, call `Hyprland.refreshToplevels()` once per
  change of `values`; when a refresh answers and one is still unrefreshed,
  once more (Quickshell drops a refresh asked during one in flight).
- **No new binding while any toplevel is unrefreshed;** existing bindings hold
  and still end on close.
- **Candidates:** the first pid in the stream's chain that owns any windows;
  with several, only those whose title matches `meetingTitles`.
- **Binding:** a previous `stableId` holds while that window exists, through
  title changes, and never moves. Otherwise exactly one candidate binds; two or
  more are `ambiguous`; none is unbound.

### Confirmation and the end
- `native` and `webapp`: a call after 3 s held, `by: "native"` / `"webapp"`.
- `browser`: `none` before 3 s; then a call when its *own* bound window's
  title matches `meetingTitles` (`by: "title"`), or after `maybeDelay` held
  (`by: "fallback"`); `maybe` in between. Another window's title and screen
  sharing confirm nothing.
- `confirmed[key] = {by, at}` (`at` = when it first became a call). Kept while
  the stream stays a call: a tab switch keeps `title`, `maybeDelay` does not
  turn it into `fallback`. `fallback` may upgrade to `title` or `webapp`
  (keeping `at`); nothing downgrades.
- **The end:** a stream whose bound window closes is `ended` (counts as
  `none`) until the stream goes away; a new window does not revive it. A
  never-bound stream ends when it goes away. A lost title ends nothing.
- **The winning stream** sets `call`, `callBy`, `callApp` and `callTitle`
  together: the highest state (`call` > `maybe` > `none`); among calls, any
  non-`fallback` outranks `fallback`, then the smallest `at`.
- `callTitle`, as today, is non-empty only for a `browser` winner whose bound
  window title matches `meetingTitles` now; a kept confirmation keeps no stale
  title. `callBy` is `""` unless `call` is `call`.

### Settings and patterns
- `webApps`: new, default `omateams|teams-for-linux`. Empty means off and is
  kept by `normalize()`; an invalid regex falls back to the default. Never
  match an empty pattern or an empty class.
- `meetingTitles` default: remove `\| Microsoft Teams`; `^Zoom( Meeting|
  Workplace)?` becomes `^Zoom Meeting`. `normalize()` replaces a stored value
  only when it equals the old default exactly.

### State file (`schema: 2`)
- `recompute()` computes the fields below with `windowFields(streams, prev)`
  and stores them; `stateObject()` only reads them (so `status()` and
  `writeState()` agree, and a flip-and-revert in one turn still moves the
  counter).
  - `callWindowState`: `none` without a call stream; `ambiguous` when a call
    stream is ambiguous or two are bound to different windows; `bound` when
    every call stream is bound to the same window; else `none`.
  - `callWindow` (the `stableId`) and `callWindowClass`: `""` unless `bound`.
  - `callWindowShowing`: `false` unless `bound`; native or `webapp`: `true`;
    browser: its window title matches `meetingTitles` now.
  - `callBy` as above.
  - `callWindowSeq`: previous + 1 when `callWindow` or `callWindowShowing`
    changed, else unchanged.
- `writeState()` also runs when any of these change.
- **Removed:** `screenShared`, `videoSources` (and its `PwObjectTracker`
  entries), the global `confirmTitle(root.titles)` confirmation, the
  `titles` property.
- Titles stay in memory and the 0600 file; nothing new is logged or notified.

## Repo traps

- Tests: `node tests/model.test.js`, `node tests/qml-text.test.js`,
  `bash tests/actions.test.sh`; `nix flake check` runs them and shellcheck.
- `tests/model.test.js` loads only `SettingsModel.js`: logic that needs a test
  lives there and is exported in `module.exports` (`SettingsModel.js:219`).
- `SettingsModel.js` is `.pragma library`: plain JS, no QML types.
- `omarchy-plugin-validate` refuses symlinks in the plugin folder.
- Never start Quickshell from a coder or reviewer.
- Coders do not stage or commit; the lead commits each step.

## Steps

1. **`SettingsModel.js` (`:7-23` defaults, `:95-140` normalize, `:156-195`
   classify/decide, `:219` exports) and `tests/model.test.js`: the pure logic.**
   - `webApps` in `DEFAULTS`/`normalize()`; the `meetingTitles` default and
     its exact-old-default migration.
   - Export `streamKey(id, pid)`, `parentFromStat(text)`, `kindOf(props,
     windowClass, s)`, `candidates(chain, windows, s)`, `bind(prev, cands,
     windows, refreshedAll)`, and **`step(prev, input, now, s)`**: the whole
     per-recompute transition.
     - `input`: `{streams: [{id, pid, props}], chains, windows}`.
     - `prev` / result state: `{heldAt, confirmed, bindings, ended, fields}`.
     - Result also: `call`, `callApp`, `callTitle`, the `fields` from
       `windowFields`, `needChain` (live keys with a positive pid and no
       chain), and `timerNeeded`.
   - Tests (each a `test(...)`):
     - `parentFromStat` with `) (` and spaces in the name;
     - `candidates`: first owning ancestor, title filtering, several left;
     - `bind`: held through a title change, never moved, dropped on close,
       one/none/several candidates, no new binding while unrefreshed;
     - stream keys: a reused id with a new pid inherits nothing; gone keys
       dropped from every map; no pid → no `needChain`, never bound;
     - pids as numbers: `"123"` matches `123`;
     - kinds: `native`, `webapp` by class for a stream unknown to both lists,
       `browser`, `""`; empty `webApps` matches nothing;
     - `decide` via `step`: browser `none` before 3 s, `maybe`, `title` by its
       own window, `fallback` at `maybeDelay`; another window's title ignored;
     - confirmation kept through a tab switch and past `maybeDelay`;
       `fallback` → `title` upgrade; no downgrade;
     - the end: bound window closes → `none` and stays; a title change does
       not end it;
     - winner: `title` outranks an older `fallback`; earlier `at` wins among
       equals; `callApp`/`callTitle`/`callBy` from the same stream;
       `callTitle` empty after a tab switch;
     - `windowFields`: one window, two streams on one window, two windows,
       an ambiguous stream, a call stream unbound → `none`; class and
       showing empty unless `bound`; `callBy` `""` without a call;
       `callWindowSeq` moves on a window or showing change, not otherwise;
     - patterns: "Chat | Microsoft Teams" and "Zoom Workplace" do not match;
       `normalize()` migrates only the old default;
     - `timerNeeded` false for an idle unknown recorder.

   → verify: `node tests/model.test.js`.
   Traps: `matches()` with an empty pattern returns true: guard it. Keep
   `decide`'s old export working or update its existing tests.

2. **`bin/meeting-mode-actions` (`:86-91` the `case`) and
   `tests/actions.test.sh`: the `ancestors` subcommand.**
   - Read `${MEETING_MODE_PROC:-/proc}/<pid>/stat` with `read`; take the text
     after the last `) ` with `${line##*) }`; the parent is its second field.
   - Tests with fake stat files: a name with `) (` and spaces, the 8-step
     limit, pid 1, a missing file, a loop.

   → verify: `bash tests/actions.test.sh` and
   `shellcheck bin/meeting-mode-actions tests/actions.test.sh`.
   Traps: the test's `PATH` holds only `bash jq cat cut mkdir chmod touch rm
   stat` (`actions.test.sh:48-52`): pure bash, no `awk`/`sed`/`grep`/`tr`.
   Keep `status` as the default and the other subcommands unchanged.

3. **`Service.qml`: wiring around `step()`.**
   - Remove `videoSources` (`:47-54`), `screenShared` (`:68-76`), `titles`
     (`:78-89`), their tracker entries and handlers (`:101-103`).
   - `windows` binding and the refresh logic (above); `onWindowsChanged:
     recompute()`.
   - `ancestryProc` with its FIFO: start the next entry only after the
     process has exited (`onRunningChanged` to false), not on
     `onStreamFinished`; drop a result whose key is gone; then `recompute()`.
   - `recompute()` (`:112-146`): build `input`, call `SettingsModel.step`,
     store its state and `fields`, enqueue `needChain`, set `call`, `callApp`,
     `callTitle`, `callSince` (unchanged rule).
   - `Timer.running` (`:108`): `root.timerNeeded`.
   - `stateObject()` (`:343-360`): add `schema: 2` and the stored `fields`;
     `writeState()` when they change.

   → verify: `node tests/qml-text.test.js` (extend it: no title reaches
   `console.*` or `notify-send`; `ancestors` is not run through `runHelper`),
   `node tests/model.test.js`.
   Traps: no `Process` started from the 1 s timer; every `Text` keeps
   `textFormat: Text.PlainText` (`qml-text.test.js`).

4. **`Settings.qml` (`:40-43` rows) and `README.md`.**
   - A row after `nativeApps`: `webApps`, "Web app windows", "Window classes
     that count as a call as soon as their window uses the microphone (regular
     expression). Empty means none.", validated like the others.
   - `browsers` hint (`:41`): drop "or screen share"; say "until its own
     window shows a meeting title".
   - README: update "Telling a call from microphone use" (`:126`), "State file
     for other plugins" (`:156`) with the new fields and `schema: 2`, "How it
     works" (`:175`) for the window binding and the end on window close, and
     the Settings list (`:102`).

   → verify: `node tests/qml-text.test.js`, `nix flake check`.
   Traps: `Text` items need `textFormat: Text.PlainText`; remove every
   mention of screen-share confirmation and of other windows' titles
   confirming a call.

5. **Build and live check** (lead).
   - `nix flake check`.
   - With meetingai #102 deployed on p620 (needs the owner's OK), with
     meetingai's sampler (no titles):

   | Case | Expected |
   |---|---|
   | Teams (`omateams`): join, then leave | `call` within ~3 s, `callBy: webapp`, `bound`, class `omateams`; `none` when the window closes or the mic is released |
   | Meet in a Chrome tab: join; switch tab; leave | `title`, `bound`, showing true; tab switch: still `call`, showing false; leave: ends when the mic stream goes |
   | Meet PWA | as the tab, with its own window |
   | Discord voice channel | `native`; window `bound` or `none` (several windows: `ambiguous`) |
   | Zoom meeting, with Zoom Workplace open | `native`, `bound` to the meeting window, not Workplace |

   Results go into meetingai PR #102.

## Implementation notes

- *Step 1 (Codex):* `confirmed` also upgrades `title` → `webapp` (the window class is the stronger signal); `matches()` returns false for an empty pattern or empty text.
- *Step 3 (coder, deviation):* the refresh is asked again from `onWindowsChanged` only while the number of unrefreshed windows has fallen since the last ask, so a window that never refreshes cannot cause a refresh loop. The chain cache lives in the stored `step()` state (`model.chains`), which `step()` prunes to live streams.
- *Step 3 (lead fix):* the next ancestry run starts only after both the process exit and its output are in, in either order; otherwise a late output was read with a cleared key, dropped, and asked again forever.
- *Step 4 (coder):* README also gained a short paragraph on binding a stream to its window and the end on window close.

## Tests

- `node tests/model.test.js`, `node tests/qml-text.test.js`,
  `bash tests/actions.test.sh`, shellcheck, `nix flake check`: all pass.
- Live: the table in step 5, each row as expected.

## Rollback

Revert the branch's commits. The state file's new fields are additive, so
meetingai falls back to schema 1 (auto screenshots unavailable, ownership by
#64's rule).
