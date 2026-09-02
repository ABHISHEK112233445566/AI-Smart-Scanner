// ============================================================
// AI SMART SCANNER — GOOGLE APPS SCRIPT API V9
// CANONICAL GOOGLE SHEETS WEBHOOK
// ============================================================
var ALLOWED_SHEETS={SCANNER:true,Dashboard:true,ACCURACY:true,PARAMETER_MASTER:true,"Parameter List":true,EQUITY:true,CALL_OPTIONS:true,PUT_OPTIONS:true,SCANNER_STATUS:true};
var WIDE_SHEETS={SCANNER:true,ACCURACY:true};
var LOCK_WAIT_MS=90000;
var ACCURACY_HEADERS=["recordId","predictionTime","symbol","stockPrice","optionType","confidence","predictedDirection","predictedScore","predictedEntry","predictedStopLoss","predictedTarget1","predictedTarget2","predictedRiskReward","livePrice","oiMood","evaluationStatus","evaluationResult","target1Reached","stopLossReached","accuracyPercent"];

function doPost(e){
  if(!e||!e.postData||!e.postData.contents)return jsonResponse({success:false,error:"No POST data received"});
  var raw=String(e.postData.contents||"");if(!raw.trim())return jsonResponse({success:false,error:"POST body is empty"});
  var payload;try{payload=JSON.parse(raw);}catch(err){return jsonResponse({success:false,error:"Invalid JSON: "+err.message});}
  if(!payload||typeof payload!=="object")return jsonResponse({success:false,error:"Invalid payload"});
  var action=String(payload.action||"").trim();
  try{return withScriptLock(function(){
    if(action==="scanner_status"){var status=payload.scannerStatus||payload.status||payload, sr=updateScannerStatus(status);return jsonResponse({success:true,action,sheet:"SCANNER_STATUS",status:status.status||"UNKNOWN",lastScanTime:status.lastScanTime||"",lastScanTimeIST:status.lastScanTimeIST||"",source:status.lastScanSource||"",broker:status.broker||"",rowCount:sr.rowCount,timestamp:new Date().toISOString()});}
    if(action==="getAccuracyRows")return jsonResponse({success:true,action,sheet:"ACCURACY",rows:getAccuracyRows(Number(payload.limit)||100),timestamp:new Date().toISOString()});
    if(action==="updateAccuracy"){var ur=updateAccuracyRows(payload.updates||payload.rows||[]);return jsonResponse({success:true,action,sheet:"ACCURACY",updated:ur.updated,notFound:ur.notFound,timestamp:new Date().toISOString()});}
    if(action!=="replaceSheet"&&action!=="appendRows")return jsonResponse({success:false,error:"Unknown action: "+action});
    var sheetName=String(payload.sheet||"").trim();if(!sheetName)return jsonResponse({success:false,error:"Missing sheet name"});if(!ALLOWED_SHEETS[sheetName])return jsonResponse({success:false,error:"Sheet not allowed: "+sheetName});
    var headers=normalizeHeaders(payload.headers||[]),rows=Array.isArray(payload.rows)?payload.rows:[];if(!headers.length)return jsonResponse({success:false,error:"No headers supplied for sheet: "+sheetName});
    for(var h=0;h<headers.length;h++)if(!headers[h])return jsonResponse({success:false,error:"Headers cannot contain empty column names"});
    var result=action==="replaceSheet"?replaceSheet(sheetName,headers,rows):appendRows(sheetName,headers,rows);
    return jsonResponse({success:true,action,sheet:sheetName,rowCount:result.rowCount,columnCount:result.columnCount,timestamp:new Date().toISOString()});
  });}catch(err2){console.error(err2&&err2.stack?err2.stack:err2);return jsonResponse({success:false,action,error:err2&&err2.message?err2.message:String(err2),timestamp:new Date().toISOString()});}
}
function withScriptLock(callback){var lock=LockService.getScriptLock();try{lock.waitLock(LOCK_WAIT_MS);return callback();}finally{try{lock.releaseLock();}catch(_){}}}
function getSpreadsheet(){var spreadsheet=SpreadsheetApp.getActiveSpreadsheet();if(!spreadsheet)throw new Error("Unable to access active spreadsheet");return spreadsheet;}
function getOrCreateSheet(spreadsheet,sheetName){return spreadsheet.getSheetByName(sheetName)||spreadsheet.insertSheet(sheetName);}
function replaceSheet(sheetName,headers,rows){var sheet=getOrCreateSheet(getSpreadsheet(),sheetName);removeExistingFilter(sheet);sheet.clear();sheet.getRange(1,1,1,headers.length).setValues([headers]);if(rows.length){var output=[];for(var i=0;i<rows.length;i++)output.push(normalizeRow(rows[i],headers.length));sheet.getRange(2,1,output.length,headers.length).setValues(output);}lightFormat(sheet,rows.length+1,headers.length,sheetName);SpreadsheetApp.flush();return{rowCount:rows.length,columnCount:headers.length};}
function appendRows(sheetName,headers,rows){var sheet=getOrCreateSheet(getSpreadsheet(),sheetName);if(sheet.getLastRow()===0){sheet.getRange(1,1,1,headers.length).setValues([headers]);lightFormat(sheet,1,headers.length,sheetName);}else{var existingCount=sheet.getLastColumn(),existingHeaders=sheet.getRange(1,1,1,existingCount).getValues()[0];if(sheetName==="ACCURACY")return appendAccuracyRows(sheet,existingHeaders,headers,rows);if(existingCount!==headers.length)throw new Error("Header column mismatch for sheet '"+sheetName+"'. Existing: "+existingCount+", Incoming: "+headers.length);for(var h=0;h<headers.length;h++)if(String(existingHeaders[h]).trim()!==String(headers[h]).trim())throw new Error("Header mismatch at column "+(h+1)+" in sheet '"+sheetName+"'. Expected: '"+existingHeaders[h]+"', received: '"+headers[h]+"'");}if(!rows.length){SpreadsheetApp.flush();return{rowCount:0,columnCount:headers.length};}var output=[];for(var i=0;i<rows.length;i++)output.push(normalizeRow(rows[i],headers.length));sheet.getRange(sheet.getLastRow()+1,1,output.length,headers.length).setValues(output);SpreadsheetApp.flush();return{rowCount:output.length,columnCount:headers.length};}

