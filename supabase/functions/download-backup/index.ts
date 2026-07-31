import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Every table with business data worth restoring. Storage objects (product photos) are
// not included - only structured data.
const BACKUP_TABLES = [
  "organizations",
  "profiles",
  "memberships",
  "stores",
  "product_categories",
  "products",
  "product_costs",
  "product_stock",
  "stock_movements",
  "suppliers",
  "customers",
  "customer_credit_balances",
  "customer_credit_movements",
  "purchases",
  "purchase_lines",
  "services",
  "sales",
  "sale_lines",
  "payments",
  "caisse_sessions",
  "cash_movements",
  "audit_log",
];

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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: callerData, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !callerData.user) {
      return jsonResponse({ error: "UNAUTHORIZED" }, 401);
    }

    const { data: membership } = await admin
      .from("memberships")
      .select("org_id")
      .eq("user_id", callerData.user.id)
      .eq("role", "proprietaire")
      .eq("is_active", true)
      .maybeSingle();

    if (!membership) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }

    const dump: Record<string, unknown[]> = {};
    for (const table of BACKUP_TABLES) {
      const { data, error } = await admin.from(table).select("*");
      if (error) throw new Error(`export ${table}: ${error.message}`);
      dump[table] = data ?? [];
    }

    await admin.from("audit_log").insert({
      org_id: membership.org_id,
      user_id: callerData.user.id,
      action: "backup_downloaded",
      entity_table: "backup",
    });

    const fileName = `manariyo-backup-${new Date().toISOString().slice(0, 10)}.json`;

    return new Response(JSON.stringify(dump), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        ...corsHeaders,
      },
    });
  } catch (err) {
    console.error("download-backup failed", err);
    return jsonResponse({ error: "SERVER_ERROR" }, 500);
  }
});
