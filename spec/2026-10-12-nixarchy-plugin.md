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

## Amendment (requested at spec approval, 2026-10-12): NixOS install and CI

Sections 1–6 above are approved as written. Sections 7–9 are new and need approval.

### 7. NixOS module (`flake.nix` → `nixosModules.default`, new `module.nix`)

nixarchy already installs third-party plugins declaratively through
`programs.nixarchy.plugins.<name>.src` (`nixarchy/modules/home.nix:677`): it
validates the manifest at build time and links the folder into
`~/.config/omarchy/plugins/<id>`. The module reuses that rather than writing
its own linking, following the `programs.nixarchy.flatsnap` namespace precedent:

```nix
{ config, lib, pkgs, ... }:
let cfg = config.programs.nixarchy.meetingMode; in {
  options.programs.nixarchy.meetingMode = {
    enable = lib.mkEnableOption "Meeting Mode: a quiet desktop during calls";
    package = lib.mkOption { type = lib.types.package; default = <this flake's package for pkgs.system>; };
  };
  config = lib.mkIf cfg.enable {
    programs.nixarchy.plugins.meeting-mode.src = cfg.package;
  };
}
```

Usage in a nixarchy configuration:

```nix
inputs.meeting-mode.url = "github:olafkfreund/nixarchy-meeting-mode";
# modules = [ … inputs.meeting-mode.nixosModules.default ];
programs.nixarchy.meetingMode.enable = true;
```

Installed, not enabled. As with every nixarchy-declared plugin, you turn it on once
in Setup → Plugins or with `omarchy plugin enable nixarchy.meeting-mode`.
nixarchy records that choice in `shell.json`. The README documents both
install routes (module, `omarchy plugin add`).

Not done: a Home Manager module. `programs.nixarchy.plugins` is the one path
nixarchy validates, and non-nixarchy systems have no Omarchy shell to load it.

### 8. Lint as flake checks

Added to `checks.<system>`, so CI and `nix flake check` run the same thing:
- `shellcheck`: `bin/meeting-mode-actions`, `tests/actions.test.sh`. Today's one
  finding (SC2174 on `mkdir -p -m 700`) is deliberate: the next line's
  `chmod 700` covers it. It gets a `# shellcheck disable=SC2174` comment with that reason.
- `nixfmt`: `nixfmt --check` over `*.nix`; `formatter` output set to `nixfmt`.
- `module`: evaluates `nixosModules.default` against a stub that declares
  `programs.nixarchy.plugins`, and asserts that `enable = true` sets `src` to the package.

Not linted: QML. `qmllint` has no Quickshell type info and flags every
import. The existing `qml-text.test.js` stays the QML guard.

### 9. GitHub workflow `.github/workflows/check.yml`

Modelled on `nixarchy-flatsnap/.github/workflows/check.yml`: on `pull_request`
and push to `main`, `contents: read`, concurrency-cancelled, actions pinned by
SHA (same pins as flatsnap). Two jobs, so a lint failure and a test failure
show separately:
- `lint`: `nix build -L .#checks.x86_64-linux.{shellcheck,nixfmt}`
- `test`: `nix flake check -L` (all checks, including tests, package and module eval)

No KVM step: there is no VM test.

## Amendment 2 (review findings; decided by the user, 2026-10-12)

The Opus review of the implementation found two defects in approved
decisions. The user chose the fix for each (AskUserQuestion, this session);
this section records those choices.

### 1 (replaces the `listen stop` design): stop the voice service

`omarchy-voice listen stop` only closes an open conversation. With a wake word
set, the daemon's `_listen_loop` (`local_engine.py:907`) keeps running
`_wake_turn()` while `idle`, so the wake word goes on hearing the meeting.
**Decision:** if `systemctl --user is-active --quiet omarchy-voice.service`, stop
that unit and on success record `voice`; undo starts it again. This frees the
microphone completely: no wake word, no conversation, no speech. The cost is the
daemon's warm-up after the call. Not covered: a daemon started by hand with
`omarchy-voice run`. The settings hint and README say what it does.

### 7 (corrects the module): NixOS module via Home Manager sharedModules

`programs.nixarchy.plugins` is a Home Manager option (nixarchy
`modules/home.nix`), not a NixOS one, so the module as written fails to
evaluate on a real system. The check's stub hid this. **Decision:**
`nixosModules.default` keeps `programs.nixarchy.meetingMode.{enable,package}`
at the NixOS level, and sets
`home-manager.sharedModules = [ { programs.nixarchy.plugins.meeting-mode.src = cfg.package; } ]`.
nixarchy imports home-manager's NixOS module, so the option exists. Also exported:
`homeModules.default`, which installs the plugin for one user. The `module`
check now mirrors where each option really lives: a NixOS-level stub declares
`home-manager.sharedModules`, and a Home Manager-level stub declares
`programs.nixarchy.plugins`.

### LICENSE

The "Third-party components" section is a copy of Jarvis's notice (edge-tts,
openwakeword, ...) and does not describe this plugin. It is removed; the MIT
text stays.

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
