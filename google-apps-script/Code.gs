// ============================================================
// AI SMART SCANNER — GOOGLE APPS SCRIPT API V8
// CANONICAL GOOGLE SHEETS WEBHOOK
// ============================================================
// FIXES
// 1. Lock wait increased to 90 seconds.
// 2. Lock is released reliably after every request.
// 3. ACCURACY accepts different incoming column counts by matching
//    fields by header name; existing historical columns are preserved.
// 4. Empty Dashboard/SCANNER writes the header even when rows = 0.
// 5. Wide SCANNER/ACCURACY sheets skip expensive filters/autoresize.
// 6. SCANNER_STATUS uses the same safe lock path.
// 7. Existing sheet names/actions remain compatible.
// ============================================================

var ALLOWED_SHEETS = {
  "SCANNER": true,
  "Dashboard": true,
  "ACCURACY": true,
  "PARAMETER_MASTER": true,
  "Parameter List": true,
  "EQUITY": true,
  "CALL_OPTIONS": true,
  "PUT_OPTIONS": true,
  "SCANNER_STATUS": true
};

var WIDE_SHEETS = {
  "SCANNER": true,
  "ACCURACY": true
};

var LOCK_WAIT_MS = 90000;

// ============================================================
// MAIN POST HANDLER
// ============================================================
function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return jsonResponse({ success: false, error: "No POST data received" });
  }

  var raw = String(e.postData.contents || "");
  if (!raw.trim()) {
    return jsonResponse({ success: false, error: "POST body is empty" });
  }

  var payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    return jsonResponse({ success: false, error: "Invalid JSON: " + err.message });
  }

  if (!payload || typeof payload !== "object") {
    return jsonResponse({ success: false, error: "Invalid payload" });
  }

  var action = String(payload.action || "").trim();

  try {
    return withScriptLock(function () {
      // --------------------------------------------------------
      // SCANNER STATUS
      // --------------------------------------------------------
      if (action === "scanner_status") {
        var status = payload.scannerStatus || payload.status || payload;
        var statusResult = updateScannerStatus(status);
        return jsonResponse({
          success: true,
          action: "scanner_status",
          sheet: "SCANNER_STATUS",
          status: status.status || "UNKNOWN",
          lastScanTime: status.lastScanTime || "",
          lastScanTimeIST: status.lastScanTimeIST || "",
          source: status.lastScanSource || "",
          broker: status.broker || "",
          rowCount: statusResult.rowCount,
          timestamp: new Date().toISOString()
        });
      }

      // --------------------------------------------------------
      // ACCURACY UPDATE
      // --------------------------------------------------------
      if (action === "updateAccuracy") {
        var updateResult = updateAccuracyRows(payload.updates || payload.rows || []);
        return jsonResponse({
          success: true,
          action: "updateAccuracy",
          sheet: "ACCURACY",
          updated: updateResult.updated,
          notFound: updateResult.notFound,
          timestamp: new Date().toISOString()
        });
      }

      // --------------------------------------------------------
      // NORMAL SHEET ACTIONS
      // --------------------------------------------------------
      if (action !== "replaceSheet" && action !== "appendRows") {
        return jsonResponse({ success: false, error: "Unknown action: " + action });
      }

      var sheetName = String(payload.sheet || "").trim();
      if (!sheetName) {
        return jsonResponse({ success: false, error: "Missing sheet name" });
      }

      if (!ALLOWED_SHEETS[sheetName]) {
        return jsonResponse({ success: false, error: "Sheet not allowed: " + sheetName });
      }

      var headers = normalizeHeaders(payload.headers || []);
      var rows = Array.isArray(payload.rows) ? payload.rows : [];

      if (!headers.length) {
        return jsonResponse({
          success: false,
          error: "No headers supplied for sheet: " + sheetName
        });
      }

      for (var h = 0; h < headers.length; h++) {
        if (!headers[h]) {
          return jsonResponse({
            success: false,
            error: "Headers cannot contain empty column names"
          });
        }
      }

      var result = action === "replaceSheet"
        ? replaceSheet(sheetName, headers, rows)
        : appendRows(sheetName, headers, rows);

      return jsonResponse({
        success: true,
        action: action,
        sheet: sheetName,
        rowCount: result.rowCount,
        columnCount: result.columnCount,
        timestamp: new Date().toISOString()
      });
    });
  } catch (err2) {
    console.error(err2 && err2.stack ? err2.stack : err2);
    return jsonResponse({
      success: false,
      action: action,
      error: err2 && err2.message ? err2.message : String(err2),
      timestamp: new Date().toISOString()
    });
  }
}

