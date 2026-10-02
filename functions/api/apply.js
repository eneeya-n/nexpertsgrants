import { resolveMarketer } from "../_lib/accounts.js";

export async function onRequest(context) {
  return handleApply(context.request, context.env);
}

async function handleApply(request, env) {
  const url = new URL(request.url);
  if (request.method !== "POST") {
    return json({ ok: false, error: "Use the application form." }, 405);
  }
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_TOKEN || !env.BREVO_API_KEY) {
    return json({ ok: false, error: "Letter delivery is not set up yet." }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return json({ ok: false, error: "Check the form and try again." }, 400);
  }

  if (body && String(body.companyFax || "").trim()) {
    return json({ ok: true });
  }

  const record = validate(body);
  if (record.error) return json({ ok: false, error: record.error }, 400);

  try {
    record.marketer = await resolveMarketer(env, body && body.ref);
    var existing = await callScript(env, {
      token: env.APPS_SCRIPT_TOKEN,
      action: "check",
      nric: record.nric,
    });
    if (!existing || existing.ok !== true || typeof existing.found !== "boolean") {
      return json({ ok: false, error: "We could not confirm your IC number. Please try again." }, 503);
    }
    if (existing.found) {
      return json({ ok: false, error: duplicateMessage(existing.marketer, record.marketer) }, 409);
    }
  } catch (error) {
    return json({ ok: false, error: "We could not confirm your IC number. Please try again." }, 503);
  }

  let emailed = false;
  try {
    const guideline = await loadGuideline(env, url.origin);
    record.guidelineBase64 = guideline;
    await sendLetter(env, record);
    emailed = true;
    record.emailStatus = "sent";
    await saveApplication(env, record);
    return json({ ok: true });
  } catch (error) {
    if (!emailed) {
      record.emailStatus = "failed";
      try { await saveApplication(env, record); } catch (saveError) { /* keep the email error */ }
      return json({ ok: false, error: "The letter could not be emailed. Please try again." }, 502);
    }
    return json({ ok: true });
  }
}

function validate(body) {
  const name = oneLine(body && body.name).slice(0, 120);
  const nric = String(body && body.nric || "").replace(/\D/g, "");
  const email = oneLine(body && body.email).slice(0, 160);
  const phoneDigits = String(body && body.phone || "").replace(/\D/g, "");
  const workStatus = oneLine(body && body.workStatus).slice(0, 40);
  const street = oneLine(body && body.street).slice(0, 160);
  const street2 = oneLine(body && body.street2).slice(0, 160);
  const city = oneLine(body && body.city).slice(0, 80);
  const region = oneLine(body && body.region).slice(0, 80);
  const postal = oneLine(body && body.postal).slice(0, 20);
  const country = oneLine(body && body.country).slice(0, 80);
  const address = oneLine(body && body.address).slice(0, 500);
  const trainingDate = oneLine(body && body.trainingDate).slice(0, 80);
  const letterDate = oneLine(body && body.letterDate);
  const filename = oneLine(body && body.filename).replace(/[\\/:*?"<>|]+/g, " ").slice(0, 180);
  const pdfBase64 = String(body && body.pdfBase64 || "").replace(/\s+/g, "");

  if (!name) return { error: "Enter your full name as per IC." };
  if (!/^\d{12}$/.test(nric)) return { error: "Enter your IC number as 12 digits, without dashes." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  if (phoneDigits.length < 8 || phoneDigits.length > 15) return { error: "Enter your phone number." };
  if (!workStatus) return { error: "Choose your current working status." };
  if (!street || !city || !region || !postal || !country) return { error: "Complete your address." };
  if (!trainingDate) return { error: "Choose a training schedule." };
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(letterDate)) return { error: "Check the form and try again." };
  if (!filename || !pdfBase64.startsWith("JVBERi") || pdfBase64.length > 6000000 || !/^[A-Za-z0-9+/=]+$/.test(pdfBase64)) {
    return { error: "The letter could not be created. Please try again." };
  }

  return {
    name: name,
    nric: nric,
    email: email,
    phone: formatPhone(phoneDigits),
    workStatus: workStatus,
    street: street,
    street2: street2,
    city: city,
    region: region,
    postal: postal,
    country: country,
    address: address,
    trainingDate: trainingDate,
    letterDate: letterDate,
    filename: filename,
    pdfBase64: pdfBase64,
  };
}

function duplicateMessage(existing, current) {
  var left = String(existing || "").trim().toLowerCase();
  var right = String(current || "").trim().toLowerCase();
  if (left && right && left !== right) return "This IC number is already registered with another marketer.";
  return "This IC number is already registered.";
}

function formatPhone(digits) {
  if (digits.indexOf("60") === 0 && digits.length > 9) return "+" + digits;
  var local = digits.charAt(0) === "0" ? digits.slice(1) : digits;
  return "+60" + local;
}

function oneLine(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

var COPY_TO = ["asma@nexpertsacademy.com", "aisyah@nexpertsacademy.com"];

async function sendLetter(env, record) {
  const cc = COPY_TO.filter(function (email) {
    return email.toLowerCase() !== record.email.toLowerCase();
  }).map(function (email) {
    return { email: email };
  });
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: env.BREVO_SENDER_EMAIL || "info@nexpertsai.com",
        name: env.BREVO_SENDER_NAME || "Nexperts Academy",
      },
      to: [{ email: record.email, name: record.name }],
      cc: cc,
      subject: "Letter of Enrolment - CEH",
      textContent: offerText(record.name),
      attachment: [
        { name: record.filename, content: record.pdfBase64 },
        { name: "Application Guideline.pdf", content: record.guidelineBase64 },
      ],
    }),
  });
  if (!response.ok) throw new Error("Email provider declined the letter");
}

