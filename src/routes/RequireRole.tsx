import { Navigate, Outlet } from "react-router-dom";
import { useAuth, type AppRole } from "../context/AuthContext";
import type { MembershipPermissions } from "../context/AuthContext";

type PermissionKey = keyof MembershipPermissions;

export function RequireRole({
  allow,
  permission,
}: {
  allow: AppRole[];
  permission?: PermissionKey | PermissionKey[];
}) {
  const { currentRole, currentPerms, loading } = useAuth();

  if (loading) return null;

  const roleOk = currentRole !== null && allow.includes(currentRole);
  const permissionKeys = permission === undefined ? [] : Array.isArray(permission) ? permission : [permission];
  const permOk = permissionKeys.some((key) => currentPerms?.[key] === true);

  if (!roleOk && !permOk) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
