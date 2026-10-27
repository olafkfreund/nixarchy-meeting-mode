.pragma library

// Settings live in this plugin's entry of ~/.config/omarchy/shell.json
// ("plugins": [{ "id": "nixarchy.meeting-mode", ... }]).
// normalize() turns whatever is there into a complete, valid set.

var DEFAULTS = {
    dnd: true,              // Do Not Disturb during the call
    awake: true,            // no idle lock or screen blank
    nightlight: true,       // night light off, so the camera isn't tinted
    voice: true,            // pause nixarchy voice control, if it is running
    pauseMedia: false,      // pause music/videos that are playing, resume after
    endDelay: 15,           // seconds without a call before everything is put back
    notify: true,           // a notification when meeting mode starts and ends
    nativeApps: "zoom|teams-for-linux|teams|discord|vesktop|slack|signal|webex|CiscoCollabHost|element|skype|jitsi|telegram",
    browsers: "chrom|firefox|brave|vivaldi|zen|librewolf|edge",
    // one regex per line, matched (case-sensitive) against window titles
    meetingTitles: "^Meet - [a-z]{3}-[a-z]{4}-[a-z]{3}\n\\| Microsoft Teams\n^Zoom( Meeting| Workplace)?\nJitsi Meet\nHuddle\nWebex\nMessenger call\nWhatsApp.*[Cc]all",
    maybeDelay: 60,         // seconds a browser mic counts as "maybe" before it is a call
    onStart: "",            // optional shell command run when a meeting starts
    onEnd: ""               // optional shell command run when it ends
};

var END_DELAY_OPTIONS = [
    { value: "5", label: "5 s" },
    { value: "15", label: "15 s" },
    { value: "30", label: "30 s" },
    { value: "60", label: "1 min" }
];

// Seconds a call app must hold the mic before meeting mode starts. Long
// enough to ignore a quick mic test, short enough that the first
// notification of the call is already silenced.
var START_AFTER = 3;

var OLD_CALL_APPS = "chrom|firefox|brave|vivaldi|zen|librewolf|zoom|teams|slack|webex|discord|skype|jitsi|signal|telegram|element";

function validRegex(p, flags) {
    try {
        new RegExp(p, flags);
        return true;
    } catch (err) {
        return false;
    }
}

function normalize(raw) {
    var e = raw && typeof raw === "object" ? raw : {};
    var delay = Number(e.endDelay);
    delay = isFinite(delay) ? Math.max(3, Math.min(600, Math.round(delay))) : DEFAULTS.endDelay;
    var apps = typeof e.callApps === "string" && e.callApps.trim() !== "" ? e.callApps.trim() : OLD_CALL_APPS;
    try {
        new RegExp(apps, "i");
    } catch (err) {
        apps = OLD_CALL_APPS;
    }
    // A callApps the user changed is split into the two new lists, unless
    // they set those lists themselves.
    var native = DEFAULTS.nativeApps, browsers = DEFAULTS.browsers;
    if (apps !== OLD_CALL_APPS && e.nativeApps === undefined && e.browsers === undefined) {
        var known = DEFAULTS.browsers.split("|");
        var parts = apps.split("|");
        var b = parts.filter(function(t) { return known.indexOf(t.toLowerCase()) !== -1; });
        var n = parts.filter(function(t) { return known.indexOf(t.toLowerCase()) === -1 && t !== ""; });
        if (n.length) native = n.join("|");
        if (b.length) browsers = b.join("|");
    }
    if (typeof e.nativeApps === "string" && e.nativeApps.trim() !== "" && validRegex(e.nativeApps.trim(), "i")) native = e.nativeApps.trim();
    if (typeof e.browsers === "string" && e.browsers.trim() !== "" && validRegex(e.browsers.trim(), "i")) browsers = e.browsers.trim();
    var titles = typeof e.meetingTitles === "string"
        ? e.meetingTitles.split("\n").map(function(l) { return l.trim(); }).filter(function(l) { return l !== "" && validRegex(l); }).join("\n")
        : "";
    var maybe = Number(e.maybeDelay);
    maybe = isFinite(maybe) && e.maybeDelay !== "" && e.maybeDelay !== null ? Math.max(10, Math.min(600, Math.round(maybe))) : DEFAULTS.maybeDelay;
    return {
        nativeApps: native,
        browsers: browsers,
        meetingTitles: titles !== "" ? titles : DEFAULTS.meetingTitles,
        maybeDelay: maybe,
        dnd: e.dnd !== false,
        awake: e.awake !== false,
        nightlight: e.nightlight !== false,
        voice: e.voice !== false,
        pauseMedia: e.pauseMedia === true,
        endDelay: delay,
        notify: e.notify !== false,
        onStart: typeof e.onStart === "string" ? e.onStart : "",
        onEnd: typeof e.onEnd === "string" ? e.onEnd : ""
    };
}

