// ============================================================
// AI SMART SCANNER — GOOGLE APPS SCRIPT API V12
// ============================================================
var ALLOWED_SHEETS={SCANNER:true,Dashboard:true,ACCURACY:true,PARAMETER_MASTER:true,"Parameter List":true,EQUITY:true,CALL_OPTIONS:true,PUT_OPTIONS:true,SCANNER_STATUS:true};
var WIDE_SHEETS={SCANNER:true,ACCURACY:true};
var LOCK_WAIT_MS=90000;
var ACCURACY_HEADERS=["recordId","predictionTime","symbol","stockPrice","optionType","confidence","predictedEntry","target","stopLoss","currentPrice","targetSLReached","slReason","resultTime","resultPrice","accuracyPercent"];
var ACCURACY_HEADER_ROW=5;
var ACCURACY_DATA_START_ROW=6;
var IST_TZ="Asia/Kolkata";

function doPost(e){
  if(!e||!e.postData||!e.postData.contents)return jsonResponse({success:false,error:"No POST data received"});
  var raw=String(e.postData.contents||"");if(!raw.trim())return jsonResponse({success:false,error:"POST body is empty"});
  var payload;try{payload=JSON.parse(raw);}catch(err){return jsonResponse({success:false,error:"Invalid JSON: "+err.message});}
  if(!payload||typeof payload!=="object")return jsonResponse({success:false,error:"Invalid payload"});
  var action=String(payload.action||"").trim();
  try{return withScriptLock(function(){
    if(action==="scanner_status"){var status=payload.scannerStatus||payload.status||{},sr=updateScannerStatus(status);return jsonResponse({success:true,action,sheet:"SCANNER_STATUS",status:status.status||"UNKNOWN",lastScanTime:status.lastScanTime||"",lastScanTimeIST:status.lastScanTimeIST||"",source:status.lastScanSource||"",broker:status.broker||"",rowCount:sr.rowCount,timestamp:new Date().toISOString()});}
    if(action==="getAccuracyRows")return jsonResponse({success:true,action,sheet:"ACCURACY",rows:getAccuracyRows(Number(payload.limit)||100),timestamp:new Date().toISOString()});
    if(action==="normalizeAccuracyTimes"){var nr=normalizeAccuracyTimes();return jsonResponse({success:true,action,sheet:"ACCURACY",updated:nr.updated,timestamp:new Date().toISOString()});}
    if(action==="updateAccuracy"){var ur=updateAccuracyRows(payload.updates||payload.rows||[]);return jsonResponse({success:true,action,sheet:"ACCURACY",updated:ur.updated,notFound:ur.notFound,timestamp:new Date().toISOString()});}
    if(action!=="replaceSheet"&&action!=="appendRows")return jsonResponse({success:false,error:"Unknown action: "+action});
    var sheetName=String(payload.sheet||"").trim();if(!sheetName)return jsonResponse({success:false,error:"Missing sheet name"});
    if(!ALLOWED_SHEETS[sheetName])return jsonResponse({success:false,error:"Sheet not allowed: "+sheetName});
    var headers=normalizeHeaders(payload.headers||[]),rows=Array.isArray(payload.rows)?payload.rows:[];
    if(!headers.length)return jsonResponse({success:false,error:"No headers supplied for sheet: "+sheetName});
    for(var h=0;h<headers.length;h++)if(!headers[h])return jsonResponse({success:false,error:"Headers cannot contain empty column names"});
    var result=action==="replaceSheet"?replaceSheet(sheetName,headers,rows):appendRows(sheetName,headers,rows);
    return jsonResponse({success:true,action,sheet:sheetName,rowCount:result.rowCount,columnCount:result.columnCount,timestamp:new Date().toISOString()});
  });}catch(err2){console.error(err2&&err2.stack?err2.stack:err2);return jsonResponse({success:false,action,error:err2&&err2.message?err2.message:String(err2),timestamp:new Date().toISOString()});}
}

function withScriptLock(callback){var lock=LockService.getScriptLock();try{lock.waitLock(LOCK_WAIT_MS);return callback();}finally{try{lock.releaseLock();}catch(_){}}}
function getSpreadsheet(){var spreadsheet=SpreadsheetApp.getActiveSpreadsheet();if(!spreadsheet)throw new Error("Unable to access active spreadsheet");return spreadsheet;}
function getOrCreateSheet(spreadsheet,sheetName){return spreadsheet.getSheetByName(sheetName)||spreadsheet.insertSheet(sheetName);}

