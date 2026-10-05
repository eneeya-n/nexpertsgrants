import { resolveMarketer } from "../../_lib/accounts.js";
import { callScript, callScriptRetry, deliverOfferLetter, json, markEmailFailed } from "../../_lib/offer-mail.js";

export async function onRequest(context) {
  return handleApply(context);
}

async function handleApply(context) {
  var request = context.request;
  var env = context.env;
  var url = new URL(request.url);

  if (request.method !== "POST") {
    return json({ ok: false, error: "Use the application form." }, 405);
  }
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_TOKEN || !env.BREVO_API_KEY) {
    return json({ ok: false, error: "Letter delivery is not set up yet." }, 503);
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

  var record = validate(body);
  if (record.error) return json({ ok: false, error: record.error }, 400);

  try {
    record.marketer = await resolveMarketer(env, body && body.ref);
  } catch (error) {
    record.marketer = "";
  }

  // 1) Save sheet row first (pending until Brevo accepts the email).
  record.emailStatus = "pending";
  try {
    var saved = await callScriptRetry(env, {
      token: env.APPS_SCRIPT_TOKEN,
      action: "save",
      record: sheetRecord(record),
    }, 4);
    if (!saved || saved.ok !== true) {
      if (saved && saved.duplicate) {
        return json({ ok: false, error: duplicateMessage(saved.marketer, record.marketer) }, 409);
      }
      var verified = await verifySaved(env, record);
      if (!verified) {
        return json({ ok: false, error: "Your registration could not be saved. Please try again." }, 502);
      }
    }
  } catch (error) {
    console.error("sheet save failed", error && error.message ? error.message : error);
    try {
      var recovered = await verifySaved(env, record);
      if (!recovered) {
        return json({ ok: false, error: "Your registration could not be saved. Please try again." }, 502);
      }
    } catch (verifyError) {
      return json({ ok: false, error: "Your registration could not be saved. Please try again." }, 502);
    }
  }

  // 2) Email through Brevo in the same request (Workers Paid has enough CPU/time).
  var emailed = false;
  try {
    await deliverOfferLetter(env, url.origin, {
      name: record.name,
      nric: record.nric,
      email: record.email,
      filename: record.filename,
      pdfBase64: record.pdfBase64,
    });
    emailed = true;
  } catch (mailError) {
    console.error("offer email failed after save", mailError && mailError.message ? mailError.message : mailError);
    await markEmailFailed(env, record.nric);
    emailed = false;
  }

  return json({ ok: true, saved: true, emailed: emailed });
}

async function verifySaved(env, record) {
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var lookup = await callScript(env, {
        token: env.APPS_SCRIPT_TOKEN,
        action: "lookup",
        nric: record.nric,
      });
      if (lookup && lookup.ok === true && lookup.found && lookup.record) {
        var savedEmail = String(lookup.record.email || "").replace(/\s+/g, " ").trim().toLowerCase();
        var givenEmail = String(record.email || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (savedEmail && savedEmail === givenEmail) return true;
      }
      var confirm = await callScript(env, {
        token: env.APPS_SCRIPT_TOKEN,
        action: "confirm",
        nric: record.nric,
        email: record.email,
      });
      if (confirm && confirm.ok === true && confirm.found === true && confirm.match === true) return true;
    } catch (error) {
      // retry
    }
    if (attempt < 2) await new Promise(function (resolve) { setTimeout(resolve, 400 * (attempt + 1)); });
  }
  return false;
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

function sheetRecord(record) {
  return {
    name: record.name,
    nric: record.nric,
    email: record.email,
    phone: record.phone,
    workStatus: record.workStatus,
    street: record.street,
    street2: record.street2,
    city: record.city,
    region: record.region,
    postal: record.postal,
    country: record.country,
    address: record.address,
    trainingDate: record.trainingDate,
    letterDate: record.letterDate,
    filename: record.filename,
    marketer: record.marketer,
    emailStatus: record.emailStatus,
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
