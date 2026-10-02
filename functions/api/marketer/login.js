import { json, passwordMatches, passwordRecords, sameOrigin, createSession, sessionCookie, tooManyAttempts, recordFailure, clearAttempts } from "../../_lib/auth.js";
import { cleanEmail, loadAccountByCode, loadAccountByEmail } from "../../_lib/accounts.js";
import { marketerCode } from "../../_lib/marketers.js";

export async function onRequest(context) {
  var request = context.request;
  if (request.method !== "POST") return json({ ok: false, error: "Use the sign-in form." }, 405);
  if (!sameOrigin(request)) return json({ ok: false, error: "The code or password is not correct." }, 403);

  var length = Number(request.headers.get("Content-Length") || 0);
  if (length > 2000) return json({ ok: false, error: "The code or password is not correct." }, 400);

  var body;
  try {
    body = await request.json();
  } catch (error) {
    return json({ ok: false, error: "The code or password is not correct." }, 400);
  }

  var entered = String(body && body.code || "").trim().slice(0, 160);
  var password = String(body && body.password || "");
  if (!context.env.SESSION_SECRET) {
    return json({ ok: false, error: "Marketer sign-in is not set up yet." }, 503);
  }
  if (await tooManyAttempts(context.env, request, entered)) {
    return json({ ok: false, error: "Too many attempts. Please wait and try again." }, 429);
  }
  if (password.length < 8 || password.length > 128) {
    await recordFailure(context.env, request, entered);
    await pause();
    return json({ ok: false, error: "The code or password is not correct." }, 401);
  }

  var identity = await findIdentity(context.env, entered);
  var valid = false;
  try {
    valid = await passwordMatches(password, identity && identity.stored);
  } catch (error) {
    valid = false;
  }
  if (!valid || !identity || !identity.code) {
    await recordFailure(context.env, request, entered);
    await pause();
    return json({ ok: false, error: "The code or password is not correct." }, 401);
  }

  await clearAttempts(context.env, request, entered);
  try {
    var token = await createSession(context.env, identity.code);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, token) });
  } catch (error) {
    return json({ ok: false, error: "Marketer sign-in is not set up yet." }, 503);
  }
}

function pause() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 400);
  });
}

async function findIdentity(env, entered) {
  var email = cleanEmail(entered);
  if (email) {
    var byEmail = await loadAccountByEmail(env, email);
    return byEmail ? { code: byEmail.code, stored: byEmail } : null;
  }
  var code = String(entered || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) return null;
  var account = await loadAccountByCode(env, code);
  if (account) return { code: account.code, stored: account };
  var builtIn = marketerCode(code);
  var records = passwordRecords(env) || {};
  return builtIn ? { code: builtIn, stored: records[builtIn] || null } : null;
}
