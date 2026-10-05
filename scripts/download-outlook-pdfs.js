#!/usr/bin/env node
/**
 * Download "Letter of Enrolment - CEH" PDFs from a Microsoft 365 / Outlook mailbox.
 *
 * Gmail Apps Script will NOT work for Microsoft mailboxes. Use this instead.
 *
 * Setup (one-time, Azure admin or you if you can create app registrations):
 * 1. Azure Portal → App registrations → New registration
 *    - Name: Nexperts PDF Recovery
 *    - Supported account types: single tenant (or multi if needed)
 *    - Redirect URI: Public client/native → http://localhost
 * 2. Authentication → Allow public client flows: Yes
 * 3. API permissions → Microsoft Graph → Delegated → Mail.Read → Grant admin consent
 * 4. Copy Application (client) ID and Directory (tenant) ID
 *
 * Run (sign in as asma@ or aisyah@ when the device code appears):
 *   OUTLOOK_CLIENT_ID=xxxxxxxx OUTLOOK_TENANT_ID=xxxxxxxx node scripts/download-outlook-pdfs.js
 *
 * Optional:
 *   MISSING_ONLY=1  → only emails listed in recovery/missing-emails-only.txt
 *
 * Saves PDFs into recovery/pdfs/
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const CLIENT_ID = String(process.env.OUTLOOK_CLIENT_ID || "").trim();
const TENANT_ID = String(process.env.OUTLOOK_TENANT_ID || "common").trim();
const MISSING_ONLY = String(process.env.MISSING_ONLY || "1").trim() !== "0";
const SUBJECT = "Letter of Enrolment - CEH";
const OUT_DIR = path.join(process.cwd(), "recovery", "pdfs");

if (!CLIENT_ID) {
  console.error("Missing OUTLOOK_CLIENT_ID.");
  console.error("Microsoft mailbox cannot use the Gmail Apps Script.");
  console.error("Create an Azure app registration (Mail.Read delegated), then rerun with:");
  console.error("  OUTLOOK_CLIENT_ID=... OUTLOOK_TENANT_ID=... node scripts/download-outlook-pdfs.js");
  console.error("");
  console.error("Easier alternative: Power Automate / Outlook search — see comments at top of this file.");
  process.exit(1);
}

function loadWanted() {
  if (!MISSING_ONLY) return null;
  var file = path.join(process.cwd(), "recovery", "missing-emails-only.txt");
  if (!fs.existsSync(file)) return null;
  var set = new Set(
    fs.readFileSync(file, "utf8").split(/\r?\n/).map(function (line) {
      return line.trim().toLowerCase();
    }).filter(Boolean)
  );
  return set.size ? set : null;
}

function requestJson(method, url, headers, body) {
  return new Promise(function (resolve, reject) {
    var u = new URL(url);
    var lib = u.protocol === "http:" ? http : https;
    var req = lib.request({
      method: method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: headers || {},
    }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        var buf = Buffer.concat(chunks);
        var text = buf.toString("utf8");
        var data = null;
        try { data = text ? JSON.parse(text) : {}; } catch (error) { data = { raw: text }; }
        if (res.statusCode >= 400) {
          reject(new Error(method + " " + url + " → " + res.statusCode + " " + (data.error_description || data.error && data.error.message || text.slice(0, 200))));
          return;
        }
        resolve({ status: res.statusCode, data: data, buf: buf, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function deviceCodeLogin() {
  var form = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: "https://graph.microsoft.com/Mail.Read offline_access openid profile",
  }).toString();
  var start = await requestJson(
    "POST",
    "https://login.microsoftonline.com/" + encodeURIComponent(TENANT_ID) + "/oauth2/v2.0/devicecode",
    { "Content-Type": "application/x-www-form-urlencoded" },
    form
  );
  console.log("");
  console.log(start.data.message || ("Open " + start.data.verification_uri + " and enter code " + start.data.user_code));
  console.log("Sign in as asma@ or aisyah@ (the Microsoft mailbox that got the CC).");
  console.log("");

  var interval = Math.max(5, Number(start.data.interval || 5)) * 1000;
  var expires = Date.now() + Number(start.data.expires_in || 900) * 1000;
  while (Date.now() < expires) {
    await new Promise(function (r) { setTimeout(r, interval); });
    try {
      var tokenForm = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: CLIENT_ID,
        device_code: start.data.device_code,
      }).toString();
      var token = await requestJson(
        "POST",
        "https://login.microsoftonline.com/" + encodeURIComponent(TENANT_ID) + "/oauth2/v2.0/token",
        { "Content-Type": "application/x-www-form-urlencoded" },
        tokenForm
      );
      if (token.data.access_token) return token.data.access_token;
    } catch (error) {
      var msg = String(error.message || "");
      if (msg.indexOf("authorization_pending") !== -1) continue;
      if (msg.indexOf("slow_down") !== -1) {
        interval += 2000;
        continue;
      }
      throw error;
    }
  }
  throw new Error("Device code login timed out");
}

function applicantFromMessage(message) {
  var skip = {
    "asma@nexpertsacademy.com": true,
    "aisyah@nexpertsacademy.com": true,
    "enquiry@nexpertsacademy.com": true,
    "info@nexpertsai.com": true,
  };
  var pools = []
    .concat(message.toRecipients || [])
    .concat(message.ccRecipients || [])
    .concat(message.bccRecipients || []);
  for (var i = 0; i < pools.length; i++) {
    var email = String((pools[i].emailAddress && pools[i].emailAddress.address) || "").toLowerCase();
    if (email && !skip[email]) return email;
  }
  return "";
}

async function graphGet(accessToken, url) {
  return requestJson("GET", url, {
    Authorization: "Bearer " + accessToken,
    Accept: "application/json",
  });
}

async function downloadBinary(accessToken, url, dest) {
  return new Promise(function (resolve, reject) {
    var u = new URL(url);
    var req = https.request({
      method: "GET",
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { Authorization: "Bearer " + accessToken },
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadBinary(accessToken, res.headers.location, dest).then(resolve, reject);
        return;
      }
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        if (res.statusCode >= 400) {
          reject(new Error("Download failed " + res.statusCode));
          return;
        }
        fs.writeFileSync(dest, Buffer.concat(chunks));
        resolve();
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  var wanted = loadWanted();
  console.log("Missing-email filter:", wanted ? wanted.size + " addresses" : "OFF (all offer letters)");

  var accessToken = await deviceCodeLogin();
  var filter = "contains(subject,'" + SUBJECT.replace(/'/g, "''") + "')";
  var url = "https://graph.microsoft.com/v1.0/me/messages?$top=50&$select=id,subject,receivedDateTime,toRecipients,ccRecipients,bccRecipients,hasAttachments&$filter=" + encodeURIComponent(filter) + "&$orderby=receivedDateTime%20desc";

  var saved = 0;
  var seen = new Set();
  while (url) {
    var page = await graphGet(accessToken, url);
    var messages = page.data.value || [];
    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      if (!message.hasAttachments) continue;
      if (String(message.subject || "").indexOf(SUBJECT) === -1) continue;
      var applicant = applicantFromMessage(message);
      if (!applicant) continue;
      if (wanted && !wanted.has(applicant)) continue;
      if (seen.has(applicant)) continue;

      var attPage = await graphGet(accessToken, "https://graph.microsoft.com/v1.0/me/messages/" + message.id + "/attachments");
      var attachments = attPage.data.value || [];
      var offer = attachments.find(function (item) {
        var name = String(item.name || "").toLowerCase();
        return item["@odata.type"] === "#microsoft.graph.fileAttachment" &&
          name.indexOf("guideline") === -1 &&
          (name.endsWith(".pdf") || String(item.contentType || "").indexOf("pdf") !== -1);
      });
      if (!offer) continue;

      var safe = applicant.replace(/[^a-zA-Z0-9._@+-]+/g, "_");
      var filename = safe + " - " + (offer.name || "Letter of Enrolment.pdf");
      if (!/\.pdf$/i.test(filename)) filename += ".pdf";
      var dest = path.join(OUT_DIR, filename);

      if (offer.contentBytes) {
        fs.writeFileSync(dest, Buffer.from(offer.contentBytes, "base64"));
      } else {
        await downloadBinary(
          accessToken,
          "https://graph.microsoft.com/v1.0/me/messages/" + message.id + "/attachments/" + offer.id + "/$value",
          dest
        );
      }
      seen.add(applicant);
      saved++;
      console.log("Saved", filename);
    }
    url = page.data["@odata.nextLink"] || "";
  }

  console.log("");
  console.log("Done. PDFs saved:", saved);
  console.log("Folder:", OUT_DIR);
  if (wanted) console.log("Still missing after filter:", Math.max(0, wanted.size - seen.size));
}

main().catch(function (error) {
  console.error(error.message || error);
  process.exit(1);
});
