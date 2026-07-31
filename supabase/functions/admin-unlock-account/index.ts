import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) {
    return jsonResponse({ error: "UNAUTHORIZED" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "INVALID_REQUEST" }, 400);
  }

  const { email } = body ?? {};
  if (typeof email !== "string" || !EMAIL_RE.test(email) || email.length > 255) {
    return jsonResponse({ error: "INVALID_REQUEST" }, 400);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: callerData, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !callerData.user) {
      return jsonResponse({ error: "UNAUTHORIZED" }, 401);
    }

    const { data: targetUserId } = await admin.rpc("find_user_id_by_email", {
      p_email: normalizedEmail,
    });

    if (!targetUserId) {
      return jsonResponse({ error: "NOT_FOUND" }, 404);
    }

    // Caller must be an active "proprietaire" of at least one org that the target user
    // also belongs to - i.e. can only unlock accounts they actually manage.
    const { data: callerOrgs } = await admin
      .from("memberships")
      .select("org_id")
      .eq("user_id", callerData.user.id)
      .eq("role", "proprietaire")
      .eq("is_active", true);

    const orgIds = (callerOrgs ?? []).map((m) => m.org_id);
    if (orgIds.length === 0) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }

    const { data: targetMembership } = await admin
      .from("memberships")
      .select("id")
      .eq("user_id", targetUserId)
      .in("org_id", orgIds)
      .maybeSingle();

    if (!targetMembership) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }

    await admin.from("account_lockouts").delete().eq("email", normalizedEmail);

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error("admin-unlock-account unexpected error", err);
    return jsonResponse({ error: "SERVER_ERROR" }, 500);
  }
});
