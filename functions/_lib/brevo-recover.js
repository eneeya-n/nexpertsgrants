var SUBJECT = "Letter of Enrolment - CEH";
var SKIP = {
  "asma@nexpertsacademy.com": true,
  "aisyah@nexpertsacademy.com": true,
  "enquiry@nexpertsacademy.com": true,
  "info@nexpertsai.com": true,
};

export async function recoverOfferLetters(env, startDate, endDate, options) {
  var opts = options || {};
  var start = String(startDate || "2026-09-20").slice(0, 10);
  var end = String(endDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  var events = await listRequestEvents(env.BREVO_API_KEY, start, end);
  var offer = events.filter(function (item) {
    return String(item.subject || "").indexOf(SUBJECT) !== -1;
  });

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

  var out = [];
  for (var i = 0; i < emails.length; i++) {
    var email = emails[i];
    var item = byEmail[email];
    var name = "";
    if (opts.withNames !== false) {
      try {
        name = await nameForEmail(env.BREVO_API_KEY, email, item.messageId || "", start, end);
      } catch (error) {
        console.warn("brevo name failed", email, error && error.message ? error.message : error);
      }
    }
    out.push({
      sentAt: item.date || "",
      name: name,
      email: email,
      subject: item.subject || SUBJECT,
      messageId: item.messageId || "",
      uuid: "",
      attachmentCount: 0,
    });
  }

  return {
    start: start,
    end: end,
    scanned: events.length,
    offerEmails: offer.length,
    uniqueApplicants: out.length,
    rows: out,
  };
}

export function toCsv(rows) {
  var header = ["Sent at", "Full name", "Email", "Subject", "Message ID", "UUID"];
  var lines = [header.map(csvEscape).join(",")];
  rows.forEach(function (row) {
    lines.push([row.sentAt, row.name, row.email, row.subject, row.messageId, row.uuid].map(csvEscape).join(","));
  });
  return lines.join("\n") + "\n";
}

export function toSheetCsv(rows) {
  var header = [
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
  ];
  var lines = [header.map(csvEscape).join(",")];
  rows.forEach(function (row) {
    var sent = String(row.sentAt || "").replace("T", " ").replace(/\.\d+.*/, "").replace("Z", "");
    lines.push([
      sent,
      row.name || "",
      "",
      row.email || "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "sent",
    ].map(csvEscape).join(","));
  });
  return lines.join("\n") + "\n";
}

async function listRequestEvents(apiKey, start, end) {
  var rows = [];
  var offset = 0;
  var limit = 2500;
  while (true) {
    var query = new URLSearchParams({
      startDate: start,
      endDate: end,
      event: "requests",
      sort: "desc",
      limit: String(limit),
      offset: String(offset),
    });
    var data = await brevo(apiKey, "/smtp/statistics/events?" + query.toString());
    var batch = data.events || [];
    if (!batch.length) break;
    rows = rows.concat(batch);
    if (batch.length < limit) break;
    offset += limit;
    if (offset > 20000) break;
  }
  return rows;
}

async function nameForEmail(apiKey, email, messageId, start, end) {
  var query = new URLSearchParams({
    email: email,
    startDate: start,
    endDate: end,
    limit: "5",
    sort: "desc",
  });
  if (messageId) query.set("messageId", messageId);
  var data = await brevo(apiKey, "/smtp/emails?" + query.toString());
  var list = data.transactionalEmails || [];
  var item = list.find(function (row) {
    return String(row.subject || "").indexOf(SUBJECT) !== -1;
  }) || list[0];
  if (!item || !item.uuid) return "";
  var content = await brevo(apiKey, "/smtp/emails/" + encodeURIComponent(item.uuid));
  return nameFromBody(content.body || content.htmlContent || content.textContent || "");
}

async function brevo(apiKey, pathname) {
  var response = await fetch("https://api.brevo.com/v3" + pathname, {
    headers: {
      accept: "application/json",
      "api-key": apiKey,
    },
  });
  var text = await response.text();
  var data = {};
  try { data = JSON.parse(text); } catch (error) { data = { raw: text }; }
  if (!response.ok) {
    throw new Error("Brevo " + response.status + ": " + (data.message || data.code || text.slice(0, 200)));
  }
  return data;
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

function csvEscape(value) {
  return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
}
