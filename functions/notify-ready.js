const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost({ request, env }) {
  try {
    const result = await notifyReady({
      body: await request.json(),
      env,
    });

    return jsonResponse(result, 200);
  } catch (error) {
    return jsonResponse({ ok: false, error: getErrorMessage(error) }, 500);
  }
}

async function notifyReady({ body, env }) {
  const sessionId = sanitizeToken(body?.sessionId);

  if (!sessionId) {
    return { ok: false, reason: "missing_session_id" };
  }

  assertEnv(env, ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "FROM_EMAIL"]);

  const session = await getSession(env, sessionId);

  if (!session) {
    return { ok: false, reason: "session_not_found" };
  }

  if (!session.owner_email) {
    return { ok: true, notified: false, reason: "missing_owner_email" };
  }

  if (session.ready_notified_at) {
    return { ok: true, notified: false, reason: "already_notified" };
  }

  const ratingCount = await getRatingCount(env, sessionId);
  const minimumRatings = Math.max(Number(session.minimum_ratings) || 3, 1);

  if (ratingCount < minimumRatings) {
    return { ok: true, notified: false, reason: "not_ready", ratingCount, minimumRatings };
  }

  const claimed = await claimNotification(env, sessionId);

  if (!claimed) {
    return { ok: true, notified: false, reason: "already_claimed" };
  }

  try {
    await sendReadyEmail(env, {
      session: claimed,
      ratingCount,
      minimumRatings,
    });
  } catch (error) {
    await releaseNotificationClaim(env, sessionId);
    throw error;
  }

  return { ok: true, notified: true, ratingCount, minimumRatings };
}

async function getSession(env, sessionId) {
  const rows = await supabaseRequest(env, {
    path: `/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}&select=id,owner_token,name,owner_email,minimum_ratings,ready_notified_at`,
  });

  return rows[0] || null;
}

async function getRatingCount(env, sessionId) {
  const rows = await supabaseRequest(env, {
    path: `/rest/v1/ratings?session_id=eq.${encodeURIComponent(sessionId)}&select=id`,
  });

  return rows.length;
}

async function claimNotification(env, sessionId) {
  const timestamp = new Date().toISOString();
  const rows = await supabaseRequest(env, {
    method: "PATCH",
    path: `/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}&ready_notified_at=is.null&select=id,owner_token,name,owner_email,minimum_ratings,ready_notified_at`,
    body: { ready_notified_at: timestamp },
    extraHeaders: { Prefer: "return=representation" },
  });

  return rows[0] || null;
}

async function releaseNotificationClaim(env, sessionId) {
  await supabaseRequest(env, {
    method: "PATCH",
    path: `/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}`,
    body: { ready_notified_at: null },
    extraHeaders: { Prefer: "return=minimal" },
  });
}

async function supabaseRequest(env, { method = "GET", path, body, extraHeaders = {} }) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  }

  if (response.status === 204) {
    return [];
  }

  return response.json();
}

async function sendReadyEmail(env, { session, ratingCount, minimumRatings }) {
  const baseUrl = env.APP_BASE_URL || "https://toolsforunderstanding.com/delulu-spectrum/";
  const resultUrl = new URL(baseUrl);
  resultUrl.searchParams.set("result", session.id);
  resultUrl.searchParams.set("owner", session.owner_token);

  const displayName = session.name === "you" ? "Your" : `${session.name}'s`;
  const subject = "Your Delulu Spectrum result is ready";
  const text = [
    `${displayName} Delulu Spectrum result is ready.`,
    "",
    `You have received ${ratingCount} anonymous ratings. The result unlocks at ${minimumRatings}.`,
    "",
    `Open your private result: ${resultUrl.toString()}`,
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `delulu-ready-${session.id}`,
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [session.owner_email],
      subject,
      text,
      html: `
        <p>${escapeHtml(displayName)} Delulu Spectrum result is ready.</p>
        <p>You have received ${ratingCount} anonymous ratings. The result unlocks at ${minimumRatings}.</p>
        <p><a href="${escapeHtml(resultUrl.toString())}">Open your private result</a></p>
      `,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend request failed: ${response.status} ${await response.text()}`);
  }
}

function assertEnv(env, keys) {
  const missing = keys.filter((key) => !env[key]);

  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

function sanitizeToken(value) {
  return typeof value === "string" ? value.trim().slice(0, 128) : "";
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getErrorMessage(error) {
  return error?.message || "Something went wrong.";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };

    return entities[char];
  });
}
