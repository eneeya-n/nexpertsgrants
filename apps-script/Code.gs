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
 *
 * After any Code.gs change: Deploy → Manage deployments → Edit → Version: New version → Deploy.
 * Optional: run bindSheet once from the editor if rows ever stop appearing.
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
  "Email status",
  "Application Status",
  "Payment Status",
  "Commission Status"
];
var MARKETER_NAMES = { Masnah: true, Affendy: true, Sarah: true, Alliyah: true, Has: true, Shaza: true, Shaabena: true };

function saveToken() {
  if (!SETUP_TOKEN || SETUP_TOKEN === "PASTE_TOKEN_HERE" || SETUP_TOKEN.length < 24) {
    throw new Error("Replace SETUP_TOKEN with a long random string, then run saveToken again.");
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty("APPS_SCRIPT_TOKEN", SETUP_TOKEN);
  rememberSpreadsheetId_(props);
}

function bindSheet() {
  var props = PropertiesService.getScriptProperties();
  var id = rememberSpreadsheetId_(props);
  if (!id) throw new Error("Open this script from the Google Sheet (Extensions → Apps Script), then run bindSheet.");
  Logger.log("Bound spreadsheet " + id);
}

function doGet() {
  return json({ ok: false, error: "Use the application form." });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      Logger.log("doPost missing body");
      return json({ ok: false, error: "Delivery failed" });
    }
    var body = JSON.parse(e.postData.contents);
    var action = String(body.action || "save");
    Logger.log("action=" + action);
    if (!tokensMatch(body.token, PropertiesService.getScriptProperties().getProperty("APPS_SCRIPT_TOKEN"))) {
      Logger.log("unauthorized");
      return json({ ok: false, error: "Unauthorized" });
    }
    if (body.action === "check") return checkRegistration(body.nric);
    if (body.action === "confirm") return confirmRegistration(body.nric, body.email);
    if (body.action === "findByEmail") return findByEmail(body.email);
    if (body.action === "list") return listRegistrations(body.marketer);
    if (body.action === "lookup") return lookupRegistration(body.nric);
    if (body.action === "markEmail") return markEmailStatus(body.nric, body.emailStatus);
    if (body.action && body.action !== "save") return json({ ok: false, error: "Unauthorized" });
    return saveRegistration(body.record || {});
  } catch (error) {
    Logger.log("doPost error: " + (error && error.message ? error.message : error));
    return json({ ok: false, error: "Delivery failed" });
  }
}

function saveRegistration(record) {
  var name = String(record.name || "").replace(/\s+/g, " ").trim();
  var nric = String(record.nric || "").replace(/\D/g, "");
  var email = String(record.email || "").replace(/\s+/g, " ").trim();
  if (!name || !/^\d{12}$/.test(nric) || !email) {
    Logger.log("save rejected incomplete record");
    return json({ ok: false, error: "Incomplete" });
  }

  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(30000);
    if (!locked) {
      Logger.log("save busy");
      return json({ ok: false, error: "Busy" });
    }

    var sheet = getDataSheet();
    Logger.log("save sheet=" + sheet.getName() + " ss=" + sheet.getParent().getId());
    ensureHeaders(sheet);

    var existing = findRegistrationOnSheet_(sheet, nric);
    if (existing) {
      if (emailsMatch_(existing.email, email)) {
        Logger.log("save resumed nric=" + nric + " row=" + (existing.row || 0));
        return json({ ok: true, resumed: true, row: existing.row || 0 });
      }
      Logger.log("save duplicate nric=" + nric);
      return json({ ok: false, duplicate: true, marketer: existing.marketer });
    }

    var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.length)).getValues()[0];
    var submittedAt = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd HH:mm:ss");
    var emailStatus = String(record.emailStatus || "").trim().toLowerCase();
    if (emailStatus !== "failed" && emailStatus !== "pending") emailStatus = "sent";
    var fields = {
      "Submitted at": submittedAt,
      "Full name": name,
      "NRIC": nric,
      "Email": email,
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
      "Email status": emailStatus
    };
    var values = headers.map(function (header) {
      var value = fields[String(header)];
      return value == null ? "" : value;
    });
    var rowNumber = sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
    var nricCol = columnOf(headers, "NRIC");
    var phoneCol = columnOf(headers, "Phone");
    if (nricCol) sheet.getRange(rowNumber, nricCol).setNumberFormat("@").setValue(nric);
    if (phoneCol) sheet.getRange(rowNumber, phoneCol).setNumberFormat("@").setValue(String(record.phone || ""));
    SpreadsheetApp.flush();

    if (nricCol) {
      var written = String(sheet.getRange(rowNumber, nricCol).getDisplayValue() || "").replace(/\D/g, "");
      if (written !== nric) {
        Logger.log("save verify failed row=" + rowNumber + " written=" + written);
        return json({ ok: false, error: "Delivery failed" });
      }
    }

    Logger.log("saved row=" + rowNumber + " name=" + name + " status=" + emailStatus);
    return json({ ok: true, row: rowNumber });
  } catch (error) {
    Logger.log("save error: " + (error && error.message ? error.message : error));
    return json({ ok: false, error: "Delivery failed" });
  } finally {
    if (locked) {
      try { lock.releaseLock(); } catch (releaseError) {}
    }
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
  var sheet = getDataSheet();
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
      nricLast4: nricLast4(record["NRIC"]),
      serialNo: cellText(pickField_(record, ["Serial No", "Serial no", "No."])),
      applicationStatus: cellText(pickField_(record, ["Application Status"])),
      paymentStatus: cellText(pickField_(record, ["Payment Status"])),
      commissionStatus: cellText(pickField_(record, ["Commission Status", "Commision Status"]))
    });
  }
  rows.reverse();
  if (rows.length > 300) rows = rows.slice(0, 300);
  return json({ ok: true, rows: rows });
}

