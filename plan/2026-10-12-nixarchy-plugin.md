---
status: approved
issue: none (issues are disabled on this repo)
spec: spec/2026-10-12-nixarchy-plugin.md
---

# Plan: Meeting Mode as a nixarchy plugin, pausing nixarchy voice instead of Jarvis

Branch `feat/nixarchy-plugin`. Repo root is the plugin folder (Omarchy shell
plugin: `manifest.json`, `Service.qml`, `BarWidget.qml`, `Settings.qml`,
`SettingsStore.qml`, `SettingsModel.js`, `assets/icon.svg`, helper
`bin/meeting-mode-actions`). Upstream is Jim Burchel's MIT
`io.github.jburchel.meeting-mode`; this plan does the nixarchy port.

## Approved decisions (from the spec)

1. Jarvis is removed. A `voice` action pauses nixarchy voice control
   (`omarchy-voice`, from nixarchy-voice) instead. On start: if
   `omarchy-voice` is on PATH and `omarchy-voice status --json | jq -r '.status // empty'`
   is **not** one of `""|idle|stopped|error|unconfigured`, run
   `omarchy-voice listen stop` and on success `record voice`. On end, the
   `voice` log entry runs `omarchy-voice listen start`. One log entry;
   `listen stop` closes the wake-word gate and drops queued speech.
2. Settings key `jarvis` → `voice` (default `true`). Settings row label
   "Pause voice control", hint "Stop nixarchy voice listening and talking
   during the call, if it is running". Bar tooltip label for `voice`:
   "voice control paused".
3. Plugin id `nixarchy.meeting-mode`, version `2.0.0`, author
   `Jim Burchel; nixarchy port by Olaf K. Freund`, homepage
   `https://github.com/olafkfreund/nixarchy-meeting-mode`. IPC target
   `meeting-mode` and the state file paths do not change.
4. `flake.nix`: `packages.default` copies the shipped files (no symlinks),
   with `jq` added to the helper's PATH; `nixosModules.default` sets
   `programs.nixarchy.plugins.meeting-mode.src` behind
   `programs.nixarchy.meetingMode.enable`; `formatter` = nixfmt; checks
   `default` (tests + package), `shellcheck`, `nixfmt`, `module`.
5. `tests/actions.test.sh` made portable: a private `$tmp/sys` of symlinked
   tools instead of `/usr/bin:/bin`; helper invoked via `"$BASH"`;
   stand-in shebangs rewritten to `#!$BASH`.
6. `.github/workflows/check.yml`: jobs `lint` and `test`.
7. README rewritten for nixarchy, with credit to Jim Burchel (MIT).
   Screenshots are not regenerated (they still show "Pause Jarvis").
8. Out of scope: the Stay Awake undo behaviour, a Home Manager module, QML
   lint, settings migration from the old id, a nixarchy-repo change.

## Repo traps (apply to every step)

- **Flakes see only git-tracked files.** `git add` new files (`flake.nix`,
  `module.nix`, workflow) before any `nix build`/`nix flake check`, or they
  are "missing".
- **The nix build sandbox has no `/usr/bin/env` and no `/usr/bin`.** Anything run
  in a check must be started via an explicit interpreter (`"$BASH" script`,
  `node file`).
- **`omarchy-plugin-validate` refuses symlinks inside a plugin folder.**
  The package uses `cp`, never `symlinkJoin`/`ln`.
- **The actions test must never reach a real `omarchy`, `omarchy-shell`,
  `hyprctl` or `omarchy-voice`.** Running it with a real one on PATH changes
  the live desktop. That is why PATH is restricted.
- **Keep the helper best-effort.** No `set -e`; each action is guarded by
  `&& record`. Only an action that succeeded is recorded.
- Match surrounding style: two-space bash, the existing one-line `#` comment
  density, JS ES5 in `SettingsModel.js` (it is a QML `.pragma library`:
  no `let`, `const` or arrow functions there).

## Steps

1. **`bin/meeting-mode-actions`: voice replaces Jarvis.**
   - L8 header: `Actions: dnd, awake, nightlight, voice.`
   - L18 comment: `... | nightlight <temp> | voice`
   - Above L26 (`mkdir -p -m 700`): `# shellcheck disable=SC2174  # -m on the leaf only is intended; the chmod below covers it`
   - Replace L56-66 (the Jarvis block) with:
     ```bash
     # nixarchy voice control (omarchy-voice), when its daemon is listening:
     # close the wake-word gate and drop queued speech for the call.
     if [[ $actions == *,voice,* ]] && have omarchy-voice; then
       case "$(omarchy-voice status --json 2>/dev/null | jq -r '.status // empty' 2>/dev/null)" in
         ""|idle|stopped|error|unconfigured) ;;
         *) omarchy-voice listen stop >/dev/null 2>&1 && record voice ;;
       esac
     fi
     ```
   - L80-81 → one line: `voice)         omarchy-voice listen start >/dev/null 2>&1 ;;`
   - L97 usage: `<dnd,awake,nightlight,voice>`
   → verify: `grep -n -i jarvis bin/meeting-mode-actions` prints nothing;
   `nix shell nixpkgs#shellcheck -c shellcheck bin/meeting-mode-actions` exits 0.
   Traps: `set -u` stays exactly once in the file (step 5 substitutes on it).

