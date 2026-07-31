import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ["proprietaire", "gerant", "caissier", "vendeur", "magasinier"];
// Roles a delegated (non-owner, perm_users) creator is allowed to hand out.
const DELEGATE_ROLES = ["gerant", "caissier", "vendeur"];

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

  const { org_id, email, password, full_name, role, store_id } = body ?? {};
  const permCaisse = body?.perm_caisse === true;
  const permCatalog = body?.perm_catalog === true;
  const permInvoices = body?.perm_invoices === true;
  const permUsers = body?.perm_users === true;
  const permViewUsers = body?.perm_view_users === true;
  const permViewReports = body?.perm_view_reports === true;

  if (
    typeof org_id !== "string" ||
    typeof email !== "string" ||
    !EMAIL_RE.test(email) ||
    email.length > 255 ||
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 200 ||
    typeof role !== "string" ||
    !VALID_ROLES.includes(role) ||
    (store_id !== undefined && store_id !== null && typeof store_id !== "string") ||
    (full_name !== undefined && full_name !== null &&
      (typeof full_name !== "string" || full_name.length > 200))
  ) {
    return jsonResponse({ error: "INVALID_REQUEST" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: callerData, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !callerData.user) {
      return jsonResponse({ error: "UNAUTHORIZED" }, 401);
    }

    const { data: membership } = await admin
      .from("memberships")
      .select("role, perm_users")
      .eq("org_id", org_id)
      .eq("user_id", callerData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    const isOwner = membership?.role === "proprietaire";
    const isDelegate = !isOwner && membership?.perm_users === true;
    if (!isOwner && !isDelegate) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }

    // Delegates (granted perm_users but not the owner) can only create ordinary
    // accounts, and can never grant permission flags to the account they create.
    if (isDelegate && !DELEGATE_ROLES.includes(role)) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: full_name ? { full_name } : undefined,
    });

    if (createError || !created.user) {
      return jsonResponse({ error: "USER_CREATE_FAILED" }, 400);
    }

    const { error: membershipError } = await admin.from("memberships").insert({
      org_id,
      user_id: created.user.id,
      role,
      store_id: store_id ?? null,
      perm_caisse: isOwner ? permCaisse : false,
      perm_catalog: isOwner ? permCatalog : false,
      perm_invoices: isOwner ? permInvoices : false,
      perm_users: isOwner ? permUsers : false,
      perm_view_users: isOwner ? permViewUsers : false,
      perm_view_reports: isOwner ? permViewReports : false,
    });

    if (membershipError) {
      return jsonResponse({ error: "MEMBERSHIP_CREATE_FAILED" }, 400);
    }

    return jsonResponse({ user_id: created.user.id }, 200);
  } catch (err) {
    console.error("admin-create-user unexpected error", err);
    return jsonResponse({ error: "SERVER_ERROR" }, 500);
  }
});