// The comma list the helper script takes: "dnd,awake,nightlight,voice".
function actionList(values) {
    var out = [];
    ["dnd", "awake", "nightlight", "voice"].forEach(function(k) {
        if (values[k]) out.push(k);
    });
    return out.join(",");
}

// A PipeWire capture stream belongs to a call when its app name or binary
// matches callApps. Voice wake words (omarchy-voice records with pw-record) and Voxtype never match.
// The caller passes only capture streams (isStream && !isSink); media.class,
// when PipeWire reports it, must agree.
function isCallStream(props, callApps) {
    if (!props) return false;
    var cls = String(props["media.class"] || "");
    if (cls !== "" && cls.indexOf("Input") === -1) return false;
    var who = String(props["application.name"] || "") + " " + String(props["application.process.binary"] || "");
    return new RegExp(callApps, "i").test(who);
}

// "native" | "browser" | "" from a capture stream's properties.
function classify(props, s) {
    if (!isCallStream(props, ".")) return "";
    var who = String(props["application.name"] || "") + " " + String(props["application.process.binary"] || "");
    if (new RegExp(s.nativeApps, "i").test(who)) return "native";
    if (new RegExp(s.browsers, "i").test(who)) return "browser";
    return "";
}

// The first window title that matches a meetingTitles pattern, or "".
function confirmTitle(titles, s) {
    var pats = String(s.meetingTitles).split("\n").filter(function(l) { return l !== "" && validRegex(l); });
    for (var i = 0; i < (titles || []).length; i++)
        for (var j = 0; j < pats.length; j++)
            if (new RegExp(pats[j]).test(String(titles[i]))) return String(titles[i]);
    return "";
}

// How sure we are that a held mic stream is a call.
function decide(x, s) {
    var title = x.title || "";
    var held = x.heldMs >= START_AFTER * 1000;
    var call = "none";
    if (x.kind === "native" && held) call = "call";
    else if (x.kind === "browser" && held)
        call = x.confirmed || x.heldMs >= s.maybeDelay * 1000 ? "call" : "maybe";
    return { call: call, title: title };
}

function callAppName(props) {
    var name = String((props && (props["application.name"] || props["application.process.binary"])) || "");
    return name !== "" ? name : "a call app";
}

// Where the service publishes its state for the bar widget and settings
// panel. It says whether you are in a call and with which app, so it must
// never land somewhere other users can read: $XDG_RUNTIME_DIR is private to
// the user (0700 by spec); without it, use this plugin's state directory,
// which bin/meeting-mode-actions creates 0700. Never /tmp.
function statePath(runtimeDir, stateHome, home) {
    if (runtimeDir)
        return runtimeDir + "/meeting-mode.json";
    var base = stateHome || ((home || "") + "/.local/state");
    return base + "/meeting-mode/state.json";
}

function entryFromConfig(config, pluginId) {
    var plugins = config && Array.isArray(config.plugins) ? config.plugins : [];
    for (var i = 0; i < plugins.length; i++)
        if (plugins[i] && String(plugins[i].id || "") === pluginId)
            return plugins[i];
    return null;
}

if (typeof module !== "undefined")
    module.exports = {
        DEFAULTS: DEFAULTS,
        START_AFTER: START_AFTER,
        normalize: normalize,
        actionList: actionList,
        isCallStream: isCallStream,
        classify: classify,
        confirmTitle: confirmTitle,
        decide: decide,
        callAppName: callAppName,
        statePath: statePath,
        entryFromConfig: entryFromConfig
    };