function replaceSheet(sheetName,headers,rows){
  var sheet=getOrCreateSheet(getSpreadsheet(),sheetName);removeExistingFilter(sheet);sheet.clear();
  if(sheetName==="ACCURACY")return replaceAccuracySheet(sheet,rows);
  sheet.getRange(1,1,1,headers.length).setValues([headers]);
  if(rows.length){var output=[];for(var i=0;i<rows.length;i++)output.push(normalizeRow(rows[i],headers.length));sheet.getRange(2,1,output.length,headers.length).setValues(output);}
  lightFormat(sheet,rows.length+1,headers.length,sheetName);SpreadsheetApp.flush();return{rowCount:rows.length,columnCount:headers.length};
}

function replaceAccuracySheet(sheet,rows){
  sheet.clear();writeAccuracyLayout(sheet,[]);var output=[];
  for(var i=0;i<rows.length;i++)output.push(normalizeAccuracyRow(rows[i]));
  if(output.length)sheet.getRange(ACCURACY_DATA_START_ROW,1,output.length,ACCURACY_HEADERS.length).setValues(output);
  formatAccuracySheet(sheet);refreshAccuracySummary(sheet);SpreadsheetApp.flush();return{rowCount:output.length,columnCount:ACCURACY_HEADERS.length};
}

function appendRows(sheetName,headers,rows){
  var sheet=getOrCreateSheet(getSpreadsheet(),sheetName);
  if(sheetName==="ACCURACY")return appendAccuracyRows(sheet,headers,rows);
  if(sheet.getLastRow()===0){sheet.getRange(1,1,1,headers.length).setValues([headers]);lightFormat(sheet,1,headers.length,sheetName);}
  else{var existingCount=sheet.getLastColumn(),existingHeaders=sheet.getRange(1,1,1,existingCount).getValues()[0];if(existingCount!==headers.length)throw new Error("Header column mismatch for sheet '"+sheetName+"'");for(var h=0;h<headers.length;h++)if(String(existingHeaders[h]).trim()!==String(headers[h]).trim())throw new Error("Header mismatch at column "+(h+1)+" in sheet '"+sheetName+"'");}
  if(!rows.length){SpreadsheetApp.flush();return{rowCount:0,columnCount:headers.length};}
  var output=[];for(var i=0;i<rows.length;i++)output.push(normalizeRow(rows[i],headers.length));sheet.getRange(sheet.getLastRow()+1,1,output.length,headers.length).setValues(output);SpreadsheetApp.flush();return{rowCount:rows.length,columnCount:headers.length};
}

function appendAccuracyRows(sheet,incomingHeaders,rows){
  var tz=IST_TZ,todayKey=Utilities.formatDate(new Date(),tz,"yyyy-MM-dd"),today=new Date(todayKey+"T00:00:00+05:30"),cutoff=new Date(today.getTime()-24*60*60*1000),cutoffKey=Utilities.formatDate(cutoff,tz,"yyyy-MM-dd");
  var incomingMap={};for(var i=0;i<incomingHeaders.length;i++){var k=String(incomingHeaders[i]).trim().toLowerCase();if(k)incomingMap[k]=i;}
  var lastRow=sheet.getLastRow(),existingData=lastRow>=ACCURACY_DATA_START_ROW?sheet.getRange(ACCURACY_DATA_START_ROW,1,lastRow-ACCURACY_DATA_START_ROW+1,ACCURACY_HEADERS.length).getValues():[],kept=[],seen={};
  for(var r=0;r<existingData.length;r++){
    var old=existingData[r],dateValue=old[1],keyDate="";
    if(dateValue instanceof Date)keyDate=Utilities.formatDate(dateValue,tz,"yyyy-MM-dd");else if(dateValue){var parsed=new Date(String(dateValue));if(!isNaN(parsed.getTime()))keyDate=Utilities.formatDate(parsed,tz,"yyyy-MM-dd");else keyDate=String(dateValue).slice(0,10);}
    if(keyDate&&keyDate<cutoffKey)continue;var id=String(old[0]||"").trim();if(id&&seen[id])continue;if(id)seen[id]=true;kept.push(normalizeAccuracyRow(old));
  }
  for(var rr=0;rr<rows.length;rr++){var source=Array.isArray(rows[rr])?rows[rr]:[],target=[];for(var c=0;c<ACCURACY_HEADERS.length;c++){var key=ACCURACY_HEADERS[c].toLowerCase();target.push(incomingMap[key]!==undefined?normalizeCell(source[incomingMap[key]]):"");}if(!target[10])target[10]="PENDING";var incomingId=String(target[0]||"").trim();if(incomingId&&seen[incomingId])continue;if(incomingId)seen[incomingId]=true;kept.push(target);}
  removeExistingFilter(sheet);sheet.clear();writeAccuracyLayout(sheet,kept);formatAccuracySheet(sheet);refreshAccuracySummary(sheet);SpreadsheetApp.flush();return{rowCount:rows.length,columnCount:ACCURACY_HEADERS.length,retainedRows:kept.length,cutoffDate:cutoffKey};
}

