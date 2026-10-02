import { clearAttempts, createSession, json, recordFailure, sameOrigin, sessionCookie, tooManyAttempts } from "../../_lib/auth.js";
import { createAccount } from "../../_lib/accounts.js";

export async function onRequest(context) {
  var request = context.request;
  if (request.method !== "POST") return json({ ok: false, error: "Use the create account form." }, 405);
  if (!sameOrigin(request)) return json({ ok: false, error: "Account creation could not be completed." }, 403);
  var length = Number(request.headers.get("Content-Length") || 0);
  if (length > 4000) return json({ ok: false, error: "Account creation could not be completed." }, 400);
  if (!context.env.SESSION_SECRET) return json({ ok: false, error: "Account creation is not set up yet." }, 503);

  var body;
  try {
    body = await request.json();
  } catch (error) {
    return json({ ok: false, error: "Check the form and try again." }, 400);
  }
  if (body && String(body.companyFax || "").trim()) return json({ ok: true });

  var limitKey = "signup";
  if (await tooManyAttempts(context.env, request, limitKey)) {
    return json({ ok: false, error: "Too many attempts. Please wait and try again." }, 429);
  }

  var created;
  try {
    created = await createAccount(context.env, body || {});
  } catch (error) {
    await recordFailure(context.env, request, limitKey);
    return json({ ok: false, error: "Account creation could not be completed. Please try again." }, 503);
  }
  if (!created || created.error) {
    var status = created && created.status ? created.status : 400;
    if (status === 409 || status === 400) await recordFailure(context.env, request, limitKey);
    return json({ ok: false, error: created && created.error ? created.error : "Check the form and try again." }, status);
  }

  await clearAttempts(context.env, request, limitKey);
  try {
    var token = await createSession(context.env, created.account.code);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, token) });
  } catch (error) {
    return json({ ok: false, error: "Account creation is not set up yet." }, 503);
  }
}
