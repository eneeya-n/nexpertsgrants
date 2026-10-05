import { clearAttempts, recordFailure, tooManyAttempts } from "../../_lib/auth.js";
import { callScript, json } from "../../_lib/offer-mail.js";

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ ok: false, error: "Use the recovery form." }, 405);
  }
  if (!context.env.APPS_SCRIPT_URL || !context.env.APPS_SCRIPT_TOKEN) {
    return json({ ok: false, error: "Letter recovery is not set up yet." }, 503);
  }

  var body;
  try {
    body = await context.request.json();
  } catch (error) {
    return json({ ok: false, error: "Enter your IC number." }, 400);
  }

  if (body && String(body.companyFax || "").trim()) {
    return json({ ok: true, found: false });
  }

  var nric = String(body && body.nric || "").replace(/\D/g, "");
  if (!/^\d{12}$/.test(nric)) {
    return json({ ok: false, error: "Enter your IC number as 12 digits, without dashes." }, 400);
  }

  if (await tooManyAttempts(context.env, context.request, "recover:" + nric)) {
    return json({ ok: false, error: "Too many attempts. Please try again later." }, 429);
  }

  try {
    var result = await callScript(context.env, {
      token: context.env.APPS_SCRIPT_TOKEN,
      action: "lookup",
      nric: nric,
    });
    if (!result || result.ok !== true || typeof result.found !== "boolean") {
      await recordFailure(context.env, context.request, "recover:" + nric);
      return json({ ok: false, error: "We could not look up your registration. Please try again." }, 503);
    }
    if (!result.found || !result.record) {
      await recordFailure(context.env, context.request, "recover:" + nric);
      return json({ ok: true, found: false });
    }
    await clearAttempts(context.env, context.request, "recover:" + nric);
    return json({
      ok: true,
      found: true,
      record: publicRecord(result.record, nric),
    });
  } catch (error) {
    await recordFailure(context.env, context.request, "recover:" + nric);
    return json({ ok: false, error: "We could not look up your registration. Please try again." }, 503);
  }
}

function publicRecord(record, nric) {
  return {
    name: clip(record.name, 120),
    nric: nric,
    email: clip(record.email, 160),
    address: clip(record.address, 500),
    trainingDate: clip(record.trainingDate, 80),
    letterDate: clip(record.letterDate, 20),
  };
}

function clip(value, max) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