2. **Settings and labels.**
   - `SettingsModel.js` L11: `voice: true,            // pause nixarchy voice control, if it is running`;
     L46: `voice: e.voice !== false,`; L56 comment `"dnd,awake,nightlight,voice"`;
     L59 array `"voice"`; L66 comment: `// matches callApps. Voice wake words (omarchy-voice records with pw-record) and Voxtype never match.`
   - `Settings.qml` L34: `{ key: "voice", label: "Pause voice control", hint: "Stop nixarchy voice listening and talking during the call, if it is running", toggle: true },`
   - `BarWidget.qml` L26-27 → `voice: "voice control paused"` (remove the trailing
     comma issue: it becomes the last entry, no trailing comma).
   - `tests/model.test.js` L24, L27, L40, L41: `jarvis` → `voice`.
   → verify: `node tests/model.test.js` → `model: 9 tests passed`;
   `node tests/qml-text.test.js` → `ok`.
   Traps: ES5 only in `SettingsModel.js`.

3. **Plugin id and manifest.**
   - `manifest.json`: `"id": "nixarchy.meeting-mode"`, `"version": "2.0.0"`,
     `"author": "Jim Burchel; nixarchy port by Olaf K. Freund"`, add
     `"homepage": "https://github.com/olafkfreund/nixarchy-meeting-mode"` after
     `license`; in `description` replace `voice assistants muted` with
     `voice control paused`.
   - `Service.qml` L23, `Settings.qml` L18 fallback id, `BarWidget.qml` L17
     `moduleName`, `SettingsModel.js` L4 comment → `nixarchy.meeting-mode`.
   → verify: `grep -rn jburchel --include='*.qml' --include='*.js' --include='*.json' .`
   prints nothing; `jq . manifest.json` parses.

4. **`tests/actions.test.sh`: portable, and voice instead of Jarvis.**
   - L4 comment: `hyprctl and omarchy-voice commands`.
   - L10: drop `"$HOME/.config/jarvis"` from the `mkdir`.
   - L35-41: replace the `jarvis` stand-in with:
     ```bash
     cat >"$tmp/bin/omarchy-voice" <<'S'
     #!/usr/bin/env bash
     case "$*" in
       "status --json") echo "{\"status\":\"$(cat "$FAKE/voice" 2>/dev/null || echo listening)\"}" ;;
       "listen stop") echo idle >"$FAKE/voice" ;; "listen start") echo listening >"$FAKE/voice" ;;
     esac
     S
     ```
   - After `chmod +x "$tmp/bin/"*`, before PATH is replaced: rewrite stand-in
     shebangs, `sed -i "1s|.*|#!$BASH|" "$tmp/bin/"*`, and build the tool dir:
     ```bash
     # Only the stand-ins and the few real tools they and the helper need:
     # never a real omarchy/omarchy-voice, which would change the live desktop.
     mkdir "$tmp/sys"
     for t in bash jq cat cut mkdir chmod touch rm stat; do
       ln -s "$(command -v "$t")" "$tmp/sys/$t" || { echo "missing tool: $t"; exit 1; }
     done
     export PATH="$tmp/bin:$tmp/sys"
     ```
     replacing L44-45 (old comment + `export PATH=...:/usr/bin:/bin`).
   - L47 guard loop: `for c in omarchy-voice omarchy omarchy-shell hyprctl; ...`
   - `A` (L48): keep the path; define `run() { "$BASH" "$A" "$@"; }` and replace
     every `"$A"` invocation with `run`.
   - `state()` L49: replace `muted=... listen=...` with
     `voice=$(cat "$FAKE/voice" 2>/dev/null || echo listening)`.
   - Case 1: `run on dnd,awake,nightlight,voice`; expected status
     `{"active":true,"changed":["dnd","awake","nightlight","voice"]}`; desktop
     `dnd=on awake=y temp=6500 voice=idle`.
   - Case 2 (pre-set): replace `touch "$HOME/.config/jarvis/muted"` with
     `echo idle >"$FAKE/voice"`; expected `{"active":true,"changed":[]}`
     (voice not listening is not recorded, and stays idle after `off`).
   - Case 3 L69: replace the jarvis `muted` file removal with `rm -f "$FAKE/voice"`;
     expected desktop `dnd=on awake=n temp=6500 voice=listening`.
   - Case 4 expected after off: `dnd=off awake=n temp=6500 voice=listening`.
   - Case 5: `# 5. Without nixarchy voice installed, the voice action is skipped cleanly.`
     `rm "$tmp/bin/omarchy-voice"`; `check "no voice" "$(run on voice,dnd)" '{"active":true,"changed":["dnd"]}'`.
   → verify: `bash tests/actions.test.sh` → `actions: 13 passed, 0 failed`
   on this NixOS machine (it fails 9/13 today); `shellcheck tests/actions.test.sh` exits 0.
   Traps: every external command the helper and the stand-ins run after
   PATH is replaced must be in the `for t in` list; if a check fails with
   "command not found", add the tool to the list rather than widening PATH.

