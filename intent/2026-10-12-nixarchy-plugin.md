---
status: draft
issue: none (issues are disabled on this repo)
author: olafkfreund
---

# Intent: Meeting Mode as a nixarchy plugin, pausing nixarchy voice instead of Jarvis

## Problem

This repo is Jim Burchel's Omarchy plugin `io.github.jburchel.meeting-mode`
(MIT), copied in unchanged. On nixarchy it has three gaps:

1. **It pauses the wrong assistant.** The "Pause Jarvis" action drives
   `jarvis` (github.com/jburchel/omarchy-jarvis), which nixarchy does not
   ship. nixarchy's voice control is `omarchy-voice` (nixarchy-voice, "Oma"):
   its wake word keeps listening through a call, so it can hear the meeting
   and act on it, and it can talk over the call.
2. **It is not packaged the nixarchy way.** Sibling plugins
   (`nixarchy-pixelbuds`, `nixarchy-herdr`) have a `nixarchy.*` id, a
   `flake.nix` that builds the plugin folder and a `checks` output that runs
   the tests. This one has none, so it cannot be installed as a flake input
   and its tests do not run in `nix flake check`.
3. **Its docs point elsewhere.** README install steps, the plugin id, the
   update/remove commands and the "more plugins" section all name the
   upstream repo and Jarvis.

### Code review of what is here (for the record, not all to be fixed)

The code is small and careful: an undo log so only what it changed is put
back, private state (0700, never `/tmp`), a test harness that refuses to run
against real binaries. Findings:

- `bin/meeting-mode-actions` needs `jq`, `hyprctl`, `omarchy`, `omarchy-shell`
  from `PATH`; nothing guarantees `jq` on a nixarchy machine.
- `turn_off` undoes `awake` with `allow-idle` unconditionally: if you switch
  Stay Awake on yourself during the call, hanging up switches it off.
  (Upstream behaviour; minor.)
- `night_status` runs twice on start; harmless.
- Jarvis needs two calls and two log entries (`mute`, `listen stop`).
  `omarchy-voice listen stop` both closes the wake-word gate and drops queued
  speech, so voice needs one action and one log entry.

## Proposed outcome

- The plugin is `nixarchy.meeting-mode`, installable from this repo's flake,
  with `nix flake check` running its three test suites.
- The settings switch reads **Pause voice control** (or similar): during a
  call `omarchy-voice` stops listening and speaking; after the call it starts
  listening again, only if it was listening before. If `omarchy-voice` is not
  installed or its daemon is not running, the action is skipped cleanly.
- Jarvis support is removed.
- README describes nixarchy install, ids and commands, and keeps credit to
  Jim Burchel as the original author (MIT).

## Affected users and systems

- This repo only: `bin/meeting-mode-actions`, `SettingsModel.js`,
  `Settings.qml`, `BarWidget.qml`, `Service.qml` (id fallback), `manifest.json`,
  `README.md`, tests, new `flake.nix`.
- Users of the upstream id: settings under `io.github.jburchel.meeting-mode`
  in `~/.config/omarchy/shell.json` are not carried over (new id).
- Not nixarchy-voice: it is called only through its existing CLI.

## Constraints

- Must keep the undo-only-what-changed guarantee and the "never /tmp" rule.
- Must not open the mic or touch audio; must not count `omarchy-voice`'s own
  mic stream as a call.
- Must keep upstream's MIT licence and author credit.
- Plugin folder must contain no symlinks (`omarchy-plugin-validate` refuses them).

## Open questions

1. **"nixi voice control" = `omarchy-voice` (nixarchy-voice)?** Nixi itself has
   no voice input (its README sends dictation to Omarchy's). I assume you mean
   nixarchy-voice. Correct?
2. **Plugin id `nixarchy.meeting-mode`**, matching `nixarchy.pixelbuds` and
   `nixarchy.herdr`. OK?
3. **Scope of nixarchy integration:** this repo's flake only, or also a
   `programs.nixarchy.defaultPlugins.meeting-mode` entry in the nixarchy repo?
   I propose this repo only; the nixarchy change is a separate task.
4. **Fix the `awake` undo finding**, or leave upstream behaviour? I propose
   leave it (out of scope).
