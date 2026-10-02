import { marketerName } from "./marketers.js";
import { accountName } from "./accounts.js";

var text = new TextEncoder();
var COOKIE = "mg_session";
var SESSION_SECONDS = 4 * 60 * 60;
var FAIL_WINDOW_MS = 15 * 60 * 1000;
var FAIL_LIMIT = 8;
var attempts = new Map();

var DUMMY = {
  i: 100000,
  s: "XQ6n1Nfq2/HM9OavtukQNw==",
  h: "yI3rvq3fPrwhw20IdkSiyBWO2DQmaLqLnhFEx5TIV2o=",
};

export function json(payload, status, extraHeaders) {
  var headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
  };
  if (extraHeaders) {
    Object.keys(extraHeaders).forEach(function (key) {
      headers[key] = extraHeaders[key];
    });
  }
  return new Response(JSON.stringify(payload), { status: status || 200, headers: headers });
}

export function sameOrigin(request) {
  var origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch (error) {
    return false;
  }
}

export function passwordRecords(env) {
  if (!env.MARKETER_PASSWORDS) return null;
  try {
    var parsed = JSON.parse(env.MARKETER_PASSWORDS);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

export async function passwordMatches(password, stored) {
  var record = stored && stored.s && stored.h ? stored : DUMMY;
  var iterations = Number(record.i) || 100000;
  if (iterations < 50000 || iterations > 200000) iterations = 100000;
  var salt = base64ToBytes(record.s);
  var expected = base64ToBytes(record.h);
  if (!salt.length || !expected.length || password.length > 128) return false;
  var key = await crypto.subtle.importKey("raw", text.encode(password), "PBKDF2", false, ["deriveBits"]);
  var derived = new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: salt,
    iterations: iterations,
    hash: "SHA-256",
  }, key, expected.length * 8));
  var same = timingSafeEqual(derived, expected);
  return Boolean(stored && stored.s && stored.h && same);
}

export async function createSession(env, code) {
  var exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  var nonce = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  var body = base64Url(JSON.stringify({ c: code, e: exp, n: nonce }));
  var mac = await sign(env, body);
  return body + "." + mac;
}

export async function readSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  var token = cookieValue(request, COOKIE);
  if (!token || token.length > 600) return null;
  var parts = token.split(".");
  if (parts.length !== 2) return null;
  var expected = await sign(env, parts[0]);
  if (!timingSafeEqual(text.encode(expected), text.encode(parts[1]))) return null;
  var payload;
  try {
    payload = JSON.parse(fromBase64Url(parts[0]));
  } catch (error) {
    return null;
  }
  var rawCode = String(payload && payload.c || "").trim().toUpperCase();
  var exp = Number(payload && payload.e);
  if (!/^[A-Z0-9]{4,10}$/.test(rawCode) || !exp || exp < Math.floor(Date.now() / 1000)) return null;
  if (exp > Math.floor(Date.now() / 1000) + SESSION_SECONDS + 60) return null;
  var name = marketerName(rawCode) || await accountName(env, rawCode);
  if (!name) return null;
  return { code: rawCode, name: name };
}

export function sessionCookie(request, token) {
  var secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return COOKIE + "=" + encodeURIComponent(token) + "; HttpOnly; SameSite=Strict; Path=/" + secure + "; Max-Age=" + SESSION_SECONDS;
}

export function clearCookie(request) {
  var secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return COOKIE + "=; HttpOnly; SameSite=Strict; Path=/" + secure + "; Max-Age=0";
}

export async function tooManyAttempts(env, request, code) {
  var entry = await loadAttempt(env, await attemptKey(request, code));
  if (!entry || entry.until < Date.now()) return false;
  return entry.count >= FAIL_LIMIT;
}

export async function recordFailure(env, request, code) {
  var key = await attemptKey(request, code);
  var now = Date.now();
  var entry = await loadAttempt(env, key);
  if (!entry || entry.until < now) entry = { count: 0, until: now + FAIL_WINDOW_MS };
  entry.count += 1;
  await saveAttempt(env, key, entry);
}

export async function clearAttempts(env, request, code) {
  await deleteAttempt(env, await attemptKey(request, code));
}

async function loadAttempt(env, key) {
  if (env && env.LOGIN_LIMITS) {
    var raw = await env.LOGIN_LIMITS.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  return attempts.get(key) || null;
}

async function saveAttempt(env, key, entry) {
  if (env && env.LOGIN_LIMITS) {
    var seconds = Math.max(60, Math.ceil((entry.until - Date.now()) / 1000));
    await env.LOGIN_LIMITS.put(key, JSON.stringify(entry), { expirationTtl: seconds });
    return;
  }
  attempts.set(key, entry);
  if (attempts.size > 500) {
    var now = Date.now();
    attempts.forEach(function (value, item) {
      if (value.until < now) attempts.delete(item);
    });
  }
}

async function deleteAttempt(env, key) {
  if (env && env.LOGIN_LIMITS) {
    await env.LOGIN_LIMITS.delete(key);
    return;
  }
  attempts.delete(key);
}

async function attemptKey(request, code) {
  var ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "local";
  var data = await crypto.subtle.digest("SHA-256", text.encode("lim|" + ip + "|" + String(code || "").toUpperCase()));
  return "lim:" + bytesToBase64(new Uint8Array(data));
}

async function sign(env, body) {
  var raw = base64ToBytes(String(env.SESSION_SECRET || "").trim());
  if (raw.length < 32) throw new Error("session secret missing");
  var key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  var mac = await crypto.subtle.sign("HMAC", key, text.encode(body));
  return bytesToBase64Url(new Uint8Array(mac));
}

function cookieValue(request, name) {
  var header = request.headers.get("Cookie") || "";
  var parts = header.split(";");
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    var eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return "";
}

function timingSafeEqual(left, right) {
  var length = Math.max(left.length, right.length);
  var mismatch = left.length === right.length ? 0 : 1;
  for (var i = 0; i < length; i++) {
    mismatch |= (left[i] || 0) ^ (right[i] || 0);
  }
  return mismatch === 0;
}

function base64Url(value) {
  return bytesToBase64Url(text.encode(value));
}

function fromBase64Url(value) {
  var padded = value.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4) padded += "=";
  var binary = atob(padded);
  return decodeURIComponent(Array.prototype.map.call(binary, function (char) {
    return "%" + ("00" + char.charCodeAt(0).toString(16)).slice(-2);
  }).join(""));
}

function bytesToBase64(bytes) {
  var binary = "";
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(value) {
  try {
    var padded = String(value).replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) padded += "=";
    var binary = atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (error) {
    return new Uint8Array();
  }
}

export { marketerName };