// ACCURACY HISTORY POLICY:
// 1) Keep only records from yesterday onward (IST).
// 2) Incoming rows are already restricted by Node to Dashboard TOP 5.
// 3) Deduplicate by recordId.
// 4) Migrate old Accuracy sheets to the canonical 20-column schema.
function appendAccuracyRows(sheet,existingHeaders,incomingHeaders,rows){
  var tz="Asia/Kolkata";
  var todayKey=Utilities.formatDate(new Date(),tz,"yyyy-MM-dd");
  var today=new Date(todayKey+"T00:00:00+05:30");
  var cutoff=new Date(today.getTime()-24*60*60*1000);
  var cutoffKey=Utilities.formatDate(cutoff,tz,"yyyy-MM-dd");
  var incomingMap={};
  for(var i=0;i<incomingHeaders.length;i++){var k=String(incomingHeaders[i]).trim().toLowerCase();if(k)incomingMap[k]=i;}

  var lastRow=sheet.getLastRow(),lastColumn=sheet.getLastColumn();
  var existingData=lastRow>=2&&lastColumn>=1?sheet.getRange(2,1,lastRow-1,lastColumn).getValues():[];
  var oldMap={};
  for(var h=0;h<existingHeaders.length;h++){var oldKey=String(existingHeaders[h]).trim().toLowerCase();if(oldKey)oldMap[oldKey]=h;}
  var kept=[];
  var seen={};

  // Copy only the canonical fields from existing records dated yesterday onward.
  for(var r=0;r<existingData.length;r++){
    var oldRow=existingData[r];
    var dateValue=oldMap["predictiontime"]!==undefined?oldRow[oldMap["predictiontime"]]:oldMap["accuracypredictiontime"]!==undefined?oldRow[oldMap["accuracypredictiontime"]]:oldMap["timestamp"]!==undefined?oldRow[oldMap["timestamp"]]:"";
    var keyDate="";
    if(dateValue instanceof Date)keyDate=Utilities.formatDate(dateValue,tz,"yyyy-MM-dd");
    else if(dateValue){var parsed=new Date(String(dateValue));if(!isNaN(parsed.getTime()))keyDate=Utilities.formatDate(parsed,tz,"yyyy-MM-dd");else keyDate=String(dateValue).slice(0,10);}
    if(keyDate<cutoffKey)continue;
    var id=oldMap["recordid"]!==undefined?String(oldRow[oldMap["recordid"]]||"").trim():"";
    if(id&&seen[id])continue;
    var canonical=[];
    for(var c=0;c<ACCURACY_HEADERS.length;c++){var ck=ACCURACY_HEADERS[c].toLowerCase();canonical.push(oldMap[ck]!==undefined?normalizeCell(oldRow[oldMap[ck]]):"");}
    if(id)seen[id]=true;
    kept.push(canonical);
  }

  // Add incoming records, mapped strictly to canonical headers.
  for(var rr=0;rr<rows.length;rr++){
    var source=Array.isArray(rows[rr])?rows[rr]:[],target=[];
    for(var c2=0;c2<ACCURACY_HEADERS.length;c2++){var key=ACCURACY_HEADERS[c2].toLowerCase();target.push(incomingMap[key]!==undefined?normalizeCell(source[incomingMap[key]]):"");}
    var incomingId=String(target[0]||"").trim();
    if(incomingId&&seen[incomingId])continue;
    if(incomingId)seen[incomingId]=true;
    kept.push(target);
  }

  removeExistingFilter(sheet);
  sheet.clear();
  sheet.getRange(1,1,1,ACCURACY_HEADERS.length).setValues([ACCURACY_HEADERS]);
  if(kept.length)sheet.getRange(2,1,kept.length,ACCURACY_HEADERS.length).setValues(kept);
  lightFormat(sheet,kept.length+1,ACCURACY_HEADERS.length,"ACCURACY");
  SpreadsheetApp.flush();
  return{rowCount:rows.length,columnCount:ACCURACY_HEADERS.length,retainedRows:kept.length,cutoffDate:cutoffKey};
}

