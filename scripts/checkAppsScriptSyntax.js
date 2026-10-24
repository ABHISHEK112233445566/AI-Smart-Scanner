const fs = require("fs");
const vm = require("vm");
const files = [
  "google-apps-script/Code.gs",
  "google-apps-script/MobileTrigger.gs"
];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  new vm.Script(source, { filename: file });
  console.log("Syntax OK:", file);
}
