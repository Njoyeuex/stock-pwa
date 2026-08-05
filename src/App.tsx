import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { RequireAuth } from "./routes/RequireAuth";
import { RequireOrg } from "./routes/RequireOrg";
import { RequireRole } from "./routes/RequireRole";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ServicesPage } from "./pages/ServicesPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { PurchasesPage } from "./pages/PurchasesPage";
import { StockPage } from "./pages/StockPage";
import { POSPage } from "./pages/POSPage";
import { ReportPage } from "./pages/ReportPage";
import { CustomersPage } from "./pages/CustomersPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { UsersPage } from "./pages/UsersPage";
import { BackupsPage } from "./pages/BackupsPage";

const STOCK_ROLES = ["proprietaire", "gerant", "magasinier"] as const;
const SALES_ROLES = ["proprietaire", "gerant", "caissier", "vendeur"] as const;
const AUDIT_ROLES = ["proprietaire", "gerant"] as const;

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<RequireOrg />}>
              <Route element={<Layout />}>
                <Route path="/" element={<DashboardPage />} />

                <Route element={<RequireRole allow={[...SALES_ROLES]} />}>
                  <Route path="/pos" element={<POSPage />} />
                  <Route path="/customers" element={<CustomersPage />} />
                </Route>

                <Route element={<RequireRole allow={[...SALES_ROLES]} permission="perm_view_reports" />}>
                  <Route path="/reports" element={<ReportPage />} />
                </Route>

                <Route element={<RequireRole allow={[...STOCK_ROLES]} />}>
                  <Route path="/stock" element={<StockPage />} />
                  <Route path="/purchases" element={<PurchasesPage />} />
                  <Route path="/suppliers" element={<SuppliersPage />} />
                </Route>

                <Route element={<RequireRole allow={[...STOCK_ROLES]} permission="perm_catalog" />}>
                  <Route path="/products" element={<ProductsPage />} />
                  <Route path="/services" element={<ServicesPage />} />
                </Route>

                <Route element={<RequireRole allow={[...AUDIT_ROLES]} />}>
                  <Route path="/audit-log" element={<AuditLogPage />} />
                </Route>

                <Route element={<RequireRole allow={["proprietaire"]} permission={["perm_users", "perm_view_users"]} />}>
                  <Route path="/users" element={<UsersPage />} />
                </Route>

                <Route element={<RequireRole allow={["proprietaire"]} />}>
                  <Route path="/backups" element={<BackupsPage />} />
                </Route>
              </Route>
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
