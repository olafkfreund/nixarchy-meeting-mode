// Run: node tests/model.test.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");

function load(file) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/^\.pragma library\s*/, "");
  const module = { exports: {} };
  new Function("module", src)(module);
  return module.exports;
}

const M = load("SettingsModel.js");
let n = 0;
function test(name, fn) { fn(); n++; }

const D = M.normalize({});
const capture = (app, bin) => ({ "media.class": "Stream/Input/Audio", "application.name": app, "application.process.binary": bin || "" });

test("defaults", () => {
  assert.strictEqual(D.dnd, true);
  assert.strictEqual(D.awake, true);
  assert.strictEqual(D.nightlight, true);
  assert.strictEqual(D.voice, true);
  assert.strictEqual(D.pauseMedia, false, "pausing media is opt-in");
  assert.strictEqual(D.endDelay, 15);
  assert.strictEqual(M.actionList(D), "dnd,awake,nightlight,voice");
});

test("bad values fall back", () => {
  const v = M.normalize({ endDelay: "soon", callApps: "(unclosed", dnd: "yes" });
  assert.strictEqual(v.endDelay, 15);
  assert.strictEqual(v.nativeApps, M.DEFAULTS.nativeApps, "an invalid regex must not break detection");
  assert.strictEqual(v.dnd, true);
  assert.strictEqual(M.normalize({ endDelay: 0 }).endDelay, 3);
  assert.strictEqual(M.normalize({ endDelay: 99999 }).endDelay, 600);
});

test("action list follows switches", () => {
  assert.strictEqual(M.actionList(M.normalize({ awake: false, voice: false })), "dnd,nightlight");
  assert.strictEqual(M.actionList(M.normalize({ dnd: false, awake: false, nightlight: false, voice: false })), "");
});

test("call apps are detected", () => {
  for (const [app, bin] of [["Google Chrome", "chrome"], ["Chromium", ""], ["Firefox", "firefox"], ["ZOOM VoiceEngine", "zoom"],
                            ["teams-for-linux", ""], ["Slack", "slack"], ["WEBRTC VoiceEngine", "Discord"], ["", "vivaldi-bin"]])
    assert.ok(M.isCallStream(capture(app, bin), D.nativeApps + "|" + D.browsers), `${app}/${bin} should count as a call`);
});

test("non-call capture is ignored", () => {
  for (const [app, bin] of [["pw-record", ""], ["voxtype", "voxtype"], ["OBS", "obs"], ["audacity", ""], ["", ""]])
    assert.ok(!M.isCallStream(capture(app, bin), D.nativeApps + "|" + D.browsers), `${app}/${bin} must not start meeting mode`);
});

test("playback streams never count", () => {
  assert.ok(!M.isCallStream({ "media.class": "Stream/Output/Audio", "application.name": "Google Chrome" }, D.nativeApps + "|" + D.browsers));
  assert.ok(!M.isCallStream(null, D.nativeApps + "|" + D.browsers));
});

test("custom call apps", () => {
  const v = M.normalize({ callApps: "mumble|obs" });
  assert.ok(M.isCallStream(capture("Mumble", ""), v.nativeApps));
  assert.ok(!M.isCallStream(capture("Google Chrome", ""), v.nativeApps));
});

test("app name for messages", () => {
  assert.strictEqual(M.callAppName(capture("Google Chrome", "chrome")), "Google Chrome");
  assert.strictEqual(M.callAppName(capture("", "zoom")), "zoom");
  assert.strictEqual(M.callAppName({}), "a call app");
});

test("classify native, browser, nothing", () => {
  for (const [app, bin] of [["vesktop", "vesktop"], ["CiscoCollabHost", ""], ["ZOOM VoiceEngine", "zoom"], ["teams-for-linux", ""]])
    assert.strictEqual(M.classify(capture(app, bin), D), "native", app);
  for (const [app, bin] of [["Google Chrome", "chrome"], ["Firefox", "firefox"], ["", "zen-bin"], ["Zen", "zen"]])
    assert.strictEqual(M.classify(capture(app, bin), D), "browser", app);
  for (const [app, bin] of [["pw-record", ""], ["voxtype", "voxtype"], ["", ""]])
    assert.strictEqual(M.classify(capture(app, bin), D), "", app);
  assert.strictEqual(M.classify({ "media.class": "Stream/Output/Audio", "application.name": "Zoom" }, D), "");
  assert.strictEqual(M.classify(null, D), "");
});

