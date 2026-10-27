import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Services.Mpris
import Quickshell.Services.Pipewire
import "SettingsModel.js" as SettingsModel

// Meeting Mode service. Watches PipeWire for a call app capturing the
// microphone; after START_AFTER seconds it applies the meeting actions, and
// endDelay seconds after the last call stream goes away it undoes them.
//
// The desktop changes themselves live in bin/meeting-mode-actions, which
// records what it changed so only those are undone, even across a shell
// restart. State for the bar widget goes to $XDG_RUNTIME_DIR/meeting-mode.json, or,
// without a runtime dir, to the plugin's private (0700) state directory; never /tmp.
//
// IPC: omarchy-shell meeting-mode toggle | on | off | auto | status | settings
Item {
    id: root

    property var shell: null
    property var manifest: null
    readonly property string pluginId: String((root.manifest && root.manifest.id) || "nixarchy.meeting-mode")

    SettingsStore {
        id: store
        shell: root.shell
        pluginId: root.pluginId
    }
    readonly property var settings: store.values

    readonly property string helper: decodeURIComponent(Qt.resolvedUrl("bin/meeting-mode-actions").toString().replace(/^file:\/\//, ""))
    readonly property string stateFile: SettingsModel.statePath(Quickshell.env("XDG_RUNTIME_DIR"), Quickshell.env("XDG_STATE_HOME"), Quickshell.env("HOME"))

    // --- call detection -----------------------------------------------------
    readonly property var nodes: Pipewire.nodes ? Pipewire.nodes.values : []
    readonly property var captureStreams: {
        var list = [];
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n && n.isStream && n.isSink === false)
                list.push(n);
        }
        return list;
    }
    // Track every node: a screen-share Video/Source is not a stream.
    PwObjectTracker { objects: root.nodes }

    // Capture streams of a call app, each with its kind (native | browser).
    readonly property var qualifying: {
        var out = [];
        for (var i = 0; i < captureStreams.length; i++) {
            var n = captureStreams[i];
            if (!n.ready) continue;
            var kind = SettingsModel.classify(n.properties, root.settings);
            if (kind !== "")
                out.push({ id: n.id, kind: kind, app: SettingsModel.callAppName(n.properties) });
        }
        return out;
    }
    // An xdph screen share is a Video/Source named xdph-streaming-*.
    readonly property bool screenShared: {
        for (var i = 0; i < nodes.length; i++) {
            var p = nodes[i] && nodes[i].ready ? nodes[i].properties : null;
            if (p && p["media.class"] === "Video/Source" && String(p["media.name"] || "").indexOf("xdph-streaming-") === 0)
                return true;
        }
        return false;
    }
    // Window titles stay in memory; they are never logged or notified.
    readonly property var titles: {
        var out = [];
        var tl = Hyprland.toplevels ? Hyprland.toplevels.values : [];
        for (var i = 0; i < tl.length; i++)
            if (tl[i]) out.push(String(tl[i].title || ""));
        return out;
    }
    readonly property bool sharingIndicator: {
        for (var i = 0; i < titles.length; i++)
            if (/(Firefox|Zen).*Sharing Indicator/.test(titles[i])) return true;
        return false;
    }

    property var heldAt: ({})          // stream id -> when we first saw it
    property string call: "none"       // none | maybe | call
    property string callApp: ""
    property string callTitle: ""
    property double callSince: 0
    readonly property bool callDetected: call === "call"

    onQualifyingChanged: recompute()
    onTitlesChanged: recompute()
    onScreenSharedChanged: recompute()
    onSettingsChanged: recompute()

    // The 1 s tick exists only for the 3 s and maybeDelay thresholds.
    Timer {
        interval: 1000
        repeat: true
        running: root.qualifying.length > 0
        onTriggered: root.recompute()
    }

    function recompute() {
        var now = Date.now();
        var q = root.qualifying;
        var held = {};
        for (var i = 0; i < q.length; i++)
            held[q[i].id] = root.heldAt[q[i].id] || now;
        root.heldAt = held;
        var title = SettingsModel.confirmTitle(root.titles, root.settings);
        var confirmed = title !== "" || root.screenShared || root.sharingIndicator;
        var rank = { none: 0, maybe: 1, call: 2 };
        var best = { call: "none", app: "", title: "" };
        for (var j = 0; j < q.length; j++) {
            var d = SettingsModel.decide({ kind: q[j].kind, heldMs: now - held[q[j].id], confirmed: confirmed, title: title }, root.settings);
            if (rank[d.call] > rank[best.call])
                best = { call: d.call, app: q[j].app, title: d.title };
        }
        if (best.call === "none") root.callSince = 0;
        else if (root.call === "none") root.callSince = now;
        root.callApp = best.app;
        root.callTitle = best.title;
        root.call = best.call;
    }

    onCallChanged: root.writeState()
    onCallAppChanged: root.writeState()
    onCallTitleChanged: root.writeState()

    // --- state ---------------------------------------------------------------
    property bool active: false        // the actions are applied
    property bool forcedOn: false      // turned on by hand: stays on until turned off by hand
    property bool suppressed: false    // turned off by hand mid-call: no auto-start until that call ends
    property string reason: ""         // what started it: an app name, or "manual"
    property var changed: []           // what the helper changed, for the tooltip
    property double since: 0
    property var pausedPlayers: []     // MPRIS players paused by us, resumed afterwards

    onCallDetectedChanged: {
        if (!root.callDetected)
            root.suppressed = false;
        root.evaluate();
    }

    function evaluate() {
        var auto = root.callDetected && !root.suppressed;
        // decide() already waited out the 3 s hold.
        if (auto && !root.active && !root.busy)
            root.start(root.callApp);

        if (root.active && !root.forcedOn && !root.callDetected)
            endTimer.restart();
        else
            endTimer.stop();
    }

    Timer {
        id: endTimer
        interval: root.settings.endDelay * 1000
        onTriggered: if (!root.callDetected && !root.forcedOn && root.active) root.stop()
    }

    // --- applying and undoing ------------------------------------------------
    property bool busy: false
    property var queued: null   // the next helper call if one is running

    function runHelper(args, after) {
        if (helperProc.running) {
            root.queued = { args: args, after: after };
            return;
        }
        root.busy = true;
        helperProc.after = after || null;
        helperProc.command = [root.helper].concat(args);
        helperProc.running = true;
    }

    Process {
        id: helperProc
        property var after: null
        stdout: StdioCollector {
            onStreamFinished: {
                var status = { active: false, changed: [] };
                try { status = JSON.parse(String(text).trim()); } catch (e) {}
                root.changed = status.changed || [];
                var cb = helperProc.after;
                helperProc.after = null;
                if (cb) cb(status);
                root.busy = false;
                if (root.queued) {
                    var q = root.queued;
                    root.queued = null;
                    root.runHelper(q.args, q.after);
                }
                root.evaluate();
            }
        }
    }

    function notify(title, body) {
        if (root.settings.notify)
            Quickshell.execDetached(["notify-send", "-a", "Meeting Mode", "-i", "camera-video", title, body]);
    }

    function hook(command) {
        if (command && command.trim() !== "")
            Quickshell.execDetached(["sh", "-c", command]);
    }

    function pauseMedia() {
        var paused = [];
        var players = Mpris.players ? Mpris.players.values : [];
        for (var i = 0; i < players.length; i++) {
            var p = players[i];
            if (p && p.isPlaying && (p.canPause || p.canTogglePlaying)) {
                p.pause();
                paused.push(p.dbusName);
            }
        }
        root.pausedPlayers = paused;
    }

    function resumeMedia() {
        var players = Mpris.players ? Mpris.players.values : [];
        for (var i = 0; i < players.length; i++) {
            var p = players[i];
            if (p && root.pausedPlayers.indexOf(p.dbusName) !== -1 && (p.canPlay || p.canTogglePlaying))
                p.play();
        }
        root.pausedPlayers = [];
    }

    function start(why) {
        if (root.active) return;
        root.active = true;
        root.reason = why;
        root.since = Date.now();
        // The meetingai plugin may offer to take notes; ask before DND is on.
        // Errors, or no meetingai plugin, are ignored.
        // Reports "Target not found" and does nothing when meetingai is not installed.
        Quickshell.execDetached(["sh", "-c", "omarchy-shell meetingai offer >/dev/null 2>&1; true"]);
        // Before Do Not Disturb, or it would swallow its own notification.
        root.notify("Meeting mode on", why === "manual" ? "Turned on by hand" : "Call detected in " + why);
        if (root.settings.pauseMedia)
            root.pauseMedia();
        root.hook(root.settings.onStart);
        root.runHelper(["on", SettingsModel.actionList(root.settings)], function() { root.writeState(); });
        root.writeState();
    }

    function stop() {
        if (!root.active) return;
        root.active = false;
        root.forcedOn = false;
        root.runHelper(["off"], function() {
            if (root.pausedPlayers.length)
                root.resumeMedia();
            root.hook(root.settings.onEnd);
            root.notify("Meeting mode off", "Everything is back the way it was");
            root.writeState();
        });
        root.writeState();
    }

    // --- manual control --------------------------------------------------------
    function turnOn() {
        root.suppressed = false;
        root.forcedOn = true;
        if (!root.active) root.start("manual");
        else root.writeState();
        root.evaluate();
    }

    function turnOff() {
        if (root.callDetected) root.suppressed = true;
        root.forcedOn = false;
        root.stop();
        root.evaluate();
    }

    function toggle() {
        if (root.active) root.turnOff();
        else root.turnOn();
    }

    // Back to automatic: drop any manual override.
    function auto() {
        root.suppressed = false;
        root.forcedOn = false;
        root.evaluate();
    }

    // --- state for the bar widget --------------------------------------------
    function stateObject() {
        return {
            active: root.active,
            forced: root.forcedOn,
            suppressed: root.suppressed,
            reason: root.reason,
            call: root.call,
            callDetected: root.callDetected,
            callApp: root.callApp,
            callTitle: root.callTitle,
            callSince: root.callSince,
            since: root.since,
            changed: root.changed,
            pausedMedia: root.pausedPlayers.length
        };
    }

    // Nothing is written until the helper has run once: it creates the private
    // (0700) state directory used when there is no XDG_RUNTIME_DIR.
    property bool stateReady: false

    function writeState() {
        if (root.stateReady)
            stateOut.setText(JSON.stringify(root.stateObject()) + "\n");
    }

    FileView {
        id: stateOut
        path: root.stateFile
        atomicWrites: true
        printErrors: false
    }

    Component.onCompleted: {
        // Pick up a meeting left active by a shell restart; the end timer
        // undoes it if the call is already over.
        root.runHelper(["status"], function(status) {
            root.stateReady = true;
            if (status.active) {
                root.active = true;
                root.reason = "restored";
                root.since = Date.now();
            }
            root.writeState();
        });
    }

    IpcHandler {
        target: "meeting-mode"
        function toggle(): string { root.toggle(); return root.active ? "on" : "off"; }
        function on(): string { root.turnOn(); return "on"; }
        function off(): string { root.turnOff(); return "off"; }
        function auto(): string { root.auto(); return "auto"; }
        function status(): string { return JSON.stringify(root.stateObject()); }
        function settings(): string {
            return root.shell && root.shell.toggle(root.pluginId, "{}") ? "ok" : "unavailable";
        }
    }
}