5. **`flake.nix` and `module.nix` (new).** Model on
   `../nixarchy-pixelbuds/flake.nix` (package) and `../nixarchy-flatsnap/flake.nix`
   (formatter, nixosModules). Inputs: `nixpkgs` = `github:NixOS/nixpkgs/nixos-unstable`.
   Systems `x86_64-linux`, `aarch64-linux`.
   - `packages.<s>.default` (= `nixarchy-meeting-mode`): `pkgs.runCommand
     "nixarchy-meeting-mode-${manifest.version}"` with `meta` (MIT, linux,
     homepage), body: `mkdir -p $out/bin $out/assets`, `cp` each of
     `manifest.json BarWidget.qml Service.qml Settings.qml SettingsStore.qml
     SettingsModel.js LICENSE preview.png` and `assets/icon.svg`,
     `install -m755 ${./bin/meeting-mode-actions} $out/bin/meeting-mode-actions`,
     `chmod -R u+w $out`, then
     `substituteInPlace $out/bin/meeting-mode-actions --replace-fail 'set -u' $'set -u\nPATH="${pkgs.jq}/bin:$PATH"  # jq is not guaranteed on PATH'`.
   - `module.nix`: a function `self: { config, lib, pkgs, ... }:` declaring
     `options.programs.nixarchy.meetingMode.enable = lib.mkEnableOption "Meeting Mode, a quiet desktop during calls"`
     and `package` (`lib.types.package`, default
     `self.packages.${pkgs.stdenv.hostPlatform.system}.default`,
     `defaultText = lib.literalExpression "inputs.meeting-mode.packages.\${system}.default"`);
     `config = lib.mkIf cfg.enable { programs.nixarchy.plugins.meeting-mode.src = cfg.package; }`.
     One header comment: why it reuses `programs.nixarchy.plugins` (nixarchy
     validates the manifest and links it in; installed, not enabled).
   - `nixosModules.default = import ./module.nix self;`
   - `formatter.<s> = pkgs.nixfmt;`
   - `checks.<s>`:
     - `default`: `runCommand` with `nativeBuildInputs = [ pkgs.nodejs pkgs.jq pkgs.coreutils ]`;
       `cp -r ${./.} src; chmod -R u+w src; cd src`; `node tests/model.test.js`;
       `node tests/qml-text.test.js`; `bash tests/actions.test.sh` (bash from stdenv);
       package asserts against `${plugin}`: `jq -e '.id == "nixarchy.meeting-mode"'`,
       guard `jq -e '.entryPoints | length > 0'`, every `entryPoints[]` file exists,
       `test -z "$(find ${plugin}/ -mindepth 1 -type l)"`,
       `test -x ${plugin}/bin/meeting-mode-actions`,
       `grep -q '${pkgs.jq}/bin' ${plugin}/bin/meeting-mode-actions`; `touch $out`.
     - `shellcheck`: `shellcheck ${./bin/meeting-mode-actions} ${./tests/actions.test.sh}`.
     - `nixfmt`: `nixfmt --check ${./flake.nix} ${./module.nix}`.
     - `module`: `lib.evalModules` over `[ self.nixosModules.default stub ]`, where
       `stub` declares `options.programs.nixarchy.plugins` as
       `attrsOf (submodule { options.src = mkOption { type = types.path; }; })`,
       sets `_module.args.pkgs = pkgs` and `programs.nixarchy.meetingMode.enable = true`;
       `assert` that `"${config.programs.nixarchy.plugins.meeting-mode.src}" == "${plugin}"`,
       then a trivial `runCommand`. Also evaluate with `enable = false` and assert
       `plugins == { }`.
   → verify: `git add flake.nix module.nix && nix flake check -L` passes and
   creates `flake.lock` (commit it); `nix build && find result/ -type l` prints nothing;
   `grep jq result/bin/meeting-mode-actions` shows the store path;
   `nix fmt` leaves the tree unchanged.
   Traps: `git add` before nix; `${./.}` copies the whole tracked tree
   including `intent/` etc. (fine for the check, but not in the package); the
   actions test in the sandbox needs `bash jq cat cut mkdir chmod touch rm stat`,
   all from stdenv/coreutils/jq.

