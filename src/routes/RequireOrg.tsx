import { Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NoOrganizationPage } from "../pages/NoOrganizationPage";

// Deliberately does not redirect to /onboarding: creating an organization only happens
// when the user explicitly navigates there (see NoOrganizationPage), never as a side
// effect of logging in.
export function RequireOrg() {
  const { memberships, loading } = useAuth();

  if (loading) return null;
  if (memberships.length === 0) return <NoOrganizationPage />;

  return <Outlet />;
}
