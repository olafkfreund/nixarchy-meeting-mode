# Meeting Mode for nixarchy

**Join a call and your desktop goes quiet by itself. Hang up and everything comes back.**

No button to remember. No calendar to connect. Meeting Mode notices when a call app starts
using your microphone (Google Meet, Zoom, Teams, Slack, Discord and more, in the browser or
as an app) and gets your desktop out of the way until the call is over.

![Meeting Mode: the bar indicator lights up during a call, with the settings panel](preview.png)

The screenshots still show the old "Pause Jarvis" label.

## What happens when a call starts

| | During the call | After you hang up |
|---|---|---|
| **Do Not Disturb** | Notification pop-ups stay silent | Back on, if they were on before |
| **Stay awake** | No idle lock or screen blank while you listen | Normal idle behaviour returns |
| **Night light** | Off, so your camera picture isn't tinted orange | Back to the exact temperature it had |
| **Voice control** (nixarchy voice) | Stopped, wake word included | Started again, if it was running |
| **Music and videos** *(optional)* | Paused | Resumed where they left off |

The voice service takes its usual warm-up after the call, and a daemon started by hand with
`omarchy-voice run` is not paused.

Meeting Mode only undoes what it changed. If Do Not Disturb or Stay Awake was already on
before the call, it stays on afterwards. It keeps a record of its changes on disk, so even a
shell restart in the middle of a call can't leave your desktop stuck in meeting mode.

A bar indicator shows a dim camera while it waits and lights up in your theme's alert
colour during a call. Hover it to see which app started the meeting, how long the call has
been going and what was changed.

## Install

Review the source first. Like every Omarchy plugin, it runs unsandboxed inside
`omarchy-shell`.

**NixOS module** (nixarchy). Add the flake input, import the module and switch it on:

```nix
# flake.nix
inputs.meeting-mode.url = "github:olafkfreund/nixarchy-meeting-mode";

# a NixOS module
imports = [ inputs.meeting-mode.nixosModules.default ];
programs.nixarchy.meetingMode.enable = true;
```

The NixOS module adds the plugin for every Home Manager user, so each one needs nixarchy's
Home Manager module: the installer's `home-manager.sharedModules` already includes it. If you
import nixarchy per user instead, use the Home Manager route for those users.

Home Manager users without the NixOS module: `imports = [ inputs.meeting-mode.homeModules.default ];`

Rebuild, then enable it once in Setup → Plugins, or with
`omarchy plugin enable nixarchy.meeting-mode --section center`.

**Without the module:**

```bash
omarchy plugin add https://github.com/olafkfreund/nixarchy-meeting-mode.git
omarchy restart shell
```

This route needs `jq` on PATH; the module route builds it in. Accept the prompt to enable
it and pick a bar section for the indicator (**center** is preselected). Move it later with
`omarchy plugin enable nixarchy.meeting-mode --section right`. The background service starts
with the shell, so meeting mode works even without the indicator on the bar.

Settings saved under the upstream plugin id (`io.github.jburchel.meeting-mode`) are not carried over.

To try it without a real call, play a few seconds of "microphone in use" from a terminal:

```bash
pw-record -P '{ application.name = "Google Chrome" }' /dev/null   # Ctrl+C to hang up
```

## Use it

It is automatic: start a call, and three seconds later meeting mode is on. Fifteen
seconds after the last call app lets go of the microphone, everything is put back. The
short wait on both ends rides out mic tests and brief reconnects.

| On the bar indicator | |
|---|---|
| Click | Turn meeting mode on or off now |
| Right-click | Settings |
| Middle-click | Back to automatic |

Turn it off by hand during a call and it stays off until that call ends. Turn it on by hand
with no call and it stays on until you turn it off.

From a terminal or a keybinding:

```bash
omarchy-shell meeting-mode toggle     # or: on | off | auto
omarchy-shell meeting-mode status     # JSON: active, call state and app, what changed
omarchy-shell meeting-mode settings   # open the settings panel
```

## Settings

Right-click the indicator, or run `omarchy-shell meeting-mode settings`. Every action has its
own switch, and you choose how long to wait after a call before putting things back
(5 s, 15 s, 30 s or 1 min). You can also edit which apps count as calls, which are browsers,
the meeting window titles that confirm a browser call, and how long a browser microphone may
stay a "maybe" before it counts as a call. Changes apply from the next meeting.

![Settings panel](docs/settings.png)

Settings are saved in this plugin's entry in `~/.config/omarchy/shell.json`. Two more can only
be set there:

```json
{
  "id": "nixarchy.meeting-mode",
  "onStart": "curl -s -X POST http://homeassistant.local:8123/api/webhook/on-air",
  "onEnd": "curl -s -X POST http://homeassistant.local:8123/api/webhook/off-air"
}
```

- **`onStart` / `onEnd`**: any shell command, run when a meeting starts and ends. Turn on an
  "on air" light, set your chat status, start a recording, light a Stream Deck key.

## Telling a call from microphone use

Meeting mode only starts for a real call, so a voice note or a dictation tool does not turn
on Do Not Disturb. What uses the microphone is sorted into three kinds:

