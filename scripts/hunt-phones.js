#!/usr/bin/env node
/**
 * Hunt phones for missing applicants:
 * 1) Brevo contacts (already known empty)
 * 2) Google Sheet via Apps Script findByEmail (catches blank-marketer rows)
 *
 * Requires latest Code.gs deployed (action: findByEmail).
 */
const fs = require("fs");
const path = require("path");

loadDevVars();
const env = {
  APPS_SCRIPT_TOKEN: process.env.APPS_SCRIPT_TOKEN,
  BREVO_API_KEY: process.env.BREVO_API_KEY,
};

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

async function main() {
  var missing = JSON.parse(fs.readFileSync(path.join("recovery", "missing-full-data.json"), "utf8"));
  var emails = missing.map(function (row) { return String(row.email || "").toLowerCase(); }).filter(Boolean);
  console.log("Checking", emails.length, "missing emails against live sheet...");

  var response = await fetch("https://www.nexpertsgrants.com/api/admin/phone-hunt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Recover-Token": env.APPS_SCRIPT_TOKEN,
    },
    body: JSON.stringify({ emails: emails }),
  });
  var text = await response.text();
  var data;
  try { data = JSON.parse(text); } catch (error) {
    // fallback pages.dev
    response = await fetch("https://nexperts-grants.pages.dev/api/admin/phone-hunt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Recover-Token": env.APPS_SCRIPT_TOKEN,
      },
      body: JSON.stringify({ emails: emails }),
    });
    text = await response.text();
    data = JSON.parse(text);
  }

  if (!data.ok) {
    console.error("Phone hunt failed:", data.error || text.slice(0, 200));
    console.error("Paste latest Code.gs and Deploy → New version, then rerun.");
    process.exit(1);
  }

  console.log("Checked:", data.checked);
  console.log("Found on sheet (any marketer/blank):", data.foundOnSheet);
  console.log("With phone:", data.withPhone);
  console.log("Still not on sheet:", data.notOnSheet);

  var byEmail = {};
  missing.forEach(function (row) { byEmail[row.email] = row; });
  (data.found || []).forEach(function (row) {
    if (byEmail[row.email]) {
      byEmail[row.email].phone = row.phone || "";
      byEmail[row.email].nric = row.nric || byEmail[row.email].nric || "";
      byEmail[row.email].address = row.address || byEmail[row.email].address || "";
      byEmail[row.email].notes = row.phone
        ? "Phone recovered from Google Sheet row (was missing from marketer-filtered view)."
        : "Row found on sheet but phone empty.";
    }
  });

  var rows = Object.keys(byEmail).map(function (email) { return byEmail[email]; });
  var out = path.join("recovery", "missing-with-phone-hunt.csv");
  var header = ["Sent at", "Full name", "Email", "NRIC", "Phone", "Address on letter", "Notes"];
  var csv = header.map(csvEscape).join(",") + "\n";
  rows.forEach(function (row) {
    csv += [row.sentAt, row.name, row.email, row.nric || "", row.phone || "", row.address || "", row.notes || ""]
      .map(csvEscape).join(",") + "\n";
  });
  fs.writeFileSync(out, csv);
  fs.writeFileSync(path.join("recovery", "missing-with-phone-hunt.json"), JSON.stringify({
    summary: {
      checked: data.checked,
      foundOnSheet: data.foundOnSheet,
      withPhone: data.withPhone,
      notOnSheet: data.notOnSheet,
    },
    found: data.found,
    rows: rows,
  }, null, 2));
  console.log("Wrote", out);
}

main().catch(function (error) {
  console.error(error.message || error);
  process.exit(1);
});