// ============================================================
// SAFE SCRIPT LOCK
// ============================================================
function withScriptLock(callback) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_WAIT_MS);
    return callback();
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// ============================================================
// SPREADSHEET HELPERS
// ============================================================
function getSpreadsheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Unable to access active spreadsheet");
  return spreadsheet;
}

function getOrCreateSheet(spreadsheet, sheetName) {
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

// ============================================================
// REPLACE SHEET
// ============================================================
function replaceSheet(sheetName, headers, rows) {
  var sheet = getOrCreateSheet(getSpreadsheet(), sheetName);

  removeExistingFilter(sheet);
  sheet.clear();

  // Always write the header, including when rows.length === 0.
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (rows.length > 0) {
    var output = [];
    for (var i = 0; i < rows.length; i++) {
      output.push(normalizeRow(rows[i], headers.length));
    }
    sheet.getRange(2, 1, output.length, headers.length).setValues(output);
  }

  lightFormat(sheet, rows.length + 1, headers.length, sheetName);
  SpreadsheetApp.flush();

  return {
    rowCount: rows.length,
    columnCount: headers.length
  };
}

// ============================================================
// APPEND ROWS
// ============================================================
function appendRows(sheetName, headers, rows) {
  var sheet = getOrCreateSheet(getSpreadsheet(), sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    lightFormat(sheet, 1, headers.length, sheetName);
  } else {
    var existingCount = sheet.getLastColumn();
    var existingHeaders = sheet.getRange(1, 1, 1, existingCount).getValues()[0];

    // ACCURACY is historical and schema-compatible by header name.
    if (sheetName === "ACCURACY") {
      return appendAccuracyRows(sheet, existingHeaders, headers, rows);
    }

    if (existingCount !== headers.length) {
      throw new Error(
        "Header column mismatch for sheet '" + sheetName +
        "'. Existing: " + existingCount + ", Incoming: " + headers.length
      );
    }

    for (var h = 0; h < headers.length; h++) {
      if (String(existingHeaders[h]).trim() !== String(headers[h]).trim()) {
        throw new Error(
          "Header mismatch at column " + (h + 1) +
          " in sheet '" + sheetName + "'. Expected: '" +
          existingHeaders[h] + "', received: '" + headers[h] + "'"
        );
      }
    }
  }

  if (!rows.length) {
    SpreadsheetApp.flush();
    return { rowCount: 0, columnCount: headers.length };
  }

  var output = [];
  for (var i = 0; i < rows.length; i++) {
    output.push(normalizeRow(rows[i], headers.length));
  }

  sheet.getRange(sheet.getLastRow() + 1, 1, output.length, headers.length).setValues(output);
  SpreadsheetApp.flush();

  return {
    rowCount: output.length,
    columnCount: headers.length
  };
}

// ============================================================
// ACCURACY COMPATIBLE APPEND
// ============================================================
function appendAccuracyRows(sheet, existingHeaders, incomingHeaders, rows) {
  if (!rows.length) {
    return {
      rowCount: 0,
      columnCount: existingHeaders.length
    };
  }

  var incomingMap = {};
  for (var i = 0; i < incomingHeaders.length; i++) {
    var incomingKey = String(incomingHeaders[i]).trim().toLowerCase();
    if (incomingKey) incomingMap[incomingKey] = i;
  }

  var output = [];

  for (var r = 0; r < rows.length; r++) {
    var source = Array.isArray(rows[r]) ? rows[r] : [];
    var target = [];

    for (var c = 0; c < existingHeaders.length; c++) {
      var key = String(existingHeaders[c]).trim().toLowerCase();

      if (key && incomingMap[key] !== undefined) {
        target.push(normalizeCell(source[incomingMap[key]]));
      } else {
        target.push("");
      }
    }

    output.push(target);
  }

  sheet
    .getRange(sheet.getLastRow() + 1, 1, output.length, existingHeaders.length)
    .setValues(output);

  SpreadsheetApp.flush();

  return {
    rowCount: output.length,
    columnCount: existingHeaders.length
  };
}

// ============================================================
// ACCURACY UPDATE
// ============================================================
function updateAccuracyRows(updates) {
  if (!Array.isArray(updates)) throw new Error("updates must be an array");
  if (!updates.length) return { updated: 0, notFound: 0 };

  var sheet = getOrCreateSheet(getSpreadsheet(), "ACCURACY");
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) {
    return { updated: 0, notFound: updates.length };
  }

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var predictionIdColumn = findHeaderColumn(headers, "predictionId");

  if (predictionIdColumn === -1) {
    throw new Error("ACCURACY sheet does not contain predictionId column");
  }

  var data = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  var rowMap = {};

  for (var i = 0; i < data.length; i++) {
    var id = String(data[i][predictionIdColumn] || "").trim();
    if (id) rowMap[id] = i;
  }

  var fields = [
    "actualHigh", "actualLow",
    "maxFavorableMove", "maxAdverseMove",
    "maxFavorablePercent", "maxAdversePercent",
    "target1Reached", "target2Reached", "stopLossReached",
    "target1Time", "target2Time", "stopLossTime",
    "finalOutcome", "completedTime"
  ];

  var updated = 0;
  var notFound = 0;

  for (var u = 0; u < updates.length; u++) {
    var update = updates[u];
    if (!update || !update.predictionId) {
      notFound++;
      continue;
    }

    var predictionId = String(update.predictionId).trim();
    if (rowMap[predictionId] === undefined) {
      notFound++;
      continue;
    }

    var rowIndex = rowMap[predictionId];

    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      if (update[field] === undefined) continue;

      var column = findHeaderColumn(headers, field);
      if (column !== -1) {
        data[rowIndex][column] = normalizeCell(update[field]);
      }
    }

    updated++;
  }

  sheet.getRange(2, 1, data.length, lastColumn).setValues(data);
  SpreadsheetApp.flush();

  return {
    updated: updated,
    notFound: notFound
  };
}

