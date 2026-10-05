#!/usr/bin/env node
/**
 * Recover offer-letter recipients from Brevo transactional activity.
 *
 * Usage:
 *   Put BREVO_API_KEY in .dev.vars, then:
 *   node scripts/recover-from-brevo.js
 *
 * Optional:
 *   START_DATE=2026-09-20 END_DATE=2026-10-03 SKIP_NAMES=1 node scripts/recover-from-brevo.js
 */
const fs = require("fs");
const path = require("path");

loadDevVars();

const API = "https://api.brevo.com/v3";
const KEY = String(process.env.BREVO_API_KEY || "").trim();
const START = process.env.START_DATE || "2026-09-20";
const END = process.env.END_DATE || new Date().toISOString().slice(0, 10);
const SUBJECT = "Letter of Enrolment - CEH";
const SKIP_NAMES = String(process.env.SKIP_NAMES || "").trim() === "1";
const SKIP = {
  "asma@nexpertsacademy.com": true,
  "aisyah@nexpertsacademy.com": true,
  "enquiry@nexpertsacademy.com": true,
  "info@nexpertsai.com": true,
};

if (!KEY) {
  console.error("Missing BREVO_API_KEY in .dev.vars or environment.");
  process.exit(1);
}

function loadDevVars() {
  var file = path.join(process.cwd(), ".dev.vars");
  if (!fs.existsSync(file)) return;
  String(fs.readFileSync(file, "utf8")).split(/\r?\n/).forEach(function (line) {
    var trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === "#") return;
    var eq = trimmed.indexOf("=");
    if (eq < 1) return;
    var name = trimmed.slice(0, eq).trim();
    var value = trimmed.slice(eq + 1).trim();
    if ((value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
        (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")) {
      value = value.slice(1, -1);
    }
    if (!process.env[name]) process.env[name] = value;
  });
}

async function brevo(pathname) {
  const response = await fetch(API + pathname, {
    headers: {
      accept: "application/json",
      "api-key": KEY,
    },
  });
  const text = await response.text();
  var data = {};
  try { data = JSON.parse(text); } catch (error) { data = { raw: text }; }
  if (!response.ok) {
    throw new Error("Brevo " + response.status + ": " + (data.message || data.code || text.slice(0, 200)));
  }
  return data;
}

function csvEscape(value) {
  return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
}

function nameFromBody(body) {
  var text = String(body || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  var match = text.match(/^Hi\s+(.+?)\s*,/i) || text.match(/\bHi\s+(.+?)\s*,/i);
  return match ? match[1].trim() : "";
}

function isProbe(email) {
  return /^(speed-probe|sheet-probe)\+/i.test(email) || /@example\.com$/i.test(email);
}

async function listRequestEvents() {
  var rows = [];
  var offset = 0;
  var limit = 2500;
  while (true) {
    var query = new URLSearchParams({
      startDate: START,
      endDate: END,
      event: "requests",
      sort: "desc",
      limit: String(limit),
      offset: String(offset),
    });
    var data = await brevo("/smtp/statistics/events?" + query.toString());
    var batch = data.events || [];
    if (!batch.length) break;
    rows = rows.concat(batch);
    console.log("Loaded events:", rows.length);
    if (batch.length < limit) break;
    offset += limit;
    if (offset > 20000) break;
  }
  return rows;
}

async function nameForEmail(email, messageId) {
  try {
    var query = new URLSearchParams({
      email: email,
      startDate: START,
      endDate: END,
      limit: "5",
      sort: "desc",
    });
    if (messageId) query.set("messageId", messageId);
    var data = await brevo("/smtp/emails?" + query.toString());
    var list = data.transactionalEmails || [];
    var item = list.find(function (row) {
      return String(row.subject || "").indexOf(SUBJECT) !== -1;
    }) || list[0];
    if (!item || !item.uuid) return "";
    var content = await brevo("/smtp/emails/" + encodeURIComponent(item.uuid));
    return nameFromBody(content.body || content.htmlContent || content.textContent || "");
  } catch (error) {
    return "";
  }
}

function sheetCsv(rows) {
  var header = [
    "Submitted at", "Full name", "NRIC", "Email", "Phone", "Working status",
    "Street", "Street line 2", "City", "Region", "Postal code", "Country",
    "Address on letter", "Training schedule", "Letter date", "Letter file",
    "Marketer", "Email status",
  ];
  var csv = header.map(csvEscape).join(",") + "\n";
  rows.forEach(function (row) {
    var sent = String(row.sentAt || "").replace("T", " ").replace(/\.\d+.*/, "").replace("Z", "");
    csv += [
      sent, row.name || "", "", row.email || "", "", "", "", "", "", "", "", "",
      "", "", "", "", "", "sent",
    ].map(csvEscape).join(",") + "\n";
  });
  return csv;
}

async function main() {
  console.log("Fetching Brevo send events from", START, "to", END);
  var events = await listRequestEvents();
  console.log("Total request events:", events.length);

  var offer = events.filter(function (item) {
    return String(item.subject || "").indexOf(SUBJECT) !== -1;
  });
  console.log("Offer-letter send events:", offer.length);

  var byEmail = {};
  offer.forEach(function (item) {
    var email = String(item.email || "").trim().toLowerCase();
    if (!email || SKIP[email] || isProbe(email)) return;
    var prev = byEmail[email];
    if (!prev || String(item.date || "") < String(prev.date || "")) {
      byEmail[email] = item;
    }
  });

  var emails = Object.keys(byEmail).sort(function (a, b) {
    return String(byEmail[a].date || "").localeCompare(String(byEmail[b].date || ""));
  });
  console.log("Unique applicants:", emails.length);

  var out = [];
  for (var i = 0; i < emails.length; i++) {
    var email = emails[i];
    var item = byEmail[email];
    var name = "";
    if (!SKIP_NAMES) {
      name = await nameForEmail(email, item.messageId || "");
      if ((i + 1) % 25 === 0 || i + 1 === emails.length) {
        console.log("Resolved names:", i + 1, "/", emails.length);
      }
    }
    out.push({
      sentAt: item.date || "",
      name: name,
      email: email,
      subject: item.subject || SUBJECT,
      messageId: item.messageId || "",
    });
  }

  var dir = path.join(process.cwd(), "recovery");
  fs.mkdirSync(dir, { recursive: true });
  var jsonPath = path.join(dir, "brevo-offer-letters.json");
  var csvPath = path.join(dir, "brevo-offer-letters.csv");
  var sheetPath = path.join(dir, "sheet-import-from-brevo.csv");
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  var csv = ["Sent at", "Full name", "Email", "Subject", "Message ID"].map(csvEscape).join(",") + "\n";
  out.forEach(function (row) {
    csv += [row.sentAt, row.name, row.email, row.subject, row.messageId].map(csvEscape).join(",") + "\n";
  });
  fs.writeFileSync(csvPath, csv);
  fs.writeFileSync(sheetPath, sheetCsv(out));

  console.log("");
  console.log("Unique applicants recovered:", out.length);
  console.log("Wrote", csvPath);
  console.log("Wrote", sheetPath);
  console.log("Wrote", jsonPath);
  console.log("");
  console.log("Next: open sheet-import-from-brevo.csv and File → Import → Append to current sheet.");
  console.log("NRIC / phone / address / intake are blank — fill from PDF attachments in Brevo or the CC inbox when needed.");
}

main().catch(function (error) {
  console.error(error.message || error);
  process.exit(1);
});