test("title confirmers", () => {
  const yes = ["Meet - abc-defg-hij - Google Chrome", "Zoom Meeting",
               "Jitsi Meet", "#team Huddle", "Webex", "Messenger call", "WhatsApp video call"];
  const no = ["Meet - Google Chrome", "Meet - abcd-efg-hij", "Microsoft Teams chat", "Chat | Microsoft Teams", "Zoom", "Zoom Workplace", "My Zoomer notes", "Hudd", "Webinar",
              "Messenger", "WhatsApp Web", "Inbox"];
  for (const t of yes) assert.strictEqual(M.confirmTitle(["Inbox", t], D), t, t);
  for (const t of no) assert.strictEqual(M.confirmTitle([t], D), "", t);
  assert.strictEqual(M.confirmTitle([], D), "");
  const v = M.normalize({ meetingTitles: "(bad\n^Standup$" });
  assert.strictEqual(M.confirmTitle(["Standup"], v), "Standup", "invalid lines are dropped");
});

test("decide tiers and boundaries", () => {
  const d = (kind, heldMs, confirmed, title) => M.decide({ kind, heldMs, confirmed, title }, D).call;
  assert.strictEqual(d("native", 2999), "none");
  assert.strictEqual(d("native", 3000), "call");
  assert.strictEqual(d("browser", 2999, true), "none");
  assert.strictEqual(d("browser", 3000), "maybe");
  assert.strictEqual(d("browser", 3000, true), "call");
  assert.strictEqual(d("browser", 59999), "maybe");
  assert.strictEqual(d("browser", 60000), "call");
  assert.strictEqual(d("", 999999, true), "none");
  assert.strictEqual(M.decide({ kind: "browser", heldMs: 5000, confirmed: true, title: "Zoom" }, D).title, "Zoom");
  assert.strictEqual(M.decide({ kind: "browser", heldMs: 10000 }, M.normalize({ maybeDelay: 10 })).call, "call");
});

test("titles: empty means none, invalid is refused, native carries no title", () => {
  const none = M.normalize({ meetingTitles: "" });
  assert.strictEqual(none.meetingTitles, "");
  assert.strictEqual(M.confirmTitle(["Huddle"], none), "");
  assert.strictEqual(M.normalize({ meetingTitles: "(bad" }).meetingTitles, M.DEFAULTS.meetingTitles);
  assert.ok(M.regexError("meetingTitles", "ok\n(bad") !== "");
  assert.strictEqual(M.regexError("meetingTitles", "ok\n^x$"), "");
  assert.ok(M.regexError("nativeApps", "zoom|(") !== "");
  assert.strictEqual(M.decide({ kind: "native", heldMs: 5000, confirmed: true, title: "Huddle" }, D).title, "");
});

test("maybeDelay is clamped", () => {
  assert.strictEqual(D.maybeDelay, 60);
  assert.strictEqual(M.normalize({ maybeDelay: 1 }).maybeDelay, 10);
  assert.strictEqual(M.normalize({ maybeDelay: 99999 }).maybeDelay, 600);
  assert.strictEqual(M.normalize({ maybeDelay: "x" }).maybeDelay, 60);
});

