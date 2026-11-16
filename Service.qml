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
    PwObjectTracker { objects: root.captureStreams }

    // Ready capture streams with their owning pid (a string or number; the
    // model compares it as a number).
    readonly property var streams: {
        var out = [];
        for (var i = 0; i < captureStreams.length; i++) {
            var n = captureStreams[i];
            if (!n.ready) continue;
            var p = n.properties || {};
            out.push({ id: n.id, pid: p["application.process.id"], props: p });
        }
        return out;
    }

    // Toplevel windows: titles stay in memory and the 0600 state file only.
    readonly property var windows: {
        var out = [];
        var tl = Hyprland.toplevels ? Hyprland.toplevels.values : [];
        for (var i = 0; i < tl.length; i++) {
            if (!tl[i]) continue;
            var o = tl[i].lastIpcObject || {};
            out.push({
                pid: o.pid,
                stableId: String(o.stableId || ""),
                cls: String(o["class"] || (tl[i].wayland && tl[i].wayland.appId) || ""),
                title: String(tl[i].title || ""),
                refreshed: o.pid !== undefined && !!o.stableId
            });
        }
        return out;
    }

    // Refresh the toplevels' IPC data once per change of the list, and again
    // after an answer that left some unrefreshed (Quickshell drops a refresh
    // asked while one is in flight). A window that never refreshes stops it.
    property int askedUnrefreshed: 0
    function unrefreshed() {
        var n = 0;
        for (var i = 0; i < root.windows.length; i++)
            if (!root.windows[i].refreshed) n++;
        return n;
    }
    Connections {
        target: Hyprland.toplevels
        function onValuesChanged() {
            root.askedUnrefreshed = root.unrefreshed();
            if (root.askedUnrefreshed > 0) Hyprland.refreshToplevels();
        }
    }
    onWindowsChanged: {
        var n = root.unrefreshed();
        if (n > 0 && n < root.askedUnrefreshed) {
            root.askedUnrefreshed = n;
            Hyprland.refreshToplevels();
        }
        root.recompute();
    }

    property var model: ({ heldAt: {}, confirmed: {}, bindings: {}, ended: {}, chains: {}, fields: {} })
    property var fields: ({ callWindowState: "none", callWindow: "", callWindowClass: "", callWindowShowing: false, callWindowSeq: 0, callBy: "" })
    property bool timerNeeded: false
    property string call: "none"       // none | maybe | call
    property string callApp: ""
    property string callTitle: ""
    property double callSince: 0
    readonly property bool callDetected: call === "call"

    onStreamsChanged: recompute()
    onSettingsChanged: recompute()

    // The 1 s tick exists only for the 3 s and maybeDelay thresholds.
    Timer {
        interval: 1000
        repeat: true
        running: root.timerNeeded
        onTriggered: root.recompute()
    }

    function recompute() {
        var r = SettingsModel.step(root.model, { streams: root.streams, chains: root.model.chains, windows: root.windows }, Date.now(), root.settings);
        root.model = r;
        r.needChain.forEach(root.queueAncestry);
        if (r.call === "none") root.callSince = 0;
        else if (root.call === "none") root.callSince = Date.now();
        if (JSON.stringify(r.fields) !== JSON.stringify(root.fields)) root.fields = r.fields;
        root.timerNeeded = r.timerNeeded;
        root.callApp = r.callApp;
        root.callTitle = r.callTitle;
        root.call = r.call;
    }

    onFieldsChanged: root.writeState()

    // --- process ancestry: one run per stream key, one at a time -------------
    property var ancQueue: []          // [{key, pid}]
    property string ancKey: ""         // the key being looked up
    property bool ancOutput: false     // its output has not been read yet
    function queueAncestry(item) {
        if (item.key === root.ancKey) return;
        for (var i = 0; i < root.ancQueue.length; i++)
            if (root.ancQueue[i].key === item.key) return;
        root.ancQueue = root.ancQueue.concat([item]);
        root.nextAncestry();
    }
    function nextAncestry() {
        // Both the exit and the output must be in: their order is not fixed.
        if (ancestryProc.running || root.ancOutput || root.ancQueue.length === 0) return;
        var item = root.ancQueue[0];
        root.ancQueue = root.ancQueue.slice(1);
        root.ancKey = item.key;
        root.ancOutput = true;
        ancestryProc.command = [root.helper, "ancestors", String(item.pid)];
        ancestryProc.running = true;
    }
    Process {
        id: ancestryProc
        stdout: StdioCollector {
            onStreamFinished: {
                var key = root.ancKey;
                // Only a stream that still exists keeps its chain.
                if (key !== "" && root.model.heldAt[key] !== undefined) {
                    var chain = String(text).split("\n").filter(function(l) { return l !== ""; }).map(Number);
                    var chains = Object.assign({}, root.model.chains);
                    chains[key] = chain;
                    root.model = Object.assign({}, root.model, { chains: chains });
                    root.recompute();
                }
                root.ancOutput = false;
                if (!ancestryProc.running) { root.ancKey = ""; root.nextAncestry(); }
            }
        }
        onRunningChanged: if (!running && !root.ancOutput) { root.ancKey = ""; root.nextAncestry(); }
    }

    onCallChanged: {
        if (root.call === "none")
            root.suppressed = false;
        root.evaluate();
        root.writeState();
    }
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

    onActiveChanged: root.writeState()

    function evaluate() {
        var auto = root.callDetected && !root.suppressed;
        // decide() already waited out the 3 s hold.
        if (auto && !root.active && !root.busy)
            root.start(root.callApp);

        // A maybe (a browser mic not yet confirmed) keeps a running meeting going.
        if (root.active && !root.forcedOn && root.call === "none")
            endTimer.restart();
        else
            endTimer.stop();
    }

    Timer {
        id: endTimer
        interval: root.settings.endDelay * 1000
        onTriggered: if (root.call === "none" && !root.forcedOn && root.active) root.stop()
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
        // Before Do Not Disturb, or it would swallow its own notification.
        root.notify("Meeting mode on", why === "manual" ? "Turned on by hand" : "Call detected in " + why);
        if (root.settings.pauseMedia)
            root.pauseMedia();
        root.hook(root.settings.onStart);
        // The meetingai plugin may offer to take notes; that goes first so DND
        // does not swallow it. It reports "Target not found" and exits when
        // meetingai is not installed; the timer covers an offer that hangs.
        root.pendingOn = true;
        offerProc.running = true;
        offerTimer.restart();
        root.writeState();
    }

    property bool pendingOn: false

    function beginOn() {
        if (!root.pendingOn) return;
        root.pendingOn = false;
        offerTimer.stop();
        root.runHelper(["on", SettingsModel.actionList(root.settings)], function() { root.writeState(); });
    }

    Process {
        id: offerProc
        command: ["omarchy-shell", "meetingai", "offer"]
        onExited: root.beginOn()
    }
    Timer {
        id: offerTimer
        interval: 1000
        onTriggered: root.beginOn()
    }

    function stop() {
        if (!root.active) return;
        root.active = false;
        root.forcedOn = false;
        root.pendingOn = false;
        offerTimer.stop();
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
        root.evaluate();
        root.writeState();
    }

    function turnOff() {
        if (root.call !== "none") root.suppressed = true;
        root.forcedOn = false;
        root.stop();
        root.evaluate();
        root.writeState();
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
        root.writeState();
    }

    // --- state for the bar widget --------------------------------------------
    function stateObject() {
        return {
            active: root.active,
            forced: root.forcedOn,
            suppressed: root.suppressed,
            reason: root.reason,
            updated: Date.now(),
            pid: Quickshell.processId,
            call: root.call,
            callDetected: root.callDetected,
            callApp: root.callApp,
            callTitle: root.callTitle,
            schema: 2,
            callWindow: root.fields.callWindow,
            callWindowState: root.fields.callWindowState,
            callWindowClass: root.fields.callWindowClass,
            callWindowShowing: root.fields.callWindowShowing,
            callBy: root.fields.callBy,
            callWindowSeq: root.fields.callWindowSeq,
            callSince: root.callSince,
            since: root.since,
            changed: root.changed,
            pausedMedia: root.pausedPlayers.length
        };
    }

    // Nothing is written until the helper has run once: it creates the private
    // (0700) state directory used when there is no XDG_RUNTIME_DIR.
    property bool stateReady: false

    // Several properties change together: write once, after they settle.
    function writeState() {
        Qt.callLater(root.flushState);
    }

    function flushState() {
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