function getAccuracyRows(limit){var sheet=getOrCreateSheet(getSpreadsheet(),"ACCURACY"),lastRow=sheet.getLastRow(),lastColumn=sheet.getLastColumn();if(lastRow<2||lastColumn<1)return[];var headers=sheet.getRange(1,1,1,lastColumn).getValues()[0],data=sheet.getRange(2,1,lastRow-1,lastColumn).getValues(),count=Math.max(1,Math.min(Number(limit)||100,500)),start=Math.max(0,data.length-count),rows=[];for(var r=start;r<data.length;r++){var obj={};for(var c=0;c<headers.length;c++)obj[String(headers[c])]=data[r][c];rows.push(obj);}return rows;}

function updateAccuracyRows(updates){if(!Array.isArray(updates))throw new Error("updates must be an array");if(!updates.length)return{updated:0,notFound:0};var sheet=getOrCreateSheet(getSpreadsheet(),"ACCURACY"),lastRow=sheet.getLastRow(),lastColumn=sheet.getLastColumn();if(lastRow<2||lastColumn<1)return{updated:0,notFound:updates.length};var headers=sheet.getRange(1,1,1,lastColumn).getValues()[0],idColumn=findHeaderColumn(headers,"recordId");if(idColumn===-1)throw new Error("ACCURACY sheet does not contain recordId column");var data=sheet.getRange(2,1,lastRow-1,lastColumn).getValues(),rowMap={};for(var i=0;i<data.length;i++){var id=String(data[i][idColumn]||"").trim();if(id)rowMap[id]=i;}
  var fields=["evaluationStatus","evaluationResult","target1Reached","stopLossReached","accuracyPercent"];
  var updated=0,notFound=0;for(var u=0;u<updates.length;u++){var update=updates[u];if(!update||!update.recordId){notFound++;continue;}var id=String(update.recordId).trim();if(rowMap[id]===undefined){notFound++;continue;}var rowIndex=rowMap[id];for(var f=0;f<fields.length;f++){var field=fields[f];if(update[field]===undefined)continue;var col=findHeaderColumn(headers,field);if(col!==-1)data[rowIndex][col]=normalizeCell(update[field]);}updated++;}sheet.getRange(2,1,data.length,lastColumn).setValues(data);SpreadsheetApp.flush();return{updated,notFound};}