function normalizeAccuracyRow(row){var output=[];for(var i=0;i<ACCURACY_HEADERS.length;i++)output.push(normalizeCell(Array.isArray(row)?row[i]:""));if(!output[10])output[10]="PENDING";return output;}
function writeAccuracyLayout(sheet,data){
  sheet.getRange(1,1,1,5).setValues([["Period","Predictions","Target Hit","SL Hit","Accuracy %"]]);
  sheet.getRange(2,1,2,5).setValues([["This Week",0,0,0,0],["This Month",0,0,0,0]]);
  sheet.getRange(ACCURACY_HEADER_ROW,1,1,ACCURACY_HEADERS.length).setValues([ACCURACY_HEADERS]);
  if(data&&data.length)sheet.getRange(ACCURACY_DATA_START_ROW,1,data.length,ACCURACY_HEADERS.length).setValues(data);
}
function refreshAccuracySummary(sheet){
  var lastRow=sheet.getLastRow(),rows=lastRow>=ACCURACY_DATA_START_ROW?sheet.getRange(ACCURACY_DATA_START_ROW,1,lastRow-ACCURACY_DATA_START_ROW+1,ACCURACY_HEADERS.length).getValues():[],now=new Date(),tz=IST_TZ,weekStart=istanbulWeekStart(now),monthStart=istanbulMonthStart(now),week=countAccuracyPeriod(rows,weekStart,now,tz),month=countAccuracyPeriod(rows,monthStart,now,tz);
  sheet.getRange(1,1,3,5).setValues([["Period","Predictions","Target Hit","SL Hit","Accuracy %"],["This Week",week.predictions,week.target,week.sl,week.accuracy],["This Month",month.predictions,month.target,month.sl,month.accuracy]]);
  sheet.getRange(2,5,2,1).setNumberFormat("0.00\%" );
}
function istanbulWeekStart(now){var tz=IST_TZ,s=Utilities.formatDate(now,tz,"yyyy-MM-dd"),d=new Date(s+"T00:00:00+05:30"),day=d.getDay(),diff=day===0?6:day-1;return new Date(d.getTime()-diff*86400000);}
function istanbulMonthStart(now){var tz=IST_TZ,s=Utilities.formatDate(now,tz,"yyyy-MM" );return new Date(s+"-01T00:00:00+05:30");}
function countAccuracyPeriod(rows,start,end,tz){var predictions=0,target=0,sl=0;for(var i=0;i<rows.length;i++){var t=parseDateValue(rows[i][1]);if(!t||t<start||t>end)continue;predictions++;var result=String(rows[i][10]||"").trim().toUpperCase();if(result==="TARGET")target++;else if(result==="SL")sl++;}var accuracy=target+sl>0?target/(target+sl):0;return{predictions:predictions,target:target,sl:sl,accuracy:accuracy};}
function parseDateValue(value){if(value instanceof Date)return value;if(!value)return null;var d=new Date(String(value));return isNaN(d.getTime())?null:d;}
function formatIST(value){var d=value instanceof Date?new Date(value.getTime()):new Date(value);if(isNaN(d.getTime()))return String(value||"");return Utilities.formatDate(d,IST_TZ,"yyyy-MM-dd HH:mm:ss");}
function normalizeAccuracyTimes(){var sheet=getOrCreateSheet(getSpreadsheet(),"ACCURACY"),lastRow=sheet.getLastRow();if(lastRow<ACCURACY_DATA_START_ROW)return{updated:0};var range=sheet.getRange(ACCURACY_DATA_START_ROW,1,lastRow-ACCURACY_DATA_START_ROW+1,ACCURACY_HEADERS.length),data=range.getValues(),updated=0;for(var i=0;i<data.length;i++){if(data[i][1]){var p=parseDateValue(data[i][1]);if(p){var s=formatIST(p);if(String(data[i][1])!==s){data[i][1]=s;updated++;}}}if(data[i][12]){var r=parseDateValue(data[i][12]);if(r)data[i][12]=formatIST(r);}}if(updated||data.length)range.setValues(data);sheet.getRange(ACCURACY_DATA_START_ROW,2,Math.max(1,data.length),1).setNumberFormat("yyyy-mm-dd hh:mm:ss");sheet.getRange(ACCURACY_DATA_START_ROW,13,Math.max(1,data.length),1).setNumberFormat("yyyy-mm-dd hh:mm:ss");SpreadsheetApp.flush();return{updated:updated};}

