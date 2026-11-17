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
    webApps: "omateams|teams-for-linux|zoom\\.us",
    browsers: "chrom|firefox|brave|vivaldi|zen|librewolf|edge",
    // one regex per line, matched (case-sensitive) against window titles
    meetingTitles: "^Meet - [a-z]{3}-[a-z]{4}-[a-z]{3}\n^Zoom Meeting\nJitsi Meet\nHuddle\nWebex\nMessenger call\nWhatsApp.*[Cc]all",
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
var OLD_MEETING_TITLES = "^Meet - [a-z]{3}-[a-z]{4}-[a-z]{3}\n\\| Microsoft Teams\n^Zoom( Meeting| Workplace)?\nJitsi Meet\nHuddle\nWebex\nMessenger call\nWhatsApp.*[Cc]all";

function validRegex(p, flags) {
    try {
        new RegExp(p, flags);
        return true;
    } catch (err) {
        return false;
    }
}

// Compiled patterns are cached: the service tests every stream on every tick.
var rxCache = {};
function rx(src, flags) {
    var k = (flags || "") + "/" + src;
    if (!(k in rxCache)) {
        try {
            rxCache[k] = new RegExp(src, flags);
        } catch (err) {
            rxCache[k] = null;
        }
    }
    return rxCache[k];
}

// Never throws: an invalid pattern matches nothing.
function matches(src, flags, text) {
    if (!src || !text) return false;
    var r = rx(src, flags);
    return r !== null && r.test(text);
}

// Split on the `|` that are not inside a group, a class or an escape.
function splitTop(src) {
    var out = [], cur = "", depth = 0, cls = false;
    for (var i = 0; i < src.length; i++) {
        var c = src.charAt(i);
        if (c === "\\" && i + 1 < src.length) { cur += c + src.charAt(++i); continue; }
        if (cls) { if (c === "]") cls = false; }
        else if (c === "[") cls = true;
        else if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === "|" && depth === 0) { out.push(cur); cur = ""; continue; }
        cur += c;
    }
    out.push(cur);
    return out;
}

// "" when text is a valid value for this setting, else a short reason.
// The settings panel refuses to save anything this rejects.
function regexError(key, text) {
    var lines = key === "meetingTitles" ? String(text).split("\n") : [String(text)];
    for (var i = 0; i < lines.length; i++)
        if (lines[i].trim() !== "" && !validRegex(lines[i].trim(), key === "meetingTitles" ? "" : "i"))
            return "Not a valid regular expression: " + lines[i].trim();
    return "";
}

