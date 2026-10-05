/**
 * Download offer-letter PDFs from Gmail (asma@ / aisyah@ CC inbox).
 *
 * Brevo's API cannot download outbound attachments. The PDFs only exist in
 * the CC mailboxes and the applicant inbox.
 *
 * How to run (5 minutes):
 * 1. Open Gmail as asma@nexpertsacademy.com OR aisyah@nexpertsacademy.com
 *    (the account that received the CC copies).
 * 2. Open that same account's Google Drive → create/open any Sheet →
 *    Extensions → Apps Script.
 * 3. Paste THIS file into the Apps Script project (new script file is fine).
 * 4. Optional: create a sheet tab named "Missing Emails" with one applicant
 *    email per row in column A (from recovery/missing-emails-only.txt).
 *    If that tab is missing, every offer letter in the date range is downloaded.
 * 5. Select downloadMissingOfferPdfs → Run → Approve Gmail + Drive permissions.
 * 6. PDFs appear in Drive folder: "Offer Letter PDFs Recovery"
 *
 * Then download that Drive folder and put PDFs into the project recovery/pdfs/
 * (or share the folder) so we can extract IC / address / intake.
 */

var RECOVER_SUBJECT = "Letter of Enrolment - CEH";
var RECOVER_AFTER = "2026/09/20"; // Gmail search date format yyyy/mm/dd
var RECOVER_FOLDER = "Offer Letter PDFs Recovery";
var SKIP_ATTACHMENT_NAMES = {
  "application guideline.pdf": true,
  "application%20guideline.pdf": true
};

function downloadMissingOfferPdfs() {
  var folder = getOrCreateFolder_(RECOVER_FOLDER);
  var wanted = loadWantedEmails_();
  var query = 'subject:"' + RECOVER_SUBJECT + '" has:attachment after:' + RECOVER_AFTER;
  Logger.log("Gmail query: " + query);
  Logger.log("Wanted email filter count: " + (wanted ? wanted.size : 0) + " (0 = download all)");

  var start = 0;
  var page = 100;
  var saved = 0;
  var seen = {};
  var skipped = 0;

  while (true) {
    var threads = GmailApp.search(query, start, page);
    if (!threads.length) break;

    for (var t = 0; t < threads.length; t++) {
      var messages = threads[t].getMessages();
      for (var m = 0; m < messages.length; m++) {
        var message = messages[m];
        if (String(message.getSubject() || "").indexOf(RECOVER_SUBJECT) === -1) continue;

        var applicantEmail = primaryRecipient_(message);
        if (!applicantEmail) {
          skipped++;
          continue;
        }
        if (wanted && !wanted.has(applicantEmail)) {
          skipped++;
          continue;
        }
        if (seen[applicantEmail]) continue;
        seen[applicantEmail] = true;

        var attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
        var wrote = false;
        for (var a = 0; a < attachments.length; a++) {
          var file = attachments[a];
          var name = String(file.getName() || "").trim();
          var lower = name.toLowerCase();
          if (SKIP_ATTACHMENT_NAMES[lower]) continue;
          if (file.getContentType() && String(file.getContentType()).indexOf("pdf") === -1 && !/\.pdf$/i.test(name)) continue;

          var safeEmail = applicantEmail.replace(/[^a-zA-Z0-9._@+-]+/g, "_");
          var outName = safeEmail + " - " + (name || "Letter of Enrolment.pdf");
          if (!/\.pdf$/i.test(outName)) outName += ".pdf";
          folder.createFile(file.copyBlob().setName(outName));
          wrote = true;
          saved++;
          Logger.log("Saved " + outName);
          break; // one offer letter PDF per applicant
        }
        if (!wrote) Logger.log("No offer PDF on message for " + applicantEmail);
      }
    }

    if (threads.length < page) break;
    start += page;
    if (start > 2000) break;
  }

  Logger.log("Done. Saved PDFs: " + saved + ". Unique applicants touched: " + Object.keys(seen).length + ". Skipped: " + skipped);
  Logger.log("Drive folder: " + folder.getUrl());
}

function loadWantedEmails_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return null;
    var tab = ss.getSheetByName("Missing Emails");
    if (!tab || tab.getLastRow() < 1) return null;
    var values = tab.getRange(1, 1, tab.getLastRow(), 1).getValues();
    var set = {};
    var count = 0;
    for (var i = 0; i < values.length; i++) {
      var email = String(values[i][0] || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!email || email.indexOf("@") < 0 || email === "email") continue;
      set[email] = true;
      count++;
    }
    if (!count) return null;
    // Use object as set with .has via wrapper
    return {
      size: count,
      has: function (email) { return !!set[String(email || "").toLowerCase()]; }
    };
  } catch (error) {
    return null;
  }
}

function primaryRecipient_(message) {
  var skip = {
    "asma@nexpertsacademy.com": true,
    "aisyah@nexpertsacademy.com": true,
    "enquiry@nexpertsacademy.com": true,
    "info@nexpertsai.com": true
  };
  var fields = [message.getTo(), message.getCc(), message.getBcc()];
  for (var f = 0; f < fields.length; f++) {
    var parts = String(fields[f] || "").split(",");
    for (var i = 0; i < parts.length; i++) {
      var match = String(parts[i] || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (!match) continue;
      var email = match[0].toLowerCase();
      if (!skip[email]) return email;
    }
  }
  return "";
}

function getOrCreateFolder_(name) {
  var folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}
