import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Layers,
  Wrench,
  ShoppingCart,
  CreditCard,
  FileBarChart,
  Truck,
  Users,
  UserCog,
  DatabaseBackup,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useAuth, type AppRole, type MembershipPermissions } from "../context/AuthContext";
import { logout } from "../lib/authApi";
import { Logo } from "./Logo";

type PermissionKey = keyof MembershipPermissions;

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  allow: AppRole[];
  permission?: PermissionKey | PermissionKey[];
}

const NAV_ITEMS: NavItem[] = [
  {
    to: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    allow: ["proprietaire", "gerant", "caissier", "vendeur", "magasinier"],
  },
  {
    to: "/pos",
    label: "Caisse",
    icon: CreditCard,
    allow: ["proprietaire", "gerant", "caissier", "vendeur"],
  },
  {
    to: "/reports",
    label: "Rapports",
    icon: FileBarChart,
    allow: ["proprietaire", "gerant", "caissier", "vendeur"],
    permission: "perm_view_reports",
  },
  { to: "/stock", label: "Stock", icon: Package, allow: ["proprietaire", "gerant", "magasinier"] },
  {
    to: "/products",
    label: "Catalogue",
    icon: Layers,
    allow: ["proprietaire", "gerant", "magasinier"],
    permission: "perm_catalog",
  },
  {
    to: "/services",
    label: "Services",
    icon: Wrench,
    allow: ["proprietaire", "gerant", "magasinier"],
    permission: "perm_catalog",
  },
  { to: "/purchases", label: "Achats", icon: ShoppingCart, allow: ["proprietaire", "gerant", "magasinier"] },
  { to: "/suppliers", label: "Fournisseurs", icon: Truck, allow: ["proprietaire", "gerant", "magasinier"] },
  {
    to: "/customers",
    label: "Clients",
    icon: Users,
    allow: ["proprietaire", "gerant", "caissier", "vendeur"],
  },
  {
    to: "/users",
    label: "Utilisateurs",
    icon: UserCog,
    allow: ["proprietaire"],
    permission: ["perm_users", "perm_view_users"],
  },
  { to: "/backups", label: "Sauvegardes", icon: DatabaseBackup, allow: ["proprietaire"] },
];

export function Layout() {
  const { currentRole, currentPerms, session, storeName } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const initials = (session?.user.email ?? "?").slice(0, 2).toUpperCase();

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (currentRole && item.allow.includes(currentRole)) return true;
    if (!item.permission) return false;
    const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
    return keys.some((key) => currentPerms?.[key] === true);
  });

  return (
    <div className="flex min-h-screen flex-col bg-gray-100 text-gray-900 lg:flex-row">
      <div className="flex items-center justify-between border-b border-black/40 bg-black px-4 py-3 lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Logo size={28} />
          <span className="min-w-0 truncate text-base font-extrabold tracking-tight text-white">
            {storeName ?? "Magasin Manariyo"}
          </span>
        </div>
        <button
          onClick={() => setSidebarOpen(true)}
          className="rounded-md p-2 text-white hover:bg-white/10"
          aria-label="Ouvrir le menu"
        >
          <Menu size={22} />
        </button>
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 transform flex-col border-r border-black/40 bg-black p-4 transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-8 flex items-center justify-between gap-2 px-2">
          <div className="flex items-center gap-2">
            <Logo size={34} />
            <span className="text-lg font-extrabold leading-tight tracking-tight text-white">
              {storeName ?? "Magasin Manariyo"}
            </span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1 text-gray-400 hover:text-white lg:hidden"
            aria-label="Fermer le menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    isActive
                      ? "bg-red-600 font-medium text-white"
                      : "text-gray-300 hover:bg-white/10 hover:text-white"
                  }`
                }
              >
                <Icon size={18} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-white/10 pt-4">
          <div className="flex items-center gap-2 px-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-900 text-xs font-medium text-white">
              {initials}
            </div>
            <span className="truncate text-xs text-gray-400">{session?.user.email}</span>
          </div>
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
          >
            <LogOut size={16} />
            Déconnexion
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