function offerText(name) {
  return [
    "Hi " + name + ",",
    "",
    "Please find attached offer letter. Please follow the steps below to complete your application.",
    "",
    "Next Steps:",
    "1. Please sign the last page of the Letter of Enrolment. And send the copy ALL PAGES to us.",
    "2. Prepare documents with signature and cop pengesahan salinan benar/CTC for the application.",
    "-Identity Card (NRIC) - colour",
    "-Birth Certificate",
    "-Bank Statement for the 3 recent month (front page only)",
    "-SPM cert (only if that is highest education)",
    "3. Please send all documents for double checking before you submit the application.",
    "4. Once your documents have been checked, submit the fully completed application, together with all mandatory supporting documents, at https://peneraju.org.",
    "Apply for the Silver Package only, and complete these selections:",
    "1. Select ALTI Nexperts Academy Sdn Bhd",
    "2. Choose Certified Ethical Hacker",
    "Upload the full Letter of Enrolment as part of that application.",
    "",
    "If you have any questions, or you would like us to check your documents, please contact us by WhatsApp at +60 11-1221 6870, or by email at asma@nexpertsacademy.com or aisyah@nexpertsacademy.com.",
    "",
    "Thank you.",
    "",
    "This is an automated no-reply email. Please do not reply to this message. Replies are not received and are not read. Please use WhatsApp or the email addresses above if you need to reach us.",
  ].join("\n");
}

async function saveApplication(env, record) {
  const sheetRecord = Object.assign({}, record);
  delete sheetRecord.pdfBase64;
  delete sheetRecord.guidelineBase64;
  return callScript(env, {
    token: env.APPS_SCRIPT_TOKEN,
    record: sheetRecord,
  });
}

async function callScript(env, payload) {
  let response = await fetch(env.APPS_SCRIPT_URL, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "NexpertsGrants/1.0",
    },
    body: JSON.stringify(payload),
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("Location");
    if (!location) throw new Error("Missing script redirect");
    response = await fetch(new URL(location, env.APPS_SCRIPT_URL), {
      method: "GET",
      redirect: "follow",
    });
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("Script did not return JSON");
  }
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

var guidelineCache = "";

async function loadGuideline(env, origin) {
  if (guidelineCache) return guidelineCache;
  const response = await env.ASSETS.fetch(origin + "/Application%20Guideline.pdf");
  if (!response.ok) throw new Error("Guidelines file missing");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 5) throw new Error("Guidelines file missing");
  guidelineCache = bytesToBase64(bytes);
  return guidelineCache;
}

function bytesToBase64(bytes) {
  var binary = "";
  var chunk = 0x2000;
  for (var i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