// ============================================================
// SCANNER STATUS
// ============================================================
function updateScannerStatus(status) {
  if (!status || typeof status !== "object") {
    throw new Error("Invalid scanner status");
  }

  var sheet = getOrCreateSheet(getSpreadsheet(), "SCANNER_STATUS");

  var headers = [
    "Last Scan Time",
    "Last Scan Time IST",
    "Status",
    "Source",
    "Broker",
    "Universe",
    "Stocks Scanned",
    "Successful Scans",
    "Failed Scans",
    "CALL Candidates",
    "PUT Candidates",
    "TRADE",
    "WATCH",
    "REJECT",
    "Duration Seconds",
    "Duration MS"
  ];

  var values = [
    normalizeCell(status.lastScanTime || ""),
    normalizeCell(status.lastScanTimeIST || ""),
    normalizeCell(status.status || ""),
    normalizeCell(status.lastScanSource || ""),
    normalizeCell(status.broker || ""),
    normalizeCell(status.universe || ""),
    normalizeNumber(status.stocksScanned),
    normalizeNumber(status.successfulScans),
    normalizeNumber(status.failedScans),
    normalizeNumber(status.callCandidates),
    normalizeNumber(status.putCandidates),
    normalizeNumber(status.tradeCount),
    normalizeNumber(status.watchCount),
    normalizeNumber(status.rejectCount),
    normalizeNumber(status.elapsedSeconds),
    normalizeNumber(status.durationMs)
  ];

  removeExistingFilter(sheet);
  sheet.clear();
  sheet.getRange(1, 1, 2, headers.length).setValues([headers, values]);
  lightFormat(sheet, 2, headers.length, "SCANNER_STATUS");

  try {
    sheet.getRange(2, 3).setFontWeight("bold");
  } catch (_) {}

  SpreadsheetApp.flush();

  return {
    rowCount: 1,
    columnCount: headers.length
  };
}

