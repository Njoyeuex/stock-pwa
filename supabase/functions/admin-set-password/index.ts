import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  const { org_id, membership_id, password } = body ?? {};

  if (
    typeof org_id !== "string" ||
    typeof membership_id !== "string" ||
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 200
  ) {
    return jsonResponse({ error: "INVALID_REQUEST" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: callerData, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !callerData.user) {
      return jsonResponse({ error: "UNAUTHORIZED" }, 401);
    }

    const { data: callerMembership } = await admin
      .from("memberships")
      .select("role, perm_users")
      .eq("org_id", org_id)
      .eq("user_id", callerData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    // Only the owner, or a gérant the owner granted perm_users, may set someone else's
    // password: unlike create/delete, this lets the caller sign in as that account.
    const isOwner = callerMembership?.role === "proprietaire";
    const isManager = callerMembership?.role === "gerant" && callerMembership?.perm_users === true;
    if (!isOwner && !isManager) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }

    const { data: target } = await admin
      .from("memberships")
      .select("id, user_id, role")
      .eq("id", membership_id)
      .eq("org_id", org_id)
      .maybeSingle();

    if (!target) {
      return jsonResponse({ error: "NOT_FOUND" }, 404);
    }
    if (target.user_id === callerData.user.id || target.role === "proprietaire") {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }

    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(target.user_id, {
      password,
    });
    if (updateError || !updated.user) {
      return jsonResponse({ error: "PASSWORD_UPDATE_FAILED" }, 400);
    }

    // A new password is usually set for someone who got locked out: let them sign in now.
    if (updated.user.email) {
      await admin.from("account_lockouts").delete().eq("email", updated.user.email.toLowerCase());
    }

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error("admin-set-password unexpected error", err);
    return jsonResponse({ error: "SERVER_ERROR" }, 500);
  }
});