test("a user-set callApps migrates", () => {
  const v = M.normalize({ callApps: "mumble|firefox|obs" });
  assert.strictEqual(v.nativeApps, "mumble|obs");
  assert.strictEqual(v.browsers, "firefox");
  assert.strictEqual(M.classify(capture("Mumble", ""), v), "native");
  assert.strictEqual(M.normalize({ callApps: "chrom|firefox|brave|vivaldi|zen|librewolf|zoom|teams|slack|webex|discord|skype|jitsi|signal|telegram|element" }).nativeApps, M.DEFAULTS.nativeApps);
  const own = M.normalize({ callApps: "mumble", nativeApps: "foo" });
  assert.strictEqual(own.nativeApps, "foo", "explicit lists win");
  const m = (callApps) => M.normalize({ callApps });
  assert.strictEqual(m("chrome|zoom").browsers, "chrome");
  assert.strictEqual(m("chromium|zoom").browsers, "chromium");
  assert.strictEqual(m(" firefox | mumble").browsers, "firefox");
  assert.strictEqual(m("firefox-esr|mumble").browsers, "firefox-esr");
  assert.strictEqual(m("(zoom|firefox)").nativeApps, "zoom");
  assert.strictEqual(m("(zoom|firefox)").browsers, "firefox");
  const grouped = m("(?:zoom|firefox)|obs");
  assert.strictEqual(M.regexError("nativeApps", grouped.nativeApps), "");
  assert.strictEqual(M.regexError("browsers", grouped.browsers), "");
  assert.strictEqual(grouped.nativeApps, "obs");
  assert.strictEqual(grouped.browsers, "(?:zoom|firefox)");
  assert.strictEqual(m("[a|b]|(zoom|x)\\|y").nativeApps, "[a|b]|(zoom|x)\\|y", "classes, groups and escapes are not split");
  const bad = m("(?:zoom|obs");
  assert.strictEqual(bad.nativeApps, M.DEFAULTS.nativeApps);
  assert.strictEqual(bad.browsers, M.DEFAULTS.browsers);
  assert.strictEqual(M.classify(capture("x", ""), { nativeApps: "(", browsers: "[", meetingTitles: "" }), "", "classify never throws");
  assert.strictEqual(M.confirmTitle(["x"], { meetingTitles: "(" }), "");
  const only = m("chrom|firefox");
  assert.strictEqual(only.browsers, "chrom|firefox");
  assert.strictEqual(only.nativeApps, M.DEFAULTS.nativeApps, "a browser-only list keeps the default call apps");
});

test("state file is never world-readable /tmp", () => {
  assert.strictEqual(M.statePath("/run/user/1000", "", "/home/u"), "/run/user/1000/meeting-mode.json");
  assert.strictEqual(M.statePath("", "", "/home/u"), "/home/u/.local/state/meeting-mode/state.json");
  assert.strictEqual(M.statePath(undefined, "/home/u/.state", "/home/u"), "/home/u/.state/meeting-mode/state.json");
  for (const p of [M.statePath("", "", "/home/u"), M.statePath(null, null, "/home/u")])
    assert.ok(!p.startsWith("/tmp"), p);
});

const win = (pid, stableId, title = "Inbox", cls = "chrome", refreshed = true) => ({ pid, stableId, title, cls, refreshed });
const stream = (id, pid, app = "Chrome", bin = "chrome") => ({ id, pid, props: capture(app, bin) });
const run = (prev, streams, windows, chains, now, s = D) => M.step(prev, { streams, windows, chains }, now, s);

test("parentFromStat uses the last closing parenthesis", () => {
  assert.strictEqual(M.parentFromStat("12 (odd ) (process name) S 345 1 0"), 345);
  assert.strictEqual(M.parentFromStat("broken"), null);
});

test("candidates use the first owning ancestor and filter several by title", () => {
  const windows = [win(12, "a", "Inbox"), win(12, "b", "Zoom Meeting"), win(20, "c", "Meet - abc-defg-hij")];
  assert.deepStrictEqual(M.candidates([12, 20], windows, D).map(w => w.stableId), ["b"]);
  assert.deepStrictEqual(M.candidates([20, 12], windows, D).map(w => w.stableId), ["c"]);
  assert.deepStrictEqual(M.candidates([12], [win(12, "a", "Zoom Meeting"), win(12, "b", "Jitsi Meet")], D).map(w => w.stableId), ["a", "b"]);
  assert.deepStrictEqual(M.candidates([12], [win(12, "a", "Inbox")], D).map(w => w.stableId), ["a"]);
});

test("bind holds its window through title changes and never moves", () => {
  assert.strictEqual(M.bind("a", [win(12, "b", "Zoom Meeting")], [win(12, "a", "Inbox"), win(12, "b", "Zoom Meeting")], true).stableId, "a");
  assert.strictEqual(M.bind("a", [win(12, "b")], [win(12, "b")], true).stableId, "");
  assert.strictEqual(M.bind("", [win(12, "a")], [win(12, "a")], true).stableId, "a");
  assert.strictEqual(M.bind("", [], [], true).stableId, "");
  assert.strictEqual(M.bind("", [win(12, "a"), win(12, "b")], [], true).ambiguous, true);
  assert.strictEqual(M.bind("", [win(12, "a")], [win(12, "a", "Inbox", "chrome", false)], false).stableId, "");
  assert.strictEqual(M.bind("a", [], [win(12, "a", "Inbox", "chrome", false)], false).stableId, "a");
});