function pickField_(record, names) {
  for (var i = 0; i < names.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(record, names[i])) continue;
    return record[names[i]];
  }
  return "";
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

function confirmRegistration(nric, email) {
  var digits = String(nric || "").replace(/\D/g, "");
  var want = String(email || "").replace(/\s+/g, " ").trim();
  if (!/^\d{12}$/.test(digits) || !want) return json({ ok: false, error: "Unauthorized" });
  var existing = findRegistrationOnSheet_(getDataSheet(), digits);
  if (!existing) return json({ ok: true, found: false, match: false });
  var match = emailsMatch_(existing.email, want);
  Logger.log("confirm nric=" + digits + " found=true match=" + match);
  return json({ ok: true, found: true, match: match, marketer: existing.marketer || "" });
}

function findByEmail(email) {
  var want = String(email || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!want || want.indexOf("@") < 0) return json({ ok: false, error: "Unauthorized" });
  var sheet = getDataSheet();
  if (sheet.getLastRow() < 2) return json({ ok: true, found: false });
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function (cell) { return String(cell); });
  var emailIndex = headers.indexOf("Email");
  if (emailIndex < 0) return json({ ok: true, found: false });
  for (var r = data.length - 1; r >= 1; r--) {
    var stored = cellText(data[r][emailIndex]).toLowerCase();
    if (stored !== want) continue;
    var record = {};
    for (var c = 0; c < headers.length; c++) record[headers[c]] = data[r][c];
    return json({
      ok: true,
      found: true,
      record: {
        name: cellText(record["Full name"]),
        nric: String(record["NRIC"] == null ? "" : record["NRIC"]).replace(/\D/g, ""),
        email: cellText(record["Email"]),
        phone: cellText(record["Phone"]),
        address: cellText(record["Address on letter"]),
        trainingDate: cellText(record["Training schedule"]),
        marketer: cellText(record["Marketer"]),
        emailStatus: cellText(record["Email status"]),
        submittedAt: cellText(record["Submitted at"])
      }
    });
  }
  return json({ ok: true, found: false });
}

/**
 * Run this once from the Apps Script editor (no deploy needed).
 * Creates a "Phone Recovery" tab with Email + Phone for every sheet row.
 */
function exportAllEmailPhones() {
  var sheet = getDataSheet();
  var ss = sheet.getParent();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) throw new Error("No registration rows found.");
  var headers = data[0].map(function (cell) { return String(cell); });
  var outName = "Phone Recovery";
  var out = ss.getSheetByName(outName) || ss.insertSheet(outName);
  out.clearContents();
  out.getRange(1, 1, 1, 6).setValues([["Submitted at", "Full name", "NRIC", "Email", "Phone", "Marketer"]]);
  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var record = {};
    for (var c = 0; c < headers.length; c++) record[headers[c]] = data[r][c];
    var email = cellText(record["Email"]);
    var name = cellText(record["Full name"]);
    if (!email && !name) continue;
    rows.push([
      cellText(record["Submitted at"]),
      name,
      String(record["NRIC"] == null ? "" : record["NRIC"]).replace(/\D/g, ""),
      email,
      cellText(record["Phone"]),
      cellText(record["Marketer"])
    ]);
  }
  if (rows.length) out.getRange(2, 1, rows.length, 6).setValues(rows);
  Logger.log("Exported " + rows.length + " rows to tab: " + outName);
}

