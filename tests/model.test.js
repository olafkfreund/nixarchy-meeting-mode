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
  assert.strictEqual(v.callApps, M.DEFAULTS.callApps, "an invalid regex must not break detection");
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
    assert.ok(M.isCallStream(capture(app, bin), D.callApps), `${app}/${bin} should count as a call`);
});

test("non-call capture is ignored", () => {
  for (const [app, bin] of [["pw-record", ""], ["voxtype", "voxtype"], ["OBS", "obs"], ["audacity", ""], ["", ""]])
    assert.ok(!M.isCallStream(capture(app, bin), D.callApps), `${app}/${bin} must not start meeting mode`);
});

test("playback streams never count", () => {
  assert.ok(!M.isCallStream({ "media.class": "Stream/Output/Audio", "application.name": "Google Chrome" }, D.callApps));
  assert.ok(!M.isCallStream(null, D.callApps));
});

test("custom call apps", () => {
  const v = M.normalize({ callApps: "mumble|obs" });
  assert.ok(M.isCallStream(capture("Mumble", ""), v.callApps));
  assert.ok(!M.isCallStream(capture("Google Chrome", ""), v.callApps));
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
  const yes = ["Meet - abc-defg-hij - Google Chrome", "Standup | Microsoft Teams", "Zoom Meeting", "Zoom", "Zoom Workplace",
               "Jitsi Meet", "#team Huddle", "Webex", "Messenger call", "WhatsApp video call"];
  const no = ["Meet - Google Chrome", "Meet - abcd-efg-hij", "Microsoft Teams chat", "My Zoomer notes", "Hudd", "Webinar",
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
  assert.strictEqual(M.normalize({ callApps: M.DEFAULTS.callApps }).nativeApps, M.DEFAULTS.nativeApps);
  const own = M.normalize({ callApps: "mumble", nativeApps: "foo" });
  assert.strictEqual(own.nativeApps, "foo", "explicit lists win");
});

test("state file is never world-readable /tmp", () => {
  assert.strictEqual(M.statePath("/run/user/1000", "", "/home/u"), "/run/user/1000/meeting-mode.json");
  assert.strictEqual(M.statePath("", "", "/home/u"), "/home/u/.local/state/meeting-mode/state.json");
  assert.strictEqual(M.statePath(undefined, "/home/u/.state", "/home/u"), "/home/u/.state/meeting-mode/state.json");
  for (const p of [M.statePath("", "", "/home/u"), M.statePath(null, null, "/home/u")])
    assert.ok(!p.startsWith("/tmp"), p);
});

console.log(`model: ${n} tests passed`);
