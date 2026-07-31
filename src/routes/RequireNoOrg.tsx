import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Guards /onboarding so a company can only ever be created once per user: anyone who
// already belongs to an organization is sent back to the app instead of being able to
// create a second one.
export function RequireNoOrg() {
  const { memberships, loading } = useAuth();

  if (loading) return null;
  if (memberships.length > 0) return <Navigate to="/" replace />;

  return <Outlet />;
}
