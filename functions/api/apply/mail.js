import {
  callScript,
  deliverOfferLetter,
  json,
  markEmailFailed,
} from "../../_lib/offer-mail.js";

export async function onRequest(context) {
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

  var name = oneLine(body && body.name).slice(0, 120);
  var nric = String(body && body.nric || "").replace(/\D/g, "");
  var email = oneLine(body && body.email).slice(0, 160);
  var filename = oneLine(body && body.filename).replace(/[\\/:*?"<>|]+/g, " ").slice(0, 180);
  var pdfBase64 = String(body && body.pdfBase64 || "").replace(/\s+/g, "");

  if (!name || !/^\d{12}$/.test(nric) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Check the form and try again." }, 400);
  }
  if (!filename || !pdfBase64.startsWith("JVBERi") || pdfBase64.length > 6000000 || !/^[A-Za-z0-9+/=]+$/.test(pdfBase64)) {
    return json({ ok: false, error: "The letter could not be created. Please try again." }, 400);
  }

  var confirmed = await confirmRegistration(env, nric, email);
  if (!confirmed.ok) {
    return json({ ok: false, error: confirmed.error }, confirmed.status || 502);
  }

  try {
    await deliverOfferLetter(env, url.origin, {
      name: name,
      nric: nric,
      email: email,
      filename: filename,
      pdfBase64: pdfBase64,
    });
    return json({ ok: true, emailed: true });
  } catch (error) {
    console.error("offer email failed", error && error.message ? error.message : error);
    await markEmailFailed(env, nric);
    return json({ ok: false, error: "The letter could not be emailed. Please try again." }, 502);
  }
}

async function confirmRegistration(env, nric, email) {
  for (var attempt = 0; attempt < 4; attempt++) {
    try {
      var confirm = await callScript(env, {
        token: env.APPS_SCRIPT_TOKEN,
        action: "confirm",
        nric: nric,
        email: email,
      });
      if (confirm && confirm.ok === true) {
        if (confirm.found === true && confirm.match === true) return { ok: true };
        if (confirm.found === true && confirm.match === false) {
          return { ok: false, error: "Your registration could not be confirmed. Please try again.", status: 403 };
        }
      }
    } catch (error) {
      // Older Apps Script deployments may not have "confirm" yet.
    }

    try {
      var lookup = await callScript(env, {
        token: env.APPS_SCRIPT_TOKEN,
        action: "lookup",
        nric: nric,
      });
      if (lookup && lookup.ok === true && lookup.found && lookup.record) {
        var savedEmail = String(lookup.record.email || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (savedEmail === email.toLowerCase()) return { ok: true };
        return { ok: false, error: "Your registration could not be confirmed. Please try again.", status: 403 };
      }
    } catch (error) {
      // retry
    }

    try {
      var check = await callScript(env, {
        token: env.APPS_SCRIPT_TOKEN,
        action: "check",
        nric: nric,
      });
      if (check && check.ok === true && check.found === true && attempt > 0) {
        return { ok: true };
      }
    } catch (error) {
      // retry
    }

    await sleep(600 * (attempt + 1));
  }
  return { ok: false, error: "Your registration was not found. Submit the form first.", status: 404 };
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function oneLine(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}
