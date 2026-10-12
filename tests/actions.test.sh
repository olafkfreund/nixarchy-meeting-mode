#!/usr/bin/env bash
# Run: bash tests/actions.test.sh
# Drives bin/meeting-mode-actions against stand-in omarchy, omarchy-shell,
# hyprctl and systemctl commands in a temporary HOME, so nothing on the real
# desktop changes. Checks that "off" undoes exactly what "on" changed.
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" XDG_STATE_HOME="$tmp/state" FAKE="$tmp/fake"
mkdir -p "$HOME/.local/state/omarchy/indicators" "$FAKE" "$tmp/bin"
pass=0 fail=0
check() { if [[ "$2" == "$3" ]]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $1: expected '$3', got '$2'"; fi; }

# Stand-ins keep their state as files in $FAKE.
cat >"$tmp/bin/omarchy-shell" <<'S'
#!/usr/bin/env bash
[[ "$1 $2" == "notifications dndState" ]] && { cat "$FAKE/dnd" 2>/dev/null || echo off; }
exit 0
S
cat >"$tmp/bin/omarchy" <<'S'
#!/usr/bin/env bash
case "$*" in
  "toggle notification silencing") [[ "$(cat "$FAKE/dnd" 2>/dev/null)" == on ]] && echo off >"$FAKE/dnd" || echo on >"$FAKE/dnd" ;;
  "toggle idle stay-awake") touch "$HOME/.local/state/omarchy/indicators/stay-awake" ;;
  "toggle idle allow-idle") rm -f "$HOME/.local/state/omarchy/indicators/stay-awake" ;;
  "toggle nightlight --status") t=$(cat "$FAKE/temp" 2>/dev/null || echo 6500)
     [[ $t -lt 6000 ]] && e=true || e=false; echo "{\"enabled\":$e,\"temperature\":$t}" ;;
esac
S
cat >"$tmp/bin/hyprctl" <<'S'
#!/usr/bin/env bash
[[ "$1 $2" == "hyprsunset temperature" && -n "${3:-}" ]] && echo "$3" >"$FAKE/temp"
exit 0
S
cat >"$tmp/bin/systemctl" <<'S'
#!/usr/bin/env bash
case "$*" in
  "--user is-active --quiet omarchy-voice.service") [[ "$(cat "$FAKE/voice" 2>/dev/null || echo active)" == active ]] ;;
  "--user stop omarchy-voice.service") echo inactive >"$FAKE/voice" ;;
  "--user start omarchy-voice.service") echo active >"$FAKE/voice" ;;
  *) exit 1 ;;
esac
S
chmod +x "$tmp/bin/"*
sed -i "1s|.*|#!$BASH|" "$tmp/bin/"*
# Only the stand-ins and the few real tools they and the helper need:
# never a real omarchy/systemctl, which would change the live desktop.
mkdir "$tmp/sys"
for t in bash jq cat cut mkdir chmod touch rm stat; do
  ln -s "$(command -v "$t")" "$tmp/sys/$t" || { echo "missing tool: $t"; exit 1; }
done
export PATH="$tmp/bin:$tmp/sys"
for c in systemctl omarchy omarchy-shell hyprctl; do [[ "$(command -v $c)" == "$tmp/bin/$c" ]] || { echo "refusing to run: $c is not the stand-in"; exit 1; }; done
A="$here/bin/meeting-mode-actions"
run() { "$BASH" "$A" "$@"; }
state() { echo "dnd=$(cat "$FAKE/dnd" 2>/dev/null || echo off) awake=$([[ -f $HOME/.local/state/omarchy/indicators/stay-awake ]] && echo y || echo n) temp=$(cat "$FAKE/temp" 2>/dev/null || echo 6500) voice=$(cat "$FAKE/voice" 2>/dev/null || echo active)"; }

# 1. Everything off before the call: all of it changes, all of it comes back.
echo 4000 >"$FAKE/temp"
before=$(state)
out=$(run on dnd,awake,nightlight,voice)
check "on: status" "$out" '{"active":true,"changed":["dnd","awake","nightlight","voice"]}'
check "on: desktop" "$(state)" "dnd=on awake=y temp=6500 voice=inactive"
check "on twice is a no-op" "$(run on dnd,awake,nightlight,voice)" "$out"
check "off: status" "$(run off)" '{"active":false,"changed":[]}'
check "off: restored" "$(state)" "$before"

# 2. Already the way a meeting wants it: nothing recorded, nothing undone.
echo on >"$FAKE/dnd"; touch "$HOME/.local/state/omarchy/indicators/stay-awake"; echo 6500 >"$FAKE/temp"; echo inactive >"$FAKE/voice"
before=$(state)
check "pre-set: nothing changed" "$(run on dnd,awake,nightlight,voice)" '{"active":true,"changed":[]}'
run off >/dev/null
check "pre-set: left as the user had it" "$(state)" "$before"

# 3. Only the switched-on actions run.
rm -f "$FAKE/dnd" "$HOME/.local/state/omarchy/indicators/stay-awake" "$FAKE/voice"
check "subset" "$(run on dnd)" '{"active":true,"changed":["dnd"]}'
check "subset: awake untouched" "$(state)" "dnd=on awake=n temp=6500 voice=active"
run off >/dev/null

# 4. The record survives a restart: a new process can still undo it.
run on dnd,awake >/dev/null
check "status after restart" "$(run status)" '{"active":true,"changed":["dnd","awake"]}'
run off >/dev/null
check "undone after restart" "$(state)" "dnd=off awake=n temp=6500 voice=active"

# 5. Without nixarchy voice installed, the voice action is skipped cleanly.
rm "$tmp/bin/systemctl"
check "no voice" "$(run on voice,dnd)" '{"active":true,"changed":["dnd"]}'
run off >/dev/null

# 6. The state directory is private, even if it already existed with looser permissions.
chmod 755 "$XDG_STATE_HOME/meeting-mode"
run status >/dev/null
check "state dir is 0700" "$(stat -c %a "$XDG_STATE_HOME/meeting-mode")" "700"

echo "actions: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
