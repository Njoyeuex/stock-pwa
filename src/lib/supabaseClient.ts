import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export const supabase = createClient<Database>(url, publishableKey, {
  auth: {
    // Login goes through the auth-login Edge Function (account lockout), not this client
    // directly - it only needs to hold/refresh whatever session that function returns.
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const FUNCTIONS_URL = `${url}/functions/v1`;
