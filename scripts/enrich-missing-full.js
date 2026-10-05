#!/usr/bin/env node
/**
 * Build the fullest possible recovery file for missing sheet rows from Brevo.
 *
 * Brevo API cannot download outbound PDF attachments, and phone is not stored
 * in Brevo or on the offer letter PDF. This script exports everything Brevo can give.
 *
 * Usage:
 *   node scripts/enrich-missing-full.js
 */
const fs = require("fs");
const path = require("path");

loadDevVars();
const KEY = String(process.env.BREVO_API_KEY || "").trim();
const START = process.env.START_DATE || "2026-09-20";
const END = process.env.END_DATE || new Date().toISOString().slice(0, 10);
const API = "https://api.brevo.com/v3";

if (!KEY) {
  console.error("Missing BREVO_API_KEY in .dev.vars");
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

async function brevo(pathname) {
  var response = await fetch(API + pathname, {
    headers: { accept: "application/json", "api-key": KEY },
  });
  var text = await response.text();
  var data = {};
  try { data = JSON.parse(text); } catch (error) { data = { raw: text }; }
  if (!response.ok) throw new Error("Brevo " + response.status + ": " + (data.message || text.slice(0, 200)));
  return data;
}

function readMissing() {
  var file = path.join(process.cwd(), "recovery", "missing-from-sheet.csv");
  if (!fs.existsSync(file)) throw new Error("missing-from-sheet.csv not found. Run recovery first.");
  var lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).slice(1);
  return lines.map(function (line) {
    var cols = [];
    var cur = "";
    var inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === '"') {
        if (inQ && line.charAt(i + 1) === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        cols.push(cur);
        cur = "";
      } else cur += ch;
    }
    cols.push(cur);
    return {
      email: String(cols[0] || "").trim().toLowerCase(),
      name: String(cols[1] || "").trim(),
      sentAt: String(cols[2] || "").trim(),
    };
  }).filter(function (row) { return row.email; });
}

async function enrichOne(row) {
  var out = {
    sentAt: row.sentAt,
    name: row.name,
    email: row.email,
    nric: "",
    phone: "",
    address: "",
    trainingSchedule: "",
    letterDate: "",
    attachmentCount: "",
    messageId: "",
    uuid: "",
    source: "brevo-api",
    notes: "Phone/NRIC/address not available via Brevo API. PDF attachments cannot be downloaded from Brevo API.",
  };

  try {
    var list = await brevo("/smtp/emails?" + new URLSearchParams({
      email: row.email,
      startDate: START,
      endDate: END,
      limit: "5",
      sort: "desc",
    }).toString());
    var item = (list.transactionalEmails || []).find(function (entry) {
      return String(entry.subject || "").indexOf("Letter of Enrolment - CEH") !== -1;
    }) || (list.transactionalEmails || [])[0];
    if (!item) return out;

    out.messageId = item.messageId || "";
    out.uuid = item.uuid || "";
    out.sentAt = item.date || out.sentAt;

    if (item.uuid) {
      var content = await brevo("/smtp/emails/" + encodeURIComponent(item.uuid));
      var name = nameFromBody(content.body || "");
      if (name) out.name = name;
      out.attachmentCount = content.attachmentCount == null ? "" : String(content.attachmentCount);
      if (Number(content.attachmentCount || 0) >= 1) {
        out.notes = "Brevo confirms offer PDF was attached, but API cannot download it. Get PDF from asma@/aisyah@ CC inbox or Brevo UI, then run extract-from-offer-pdfs.js";
      }
    }
  } catch (error) {
    out.notes = "Brevo lookup failed: " + (error.message || error);
  }

  // Contacts almost never exist for transactional-only recipients; try anyway.
  try {
    var contact = await brevo("/contacts/" + encodeURIComponent(row.email));
    var attrs = contact.attributes || {};
    if (attrs.SMS || attrs.PHONE || attrs.WHATSAPP) {
      out.phone = String(attrs.SMS || attrs.PHONE || attrs.WHATSAPP || "");
      out.notes = "Phone found on Brevo contact record.";
    }
  } catch (error) {
    // ignore missing contacts
  }

  return out;
}

async function main() {
  var missing = readMissing();
  console.log("Missing applicants:", missing.length);
  var rows = [];
  for (var i = 0; i < missing.length; i++) {
    rows.push(await enrichOne(missing[i]));
    if ((i + 1) % 20 === 0 || i + 1 === missing.length) {
      console.log("Enriched", i + 1, "/", missing.length);
    }
  }

  var dir = path.join(process.cwd(), "recovery");
  fs.mkdirSync(dir, { recursive: true });
  var jsonPath = path.join(dir, "missing-full-data.json");
  var csvPath = path.join(dir, "missing-full-data.csv");
  fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2));

  var header = [
    "Sent at", "Full name", "Email", "NRIC", "Phone", "Address on letter",
    "Training schedule", "Letter date", "Attachment count", "Message ID", "UUID", "Notes",
  ];
  var csv = header.map(csvEscape).join(",") + "\n";
  rows.forEach(function (row) {
    csv += [
      row.sentAt, row.name, row.email, row.nric, row.phone, row.address,
      row.trainingSchedule, row.letterDate, row.attachmentCount, row.messageId, row.uuid, row.notes,
    ].map(csvEscape).join(",") + "\n";
  });
  fs.writeFileSync(csvPath, csv);

  var withPhone = rows.filter(function (r) { return r.phone; }).length;
  var withName = rows.filter(function (r) { return r.name; }).length;
  console.log("");
  console.log("Wrote", csvPath);
  console.log("Wrote", jsonPath);
  console.log("With name:", withName);
  console.log("With phone:", withPhone);
  console.log("With NRIC:", rows.filter(function (r) { return r.nric; }).length);
  console.log("");
  console.log("Phone/NRIC/address require the offer PDFs from the CC inbox (asma@ / aisyah@).");
  console.log("Save those PDFs into recovery/pdfs/ then run: node scripts/extract-from-offer-pdfs.js");
}

main().catch(function (error) {
  console.error(error.message || error);
  process.exit(1);
});
