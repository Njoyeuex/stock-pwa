import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_ATTEMPTS = 4;
const LOCKOUT_MINUTES = 15;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
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

  let email: unknown;
  let password: unknown;
  try {
    const body = await req.json();
    email = body.email;
    password = body.password;
  } catch {
    return jsonResponse({ error: "INVALID_REQUEST" }, 400);
  }

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !EMAIL_RE.test(email) ||
    email.length > 255 ||
    password.length < 1 ||
    password.length > 200
  ) {
    return jsonResponse({ error: "INVALID_REQUEST" }, 400);
  }

  const normalizedEmail = email.trim().toLowerCase();
  // service_role bypasses RLS - this is the only piece of code allowed to touch account_lockouts.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: lockout } = await admin
      .from("account_lockouts")
      .select("failed_count, locked_until")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (lockout?.locked_until && new Date(lockout.locked_until) > new Date()) {
      return jsonResponse({ error: "ACCOUNT_LOCKED", locked_until: lockout.locked_until }, 423);
    }

    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (signInError || !signInData.session) {
      // A previously locked_until in the past means the lockout window has expired -> fresh count.
      const baseline = lockout && !lockout.locked_until ? lockout.failed_count : 0;
      const nextFailedCount = baseline + 1;
      const shouldLock = nextFailedCount >= MAX_ATTEMPTS;
      const lockedUntil = shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null;
      await admin.from("account_lockouts").upsert({
        email: normalizedEmail,
        failed_count: nextFailedCount,
        locked_until: lockedUntil,
        updated_at: new Date().toISOString(),
      });
      // Freeze the client immediately on the attempt that trips the lock, rather than
      // waiting for a wasted next attempt to reveal it.
      if (shouldLock) {
        return jsonResponse({ error: "ACCOUNT_LOCKED", locked_until: lockedUntil }, 423);
      }
      return jsonResponse({ error: "AUTH_INVALID" }, 401);
    }

    await admin.from("account_lockouts").delete().eq("email", normalizedEmail);

    return jsonResponse({ session: signInData.session, user: signInData.user }, 200);
  } catch (err) {
    console.error("auth-login unexpected error", err);
    return jsonResponse({ error: "SERVER_ERROR" }, 500);
  }
});
