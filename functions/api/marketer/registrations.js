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
    var rows = result.rows.filter(function (row) {
      return String(row && row.emailStatus || "").trim().toLowerCase() !== "failed";
    }).slice(0, 300).map(publicRow);
    return dashboard(session, rows, "");
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
  return {
    submittedAt: clip(row && row.submittedAt, 40),
    name: clip(row && row.name, 120),
    serialNo: clip(row && row.serialNo, 40),
    applicationStatus: clip(row && row.applicationStatus, 80),
    paymentStatus: clip(row && row.paymentStatus, 80),
    commissionStatus: clip(row && row.commissionStatus, 80),
    // Kept for the failed-row filter above; not shown on the dashboard.
    emailStatus: clip(row && row.emailStatus, 20),
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