function normalize(raw) {
    var e = raw && typeof raw === "object" ? raw : {};
    var delay = Number(e.endDelay);
    delay = isFinite(delay) ? Math.max(3, Math.min(600, Math.round(delay))) : DEFAULTS.endDelay;
    var apps = typeof e.callApps === "string" && e.callApps.trim() !== "" ? e.callApps.trim() : OLD_CALL_APPS;
    if (apps.charAt(0) === "(" && apps.charAt(apps.length - 1) === ")" && validRegex(apps.slice(1, -1), "i"))
        apps = apps.slice(1, -1);
    if (!validRegex(apps, "i"))
        apps = OLD_CALL_APPS;
    // A callApps the user changed is split into the two new lists, unless
    // they set those lists themselves.
    var native = DEFAULTS.nativeApps, browsers = DEFAULTS.browsers;
    if (apps !== OLD_CALL_APPS && e.nativeApps === undefined && e.browsers === undefined) {
        var known = new RegExp(DEFAULTS.browsers, "i");
        var parts = splitTop(apps).map(function(t) { return t.trim(); }).filter(function(t) { return t !== ""; });
        var b = parts.filter(function(t) { return known.test(t); });
        var n = parts.filter(function(t) { return !known.test(t); });
        // Each side must still be a valid pattern; otherwise it keeps its default.
        if (n.length && validRegex(n.join("|"), "i")) native = n.join("|");
        if (b.length && validRegex(b.join("|"), "i")) browsers = b.join("|");
    }
    if (typeof e.nativeApps === "string" && e.nativeApps.trim() !== "" && validRegex(e.nativeApps.trim(), "i")) native = e.nativeApps.trim();
    if (typeof e.browsers === "string" && e.browsers.trim() !== "" && validRegex(e.browsers.trim(), "i")) browsers = e.browsers.trim();
    var webApps = DEFAULTS.webApps;
    if (typeof e.webApps === "string" && validRegex(e.webApps.trim(), "i")) webApps = e.webApps.trim();
    // Missing: the defaults. An empty string is a choice: no title confirmation.
    var titles = DEFAULTS.meetingTitles;
    if (typeof e.meetingTitles === "string" && e.meetingTitles !== OLD_MEETING_TITLES) {
        var lines = e.meetingTitles.split("\n").map(function(l) { return l.trim(); }).filter(function(l) { return l !== ""; });
        var good = lines.filter(function(l) { return validRegex(l); });
        if (good.length || !lines.length) titles = good.join("\n");
    }
    var maybe = Number(e.maybeDelay);
    maybe = isFinite(maybe) && e.maybeDelay !== "" && e.maybeDelay !== null ? Math.max(10, Math.min(600, Math.round(maybe))) : DEFAULTS.maybeDelay;
    return {
        nativeApps: native,
        webApps: webApps,
        browsers: browsers,
        meetingTitles: titles,
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
    return matches(callApps, "i", who);
}

// "native" | "browser" | "" from a capture stream's properties.
function classify(props, s) {
    if (!isCallStream(props, ".")) return "";
    var who = String(props["application.name"] || "") + " " + String(props["application.process.binary"] || "");
    if (matches(s.nativeApps, "i", who)) return "native";
    if (matches(s.browsers, "i", who)) return "browser";
    return "";
}

// The first window title that matches a meetingTitles pattern, or "".
function confirmTitle(titles, s) {
    var pats = String(s.meetingTitles).split("\n").filter(function(l) { return l !== "" && validRegex(l); });
    for (var i = 0; i < (titles || []).length; i++)
        for (var j = 0; j < pats.length; j++)
            if (matches(pats[j], "", String(titles[i]))) return String(titles[i]);
    return "";
}

// How sure we are that a held mic stream is a call.
function decide(x, s) {
    // Only a browser call carries the title that confirmed it.
    var title = x.kind === "browser" && x.confirmed ? x.title || "" : "";
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

function streamKey(id, pid) {
    return id + ":" + pid;
}

function parentFromStat(text) {
    var end = String(text).lastIndexOf(") ");
    if (end < 0) return null;
    var fields = text.slice(end + 2).trim().split(/\s+/);
    var pid = Number(fields[1]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function kindOf(props, windowClass, s) {
    if (!isCallStream(props, ".")) return "";
    var who = String(props["application.name"] || "") + " " + String(props["application.process.binary"] || "");
    if (matches(s.nativeApps, "i", who)) return "native";
    if (matches(s.webApps, "i", String(windowClass || ""))) return "webapp";
    if (matches(s.browsers, "i", who)) return "browser";
    return "";
}

function candidates(chain, windows, s) {
    for (var i = 0; i < (chain || []).length; i++) {
        var owned = (windows || []).filter(function(w) { return Number(w.pid) === Number(chain[i]) && Number(chain[i]) > 0; });
        if (owned.length) {
            if (owned.length === 1) return owned;
            // One process, several windows (a browser): only a meeting title or a web-app class names the call's window.
            return owned.filter(function(w) { return strongWindow(w, s); });
        }
    }
    return [];
}

function strongWindow(w, s) {
    return !!s && (confirmTitle([w.title], s) !== "" || matches(s.webApps, "i", String(w.cls || "")));
}
function bind(prev, cands, windows, refreshedAll, wasAmbiguous, prevHow, s) {
    var titled = function(w) { return strongWindow(w, s); };
    if (prev) {
        var held = windows.filter(function(w) { return w.stableId === prev; })[0];
        if (!held) return { stableId: "", ambiguous: false, how: "" };
        // A sole binding moves once, to the single title window of the same pid; a title binding never moves.
        if (prevHow === "sole" && refreshedAll && s) {
            var titles = cands.filter(function(w) { return titled(w) && Number(w.pid) === Number(held.pid); });
            if (titles.length === 1) return { stableId: titles[0].stableId, ambiguous: false, how: "title" };
        }
        return { stableId: prev, ambiguous: false, how: prevHow || "" };
    }
    // While a window is unrefreshed nothing new binds; an ambiguous stream stays ambiguous meanwhile.
    if (!refreshedAll) return { stableId: "", ambiguous: !!wasAmbiguous, how: "" };
    var one = cands.length === 1;
    return { stableId: one ? cands[0].stableId : "", ambiguous: cands.length > 1, how: one ? (titled(cands[0]) ? "title" : "sole") : "" };
}

function windowFields(calls, prev, s) {
    var old = prev || {};
    // A native call with its window closed to the tray has no window to show; it must not hide another call's window.
    var ids = calls.filter(function(c) { return c.binding.stableId !== "" || c.binding.ambiguous || c.kind !== "native"; })
        .map(function(c) { return c.binding.stableId; });
    var state = "none";
    var boundIds = ids.filter(function(id) { return id !== ""; });
    if (calls.some(function(c) { return c.binding.ambiguous; }) ||
        boundIds.some(function(id) { return id !== boundIds[0]; }))
        state = "ambiguous";
    else if (ids.length && ids.every(function(id) { return id !== ""; })) state = "bound";
    var window = state === "bound" ? calls.filter(function(c) { return c.binding.stableId !== ""; })[0].window : null;
    // Only calls bound to that window say whether it shows the meeting: an unbound native call must not.
    var showing = state === "bound" && calls.some(function(c) {
        return c.binding.stableId === window.stableId && (c.kind !== "browser" || confirmTitle([c.window.title], s) !== "");
    });
    var id = window ? window.stableId : "";
    return {
        callWindowState: state,
        callWindow: id,
        callWindowClass: window ? String(window.cls || "") : "",
        callWindowShowing: showing,
        callWindowSeq: (old.callWindowSeq || 0) + ((old.callWindow || "") !== id || (old.callWindowShowing || false) !== showing ? 1 : 0)
    };
}

function step(prev, input, now, s) {
    prev = prev || {};
    var heldAt = {}, confirmed = {}, bindings = {}, bindHow = {}, ended = {}, chains = {}, ambiguous = {};
    var windows = input.windows || [], streams = input.streams || [];
    var refreshedAll = windows.every(function(w) { return w.refreshed; });
    var needChain = [], calls = [], ranked = [], timerNeeded = false;
    streams.forEach(function(stream) {
        if (!isCallStream(stream.props, ".")) return;
        var pid = Number(stream.pid);
        var key = streamKey(stream.id, stream.pid);
        heldAt[key] = prev.heldAt && prev.heldAt[key] !== undefined ? prev.heldAt[key] : now;
        if (prev.ended && prev.ended[key]) ended[key] = true;
        if (prev.confirmed && prev.confirmed[key]) confirmed[key] = prev.confirmed[key];
        if (Number.isFinite(pid) && pid > 0) {
            if (Object.prototype.hasOwnProperty.call(input.chains || {}, key)) chains[key] = input.chains[key];
            else needChain.push({ key: key, pid: pid });
        }
        var previous = prev.bindings && prev.bindings[key] || "";
        var binding = Number.isFinite(pid) && pid > 0 && !ended[key] ? bind(previous, candidates(chains[key], windows, s), windows, refreshedAll, prev.ambiguous && prev.ambiguous[key], prev.bindHow && prev.bindHow[key], s) : { stableId: "", ambiguous: false, how: "" };
        // Only browser and webapp streams end with their window; a native app keeps its mic stream and may bind again.
        if (previous && !binding.stableId && kindOf(stream.props, undefined, s) !== "native") ended[key] = true;
        if (binding.stableId) { bindings[key] = binding.stableId; bindHow[key] = binding.how; }
        if (binding.ambiguous) ambiguous[key] = true;
        // An unbound stream has no window: "" must not match an unrefreshed window's empty id.
        var window = binding.stableId ? windows.filter(function(w) { return w.stableId === binding.stableId; })[0] : undefined;
        var kind = kindOf(stream.props, window && window.cls, s);
        if (kind && !ended[key]) timerNeeded = true;
        var heldMs = now - heldAt[key], title = window && confirmTitle([window.title], s) || "";
        var by = "";
        if (!ended[key] && heldMs >= START_AFTER * 1000) {
            if (kind === "native" || kind === "webapp") by = kind;
            else if (kind === "browser") by = title ? "title" : heldMs >= s.maybeDelay * 1000 ? "fallback" : "";
        }
        if (by) {
            var old = confirmed[key];
            if (!old) confirmed[key] = { by: by, at: now };
            else if ((old.by === "fallback" && by !== "fallback") || (old.by === "title" && by === "webapp"))
                confirmed[key] = { by: by, at: old.at };
        }
        var level = ended[key] ? "none" : confirmed[key] ? "call" : kind === "browser" && heldMs >= START_AFTER * 1000 ? "maybe" : "none";
        var item = { key: key, level: level, kind: kind, binding: binding, window: window, props: stream.props,
                     confirmation: confirmed[key] };
        if (level === "call") calls.push(item);
        if (level !== "none") ranked.push(item);
    });
    ranked.sort(function(a, b) {
        if (a.level !== b.level) return a.level === "call" ? -1 : 1;
        if (a.level === "call") {
            var af = a.confirmation.by === "fallback", bf = b.confirmation.by === "fallback";
            if (af !== bf) return af ? 1 : -1;
            return a.confirmation.at - b.confirmation.at;
        }
        return heldAt[a.key] - heldAt[b.key];
    });
    var winner = ranked[0], fields = windowFields(calls, prev.fields, s);
    fields.callBy = winner && winner.level === "call" ? winner.confirmation.by : "";
    return { heldAt: heldAt, confirmed: confirmed, bindings: bindings, bindHow: bindHow, ended: ended, chains: chains, ambiguous: ambiguous,
             fields: fields, call: winner ? winner.level : "none",
             callApp: winner ? callAppName(winner.props) : "",
             callTitle: winner && winner.level === "call" && winner.kind === "browser" && winner.window ? confirmTitle([winner.window.title], s) : "",
             needChain: needChain, timerNeeded: timerNeeded };
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
        regexError: regexError,
        actionList: actionList,
        isCallStream: isCallStream,
        classify: classify,
        confirmTitle: confirmTitle,
        decide: decide,
        streamKey: streamKey,
        parentFromStat: parentFromStat,
        kindOf: kindOf,
        candidates: candidates,
        bind: bind,
        windowFields: windowFields,
        step: step,
        callAppName: callAppName,
        statePath: statePath,
        entryFromConfig: entryFromConfig
    };
