import { supabase, FUNCTIONS_URL } from "./supabaseClient";
import { mapEdgeFunctionError } from "./errorMessages";

export class AuthApiError extends Error {
  lockedUntil?: string;
}

async function callFunction<T>(name: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new AuthApiError(mapEdgeFunctionError(data.error));
    if (data.error === "ACCOUNT_LOCKED" && typeof data.locked_until === "string") {
      err.lockedUntil = data.locked_until;
    }
    throw err;
  }

  return data as T;
}

interface LoginResult {
  session: {
    access_token: string;
    refresh_token: string;
  };
}

export async function login(email: string, password: string) {
  const result = await callFunction<LoginResult>("auth-login", { email, password });

  const { error } = await supabase.auth.setSession({
    access_token: result.session.access_token,
    refresh_token: result.session.refresh_token,
  });

  if (error) {
    throw new AuthApiError("Une erreur est survenue.");
  }
}

export async function logout() {
  await supabase.auth.signOut();
}

interface CreateUserInput {
  org_id: string;
  email: string;
  password: string;
  full_name?: string;
  role: string;
  store_id?: string | null;
  perm_caisse?: boolean;
  perm_catalog?: boolean;
  perm_invoices?: boolean;
  perm_users?: boolean;
  perm_view_users?: boolean;
  perm_view_reports?: boolean;
}

export async function adminCreateUser(input: CreateUserInput) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new AuthApiError("Vous devez être connecté.");
  return callFunction<{ user_id: string }>("admin-create-user", input, session.access_token);
}

export async function adminDeleteUser(input: { org_id: string; membership_id: string }) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new AuthApiError("Vous devez être connecté.");
  return callFunction<{ ok: true }>("admin-delete-user", input, session.access_token);
}

export async function adminUnlockAccount(email: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new AuthApiError("Vous devez être connecté.");
  return callFunction<{ ok: true }>("admin-unlock-account", { email }, session.access_token);
}
