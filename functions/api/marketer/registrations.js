import { json, readSession } from "../../_lib/auth.js";

export async function onRequest(context) {
  if (context.request.method !== "GET") return json({ ok: false, error: "Use the dashboard." }, 405);
  var session = await readSession(context.request, context.env);
  if (!session) return json({ ok: false }, 401);
  if (!context.env.APPS_SCRIPT_URL || !context.env.APPS_SCRIPT_TOKEN) {
    return dashboard(session, [], "The registration list is not available right now.");
  }

  try {
    var result = await callScript(context.env, {
      token: context.env.APPS_SCRIPT_TOKEN,
      action: "list",
      marketer: session.name,
    });
    if (!result || result.ok !== true || !Array.isArray(result.rows)) {
      return dashboard(session, [], "The registration list is not available right now.");
    }
    return dashboard(session, result.rows.slice(0, 300).map(publicRow), "");
  } catch (error) {
    return dashboard(session, [], "The registration list is not available right now.");
  }
}

function dashboard(session, rows, listError) {
  return json({
    ok: true,
    name: session.name,
    link: "https://www.nexpertsgrants.com/?ref=" + encodeURIComponent(session.code),
    rows: rows,
    listError: listError,
  });
}

function publicRow(row) {
  var ending = String(row && row.nricLast4 || "").replace(/\D/g, "").slice(-4);
  return {
    submittedAt: clip(row && row.submittedAt, 40),
    name: clip(row && row.name, 120),
    email: clip(row && row.email, 160),
    phone: clip(row && row.phone, 24),
    training: clip(row && row.training, 80),
    workStatus: clip(row && row.workStatus, 40),
    emailStatus: clip(row && row.emailStatus, 20),
    icEnding: ending,
  };
}

function clip(value, max) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

async function callScript(env, payload) {
  var response = await fetch(env.APPS_SCRIPT_URL, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
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
    });
  }
  return JSON.parse(await response.text());
}
