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

  const { org_id, membership_id } = body ?? {};

  if (typeof org_id !== "string" || typeof membership_id !== "string") {
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

    const isOwner = callerMembership?.role === "proprietaire";
    const isDelegate = !isOwner && callerMembership?.perm_users === true;
    if (!isOwner && !isDelegate) {
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
    if (target.user_id === callerData.user.id) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }
    if (target.role === "proprietaire") {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }

    const { error: deleteError } = await admin.from("memberships").delete().eq("id", target.id);
    if (deleteError) {
      return jsonResponse({ error: "SERVER_ERROR" }, 500);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error("admin-delete-user unexpected error", err);
    return jsonResponse({ error: "SERVER_ERROR" }, 500);
  }
});