function getAccuracyRows(limit){var sheet=getOrCreateSheet(getSpreadsheet(),"ACCURACY"),lastRow=sheet.getLastRow();if(lastRow<ACCURACY_DATA_START_ROW)return[];var data=sheet.getRange(ACCURACY_DATA_START_ROW,1,lastRow-ACCURACY_DATA_START_ROW+1,ACCURACY_HEADERS.length).getValues(),count=Math.max(1,Math.min(Number(limit)||100,500)),start=Math.max(0,data.length-count),rows=[];for(var r=start;r<data.length;r++){var obj={};for(var c=0;c<ACCURACY_HEADERS.length;c++)obj[ACCURACY_HEADERS[c]]=data[r][c];if(obj.predictionTime)obj.predictionTime=formatIST(obj.predictionTime);if(obj.resultTime)obj.resultTime=formatIST(obj.resultTime);rows.push(obj);}return rows;}

function updateAccuracyRows(updates){
  if(!Array.isArray(updates))throw new Error("updates must be an array");if(!updates.length)return{updated:0,notFound:0};
  var sheet=getOrCreateSheet(getSpreadsheet(),"ACCURACY"),lastRow=sheet.getLastRow();if(lastRow<ACCURACY_DATA_START_ROW)return{updated:0,notFound:updates.length};
  var data=sheet.getRange(ACCURACY_DATA_START_ROW,1,lastRow-ACCURACY_DATA_START_ROW+1,ACCURACY_HEADERS.length).getValues(),rowMap={};for(var i=0;i<data.length;i++){var id=String(data[i][0]||"").trim();if(id)rowMap[id]=i;}
  var updated=0,notFound=0;for(var u=0;u<updates.length;u++){var update=updates[u];if(!update||!update.recordId){notFound++;continue;}var id=String(update.recordId).trim();if(rowMap[id]===undefined){notFound++;continue;}var rowIndex=rowMap[id];if(update.currentPrice!==undefined)data[rowIndex][9]=normalizeCell(update.currentPrice);if(update.targetSLReached!==undefined)data[rowIndex][10]=normalizeCell(update.targetSLReached);if(update.slReason!==undefined)data[rowIndex][11]=normalizeCell(update.slReason);if(update.resultTime!==undefined)data[rowIndex][12]=normalizeCell(update.resultTime);if(update.resultPrice!==undefined)data[rowIndex][13]=normalizeCell(update.resultPrice);if(update.accuracyPercent!==undefined)data[rowIndex][14]=normalizeCell(update.accuracyPercent);if(update.predictionTime!==undefined){var pt=parseDateValue(update.predictionTime);data[rowIndex][1]=pt?formatIST(pt):normalizeCell(update.predictionTime);}updated++;}
  sheet.getRange(ACCURACY_DATA_START_ROW,1,data.length,ACCURACY_HEADERS.length).setValues(data);formatAccuracySheet(sheet);refreshAccuracySummary(sheet);SpreadsheetApp.flush();return{updated:updated,notFound:notFound};
}