6. **`.github/workflows/check.yml` (new).** Copy the shape of
   `../nixarchy-flatsnap/.github/workflows/check.yml` without the KVM step:
   `on: pull_request` + push to `main`; `permissions: contents: read`;
   `concurrency: { group: check-${{ github.ref }}, cancel-in-progress: true }`;
   pins `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`,
   `cachix/install-nix-action@13d8dd58da0234aa297dedd986986ccb8e7f3e24 # v31.11.1`.
   Jobs: `lint` runs `nix build -L .#checks.x86_64-linux.shellcheck .#checks.x86_64-linux.nixfmt`;
   `test` runs `nix flake check -L`. `timeout-minutes: 20` each.
   → verify: `nix run nixpkgs#actionlint -- .github/workflows/check.yml` exits 0.

7. **`README.md` rewrite for nixarchy.** Keep upstream's structure and voice
   (it is good). Changes:
   - Title `# Meeting Mode for nixarchy`.
   - Table row 18: `| **Voice control** (nixarchy voice) | Stops listening and talking | Listening again, if it was before |`.
   - Install section: two routes. (a) NixOS module: flake input
     `github:olafkfreund/nixarchy-meeting-mode`, import
     `inputs.meeting-mode.nixosModules.default`, `programs.nixarchy.meetingMode.enable = true;`,
     rebuild, then enable once in Setup → Plugins or with
     `omarchy plugin enable nixarchy.meeting-mode --section center`.
     (b) `omarchy plugin add https://github.com/olafkfreund/nixarchy-meeting-mode.git`
     (needs `jq` on PATH; the module route builds it in).
   - Every `io.github.jburchel.meeting-mode` → `nixarchy.meeting-mode`
     (L40, L86, L122, L130); L116 "the Jarvis wake word" → "nixarchy voice's wake word".
   - Update section: module route = `nix flake update meeting-mode` + rebuild.
   - One line noting that settings saved under the upstream id are not carried over.
   - Tests section: add `nix flake check` and say CI runs it.
   - Replace "More Omarchy plugins by Jim Burchel" (L143-153 incl. the ⭐ line) with
     `## Credit`: Meeting Mode was written by Jim Burchel
     ([jburchel/omarchy-meeting-mode](https://github.com/jburchel/omarchy-meeting-mode), MIT);
     this fork packages it for nixarchy and swaps Jarvis for nixarchy voice control.
   - Under the screenshots: a one-line note that they still show the old "Pause Jarvis" label.
   → verify: `grep -n -i jarvis README.md` matches only the credit line and the
   screenshot note; `grep -n 'io.github.jburchel' README.md` prints nothing.

## Tests

| Command | Expected |
|---|---|
| `node tests/model.test.js` | `model: 9 tests passed` |
| `node tests/qml-text.test.js` | `ok (...)` |
| `bash tests/actions.test.sh` | `actions: 13 passed, 0 failed` |
| `nix flake check -L` | all checks pass (default, shellcheck, nixfmt, module) |
| `nix build && find result/ -type l` | no output |
| `grep -rn -i jarvis --exclude-dir={intent,spec,plan,.git} .` | only README credit and screenshot note |

Manual, on the desktop (after merge, by the user): enable the plugin;
`omarchy-voice listen start`; `pw-record -P '{ application.name = "Google Chrome" }' /dev/null`
for >3 s → `omarchy-voice status` shows `idle`, tooltip says "voice control
paused"; Ctrl+C, wait 15 s → status is `listening`.

## Rollback

Everything is on `feat/nixarchy-plugin`; drop the branch or revert the PR.
Nothing outside this repo changes. A user who enabled it runs
`omarchy-shell meeting-mode off` (puts back any active meeting changes),
then sets `programs.nixarchy.meetingMode.enable = false` or runs
`omarchy plugin remove nixarchy.meeting-mode`.

## Execution

Seven file-editing steps → handed to the `coder` agent per policy (one
agent, step by step), reviewed by a fresh Opus agent against this plan and
`git diff`.
