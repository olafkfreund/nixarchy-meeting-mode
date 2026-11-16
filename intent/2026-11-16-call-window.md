---
status: draft
issue: none (issues are disabled on this repo)
author: olafkfreund
related: olafkfreund/nixarchy-meetingai #101, spec/2026-11-16-101-meeting-end-and-window-shots.md section A (approved)
---

# Intent: name the meeting's window, and end the call when the meeting ends

## Problem

nixarchy-meetingai reads `meeting-mode.json` to stop meeting notes when a call
ends and, from #101, to take auto screenshots of the meeting window only. Today
the file cannot support either:

- **No window.** The file says a call is on and which app, but not which
  window holds it. meetingai cannot capture the meeting window, or show the
  owner which window it took as the meeting.
- **Confirmation is global** (`Service.qml:127`, `:69`). A meeting title in
  *any* browser window, or any screen share, confirms *every* browser mic
  stream. So an unrelated mic user becomes a call.
- **Calls outlive the meeting.** A stream stays a call while it exists
  (`Service.qml:133`), and the highest state across all streams wins
  (`:129`). An idle second mic user keeps `call` on.
- **Loose patterns** (`SettingsModel.js:18`): `\| Microsoft Teams` matches the
  idle Teams app ("Chat | Microsoft Teams"), and `^Zoom( Meeting| Workplace)?`
  matches an idle Zoom Workplace.
- **Web apps are browsers.** Teams on p620 (`omateams`) is a QtWebEngine app
  whose mic stream is named "Chromium input", so it falls into the browser
  tier and its 60 s fallback (measured 2026-11-16 in meetingai #101).

## Proposed outcome

Observable through the state file and the bar:

- **Each call names its window** when it can tell: the window's `stableId`
  and class, or that there is none, or that several windows could be it. It
  never picks one of several.
- **A browser mic is confirmed only by its own window,** not by another
  window's title or an unrelated screen share. The 60 s fallback stays, and
  is reported as such.
- **A call ends when its stream goes away or its window closes.** A title
  change (a tab switch) does not end it.
- **Web-app windows** (Teams as `omateams` or `teams-for-linux`) count as
  native calls by window class.
- **Idle Teams and idle Zoom Workplace are not calls.**
- **The file says how the call was confirmed** (native, web app, title,
  fallback), whether the bound window is currently showing the meeting, and
  carries `schema: 2`. The exact fields are in meetingai's approved spec,
  section A6.

## Affected users and systems

- `Service.qml`, `SettingsModel.js` (patterns, a new `webApps` setting),
  `Settings.qml`, `tests/model.test.js`, README.
- Readers of `meeting-mode.json`: nixarchy-meetingai (shell and daemon).
- Hosts: p620 and razer, Hyprland only.

## Constraints

- **Additive fields only.** Readers of schema 1 keep working; meetingai
  already handles both.
- **Titles stay** in memory and in the 0600 file, never in logs.
- **Event-driven,** as today: no window or process lookups on the 1 s tick.
- **Never guess a window.** Several candidates means `ambiguous`, not the
  first one.
- No new dependency.

## Open questions

None for the owner. The design was approved in meetingai's spec, section A
(2026-11-16), including F5: a Chrome window with a meeting title is taken as
the meeting even though Chrome reports one audio process for all its tabs.
