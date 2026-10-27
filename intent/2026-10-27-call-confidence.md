---
status: draft
issue: none (issues are disabled on this repo)
author: olafkfreund
related: olafkfreund/mixarchy-meetingai intent/2026-10-27-0-call-detection.md (approved) and its spec
---

# Intent: tell real calls from mic use, and publish it for other plugins

## Problem

- **Any browser mic use counts as a call:** voice typing, voice notes and
  mic tests quiet the desktop. Chrome's capture streams carry no tab
  title or URL, so a Meet tab looks like any other mic use.
- **Missed apps:** Vesktop (`vesktop`) and the native Webex client
  (`CiscoCollabHost`) aren't in `callApps`.
- **Stale state for other plugins:** `meeting-mode.json` is only written
  inside `start()`/`stop()`, so `callDetected` and `callApp` can be stale.
  nixarchy-meetingai reads this file to offer meeting notes and currently
  has to use `active`, which a manual toggle also flips.

## Proposed outcome

- Two tiers:
  - native call apps count after 3 s of mic
  - browsers count as "maybe" after 3 s of mic, and as a call once a
    meeting window title, an xdph screen share or Firefox's sharing
    indicator confirms it, or after 60 s of continuous mic
- The state file is written on every detection change, with `call`
  (`none|maybe|call`), `callApp`, `callTitle` and `since`. `active` keeps
  its meaning.
- Quieting the desktop happens only for `call`, so voice notes stop
  triggering DND.
- An optional `onStart` step runs `omarchy-shell meetingai offer` before
  DND turns on, when that plugin is installed.

## Affected users and systems

`Service.qml`, `SettingsModel.js`, `Settings.qml` (new title patterns and
`maybeDelay`), `tests/`, README. Users of this plugin on razer and p620.

## Constraints

- Event-driven only (PipeWire, Hyprland toplevels), no polling.
- Window titles stay in memory and in the 0600 runtime file, never in
  logs.
- Additive state-file fields; existing readers keep working.

## Open questions

None. The design decisions were approved in the meetingai spec.
