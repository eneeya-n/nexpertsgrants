import { clearAttempts, recordFailure, tooManyAttempts } from "../../_lib/auth.js";
import { callScript, json, loadGuideline, sendLetter } from "../../_lib/offer-mail.js";

export async function onRequest(context) {
  var request = context.request;
  var env = context.env;
  var url = new URL(request.url);
  if (request.method !== "POST") {
    return json({ ok: false, error: "Use the recovery form." }, 405);
  }
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_TOKEN || !env.BREVO_API_KEY) {
    return json({ ok: false, error: "Letter recovery is not set up yet." }, 503);
  }

  var body;
  try {
    body = await request.json();
  } catch (error) {
    return json({ ok: false, error: "Check the form and try again." }, 400);
  }

  if (body && String(body.companyFax || "").trim()) {
    return json({ ok: true });
  }

  var nric = String(body && body.nric || "").replace(/\D/g, "");
  var filename = String(body && body.filename || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  var pdfBase64 = String(body && body.pdfBase64 || "").replace(/\s+/g, "");

  if (!/^\d{12}$/.test(nric)) {
    return json({ ok: false, error: "Enter your IC number as 12 digits, without dashes." }, 400);
  }
  if (!filename || !pdfBase64.startsWith("JVBERi") || pdfBase64.length > 6000000 || !/^[A-Za-z0-9+/=]+$/.test(pdfBase64)) {
    return json({ ok: false, error: "The letter could not be created. Please try again." }, 400);
  }

  if (await tooManyAttempts(env, request, "resend:" + nric)) {
    return json({ ok: false, error: "Too many attempts. Please try again later." }, 429);
  }

  var lookup;
  try {
    lookup = await callScript(env, {
      token: env.APPS_SCRIPT_TOKEN,
      action: "lookup",
      nric: nric,
    });
  } catch (error) {
    await recordFailure(env, request, "resend:" + nric);
    return json({ ok: false, error: "We could not look up your registration. Please try again." }, 503);
  }

  if (!lookup || lookup.ok !== true || typeof lookup.found !== "boolean") {
    await recordFailure(env, request, "resend:" + nric);
    return json({ ok: false, error: "We could not look up your registration. Please try again." }, 503);
  }
  if (!lookup.found || !lookup.record) {
    await recordFailure(env, request, "resend:" + nric);
    return json({ ok: false, error: "No registration was found for this IC number." }, 404);
  }

  var record = {
    name: clip(lookup.record.name, 120),
    nric: nric,
    email: clip(lookup.record.email, 160),
    address: clip(lookup.record.address, 500),
    trainingDate: clip(lookup.record.trainingDate, 80),
    letterDate: clip(lookup.record.letterDate, 20),
    filename: filename,
    pdfBase64: pdfBase64,
  };

  if (!record.name || !record.email || !record.address || !record.trainingDate) {
    return json({ ok: false, error: "Your registration is incomplete. Please contact us on WhatsApp." }, 422);
  }

  try {
    record.guidelineBase64 = await loadGuideline(env, url.origin);
    await sendLetter(env, record);
    await clearAttempts(env, request, "resend:" + nric);
    try {
      await callScript(env, {
        token: env.APPS_SCRIPT_TOKEN,
        action: "markEmail",
        nric: nric,
        emailStatus: "sent",
      });
    } catch (markError) { /* letter already sent */ }
    return json({ ok: true, email: record.email });
  } catch (error) {
    await recordFailure(env, request, "resend:" + nric);
    return json({ ok: false, error: "The letter could not be emailed. Please try again." }, 502);
  }
}

function clip(value, max) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