test("stream keys isolate reused ids and prune gone map entries", () => {
  const old = run({}, [stream(1, 12)], [win(12, "a", "Zoom Meeting")], { "1:12": [12] }, 0);
  old.confirmed["1:12"] = { by: "title", at: 3000 };
  old.ended["1:12"] = true;
  const next = run(old, [stream(1, 13)], [win(13, "b", "Inbox")], { "1:13": [13] }, 10000);
  assert.strictEqual(M.streamKey(1, 13), "1:13");
  for (const key of ["heldAt", "confirmed", "bindings", "ended", "chains"])
    assert.deepStrictEqual(Object.keys(next[key]), key === "confirmed" || key === "ended" ? [] : ["1:13"], key);
  assert.strictEqual(next.call, "none");
});

test("missing pid needs no chain and never binds; numeric strings match", () => {
  const missing = run({}, [stream(1, undefined)], [win(12, "a", "Zoom Meeting")], {}, 0);
  assert.deepStrictEqual(missing.needChain, []);
  assert.deepStrictEqual(missing.bindings, {});
  const numeric = run({}, [stream(2, "123")], [win(123, "b", "Zoom Meeting")], { "2:123": ["123"] }, 0);
  assert.strictEqual(numeric.bindings["2:123"], "b");
});

test("kind priority and empty webApps", () => {
  assert.strictEqual(M.kindOf(capture("Zoom", "zoom"), "omateams", D), "native");
  assert.strictEqual(M.kindOf(capture("Unknown", "unknown"), "omateams", D), "webapp");
  assert.strictEqual(M.kindOf(capture("Chrome", "chrome"), "", D), "browser");
  assert.strictEqual(M.kindOf(capture("Recorder", "record"), "", D), "");
  assert.strictEqual(M.kindOf(capture("Recorder", "record"), "omateams", M.normalize({ webApps: "" })), "");
  assert.strictEqual(M.kindOf(capture("Recorder", "record"), "", M.normalize({ webApps: ".*" })), "");
});

test("browser needs three seconds, its own title, or fallback delay", () => {
  const ss = [stream(1, 12)];
  const chain = { "1:12": [12] };
  const a = run({}, ss, [win(12, "a"), win(20, "other", "Zoom Meeting")], chain, 0);
  assert.strictEqual(run(a, ss, [win(12, "a")], chain, 2999).call, "none");
  const b = run(a, ss, [win(12, "a"), win(20, "other", "Zoom Meeting")], chain, 3000);
  assert.strictEqual(b.call, "maybe");
  assert.strictEqual(b.fields.callBy, "");
  assert.strictEqual(run(b, ss, [win(12, "a", "Zoom Meeting")], chain, 4000).fields.callBy, "title");
  assert.strictEqual(run(b, ss, [win(12, "a")], chain, 60000).fields.callBy, "fallback");
});

test("confirmation survives tab changes and fallback upgrades without downgrading", () => {
  const ss = [stream(1, 12)], chain = { "1:12": [12] };
  const a = run({}, ss, [win(12, "a", "Zoom Meeting")], chain, 0);
  const title = run(a, ss, [win(12, "a", "Zoom Meeting")], chain, 3000);
  const switched = run(title, ss, [win(12, "a")], chain, 70000);
  assert.strictEqual(switched.call, "call");
  assert.strictEqual(switched.fields.callBy, "title");
  assert.strictEqual(switched.callTitle, "");
  assert.strictEqual(switched.fields.callWindowShowing, false);
  const fallback = run(a, ss, [win(12, "a")], chain, 60000);
  const upgraded = run(fallback, ss, [win(12, "a", "Zoom Meeting")], chain, 61000);
  assert.deepStrictEqual(upgraded.confirmed["1:12"], { by: "title", at: 60000 });
  assert.strictEqual(run(upgraded, ss, [win(12, "a")], chain, 62000).fields.callBy, "title");
});

test("closing a bound window ends the stream permanently; title changes do not", () => {
  const ss = [stream(1, 12)], chain = { "1:12": [12] };
  const a = run({}, ss, [win(12, "a", "Zoom Meeting")], chain, 0);
  const b = run(a, ss, [win(12, "a")], chain, 3000);
  assert.strictEqual(b.ended["1:12"], undefined);
  const closed = run(b, ss, [], chain, 4000);
  assert.strictEqual(closed.call, "none");
  assert.strictEqual(closed.ended["1:12"], true);
  const reopened = run(closed, ss, [win(12, "b", "Zoom Meeting")], chain, 5000);
  assert.strictEqual(reopened.call, "none");
  assert.deepStrictEqual(reopened.bindings, {});
});

