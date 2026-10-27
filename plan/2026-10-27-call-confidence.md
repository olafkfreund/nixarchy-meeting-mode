---
status: approved
issue: none (issues are disabled on this repo)
spec: spec/2026-10-27-call-confidence.md
reviewers:   # read-only, after the Opus review
  - codex
---

# Plan: tell real calls from mic use, and publish it for other plugins

## Approved decisions (copied from the spec)

- **Settings** (normalised in `SettingsModel.js`): `nativeApps` (default
  `zoom|teams-for-linux|teams|discord|vesktop|slack|signal|webex|CiscoCollabHost|element|skype|jitsi|telegram`),
  `browsers` (`chrom|firefox|brave|vivaldi|zen|librewolf|edge`),
  `meetingTitles` (one regex per line: `^Meet - [a-z]{3}-[a-z]{4}-[a-z]{3}`,
  `\| Microsoft Teams`, `^Zoom( Meeting| Workplace)?`, `Jitsi Meet`,
  `Huddle`, `Webex`, `Messenger call`, `WhatsApp.*[Cc]all`), `maybeDelay`
  (60, range 10–600). A user-set `callApps` is migrated by splitting on
  the default browser list.
- **Pure functions:** `classify(props, s)` → `native|browser|""`;
  `confirmTitle(titles, s)` → first matching title or "";
  `decide({kind, heldMs, confirmed, title}, s)` →
  `{call: none|maybe|call, title}` (native ≥ 3 s → call; browser ≥ 3 s →
  maybe, with a confirmer → call, ≥ `maybeDelay` → call).
- **Signals:** existing `Pipewire.nodes` capture streams; `Hyprland.toplevels`
  titles; a PipeWire `Video/Source` with `media.name` starting
  `xdph-streaming-`; the Firefox/Zen "Sharing Indicator" toplevel. A 1 s
  timer runs only while a stream is held.
- **Behaviour:** desktop quieting starts only for `call`; manual on/off
  and `suppressed` unchanged. The 0600 state file is written on every
  change of `call`, `callApp`, `callTitle` or `active`:
  `{active, reason, since, call, callApp, callTitle, callSince,
  callDetected}` with `callDetected = call === "call"`.
- **Offer hook:** in `start()`, before DND, run `omarchy-shell meetingai
  offer` if `nixarchy.meetingai` is enabled; errors ignored.
- Titles never reach logs or notifications.
- `Settings.qml`: "Call apps", "Browsers", "Meeting window titles" (text
  area) and "Treat browser mic as a call after (s)".

## Repo traps

- Tests: `node tests/model.test.js`, `node tests/qml-text.test.js`,
  `bash tests/actions.test.sh`.
- The Nix package copies an explicit file list (`flake.nix`): add any new
  file there.
- `omarchy-plugin-validate` refuses symlinks in the plugin folder.
- Coders cannot commit; the lead commits each step.

## Steps

1. `SettingsModel.js`: new settings, migration, `classify`,
   `confirmTitle`, `decide`. → verify by `node tests/model.test.js` with
   new cases (vesktop, CiscoCollabHost, each tier and boundary, maybeDelay,
   migration).
2. `Service.qml`: signals, held timers, `call` state, quieting only for
   `call`, state file on every change, offer hook. → verify by
   `qml-text.test.js` (plus a new check that no title reaches `console.*`
   or `notify-send`) and `actions.test.sh`.
3. `Settings.qml` fields; README section. → verify by `qml-text.test.js`
   and `nix flake check`.
4. Review: Opus, then Codex (read-only); fix confirmed findings.

## Tests

All three test files pass; `nix flake check` passes.

## Rollback

Revert the branch; the state file's new fields are additive.

## Implementation split

Below the hand-off threshold for files touched per step but three steps
edit files, so one `coder` does steps 1–3; the lead commits and reviews.

## Deviations log (recorded with the implementation commit)

None yet.
- **Step 2:** `startTimer` removed (`decide()` already waits 3 s);
  `PwObjectTracker` tracks all nodes (the xdph `Video/Source` node is not
  a stream and needs tracking for its properties); `callApps` is no longer
  returned by `normalize()` (kept only for migration). The offer hook runs
  `omarchy-shell meetingai offer` detached, without a plugin check: the
  IPC target simply doesn't exist when meetingai isn't installed. It is
  asynchronous, so it is not guaranteed to land before DND.
- **Review fixes (Opus):** a meeting starts on `call` but only `none`
  ends it or clears `suppressed`; a stream that was `call` stays `call`
  while it exists (tab switches, shell restarts); the Firefox/Zen sharing
  indicator confirmer is removed (it opens for mic-only use); the offer
  runs as a `Process` and DND starts from its exit (1 s fallback); the
  `callApps` migration trims tokens and matches browsers by pattern;
  titles confirm only browser streams and only from browser toplevels;
  only capture streams and `VideoSource` nodes are tracked; state writes
  are coalesced and carry `updated` and `pid`. Compiled regexes are cached
  in a module memo (not in `normalize()` output, which is persisted). An
  explicit empty `meetingTitles` turns title confirmation off. The number
  field has no Escape handler.
- **Review fixes (Codex):** the legacy `callApps` migration splits only
  on top-level `|` and validates each side (invalid → default); regex
  compile failures are cached as no-match, so detection never throws. A
  legacy value that is one group, like `(?:zoom|firefox)`, stays whole and
  lands in `browsers` (zoom then counts as a browser tier app); this is
  rare and documented here only. The Settings card is capped to the
  screen height and scrolls, revealing the focused row.
