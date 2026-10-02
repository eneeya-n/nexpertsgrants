import { marketerName } from "./marketers.js";

var BUILT_IN_NAMES = {
  masnah: true,
  affendy: true,
  sarah: true,
  alliyah: true,
  has: true,
  shaza: true,
  shaabena: true,
};

var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function accountStore(env) {
  return env && env.LOGIN_LIMITS ? env.LOGIN_LIMITS : null;
}

export function cleanName(value) {
  var name = String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(name)) return "";
  return name;
}

export function cleanEmail(value) {
  var email = String(value || "").replace(/\s+/g, "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) return "";
  return email;
}

export async function loadAccountByCode(env, code) {
  var store = accountStore(env);
  var upper = String(code || "").trim().toUpperCase();
  if (!store || !/^[A-Z0-9]{4,10}$/.test(upper)) return null;
  return parseAccount(await store.get("acct:code:" + upper));
}

export async function loadAccountByEmail(env, email) {
  var store = accountStore(env);
  var key = cleanEmail(email);
  if (!store || !key) return null;
  var code = await store.get("acct:email:" + key);
  if (!code) return null;
  return loadAccountByCode(env, code);
}

export async function accountName(env, code) {
  var built = marketerName(code);
  if (built) return built;
  var account = await loadAccountByCode(env, code);
  return account ? account.name : "";
}

export async function resolveMarketer(env, code) {
  return accountName(env, code);
}

export async function createAccount(env, input) {
  var store = accountStore(env);
  if (!store) return { error: "Account creation is not set up yet.", status: 503 };
  var name = cleanName(input && input.name);
  var email = cleanEmail(input && input.email);
  var password = String(input && input.password || "");
  var confirm = String(input && input.confirm || "");
  if (!name) return { error: "Enter your name using letters only.", status: 400 };
  if (!email) return { error: "Enter a valid email address.", status: 400 };
  if (password.length < 8 || password.length > 128) return { error: "Choose a password of at least 8 characters.", status: 400 };
  if (password !== confirm) return { error: "The passwords do not match.", status: 400 };
  if (BUILT_IN_NAMES[name.toLowerCase()]) return { error: "An account with this name already exists.", status: 409 };

  var nameKey = "acct:name:" + name.toLowerCase();
  var mailKey = "acct:email:" + email;
  if (await store.get(nameKey)) return { error: "An account with this name already exists.", status: 409 };
  if (await store.get(mailKey)) return { error: "An account with this email already exists.", status: 409 };

  var code = await freshCode(store);
  if (!code) return { error: "Account creation could not be completed. Please try again.", status: 503 };
  var hashed = await hashPassword(password);
  var account = {
    name: name,
    email: email,
    code: code,
    i: hashed.i,
    s: hashed.s,
    h: hashed.h,
    createdAt: new Date().toISOString(),
  };
  await store.put("acct:code:" + code, JSON.stringify(account));
  await store.put(mailKey, code);
  if ((await store.get(mailKey)) !== code) {
    await store.delete("acct:code:" + code);
    return { error: "An account with this email already exists.", status: 409 };
  }
  await store.put(nameKey, code);
  return { account: { name: name, email: email, code: code } };
}

async function freshCode(store) {
  for (var attempt = 0; attempt < 8; attempt++) {
    var code = randomCode(6);
    if (marketerName(code)) continue;
    if (await store.get("acct:code:" + code)) continue;
    return code;
  }
  return "";
}

function randomCode(length) {
  var bytes = crypto.getRandomValues(new Uint8Array(length));
  var code = "";
  for (var i = 0; i < bytes.length; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

async function hashPassword(password) {
  var salt = crypto.getRandomValues(new Uint8Array(16));
  var key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  var derived = new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: salt,
    iterations: 100000,
    hash: "SHA-256",
  }, key, 256));
  return { i: 100000, s: toBase64(salt), h: toBase64(derived) };
}

function parseAccount(raw) {
  if (!raw) return null;
  try {
    var data = JSON.parse(raw);
    if (!data || !data.code || !data.name || !data.s || !data.h) return null;
    return data;
  } catch (error) {
    return null;
  }
}

function toBase64(bytes) {
  var binary = "";
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