function lookupRegistration(nric) {
  var digits = String(nric || "").replace(/\D/g, "");
  if (!/^\d{12}$/.test(digits)) return json({ ok: false, error: "Unauthorized" });
  var record = findApplication(digits);
  if (!record) return json({ ok: true, found: false });
  return json({ ok: true, found: true, record: record });
}

function markEmailStatus(nric, status) {
  var digits = String(nric || "").replace(/\D/g, "");
  var next = String(status || "").trim().toLowerCase();
  if (next !== "failed" && next !== "pending") next = "sent";
  if (!/^\d{12}$/.test(digits)) return json({ ok: false, error: "Unauthorized" });

  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    // Short wait so status updates never starve real saves for 20s.
    locked = lock.tryLock(8000);
    if (!locked) {
      Logger.log("markEmail busy");
      return json({ ok: false, error: "Busy" });
    }
    var sheet = getDataSheet();
    if (sheet.getLastRow() < 2) return json({ ok: false, error: "Not found" });
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (cell) { return String(cell); });
    var nricIndex = headers.indexOf("NRIC");
    var nameIndex = headers.indexOf("Full name");
    var statusIndex = headers.indexOf("Email status");
    if (nricIndex < 0 || statusIndex < 0) return json({ ok: false, error: "Not found" });
    for (var r = data.length - 1; r >= 1; r--) {
      var stored = String(data[r][nricIndex] == null ? "" : data[r][nricIndex]).replace(/\D/g, "");
      if (stored !== digits) continue;
      var person = nameIndex < 0 ? "" : String(data[r][nameIndex] || "").trim();
      if (!person) continue;
      sheet.getRange(r + 1, statusIndex + 1).setValue(next);
      SpreadsheetApp.flush();
      Logger.log("markEmail row=" + (r + 1) + " status=" + next);
      return json({ ok: true });
    }
    return json({ ok: false, error: "Not found" });
  } catch (error) {
    Logger.log("markEmail error: " + (error && error.message ? error.message : error));
    return json({ ok: false, error: "Delivery failed" });
  } finally {
    if (locked) {
      try { lock.releaseLock(); } catch (releaseError) {}
    }
  }
}

function findApplication(nric) {
  return findApplicationOnSheet_(getDataSheet(), nric);
}

function findRegistration(nric) {
  return findRegistrationOnSheet_(getDataSheet(), nric);
}

function findApplicationOnSheet_(sheet, nric) {
  var digits = String(nric || "").replace(/\D/g, "");
  if (!/^\d{12}$/.test(digits)) return null;
  if (sheet.getLastRow() < 2) return null;
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function (cell) { return String(cell); });
  var nricIndex = headers.indexOf("NRIC");
  if (nricIndex < 0) return null;
  for (var r = data.length - 1; r >= 1; r--) {
    var stored = String(data[r][nricIndex] == null ? "" : data[r][nricIndex]).replace(/\D/g, "");
    if (stored !== digits) continue;
    var record = {};
    for (var c = 0; c < headers.length; c++) record[headers[c]] = data[r][c];
    var name = cellText(record["Full name"]);
    var email = cellText(record["Email"]);
    var address = cellText(record["Address on letter"]);
    var trainingDate = cellText(record["Training schedule"]);
    if (!name || !email || !address || !trainingDate) continue;
    return {
      row: r + 1,
      name: name,
      email: email,
      phone: cellText(record["Phone"]),
      address: address,
      trainingDate: trainingDate,
      letterDate: cellText(record["Letter date"]),
      emailStatus: cellText(record["Email status"])
    };
  }
  return null;
}

function findRegistrationOnSheet_(sheet, nric) {
  var digits = String(nric || "").replace(/\D/g, "");
  if (!/^\d{12}$/.test(digits)) return null;
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
    var emailIndex = headers.indexOf("Email");
    var emailValue = emailIndex < 0 ? "" : cellText(data[r][emailIndex]);
    return { marketer: marketer, row: r + 1, email: emailValue };
  }
  return null;
}

function getDataSheet() {
  return getSpreadsheet_().getSheets()[0];
}

function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = String(props.getProperty("SPREADSHEET_ID") || "").trim();
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (error) {
      Logger.log("openById failed: " + (error && error.message ? error.message : error));
    }
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("No spreadsheet bound");
  props.setProperty("SPREADSHEET_ID", ss.getId());
  return ss;
}

function rememberSpreadsheetId_(props) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return "";
  var id = ss.getId();
  props.setProperty("SPREADSHEET_ID", id);
  return id;
}

function emailsMatch_(left, right) {
  return String(left || "").replace(/\s+/g, " ").trim().toLowerCase() ===
    String(right || "").replace(/\s+/g, " ").trim().toLowerCase();
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
