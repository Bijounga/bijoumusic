// Regenerates TEST-CHECKLIST.md from app/js/testlist.js (the same list the app shows).
const fs = require("fs");
const path = require("path");
const list = require("../app/js/testlist.js");

const lines = [
  "# Thumb Lab: tester's checklist",
  "",
  "Tick items off as you try them. The same list is in the app under **Test checklist**, where ticks are remembered.",
  "",
];
let total = 0;
for (const g of list) {
  lines.push(`## ${g.name}`, "");
  for (const it of g.items) { lines.push(`- [ ] ${it.text}`); total++; }
  lines.push("");
}
lines.splice(3, 0, `${total} things to check.`, "");
fs.writeFileSync(path.join(__dirname, "..", "TEST-CHECKLIST.md"), lines.join("\n"));
console.log(`Wrote TEST-CHECKLIST.md (${total} items)`);