test("webapp confirmation follows its bound class", () => {
  const ss = [stream(1, 12, "Unknown", "unknown")], chain = { "1:12": [12] };
  const a = run({}, ss, [win(12, "a", "Inbox", "omateams")], chain, 0);
  assert.strictEqual(a.timerNeeded, true);
  const b = run(a, ss, [win(12, "a", "Inbox", "omateams")], chain, 3000);
  assert.strictEqual(b.call, "call");
  assert.strictEqual(b.fields.callBy, "webapp");
  assert.strictEqual(b.fields.callWindowShowing, true);
});

test("winner prefers title over older fallback, then earlier confirmation", () => {
  const ss = [stream(1, 12, "Chrome"), stream(2, 20, "Firefox", "firefox")];
  const chains = { "1:12": [12], "2:20": [20] };
  const windows = [win(12, "a"), win(20, "b", "Zoom Meeting")];
  const prev = { heldAt: { "1:12": 0, "2:20": 0 }, confirmed: { "1:12": { by: "fallback", at: 1000 }, "2:20": { by: "title", at: 2000 } }, bindings: { "1:12": "a", "2:20": "b" } };
  const chosen = run(prev, ss, windows, chains, 70000);
  assert.strictEqual(chosen.callApp, "Firefox");
  assert.strictEqual(chosen.callTitle, "Zoom Meeting");
  assert.strictEqual(chosen.fields.callBy, "title");
  const equal = run({ ...prev, confirmed: { "1:12": { by: "title", at: 1000 }, "2:20": { by: "title", at: 2000 } } }, ss, windows, chains, 70000);
  assert.strictEqual(equal.callApp, "Chrome");
});

test("window fields cover bound, shared, split, ambiguous, and unbound calls", () => {
  const a = { kind: "browser", binding: { stableId: "a", ambiguous: false }, window: win(12, "a", "Zoom Meeting", "chrome") };
  const b = { ...a, kind: "native" };
  const first = M.windowFields([a], {}, D);
  assert.strictEqual(first.callWindowState, "bound");
  assert.strictEqual(first.callWindowClass, "chrome");
  assert.strictEqual(first.callWindowShowing, true);
  assert.strictEqual(first.callWindowSeq, 1);
  assert.strictEqual(M.windowFields([a, b], first, D).callWindowState, "bound");
  assert.strictEqual(M.windowFields([a, { ...b, binding: { stableId: "b", ambiguous: false }, window: win(20, "b") }], first, D).callWindowState, "ambiguous");
  assert.strictEqual(M.windowFields([{ ...a, binding: { stableId: "", ambiguous: true } }], first, D).callWindowState, "ambiguous");
  const unbound = M.windowFields([{ ...a, binding: { stableId: "", ambiguous: false } }], first, D);
  assert.strictEqual(unbound.callWindowState, "none");
  assert.strictEqual(unbound.callWindowClass, "");
  assert.strictEqual(unbound.callWindowShowing, false);
  assert.strictEqual(unbound.callWindowSeq, 2);
  assert.strictEqual(M.windowFields([], unbound, D).callWindowSeq, 2);
  assert.strictEqual(M.windowFields([a, b], first, D).callWindowSeq, 1);
  assert.strictEqual(M.windowFields([{ ...a, window: win(12, "a") }], first, D).callWindowSeq, 2);
});

test("settings migrate only the exact old title default and validate webApps", () => {
  const old = "^Meet - [a-z]{3}-[a-z]{4}-[a-z]{3}\n\\| Microsoft Teams\n^Zoom( Meeting| Workplace)?\nJitsi Meet\nHuddle\nWebex\nMessenger call\nWhatsApp.*[Cc]all";
  assert.strictEqual(M.normalize({ meetingTitles: old }).meetingTitles, D.meetingTitles);
  assert.strictEqual(M.normalize({ meetingTitles: old + "\nCustom" }).meetingTitles, old + "\nCustom");
  assert.strictEqual(M.normalize({ webApps: "" }).webApps, "");
  assert.strictEqual(M.normalize({ webApps: "(" }).webApps, D.webApps);
});

test("unknown idle recorder does not need the timer", () => {
  assert.strictEqual(run({}, [stream(1, 12, "Recorder", "record")], [], {}, 0).timerNeeded, false);
});

console.log(`model: ${n} tests passed`);
