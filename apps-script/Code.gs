/**
 * Nexperts Grants — saves each application to this spreadsheet,
 * and returns one marketer's registrations to the signed-in dashboard.
 * The offer letter is emailed by the website through Brevo, not by Gmail.
 *
 * Setup (once):
 * 1. Create a Google Sheet. Extensions → Apps Script. Replace the default file with this script.
 * 2. Set SETUP_TOKEN below to a long random string (24+ characters). Save.
 * 3. Select saveToken in the function menu and Run. Approve the permissions.
 * 4. Change SETUP_TOKEN back to PASTE_TOKEN_HERE and save. The token stays in Script properties.
 * 5. Deploy → Manage deployments → Edit → New version.
 *    Execute as: Me
 *    Who has access: Anyone
 * 6. The web app URL stays the same (it ends in /exec).
 */
var SETUP_TOKEN = "PASTE_TOKEN_HERE";
var TIME_ZONE = "Asia/Kuala_Lumpur";
var HEADERS = [
  "Submitted at",
  "Full name",
  "NRIC",
  "Email",
  "Phone",
  "Working status",
  "Street",
  "Street line 2",
  "City",
  "Region",
  "Postal code",
  "Country",
  "Address on letter",
  "Training schedule",
  "Letter date",
  "Letter file",
  "Marketer",
  "Email status"
];
var MARKETER_NAMES = { Masnah: true, Affendy: true, Sarah: true, Alliyah: true, Has: true, Shaza: true, Shaabena: true };

function saveToken() {
  if (!SETUP_TOKEN || SETUP_TOKEN === "PASTE_TOKEN_HERE" || SETUP_TOKEN.length < 24) {
    throw new Error("Replace SETUP_TOKEN with a long random string, then run saveToken again.");
  }
  PropertiesService.getScriptProperties().setProperty("APPS_SCRIPT_TOKEN", SETUP_TOKEN);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (!tokensMatch(body.token, PropertiesService.getScriptProperties().getProperty("APPS_SCRIPT_TOKEN"))) {
      return json({ ok: false, error: "Unauthorized" });
    }
    if (body.action === "check") return checkRegistration(body.nric);
    if (body.action === "list") return listRegistrations(body.marketer);
    var record = body.record || {};
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
      ensureHeaders(sheet);
      var existing = findRegistration(String(record.nric || ""));
      if (existing) return json({ ok: false, duplicate: true, marketer: existing.marketer });
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var submittedAt = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd HH:mm:ss");
      var fields = {
        "Submitted at": submittedAt,
        "Full name": record.name,
        "NRIC": record.nric,
        "Email": record.email,
        "Phone": record.phone,
        "Working status": record.workStatus,
        "Street": record.street,
        "Street line 2": record.street2,
        "City": record.city,
        "Region": record.region,
        "Postal code": record.postal,
        "Country": record.country,
        "Address on letter": record.address,
        "Training schedule": record.trainingDate,
        "Letter date": record.letterDate,
        "Letter file": record.filename,
        "Marketer": allowedMarketer(record.marketer),
        "Email status": record.emailStatus === "failed" ? "failed" : "sent"
      };
      var values = headers.map(function (header) {
        var value = fields[String(header)];
        return value == null ? "" : value;
      });
      var rowNumber = sheet.getLastRow() + 1;
      sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
      var nricCol = columnOf(headers, "NRIC");
      var phoneCol = columnOf(headers, "Phone");
      if (nricCol) sheet.getRange(rowNumber, nricCol).setNumberFormat("@").setValue(String(record.nric));
      if (phoneCol) sheet.getRange(rowNumber, phoneCol).setNumberFormat("@").setValue(String(record.phone));
      SpreadsheetApp.flush();
      return json({ ok: true });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return json({ ok: false, error: "Delivery failed" });
  }
}

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }
  var width = Math.max(sheet.getLastColumn(), 1);
  var titles = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (cell) { return String(cell); });
  if (titles[0] !== HEADERS[0]) {
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }
  HEADERS.forEach(function (header) {
    if (titles.indexOf(header) === -1) {
      var col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(header);
      titles.push(header);
    }
  });
}

function columnOf(headers, name) {
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]) === name) return i + 1;
  }
  return 0;
}

function listRegistrations(name) {
  var marketer = String(name || "").replace(/\s+/g, " ").trim();
  if (!isSafeMarketer(marketer)) return json({ ok: false, error: "Unauthorized" });
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() < 2) return json({ ok: true, rows: [] });
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function (cell) { return String(cell); });
  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var record = {};
    for (var c = 0; c < headers.length; c++) record[headers[c]] = data[r][c];
    if (String(record["Marketer"] || "").trim() !== marketer) continue;
    if (!String(record["Full name"] || "").trim()) continue;
    rows.push({
      submittedAt: cellText(record["Submitted at"]),
      name: cellText(record["Full name"]),
      email: cellText(record["Email"]),
      phone: cellText(record["Phone"]),
      training: cellText(record["Training schedule"]),
      workStatus: cellText(record["Working status"]),
      emailStatus: cellText(record["Email status"]),
      nricLast4: nricLast4(record["NRIC"])
    });
  }
  rows.reverse();
  if (rows.length > 300) rows = rows.slice(0, 300);
  return json({ ok: true, rows: rows });
}

function cellText(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, TIME_ZONE, "yyyy-MM-dd HH:mm:ss");
  }
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function nricLast4(value) {
  var digits = String(value == null ? "" : value).replace(/\D/g, "");
  return digits.length < 4 ? "" : digits.slice(-4);
}

function checkRegistration(nric) {
  var digits = String(nric || "").replace(/\D/g, "");
  if (!/^\d{12}$/.test(digits)) return json({ ok: false, error: "Unauthorized" });
  var found = findRegistration(digits);
  if (!found) return json({ ok: true, found: false });
  return json({ ok: true, found: true, marketer: found.marketer });
}

function findRegistration(nric) {
  var digits = String(nric || "").replace(/\D/g, "");
  if (!/^\d{12}$/.test(digits)) return null;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() < 2) return null;
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function (cell) { return String(cell); });
  var nricIndex = headers.indexOf("NRIC");
  var nameIndex = headers.indexOf("Full name");
  var marketerIndex = headers.indexOf("Marketer");
  var statusIndex = headers.indexOf("Email status");
  if (nricIndex < 0) return null;
  for (var r = 1; r < data.length; r++) {
    var stored = String(data[r][nricIndex] == null ? "" : data[r][nricIndex]).replace(/\D/g, "");
    if (stored !== digits) continue;
    var person = nameIndex < 0 ? "" : String(data[r][nameIndex] || "").trim();
    if (!person) continue;
    var status = statusIndex < 0 ? "" : String(data[r][statusIndex] || "").trim().toLowerCase();
    if (status === "failed") continue;
    var marketer = marketerIndex < 0 ? "" : String(data[r][marketerIndex] || "").replace(/\s+/g, " ").trim();
    return { marketer: marketer };
  }
  return null;
}

function isSafeMarketer(name) {
  if (MARKETER_NAMES[name]) return true;
  return /^[A-Za-z][A-Za-z .'-]{1,59}$/.test(name);
}

function allowedMarketer(value) {
  var name = String(value || "").replace(/\s+/g, " ").trim();
  return isSafeMarketer(name) ? name : "";
}

function tokensMatch(given, expected) {
  if (!given || !expected || given.length !== expected.length) return false;
  var mismatch = 0;
  for (var i = 0; i < given.length; i++) mismatch |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
