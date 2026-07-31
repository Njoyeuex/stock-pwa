import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import type { Enums } from "../types/database.types";

export type AppRole = Enums<"app_role">;

export interface MembershipPermissions {
  perm_caisse: boolean;
  perm_catalog: boolean;
  perm_invoices: boolean;
  perm_users: boolean;
  perm_view_users: boolean;
  perm_view_reports: boolean;
}

export interface Membership extends MembershipPermissions {
  org_id: string;
  role: AppRole;
  store_id: string | null;
}

export interface Profile {
  full_name: string | null;
}

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  memberships: Membership[];
  currentOrgId: string | null;
  currentRole: AppRole | null;
  currentPerms: MembershipPermissions | null;
  currentStoreId: string | null;
  storeName: string | null;
  storeCity: string | null;
  loading: boolean;
  setCurrentOrgId: (orgId: string) => void;
  refreshMemberships: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(null);
  const [currentStoreId, setCurrentStoreIdState] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [storeCity, setStoreCity] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshMemberships() {
    const { data } = await supabase
      .from("memberships")
      .select(
        "org_id, role, store_id, perm_caisse, perm_catalog, perm_invoices, perm_users, perm_view_users, perm_view_reports",
      )
      .eq("is_active", true);
    const rows = data ?? [];
    setMemberships(rows);
    setCurrentOrgIdState((prev) => prev ?? rows[0]?.org_id ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) {
        setMemberships([]);
        setCurrentOrgIdState(null);
        setCurrentStoreIdState(null);
        setStoreName(null);
        setStoreCity(null);
        setProfile(null);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) {
      refreshMemberships();
      supabase
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .maybeSingle()
        .then(({ data }) => setProfile(data ?? { full_name: null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const currentMembership = useMemo(
    () => memberships.find((m) => m.org_id === currentOrgId) ?? null,
    [memberships, currentOrgId],
  );
  const currentRole = currentMembership?.role ?? null;
  const currentPerms = useMemo<MembershipPermissions | null>(
    () =>
      currentMembership
        ? {
            perm_caisse: currentMembership.perm_caisse,
            perm_catalog: currentMembership.perm_catalog,
            perm_invoices: currentMembership.perm_invoices,
            perm_users: currentMembership.perm_users,
            perm_view_users: currentMembership.perm_view_users,
            perm_view_reports: currentMembership.perm_view_reports,
          }
        : null,
    [currentMembership],
  );

  // Single-store deployment: every member works out of the org's one store, so it's
  // resolved automatically here instead of asking the user to pick one anywhere.
  useEffect(() => {
    async function loadStore() {
      if (!currentOrgId) {
        setCurrentStoreIdState(null);
        setStoreName(null);
        setStoreCity(null);
        return;
      }
      const { data } = await supabase
        .from("stores")
        .select("id, name, city")
        .eq("org_id", currentOrgId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      setCurrentStoreIdState(data?.id ?? null);
      setStoreName(data?.name ?? null);
      setStoreCity(data?.city ?? null);
    }
    loadStore();
  }, [currentOrgId]);

  const value: AuthContextValue = {
    session,
    profile,
    memberships,
    currentOrgId,
    currentRole,
    currentPerms,
    currentStoreId,
    storeName,
    storeCity,
    loading,
    setCurrentOrgId: setCurrentOrgIdState,
    refreshMemberships,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