function updateScannerStatus(status){if(!status||typeof status!=="object")throw new Error("Invalid scanner status");var sheet=getOrCreateSheet(getSpreadsheet(),"SCANNER_STATUS"),headers=["Last Scan Time","Last Scan Time IST","Status","Source","Broker","Universe","Stocks Scanned","Successful Scans","Failed Scans","CALL Candidates","PUT Candidates","TRADE","WATCH","REJECT","Duration Seconds","Duration MS"],values=[normalizeCell(status.lastScanTime||""),normalizeCell(status.lastScanTimeIST||""),normalizeCell(status.status||""),normalizeCell(status.lastScanSource||""),normalizeCell(status.broker||""),normalizeCell(status.universe||""),normalizeNumber(status.stocksScanned),normalizeNumber(status.successfulScans),normalizeNumber(status.failedScans),normalizeNumber(status.callCandidates),normalizeNumber(status.putCandidates),normalizeNumber(status.tradeCount),normalizeNumber(status.watchCount),normalizeNumber(status.rejectCount),normalizeNumber(status.elapsedSeconds),normalizeNumber(status.durationMs)];removeExistingFilter(sheet);sheet.clear();sheet.getRange(1,1,2,headers.length).setValues([headers,values]);lightFormat(sheet,2,headers.length,"SCANNER_STATUS");try{sheet.getRange(2,3).setFontWeight("bold");}catch(_){}SpreadsheetApp.flush();return{rowCount:1,columnCount:headers.length};}
function lightFormat(sheet,rowCount,columnCount,sheetName){if(!columnCount)return;sheet.getRange(1,1,1,columnCount).setFontWeight("bold").setWrap(false);sheet.setFrozenRows(1);if(!WIDE_SHEETS[sheetName]&&rowCount>1)try{removeExistingFilter(sheet);sheet.getRange(1,1,rowCount,columnCount).createFilter();}catch(err){console.log("Filter creation skipped: "+err.message);}}
function removeExistingFilter(sheet){try{var filter=sheet.getFilter();if(filter)filter.remove();}catch(err){console.log("Filter removal skipped: "+err.message);}}
function findHeaderColumn(headers,name){var target=String(name).trim().toLowerCase();for(var i=0;i<headers.length;i++)if(String(headers[i]).trim().toLowerCase()===target)return i;return-1;}
function normalizeHeaders(headers){if(!Array.isArray(headers))return[];var output=[];for(var i=0;i<headers.length;i++)output.push(headers[i]===null||headers[i]===undefined?"":String(headers[i]).trim());return output;}
function normalizeRow(row,columnCount){if(!Array.isArray(row))row=[];var output=[];for(var i=0;i<columnCount;i++)output.push(i<row.length?normalizeCell(row[i]):"");return output;}
function normalizeCell(value){if(value===null||value===undefined)return"";if(Object.prototype.toString.call(value)==="[object Date]")return isNaN(value.getTime())?"":value;if(typeof value==="number")return isFinite(value)?value:"";if(typeof value==="boolean")return value;if(typeof value==="object")try{return JSON.stringify(value);}catch(_){return String(value);}return String(value);}
function normalizeNumber(value){var number=Number(value);return isFinite(number)?number:0;}
function jsonResponse(object){return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);}
function doGet(){return jsonResponse({success:true,service:"AI Smart Scanner Google Sheet API",version:"V9",status:"RUNNING",lockWaitMs:LOCK_WAIT_MS,accuracyHeaderCompatible:true,liveAccuracyReadUpdate:true,performanceMode:true,accuracyColumns:ACCURACY_HEADERS.length,supportedActions:["replaceSheet","appendRows","getAccuracyRows","updateAccuracy","scanner_status"],supportedSheets:Object.keys(ALLOWED_SHEETS),accuracyHistoryPolicy:"yesterday_onward_dashboard_only_deduplicated",timestamp:new Date().toISOString()});}
function startScannerFromSheet(){var token=PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");if(!token)throw new Error("GITHUB_TOKEN is not configured in Script Properties.");var owner="ABHISHEK112233445566",repo="AI-Smart-Scanner",workflow="scanner.yml",branch="master",url="https://api.github.com/repos/"+owner+"/"+repo+"/actions/workflows/"+workflow+"/dispatches",response=UrlFetchApp.fetch(url,{method:"post",headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},payload:JSON.stringify({ref:branch}),muteHttpExceptions:true}),code=response.getResponseCode(),body=response.getContentText();if(code!==204)throw new Error("GitHub workflow trigger failed. HTTP "+code+": "+body);return"Scanner started successfully.";}
