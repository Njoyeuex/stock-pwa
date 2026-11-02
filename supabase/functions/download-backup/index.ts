import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Every table with business data worth restoring, with its primary key. Storage objects
// (product photos) are not included - only structured data.
const BACKUP_TABLES: Record<string, string[]> = {
  organizations: ["id"],
  profiles: ["id"],
  memberships: ["id"],
  stores: ["id"],
  product_categories: ["id"],
  products: ["id"],
  product_costs: ["product_id"],
  product_stock: ["product_id", "store_id"],
  stock_movements: ["id"],
  suppliers: ["id"],
  customers: ["id"],
  customer_credit_balances: ["customer_id"],
  customer_credit_movements: ["id"],
  supplier_credit_balances: ["supplier_id"],
  supplier_credit_movements: ["id"],
  purchases: ["id"],
  purchase_lines: ["id"],
  services: ["id"],
  sales: ["id"],
  sale_lines: ["id"],
  payments: ["id"],
  caisse_sessions: ["id"],
  cash_movements: ["id"],
  audit_log: ["id"],
};

// The API caps how many rows one request returns (1000 by default), so a single
// select("*") would silently cut a bigger table. Page through it in primary-key order
// until a page comes back empty, whatever that cap is set to.
const PAGE_SIZE = 1000;

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
    for (const [table, keys] of Object.entries(BACKUP_TABLES)) {
      const rows: unknown[] = [];
      for (let from = 0; ; ) {
        let query = admin.from(table).select("*");
        for (const key of keys) query = query.order(key);
        const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(`export ${table}: ${error.message}`);
        if (!data || data.length === 0) break;
        rows.push(...data);
        from += data.length;
      }
      dump[table] = rows;
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
