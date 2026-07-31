import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BACKUP_TRIGGER_SECRET = Deno.env.get("BACKUP_TRIGGER_SECRET");
const GOOGLE_OAUTH_CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
const GOOGLE_OAUTH_CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
const GOOGLE_OAUTH_REFRESH_TOKEN = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN");
const GOOGLE_DRIVE_FOLDER_ID = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");

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

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Personal Gmail accounts have no Shared Drive, and a plain service account has no
// storage quota of its own on a regular My Drive folder - so we authenticate as the
// actual Google account (via a long-lived refresh token from a one-time OAuth consent)
// instead of a service account. Uploaded files then belong to that account's own quota.
async function getGoogleAccessTokenFromRefreshToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error(`google token refresh failed: ${await res.text()}`);
  }

  const tokenData = await res.json();
  return tokenData.access_token as string;
}

async function uploadToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  jsonContent: string,
): Promise<string> {
  const metadata = { name: fileName, parents: [folderId] };
  const boundary = "manariyo-backup-boundary";
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${jsonContent}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!res.ok) {
    throw new Error(`drive upload failed: ${await res.text()}`);
  }

  const data = await res.json();
  return data.id as string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  // Authenticated via a shared secret (stored in Supabase Vault, sent by the pg_cron job)
  // rather than a Supabase JWT, since this is only ever called server-to-server.
  const providedSecret = req.headers.get("x-backup-secret");
  if (!BACKUP_TRIGGER_SECRET || providedSecret !== BACKUP_TRIGGER_SECRET) {
    return jsonResponse({ error: "UNAUTHORIZED" }, 401);
  }

  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REFRESH_TOKEN || !GOOGLE_DRIVE_FOLDER_ID) {
    return jsonResponse({ error: "BACKUP_NOT_CONFIGURED" }, 500);
  }

  let runType = "scheduled";
  try {
    const body = await req.json();
    if (body?.run_type === "manual") runType = "manual";
  } catch {
    // no body (cron call) - keep the "scheduled" default
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: run } = await admin
    .from("backup_runs")
    .insert({ run_type: runType })
    .select("id")
    .single();
  const runId = run?.id as string | undefined;

  try {
    const dump: Record<string, unknown[]> = {};
    for (const table of BACKUP_TABLES) {
      const { data, error } = await admin.from(table).select("*");
      if (error) throw new Error(`export ${table}: ${error.message}`);
      dump[table] = data ?? [];
    }

    const json = JSON.stringify(dump);
    const fileName = `manariyo-backup-${new Date().toISOString().slice(0, 10)}.json`;

    const accessToken = await getGoogleAccessTokenFromRefreshToken(
      GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET,
      GOOGLE_OAUTH_REFRESH_TOKEN,
    );
    const driveFileId = await uploadToDrive(accessToken, GOOGLE_DRIVE_FOLDER_ID, fileName, json);

    if (runId) {
      await admin
        .from("backup_runs")
        .update({ status: "success", finished_at: new Date().toISOString(), drive_file_id: driveFileId })
        .eq("id", runId);
    }

    return jsonResponse({ ok: true, drive_file_id: driveFileId }, 200);
  } catch (err) {
    console.error("backup-to-drive failed", err);
    if (runId) {
      await admin
        .from("backup_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: String(err instanceof Error ? err.message : err).slice(0, 2000),
        })
        .eq("id", runId);
    }
    return jsonResponse({ error: "BACKUP_FAILED" }, 500);
  }
});
