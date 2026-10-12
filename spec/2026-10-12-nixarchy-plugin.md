---
status: approved
issue: none (issues are disabled on this repo)
intent: intent/2026-10-12-nixarchy-plugin.md
---

# Spec: Meeting Mode as a nixarchy plugin, pausing nixarchy voice instead of Jarvis

## Design

### 1. Voice action replaces Jarvis (`bin/meeting-mode-actions`)

The `jarvis` action becomes `voice`. One undo-log entry, `voice`:

```bash
# nixarchy voice control (omarchy-voice), when its daemon is running: close the
# wake-word gate and drop queued speech for the call; reopen it afterwards.
if [[ $actions == *,voice,* ]] && have omarchy-voice; then
  case "$(omarchy-voice status --json 2>/dev/null | jq -r '.status // empty')" in
    ""|idle|stopped|error|unconfigured) ;;
    *) omarchy-voice listen stop >/dev/null 2>&1 && record voice ;;
  esac
fi
```

and in `turn_off`: `voice) omarchy-voice listen start >/dev/null 2>&1 ;;`.

Why this shape, from nixarchy-voice's source (`src/omarchy_voice/local_engine.py`):
- `listen stop` → `_set_active(False)`: closes the wake-word gate **and** drops
  queued speech. One call replaces Jarvis' `hush` + `mute` + `listen stop`.
- The gate is closed (`idle`) by default, and `stopped` means no daemon, so
  only an open gate is recorded: if you were not listening before the call,
  hanging up does not start listening.
- A deny-list (`idle|stopped|error|unconfigured`) rather than an allow-list,
  so in-turn states (`listening`, `thinking`, `acting`, `confirm`) and any
  state added later all count as "listening".
- `listen stop` fails when no daemon answers; `&& record` keeps the log honest.

Usage line, header comment and `changed` comment updated to name `voice`.

### 2. Settings and labels

- `SettingsModel.js`: key `jarvis` → `voice` in `DEFAULTS`, `normalize`,
  `actionList` and the comments. Default stays `true`. The `isCallStream`
  comment names omarchy-voice: it records with `pw-record`, which already
  never matches (existing test covers `pw-record`).
- `Settings.qml:34`: `{ key: "voice", label: "Pause voice control", hint: "Stop nixarchy voice listening and talking during the call, if it is running" }`.
- `BarWidget.qml:26-27`: the two Jarvis labels become `voice: "voice control paused"`.

### 3. Plugin id `nixarchy.meeting-mode`

`manifest.json`: `id` → `nixarchy.meeting-mode`, `version` → `2.0.0` (new
id, settings key renamed), `author` → `Jim Burchel; nixarchy port by Olaf K. Freund`,
add `homepage`, description "voice control paused" in place of "voice
assistants muted". Fallback ids in `Service.qml:23`, `Settings.qml:18`,
`BarWidget.qml:17` (`moduleName`) and the `SettingsModel.js:4` comment follow.
IPC target `meeting-mode` and the state paths stay unchanged.

### 4. `flake.nix` (new), modelled on `nixarchy-pixelbuds/flake.nix`

- `packages.<system>.default`: `runCommand` that **copies** (no symlinks) the
  shipped files: `manifest.json`, the five QML/JS files, `assets/icon.svg`,
  `bin/meeting-mode-actions`, `LICENSE`, `preview.png`. The helper gets
  `jq` on its `PATH` via `substituteInPlace --replace-fail 'set -u'` adding
  `PATH=${jq}/bin:$PATH` after it, so a missing `jq` cannot silently turn
  every action into a no-op.
- `checks.<system>.default`: runs the three test suites against the source,
  then asserts the package: manifest id, every `entryPoints` file present,
  no symlinks, helper executable.
- Systems: `x86_64-linux`, `aarch64-linux`. Input: `nixpkgs` unstable.

### 5. `tests/actions.test.sh` portable (fixes a bug found while specifying)

The suite exports `PATH="$tmp/bin:/usr/bin:/bin"`; on NixOS (and in the nix
sandbox) that has no `bash` or `jq`, and 9 of 13 checks fail today. Change:
- Build `$tmp/sys` with symlinks to exactly the tools the helper and stand-ins
  need (`bash jq cat cut mkdir chmod touch rm`), resolved from the caller's
  `PATH` before it is replaced; `PATH="$tmp/bin:$tmp/sys"`. Same safety
  guarantee as today (nothing real is reachable), now on any distro.
- Invoke the helper as `"$BASH" "$A"` and rewrite stand-in shebangs to
  `#!$BASH`, because the nix sandbox has no `/usr/bin/env`.
- Jarvis stand-in → `omarchy-voice` stand-in (`status --json`, `listen start|stop`,
  state in `$FAKE/voice`). Cases: listening → recorded and restored;
  `idle` → not recorded, stays idle after off; not installed → skipped.

`tests/model.test.js`: `jarvis` → `voice` in the four assertions.

### 6. README

Rewritten around nixarchy: what pauses ("nixarchy voice control"), install via
`omarchy plugin add https://github.com/olafkfreund/nixarchy-meeting-mode.git`
or the flake package, the new id in enable/update/remove commands, the
`shell.json` example, a `nix flake check` line under Tests, and a credit
section naming Jim Burchel as the original author (MIT) with a link to
upstream. The "More Omarchy plugins by Jim Burchel" promo section is replaced by that credit.
`docs/settings.png` and `preview.png` still show "Pause Jarvis"; noted as stale,
not regenerated here (needs a live desktop).

## Alternatives rejected

- **Keep Jarvis alongside voice.** Not shipped on nixarchy; you asked to replace it.
- **Mute voice's TTS separately.** `listen stop` already drops queued speech;
  a second mechanism would add a second undo entry for no behaviour.
- **Read `~/.local/state/.../state.json` directly** instead of `status --json`.
  Couples to voice's private file layout; the CLI also checks the daemon is alive.
- **Migrate settings from the old id.** One-off for a renamed plugin; the
  defaults are already what most users want.
- **`writeShellApplication` for the helper.** Its strict mode (`set -e`,
  shellcheck) changes the script's deliberate best-effort behaviour.

## Risks

- `omarchy-voice status --json` field or state names change upstream → voice
  is either always skipped or always recorded. Mitigated by the deny-list and by
  only acting on a running daemon. Both repos are yours.
- Voice was listening and you stop it by hand mid-call → after the call it is
  started again. Same as upstream's Jarvis behaviour; acceptable.
- Upstream users of `io.github.jburchel.meeting-mode` lose their settings on
  switching. Stated in README.
- Screenshots show the old label until regenerated.

## Verification

- `nix flake check` passes (runs all three suites + package assertions).
- `node tests/model.test.js`, `node tests/qml-text.test.js`,
  `bash tests/actions.test.sh` pass outside nix on this NixOS machine.
- `nix build` → result has no symlinks, `bin/meeting-mode-actions` contains a
  `/nix/store/...-jq-.../bin` PATH line.
- `grep -ri jarvis` over shipped files returns nothing (README credit aside).
- Runtime (manual, on your desktop): enable the plugin, start
  `omarchy-voice listen start`, run `pw-record -P '{ application.name = "Google Chrome" }' /dev/null`
  for >3 s → `omarchy-voice status` shows `idle`, bar tooltip says
  "voice control paused"; Ctrl+C, wait 15 s → status `listening` again.