- **Call apps** (`nativeApps`; Zoom, Teams, Discord, Vesktop, Slack, Signal, Webex, Cisco
  Collab Host, Element, Skype, Jitsi, Telegram): a call once the app has held the microphone for
  3 seconds.
- **Browsers** (`browsers`; Chrome and Chromium, Firefox, Brave, Vivaldi, Zen, LibreWolf,
  Edge): a **maybe** after 3 seconds, because a browser may record a voice message too. A maybe
  becomes a **call** when something confirms it, or after `maybeDelay` seconds (default 60,
  range 10 to 600).
- **Everything else** (OBS, Audacity, dictation tools, the nixarchy voice wake word): never a
  call.

A browser call is confirmed by any of: a window title that matches a pattern in
`meetingTitles` (one regular expression per line, case-sensitive; the defaults cover Google
Meet, Teams, Zoom, Jitsi, Huddle, Webex, Messenger and WhatsApp calls), a screen share
(a PipeWire `xdph-streaming-*` source), or the Firefox or Zen "Sharing Indicator" window.

Window titles are read in memory only. They are never written to a log or a notification; the
only place a matched title appears is the state file below, which only you can read.

If you had set `callApps` in an earlier version, it is split on the browser list into
`nativeApps` and `browsers` the first time the settings are read, unless you set those
yourself.

### State file for other plugins

The service writes `$XDG_RUNTIME_DIR/meeting-mode.json` (mode 0600) whenever `call`, `callApp`,
`callTitle` or `active` changes, and `omarchy-shell meeting-mode status` prints the same JSON:

```json
{"active": true, "reason": "Zoom", "since": 1788000000000,
 "call": "call", "callApp": "Zoom", "callTitle": "", "callSince": 1788000000000,
 "callDetected": true}
```

`call` is `none`, `maybe` or `call`; `callDetected` is `call === "call"`, kept for older readers.
Times are milliseconds since the epoch. Before starting Do Not Disturb the service also runs
`omarchy-shell meetingai offer`, which does nothing when the meetingai plugin is not installed.

## How it works

The service is a small QML component inside `omarchy-shell`. It uses the shell's built-in
PipeWire connection to see which apps have a microphone stream open, and its Hyprland
connection to read window titles, so there is no polling and no extra process (a one-second
timer runs only while a call app holds the microphone). It never opens the microphone itself and never touches audio: it only
reads which apps are recording.

The desktop changes are made by `bin/meeting-mode-actions`, a small shell script you can read
in a minute. It uses Omarchy's own commands (`omarchy toggle notification silencing`,
`omarchy toggle idle`, `hyprctl hyprsunset`) and records each change in
`~/.local/state/meeting-mode/` (created readable only by you) so it can undo exactly those.

The call status shown in the bar (whether you are in a call, with which app, since when) lives in
`$XDG_RUNTIME_DIR`, which only you can read; without one it stays in that private state
directory. It is never written to `/tmp`.

Each action checks first and changes only what needs changing. If Do Not Disturb is already
on, or voice control isn't running, that action does nothing and nothing is recorded. When the
call ends, only what is in the record is undone, so anything you set yourself stays as it was.

Voice control is paused by stopping its user service (`omarchy-voice.service`) and starting it
again after the call. Stopping the service frees the microphone completely, so its wake word
can't hear the meeting. Closing the conversation would leave the wake word listening.

Installed through the flake, the plugin is a plain copy of this folder with `jq` built into
the helper's PATH. The NixOS module hands it to nixarchy's own plugin option
(`programs.nixarchy.plugins`) through Home Manager's `sharedModules`. nixarchy checks the
manifest when you rebuild and links the plugin into `~/.config/omarchy/plugins/`.

## Limits

- **Voice started by hand:** a voice daemon you started with `omarchy-voice run`, rather than
  the service, is not paused.
- **Things you change during the call:** the record is made when meeting mode starts.
  - If you stop the voice service yourself during a call, it is started again afterwards.
  - If you turn Stay Awake on yourself during a call, it is turned off afterwards.
- **Home Manager switch during a call:** running one may start the voice service again before
  the call ends.
- **Voice start-up time:** after the call, voice control needs its usual start-up time before
  it answers again.

## Update

With the module: `nix flake update meeting-mode`, then rebuild. Without it:

```bash
omarchy plugin update nixarchy.meeting-mode
omarchy restart shell
```

## Remove

```bash
omarchy-shell meeting-mode off
omarchy plugin remove nixarchy.meeting-mode
```

Turning it off first puts back anything a current meeting changed.

## Tests

```bash
node tests/model.test.js        # which apps count as a call, settings defaults and limits
node tests/qml-text.test.js     # app names are always shown as plain text
bash tests/actions.test.sh      # on/off undoes exactly what changed (uses stand-in commands)
nix flake check                 # all of the above, plus shellcheck, nixfmt and the module
```

CI runs `nix flake check` on every pull request.

## Credit

Meeting Mode was written by Jim Burchel
([jburchel/omarchy-meeting-mode](https://github.com/jburchel/omarchy-meeting-mode), MIT).
This fork packages it for nixarchy and swaps Jarvis for nixarchy voice control.

## License

MIT. See [LICENSE](LICENSE).
