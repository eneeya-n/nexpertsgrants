import { clearCookie, json, sameOrigin } from "../../_lib/auth.js";

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ ok: false, error: "Use the sign-out button." }, 405);
  if (!sameOrigin(context.request)) return json({ ok: false }, 403);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie(context.request) });
}