// ============================================================
// LIGHT FORMAT — PERFORMANCE SAFE
// ============================================================
function lightFormat(sheet, rowCount, columnCount, sheetName) {
  if (!columnCount) return;

  sheet
    .getRange(1, 1, 1, columnCount)
    .setFontWeight("bold")
    .setWrap(false);

  sheet.setFrozenRows(1);

  // Do not create filters on very wide sheets.
  if (!WIDE_SHEETS[sheetName] && rowCount > 1) {
    try {
      removeExistingFilter(sheet);
      sheet.getRange(1, 1, rowCount, columnCount).createFilter();
    } catch (err) {
      console.log("Filter creation skipped: " + err.message);
    }
  }
}

function removeExistingFilter(sheet) {
  try {
    var filter = sheet.getFilter();
    if (filter) filter.remove();
  } catch (err) {
    console.log("Filter removal skipped: " + err.message);
  }
}

// ============================================================
// HELPERS
// ============================================================
function findHeaderColumn(headers, name) {
  var target = String(name).trim().toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === target) return i;
  }
  return -1;
}

function normalizeHeaders(headers) {
  if (!Array.isArray(headers)) return [];
  var output = [];
  for (var i = 0; i < headers.length; i++) {
    output.push(
      headers[i] === null || headers[i] === undefined
        ? ""
        : String(headers[i]).trim()
    );
  }
  return output;
}

function normalizeRow(row, columnCount) {
  if (!Array.isArray(row)) row = [];
  var output = [];
  for (var i = 0; i < columnCount; i++) {
    output.push(i < row.length ? normalizeCell(row[i]) : "");
  }
  return output;
}

function normalizeCell(value) {
  if (value === null || value === undefined) return "";

  if (Object.prototype.toString.call(value) === "[object Date]") {
    return isNaN(value.getTime()) ? "" : value;
  }

  if (typeof value === "number") {
    return isFinite(value) ? value : "";
  }

  if (typeof value === "boolean") return value;

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  return String(value);
}

function normalizeNumber(value) {
  var number = Number(value);
  return isFinite(number) ? number : 0;
}

function jsonResponse(object) {
  return ContentService
    .createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// GET TEST
// ============================================================
function doGet() {
  return jsonResponse({
    success: true,
    service: "AI Smart Scanner Google Sheet API",
    version: "V8",
    status: "RUNNING",
    lockWaitMs: LOCK_WAIT_MS,
    accuracyHeaderCompatible: true,
    performanceMode: true,
    supportedActions: [
      "replaceSheet",
      "appendRows",
      "updateAccuracy",
      "scanner_status"
    ],
    supportedSheets: Object.keys(ALLOWED_SHEETS),
    timestamp: new Date().toISOString()
  });
}

// ============================================================
// MANUAL GITHUB SCANNER TRIGGER
// ============================================================
function startScannerFromSheet() {
  var token = PropertiesService
    .getScriptProperties()
    .getProperty("GITHUB_TOKEN");

  if (!token) {
    throw new Error("GITHUB_TOKEN is not configured in Script Properties.");
  }

  var owner = "ABHISHEK112233445566";
  var repo = "AI-Smart-Scanner";
  var workflow = "scanner.yml";
  var branch = "master";

  var url =
    "https://api.github.com/repos/" +
    owner + "/" + repo +
    "/actions/workflows/" + workflow + "/dispatches";

  var response = UrlFetchApp.fetch(url, {
    method: "post",
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    payload: JSON.stringify({ ref: branch }),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code !== 204) {
    throw new Error(
      "GitHub workflow trigger failed. HTTP " + code + ": " + body
    );
  }

  return "Scanner started successfully.";
}
