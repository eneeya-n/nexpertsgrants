var COPY_TO = ["asma@nexpertsacademy.com", "aisyah@nexpertsacademy.com"];
var guidelineCache = "";

export async function callScript(env, payload) {
  var response = await fetch(env.APPS_SCRIPT_URL, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
      "User-Agent": "NexpertsGrants/1.0",
    },
    body: JSON.stringify(payload),
  });

  if (response.status >= 300 && response.status < 400) {
    var location = response.headers.get("Location");
    if (!location) throw new Error("Missing script redirect");
    response = await fetch(new URL(location, env.APPS_SCRIPT_URL), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "NexpertsGrants/1.0",
      },
    });
  }

  var text = await response.text();
  var trimmed = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("Script returned an empty response");
  var parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error("Script did not return JSON");
  }
  // A mistaken follow into doGet must never look like a normal script failure.
  if (parsed && parsed.ok === false && parsed.error === "Use the application form.") {
    throw new Error("Script redirect returned doGet");
  }
  return parsed;
}

export async function callScriptRetry(env, payload, attempts) {
  var tries = Math.max(1, attempts || 3);
  var lastError = null;
  for (var i = 0; i < tries; i++) {
    try {
      var result = await callScript(env, payload);
      if (result && result.ok === true) return result;
      if (result && result.duplicate) return result;
      lastError = new Error((result && result.error) || "Script call failed");
      if (!isRetryableScriptError(result && result.error)) break;
    } catch (error) {
      lastError = error;
    }
    if (i + 1 < tries) await sleep(500 * (i + 1));
  }
  throw lastError || new Error("Script call failed");
}

function isRetryableScriptError(error) {
  var message = String(error || "");
  return !message ||
    message === "Busy" ||
    message === "Delivery failed" ||
    message === "Script redirect returned doGet" ||
    message === "Script returned an empty response" ||
    message === "Script did not return JSON";
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

export async function loadGuideline(env, origin) {
  if (guidelineCache) return guidelineCache;
  var path = "/Application%20Guideline.pdf";
  var response = null;
  if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
    response = await env.ASSETS.fetch(origin + path);
  }
  if (!response || !response.ok) {
    response = await fetch(origin + path);
  }
  if (!response.ok) throw new Error("Guidelines file missing");
  var bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 5) throw new Error("Guidelines file missing");
  guidelineCache = bytesToBase64(bytes);
  return guidelineCache;
}

/**
 * Send the offer letter through Brevo, then best-effort mark sheet status.
 * Throws only if Brevo send fails. markEmail failures do not undo a successful send.
 */
export async function deliverOfferLetter(env, origin, record) {
  record.guidelineBase64 = await loadGuideline(env, origin);
  await sendLetter(env, record);
  try {
    await callScriptRetry(env, {
      token: env.APPS_SCRIPT_TOKEN,
      action: "markEmail",
      nric: record.nric,
      emailStatus: "sent",
    }, 4);
  } catch (markError) {
    console.error("mark email sent status", markError && markError.message ? markError.message : markError);
  }
}

export async function markEmailFailed(env, nric) {
  try {
    await callScriptRetry(env, {
      token: env.APPS_SCRIPT_TOKEN,
      action: "markEmail",
      nric: nric,
      emailStatus: "failed",
    }, 4);
  } catch (markError) {
    console.error("mark email failed status", markError && markError.message ? markError.message : markError);
  }
}

export async function sendLetter(env, record) {
  var cc = COPY_TO.filter(function (email) {
    return email.toLowerCase() !== record.email.toLowerCase();
  }).map(function (email) {
    return { email: email };
  });
  var response = await fetch("https://api.brevo.com/v3/smtp/email", {
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
      htmlContent: offerHtml(record.name),
      textContent: offerText(record.name),
      attachment: [
        { name: record.filename, content: record.pdfBase64 },
        { name: "Application Guideline.pdf", content: record.guidelineBase64 },
      ],
    }),
  });
  var payload = await response.json().catch(function () { return {}; });
  if (!response.ok || !payload.messageId) {
    console.error("offer email declined", response.status, payload && payload.code ? payload.code : "");
    throw new Error("Email provider declined the letter");
  }
}

export function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function offerHtml(name) {
  return "<p>" + offerText(name).split("\n").map(function (line) {
    return escapeHtml(line);
  }).join("<br>") + "</p>";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
    "If you have any questions, or you would like us to check your documents, please contact us by WhatsApp at 011 1221 6870 or +60 11 3337 5331, or by email at asma@nexpertsacademy.com or aisyah@nexpertsacademy.com.",
    "",
    "Thank you.",
    "",
    "This is an automated no-reply email. Please do not reply to this message. Replies are not received and are not read. Please use WhatsApp on 011 1221 6870 or +60 11 3337 5331, or the email addresses above, if you need to reach us.",
  ].join("\n");
}

function bytesToBase64(bytes) {
  var binary = "";
  var chunk = 0x2000;
  for (var i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