function updateScannerStatus(status){var sheet=getOrCreateSheet(getSpreadsheet(),"SCANNER_STATUS"),headers=["Last Scan Time","Last Scan Time IST","Status","Source","Broker","Universe","Stocks Scanned","Successful Scans","Failed Scans","CALL Candidates","PUT Candidates","TRADE","WATCH","REJECT","Duration Seconds","Duration MS"],values=[normalizeCell(status.lastScanTime||""),normalizeCell(status.lastScanTimeIST||""),normalizeCell(status.status||""),normalizeCell(status.lastScanSource||""),normalizeCell(status.broker||""),normalizeCell(status.universe||""),normalizeNumber(status.stocksScanned),normalizeNumber(status.successfulScans),normalizeNumber(status.failedScans),normalizeNumber(status.callCandidates),normalizeNumber(status.putCandidates),normalizeNumber(status.tradeCount),normalizeNumber(status.watchCount),normalizeNumber(status.rejectCount),normalizeNumber(status.elapsedSeconds),normalizeNumber(status.durationMs)];removeExistingFilter(sheet);sheet.clear();sheet.getRange(1,1,2,headers.length).setValues([headers,values]);lightFormat(sheet,2,headers.length,"SCANNER_STATUS");SpreadsheetApp.flush();return{rowCount:1,columnCount:headers.length};}
function formatAccuracySheet(sheet){sheet.getRange(1,1,1,5).setFontWeight("bold");sheet.getRange(5,1,1,ACCURACY_HEADERS.length).setFontWeight("bold");sheet.setFrozenRows(5);sheet.getRange(2,5,2,1).setNumberFormat("0.00\%");sheet.getRange(ACCURACY_DATA_START_ROW,15,Math.max(1,sheet.getMaxRows()-ACCURACY_DATA_START_ROW+1),1).setNumberFormat("0.00");sheet.getRange(ACCURACY_DATA_START_ROW,2,Math.max(1,sheet.getMaxRows()-ACCURACY_DATA_START_ROW+1),1).setNumberFormat("yyyy-mm-dd hh:mm:ss");sheet.getRange(ACCURACY_DATA_START_ROW,13,Math.max(1,sheet.getMaxRows()-ACCURACY_DATA_START_ROW+1),1).setNumberFormat("yyyy-mm-dd hh:mm:ss");}
function lightFormat(sheet,rowCount,columnCount,sheetName){if(!columnCount)return;sheet.getRange(1,1,1,columnCount).setFontWeight("bold").setWrap(false);sheet.setFrozenRows(1);if(!WIDE_SHEETS[sheetName]&&rowCount>1)try{removeExistingFilter(sheet);sheet.getRange(1,1,rowCount,columnCount).createFilter();}catch(err){console.log("Filter creation skipped: "+err.message);}}
function removeExistingFilter(sheet){try{var filter=sheet.getFilter();if(filter)filter.remove();}catch(err){console.log("Filter removal skipped: "+err.message);}}
function normalizeHeaders(headers){if(!Array.isArray(headers))return[];var output=[];for(var i=0;i<headers.length;i++)output.push(headers[i]===null||headers[i]===undefined?"":String(headers[i]).trim());return output;}
function normalizeRow(row,columnCount){if(!Array.isArray(row))row=[];var output=[];for(var i=0;i<columnCount;i++)output.push(i<row.length?normalizeCell(row[i]):"");return output;}
function normalizeCell(value){if(value===null||value===undefined)return"";if(Object.prototype.toString.call(value)==="[object Date]")return isNaN(value.getTime())?"":value;if(typeof value==="number")return isFinite(value)?value:"";if(typeof value==="boolean")return value;if(typeof value==="object")try{return JSON.stringify(value);}catch(_){return String(value);}return String(value);}
function normalizeNumber(value){var number=Number(value);return isFinite(number)?number:0;}
function jsonResponse(object){return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);}
function doGet(){return jsonResponse({success:true,service:"AI Smart Scanner Google Sheet API",version:"V12",status:"RUNNING",lockWaitMs:LOCK_WAIT_MS,accuracyHeaderCompatible:true,liveAccuracyReadUpdate:true,performanceMode:true,accuracyColumns:ACCURACY_HEADERS.length,accuracyColumnsList:ACCURACY_HEADERS,accuracyDataStartRow:ACCURACY_DATA_START_ROW,supportedActions:["replaceSheet","appendRows","getAccuracyRows","normalizeAccuracyTimes","updateAccuracy","scanner_status"],supportedSheets:Object.keys(ALLOWED_SHEETS),accuracyHistoryPolicy:"yesterday_onward_all_option_ready_stocks_deduplicated",timestamp:new Date().toISOString()});}