#!/usr/bin/env node
/**
 * Extract fields from offer-letter PDFs dropped into recovery/pdfs/.
 *
 * The letter PDF contains: name, NRIC, address, training schedule, letter date.
 * It does NOT contain phone numbers.
 *
 * Usage:
 *   1. From asma@ / aisyah@ CC inbox (or Brevo UI), download the Letter of Enrolment PDFs
 *   2. Put them in recovery/pdfs/
 *   3. node scripts/extract-from-offer-pdfs.js
 */
const fs = require("fs");
const path = require("path");

async function loadPdfParse() {
  try {
    return require("pdf-parse");
  } catch (error) {
    console.error("Installing pdf-parse...");
    require("child_process").execSync("npm install pdf-parse --no-save", {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    return require("pdf-parse");
  }
}

function csvEscape(value) {
  return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
}

function extractFields(text) {
  var clean = String(text || "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ");
  var nric = "";
  var nricMatch = clean.match(/\b(\d{12})\b/) || clean.match(/\b(\d{6}-\d{2}-\d{4})\b/);
  if (nricMatch) nric = String(nricMatch[1]).replace(/\D/g, "");

  var letterDate = "";
  var dateMatch = clean.match(/\b(\d{2}\.\d{2}\.\d{4})\b/);
  if (dateMatch) letterDate = dateMatch[1];

  // Training dates on the letter are usually like 31.10.2026 – 15.12.2026 or similar labels.
  var training = "";
  var trainMatch = clean.match(/(\d{2}\.\d{2}\.\d{4}\s*[–\-to]+\s*\d{2}\.\d{2}\.\d{4}[^\n]*)/i);
  if (trainMatch) training = trainMatch[1].replace(/\s+/g, " ").trim();

  var name = "";
  // Heuristic: line near NRIC / after date block; keep empty if unsure.
  var lines = clean.split(/\n/).map(function (line) { return line.trim(); }).filter(Boolean);
  for (var i = 0; i < lines.length; i++) {
    if (nric && lines[i].replace(/\D/g, "").indexOf(nric) !== -1 && i > 0) {
      var prev = lines[i - 1];
      if (prev && !/\d{2}\.\d{2}\.\d{4}/.test(prev) && prev.length > 3 && prev.length < 120) {
        name = prev;
      }
      break;
    }
  }

  return {
    name: name,
    nric: nric,
    phone: "",
    address: "",
    trainingSchedule: training,
    letterDate: letterDate,
    rawPreview: clean.slice(0, 500),
  };
}

async function main() {
  var pdfParse = await loadPdfParse();
  var dir = path.join(process.cwd(), "recovery", "pdfs");
  fs.mkdirSync(dir, { recursive: true });
  var files = fs.readdirSync(dir).filter(function (name) {
    return /\.pdf$/i.test(name);
  });
  if (!files.length) {
    console.error("No PDFs found in recovery/pdfs/");
    console.error("Download offer letters from asma@ / aisyah@ CC inbox, put them there, run again.");
    process.exit(1);
  }

  var rows = [];
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var bytes = fs.readFileSync(path.join(dir, file));
    var parsed = await pdfParse(bytes);
    var fields = extractFields(parsed.text || "");
    rows.push({
      file: file,
      name: fields.name,
      nric: fields.nric,
      phone: "",
      address: fields.address,
      trainingSchedule: fields.trainingSchedule,
      letterDate: fields.letterDate,
      notes: "Phone is not printed on the offer letter PDF.",
      textLength: String((parsed.text || "").length),
    });
    console.log((i + 1) + "/" + files.length, file, "nric=" + (fields.nric || "?"));
  }

  var outCsv = path.join(process.cwd(), "recovery", "pdf-extracted-fields.csv");
  var header = ["PDF file", "Full name", "NRIC", "Phone", "Address", "Training schedule", "Letter date", "Notes"];
  var csv = header.map(csvEscape).join(",") + "\n";
  rows.forEach(function (row) {
    csv += [row.file, row.name, row.nric, row.phone, row.address, row.trainingSchedule, row.letterDate, row.notes]
      .map(csvEscape).join(",") + "\n";
  });
  fs.writeFileSync(outCsv, csv);
  fs.writeFileSync(path.join(process.cwd(), "recovery", "pdf-extracted-fields.json"), JSON.stringify(rows, null, 2));
  console.log("Wrote", outCsv);
}

main().catch(function (error) {
  console.error(error.message || error);
  process.exit(1);
});
