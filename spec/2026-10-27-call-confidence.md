---
status: draft
issue: none (issues are disabled on this repo)
intent: intent/2026-10-27-call-confidence.md
related: olafkfreund/mixarchy-meetingai spec/2026-10-27-0-call-detection.md (approved), section A
---

# Spec: tell real calls from mic use, and publish it for other plugins

## Design

### Classification (`SettingsModel.js`, pure and unit-tested)

- New settings, normalised like the existing ones:
  - `nativeApps` (default
    `zoom|teams-for-linux|teams|discord|vesktop|slack|signal|webex|CiscoCollabHost|element|skype|jitsi|telegram`)
  - `browsers` (default `chrom|firefox|brave|vivaldi|zen|librewolf|edge`)
  - `meetingTitles` (default, one regex per line:
    `^Meet - [a-z]{3}-[a-z]{4}-[a-z]{3}`, `\| Microsoft Teams`,
    `^Zoom( Meeting| Workplace)?`, `Jitsi Meet`, `Huddle`, `Webex`,
    `Messenger call`, `WhatsApp.*[Cc]all`)
  - `maybeDelay` (60 s, 10–600)
  - an existing `callApps` value set by the user is migrated into
    `nativeApps` + `browsers` by splitting on the default browser list
- `classify(props, s)` → `"native" | "browser" | ""` from
  `application.name` / `application.process.binary`.
- `confirmTitle(titles, s)` → the first matching title, or "".
- `decide({kind, heldMs, confirmed, title}, s)` →
  `{call: "none"|"maybe"|"call", title}`:
  - native, held ≥ 3 s → call
  - browser, held ≥ 3 s → maybe; with a confirmer → call; held ≥
    `maybeDelay` → call

### Signals (`Service.qml`, event-driven)

- Mic: the existing `Pipewire.nodes` capture streams (unchanged).
- Titles: `Quickshell.Hyprland` `Hyprland.toplevels` titles (in memory).
- Screen share: a PipeWire node with `media.class` `Video/Source` and
  `media.name` starting with `xdph-streaming-`.
- Firefox/Zen sharing indicator: a toplevel titled "Firefox — Sharing
  Indicator" (or the Zen equivalent).
- A `heldSince` timestamp per qualifying stream; a 1 s `Timer` runs only
  while a stream is held (needed for the 3 s and 60 s thresholds).

### Behaviour

- Desktop quieting starts only for `call` (fixes voice notes triggering
  DND). Manual on/off and `suppressed` keep working as today.
- **State file** (0600, `$XDG_RUNTIME_DIR/meeting-mode.json`) is written
  whenever `call`, `callApp`, `callTitle` or `active` changes:
  `{active, reason, since, call, callApp, callTitle, callSince,
  callDetected}`, where `callDetected` = `call === "call"` (kept for old
  readers).
- **Offer hook:** in `start()`, before the helper turns DND on, run
  `omarchy-shell meetingai offer` if `omarchy-shell plugin list` shows
  `nixarchy.meetingai` enabled. Errors are ignored.
- Titles never go to logs or notifications from this plugin.

### Settings UI

`Settings.qml` gains the "Meeting window titles" text area (one pattern
per line) and "Treat browser mic as a call after (s)". The app list
splits into "Call apps" and "Browsers".

## Alternatives rejected

Same as the meetingai spec: no camera polling, no browser extension, no
Hyprland screencast events, no weighted scoring.

## Risks

- Title patterns need real calls to confirm.
- A background Meet tab stays "maybe" until 60 s or a screen share.
- `Hyprland.toplevels` needs Quickshell's Hyprland module (present on
  nixarchy).

## Verification

- `node tests/model.test.js`: classify per app (incl. vesktop,
  CiscoCollabHost), title confirmers, `decide` for every tier, threshold
  and `maybeDelay` boundaries, migration of a custom `callApps`.
- `tests/qml-text.test.js` and `actions.test.sh` still pass; a new check
  that `Service.qml` writes no title into `console.*` or `notify-send`.
- `nix flake check`.
- Real calls with the owner (shared with the meetingai verification).
