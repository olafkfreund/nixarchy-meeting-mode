// Run: node tests/qml-text.test.js
// Every Text item must render plain text: window titles, classes and
// workspace names are untrusted, and Qt's default AutoText would treat
// markup in them as rich text (and load <img> URLs).
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let failures = 0;
let checked = 0;

for (const file of fs.readdirSync(root).filter(f => f.endsWith(".qml"))) {
  const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
  lines.forEach((line, i) => {
    const open = line.match(/^(\s*)Text \{\s*$/);
    if (!open) return;
    checked++;
    // Scan this item's own lines (up to its closing brace at the same indent).
    let plain = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] === open[1] + "}") break;
      if (/^\s*textFormat:\s*Text\.PlainText\s*$/.test(lines[j])) plain = true;
    }
    if (!plain) {
      failures++;
      console.log(`FAIL: ${file}:${i + 1} Text without textFormat: Text.PlainText`);
    }
  });
}

// Window titles must never reach logs or notifications.
const svc = fs.readFileSync(path.join(root, "Service.qml"), "utf8").split("\n");
svc.forEach((line, i) => {
  if (/console\./.test(line) && /title/i.test(line)) { failures++; console.log(`FAIL: Service.qml:${i + 1} title in console`); }
  if (/notify-send|root\.notify\(/.test(line) && /[tT]itles?\b/.test(line.replace(/title, body/, ""))) { failures++; console.log(`FAIL: Service.qml:${i + 1} title in notification`); }
});

if (checked === 0) {
  console.log("FAIL: no Text items found");
  process.exit(1);
}
if (failures > 0) process.exit(1);
console.log(`ok (${checked} Text items are PlainText)`);
