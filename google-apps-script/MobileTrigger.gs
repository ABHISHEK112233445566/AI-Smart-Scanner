// ============================================================
// AI SMART SCANNER — MOBILE SHEET TRIGGER
// ============================================================
// Mobile-safe trigger:
// 1. Create a sheet named MOBILE_CONTROL.
// 2. Put RUN SCANNER in A1 and a checkbox in B1.
// 3. Run setupMobileScannerTrigger() ONCE from Apps Script.
// 4. From phone, tick B1. GitHub Actions starts scanner.yml.
// 5. The checkbox is reset automatically after the trigger request.
// ============================================================

var MOBILE_CONTROL_SHEET = "MOBILE_CONTROL";
var MOBILE_RUN_CELL = "B1";

function setupMobileScannerTrigger() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MOBILE_CONTROL_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(MOBILE_CONTROL_SHEET);
  }

  sheet.getRange("A1").setValue("RUN SCANNER");
  sheet.getRange(MOBILE_RUN_CELL).insertCheckboxes();
  sheet.getRange("A2").setValue("Status");
  sheet.getRange("B2").setValue("READY");
  sheet.getRange("A3").setValue("Last Trigger");

  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "mobileScannerEditTrigger") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger("mobileScannerEditTrigger")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  ss.toast("Mobile scanner trigger is ready", "AI Smart Scanner", 5);
  return "Mobile scanner trigger installed successfully.";
}

function mobileScannerEditTrigger(e) {
  if (!e || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== MOBILE_CONTROL_SHEET) return;
  if (range.getA1Notation() !== MOBILE_RUN_CELL) return;

  var value = e.value;
  if (value !== "TRUE") return;

  var statusCell = sheet.getRange("B2");
  var timeCell = sheet.getRange("B3");

  try {
    statusCell.setValue("STARTING...");
    timeCell.setValue(new Date());
    SpreadsheetApp.flush();

    var result = startScannerFromSheet();

    statusCell.setValue("STARTED");
    timeCell.setValue(new Date());
    console.log(result);
  } catch (err) {
    statusCell.setValue("ERROR: " + (err.message || err));
    timeCell.setValue(new Date());
    console.error(err && err.stack ? err.stack : err);
  } finally {
    range.setValue(false);
    SpreadsheetApp.flush();
  }
}

function testMobileScannerTrigger() {
  return startScannerFromSheet();
}


// Starts the GitHub Actions scanner workflow. Configure Script Property
// GITHUB_TOKEN with a fine-grained token that has Actions: write permission.
function startScannerFromSheet() {
  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) throw new Error("Missing Script Property GITHUB_TOKEN. Add a GitHub token with Actions: write permission.");
  var url = "https://api.github.com/repos/ABHISHEK112233445566/AI-Smart-Scanner/actions/workflows/scanner.yml/dispatches";
  var response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    payload: JSON.stringify({ ref: "master" }),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  if (code !== 204) throw new Error("GitHub Actions dispatch failed (HTTP " + code + "): " + response.getContentText().slice(0, 300));
  return "GitHub Actions scanner workflow dispatched successfully.";
}
