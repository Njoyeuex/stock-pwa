import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, AlertTriangle, FileClock, TrendingUp } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { formatCurrency } from "../lib/currency";
import { unitShort } from "../lib/units";
import { ErrorBox } from "../components/ErrorBox";
import { useAuth } from "../context/AuthContext";
import type { Tables } from "../types/database.types";

type Sale = Tables<"sales">;
type LowStockRow = Tables<"low_stock_products">;
type Payment = Tables<"payments">;
type CaisseSession = Tables<"caisse_sessions">;

interface CashMovementRow {
  id: string;
  type: string;
  amount: number;
  reason: string | null;
  created_at: string;
  created_by: string;
}

interface ServiceLineRow {
  quantity: number;
  line_total: number;
  services: { name: string } | null;
}

interface ProductLineRow {
  product_id: string;
  quantity: number;
  line_total: number;
  products: { name: string; unit: string } | null;
}

interface ProductProfit {
  productId: string;
  name: string;
  unit: string | null;
  quantity: number;
  revenue: number;
  cost: number;
  hasCost: boolean;
}

// Roles allowed to read product_costs (see RLS policy product_costs_select).
const COST_ROLES = ["proprietaire", "gerant", "magasinier"];

interface SaleLineDetail {
  name: string;
  quantity: number;
  unit: string | null;
  productId: string | null;
  lineTotal: number;
}

function toDateInputValue(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function ReportPage() {
  const { currentOrgId, currentRole, currentPerms } = useAuth();
  const canVoid =
    currentRole === "proprietaire" || currentRole === "gerant" || currentPerms?.perm_invoices === true;
  const canSeeProfit = !!currentRole && COST_ROLES.includes(currentRole);

  const today = new Date();
  const [fromDate, setFromDate] = useState(toDateInputValue(today));
  const [toDate, setToDate] = useState(toDateInputValue(today));

  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovementRow[]>([]);
  const [caisseSessions, setCaisseSessions] = useState<CaisseSession[]>([]);
  const [serviceLines, setServiceLines] = useState<ServiceLineRow[]>([]);
  const [productLines, setProductLines] = useState<ProductLineRow[]>([]);
  const [costsByProduct, setCostsByProduct] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [currentCaisse, setCurrentCaisse] = useState<number | null>(null);
  const [supplierDebt, setSupplierDebt] = useState(0);
  const [saleLineDetails, setSaleLineDetails] = useState<Record<string, SaleLineDetail[]>>({});
  const [namesById, setNamesById] = useState<Record<string, string>>({});

  async function load() {
    if (!currentOrgId) return;
    setLoading(true);

    const rangeStart = new Date(`${fromDate}T00:00:00`).toISOString();
    const rangeEnd = new Date(`${toDate}T23:59:59.999`).toISOString();

    const [
      { data: salesData },
      { data: lowStockData },
      { data: cashMovementsData },
      { data: serviceLinesData },
      { data: productLinesData },
      { data: caisseSessionsData },
    ] = await Promise.all([
        supabase
          .from("sales")
          .select("*")
          .eq("org_id", currentOrgId)
          .gte("created_at", rangeStart)
          .lte("created_at", rangeEnd)
          .order("created_at", { ascending: false }),
        supabase.from("low_stock_products").select("*").eq("org_id", currentOrgId),
        supabase
          .from("cash_movements")
          .select("id, type, amount, reason, created_at, created_by, caisse_sessions!inner(org_id)")
          .eq("caisse_sessions.org_id", currentOrgId)
          .gte("created_at", rangeStart)
          .lte("created_at", rangeEnd)
          .order("created_at", { ascending: false }),
        supabase
          .from("sale_lines")
          .select("quantity, line_total, services(name), sales!inner(org_id, created_at, status)")
          .not("service_id", "is", null)
          .eq("sales.org_id", currentOrgId)
          .eq("sales.status", "completed")
          .gte("sales.created_at", rangeStart)
          .lte("sales.created_at", rangeEnd),
        supabase
          .from("sale_lines")
          .select("product_id, quantity, line_total, products(name, unit), sales!inner(org_id, created_at, status)")
          .not("product_id", "is", null)
          .eq("sales.org_id", currentOrgId)
          .eq("sales.status", "completed")
          .gte("sales.created_at", rangeStart)
          .lte("sales.created_at", rangeEnd),
        supabase
          .from("caisse_sessions")
          .select("*")
          .eq("org_id", currentOrgId)
          // Any session active during the period, including one opened earlier and closed (or still open) now.
          .lte("opened_at", rangeEnd)
          .or(`closed_at.gte.${rangeStart},closed_at.is.null`)
          .order("opened_at", { ascending: false }),
      ]);

    setSales(salesData ?? []);
    const caisseSessionRows = caisseSessionsData ?? [];
    setCaisseSessions(caisseSessionRows);
    setLowStock(lowStockData ?? []);
    const cashMovementRows = (cashMovementsData as unknown as CashMovementRow[]) ?? [];
    setCashMovements(cashMovementRows);
    setServiceLines((serviceLinesData as unknown as ServiceLineRow[]) ?? []);
    const productLineRows = (productLinesData as unknown as ProductLineRow[]) ?? [];
    setProductLines(productLineRows);

    // Cost prices are hidden from caissier/vendeur by RLS, so only fetch them for allowed roles.
    const soldProductIds = Array.from(new Set(productLineRows.map((l) => l.product_id)));
    if (canSeeProfit && soldProductIds.length > 0) {
      const { data: costsData } = await supabase
        .from("product_costs")
        .select("product_id, cost_price")
        .in("product_id", soldProductIds);
      setCostsByProduct(Object.fromEntries((costsData ?? []).map((c) => [c.product_id, c.cost_price])));
    } else {
      setCostsByProduct({});
    }

    const userIds = Array.from(
      new Set([
        ...cashMovementRows.map((m) => m.created_by),
        ...caisseSessionRows.flatMap((s) => (s.closed_by ? [s.opened_by, s.closed_by] : [s.opened_by])),
      ]),
    );
    if (userIds.length > 0) {
      const { data: profilesData } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
      setNamesById(
        Object.fromEntries((profilesData ?? []).map((p) => [p.id, p.full_name || "Utilisateur"])),
      );
    } else {
      setNamesById({});
    }

    if (salesData && salesData.length > 0) {
      const saleIds = salesData.map((s) => s.id);
      const [{ data: paymentsData }, { data: lineRows }] = await Promise.all([
        supabase.from("payments").select("*").in("sale_id", saleIds),
        supabase
          .from("sale_lines")
          .select("sale_id, product_id, quantity, line_total, products(name, unit), services(name)")
          .in("sale_id", saleIds),
      ]);
      setPayments(paymentsData ?? []);

      const detailMap: Record<string, SaleLineDetail[]> = {};
      for (const row of (lineRows as unknown as {
        sale_id: string;
        product_id: string | null;
        quantity: number;
        line_total: number;
        products: { name: string; unit: string } | null;
        services: { name: string } | null;
      }[]) ?? []) {
        const name = row.products?.name ?? row.services?.name ?? "—";
        const unit = row.products?.unit ?? null;
        if (!detailMap[row.sale_id]) detailMap[row.sale_id] = [];
        detailMap[row.sale_id].push({
          name,
          quantity: row.quantity,
          unit,
          productId: row.product_id,
          lineTotal: row.line_total,
        });
      }
      setSaleLineDetails(detailMap);
    } else {
      setPayments([]);
      setSaleLineDetails({});
    }

    // Total supplier debts (RLS already scopes the balances to this org).
    const { data: supplierBalances } = await supabase.from("supplier_credit_balances").select("balance");
    setSupplierDebt((supplierBalances ?? []).reduce((sum, b) => sum + b.balance, 0));

    // Current cash in the open caisse = opening float + cash sales + cash in - cash out.
    const { data: openSession } = await supabase
      .from("caisse_sessions")
      .select("id, opening_float")
      .eq("org_id", currentOrgId)
      .eq("status", "open")
      .maybeSingle();

    if (openSession) {
      const [{ data: cashPayments }, { data: sessionMovements }] = await Promise.all([
        supabase
          .from("payments")
          .select("amount, sales!inner(caisse_session_id, status)")
          .eq("method", "cash")
          .eq("sales.caisse_session_id", openSession.id)
          .eq("sales.status", "completed"),
        supabase.from("cash_movements").select("type, amount").eq("caisse_session_id", openSession.id),
      ]);
      const cashSales = ((cashPayments as unknown as { amount: number }[]) ?? []).reduce((s, p) => s + p.amount, 0);
      const mvIn = (sessionMovements ?? []).filter((m) => m.type === "in").reduce((s, m) => s + m.amount, 0);
      const mvOut = (sessionMovements ?? []).filter((m) => m.type === "out").reduce((s, m) => s + m.amount, 0);
      setCurrentCaisse(openSession.opening_float + cashSales + mvIn - mvOut);
    } else {
      setCurrentCaisse(null);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId, fromDate, toDate]);

  const completedSales = sales.filter((s) => s.status === "completed");
  const totalAmount = completedSales.reduce((sum, s) => sum + s.total_amount, 0);

  const cashIn = cashMovements.filter((m) => m.type === "in").reduce((sum, m) => sum + m.amount, 0);
  const cashOut = cashMovements.filter((m) => m.type === "out").reduce((sum, m) => sum + m.amount, 0);
  const servicesTotal = serviceLines.reduce((sum, l) => sum + l.line_total, 0);

  // Profit = revenue - (quantity sold × current weighted-average cost price). Services have no cost.
  const productProfits = useMemo(() => {
    const byProduct: Record<string, ProductProfit> = {};
    for (const l of productLines) {
      const unitCost = costsByProduct[l.product_id];
      const entry = (byProduct[l.product_id] ??= {
        productId: l.product_id,
        name: l.products?.name ?? "—",
        unit: l.products?.unit ?? null,
        quantity: 0,
        revenue: 0,
        cost: 0,
        hasCost: unitCost !== undefined && unitCost > 0,
      });
      entry.quantity += l.quantity;
      entry.revenue += l.line_total;
      entry.cost += l.quantity * (unitCost ?? 0);
    }
    return Object.values(byProduct).sort((a, b) => b.revenue - b.cost - (a.revenue - a.cost));
  }, [productLines, costsByProduct]);

  const productsRevenue = productProfits.reduce((sum, p) => sum + p.revenue, 0);
  const costOfGoodsSold = productProfits.reduce((sum, p) => sum + p.cost, 0);
  const profitRevenue = productsRevenue + servicesTotal;
  const grossProfit = profitRevenue - costOfGoodsSold;
  const marginPercent = profitRevenue > 0 ? (grossProfit / profitRevenue) * 100 : 0;
  const productsWithoutCost = productProfits.filter((p) => !p.hasCost).length;

  function saleProfit(saleId: string) {
    return (saleLineDetails[saleId] ?? []).reduce(
      (sum, l) => sum + l.lineTotal - (l.productId ? l.quantity * (costsByProduct[l.productId] ?? 0) : 0),
      0,
    );
  }

  const totalsByMethod = useMemo(() => {
    const completedSaleIds = new Set(completedSales.map((s) => s.id));
    return payments
      .filter((p) => completedSaleIds.has(p.sale_id))
      .reduce(
        (acc, p) => {
          acc[p.method] = (acc[p.method] ?? 0) + p.amount;
          return acc;
        },
        {} as Record<string, number>,
      );
  }, [payments, completedSales]);

  async function confirmVoid(saleId: string) {
    if (!voidReason.trim()) {
      setErrorMessage("Un motif est requis pour annuler une vente.");
      return;
    }
    setErrorMessage(null);
    const { error } = await supabase.rpc("void_sale", { p_sale_id: saleId, p_reason: voidReason });
    if (error) {
      setErrorMessage(mapSupabaseError(error));
      return;
    }
    setVoidingId(null);
    setVoidReason("");
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/pos" className="text-gray-500 hover:text-gray-900">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">Rapport des ventes</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900"
          />
          <span className="text-gray-500">au</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900"
          />
        </div>
      </div>

      {errorMessage && <ErrorBox message={errorMessage} onDismiss={() => setErrorMessage(null)} />}

      {loading ? (
        <p className="text-sm text-gray-500">Chargement...</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-blue-900 p-6 text-white shadow-sm">
              <p className="text-sm text-blue-200">Solde de la caisse actuelle</p>
              <p className="mt-1 text-3xl font-bold">
                {currentCaisse !== null ? formatCurrency(currentCaisse) : "Caisse fermée"}
              </p>
              <p className="mt-1 text-xs text-blue-200">
                {currentCaisse !== null
                  ? "Espèces réellement dans la caisse ouverte en ce moment."
                  : "Aucune caisse n'est ouverte actuellement."}
              </p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">Dettes envers les fournisseurs</p>
              <p className={`mt-1 text-3xl font-bold ${supplierDebt > 0 ? "text-amber-600" : "text-gray-900"}`}>
                {formatCurrency(supplierDebt)}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Montant total restant dû aux fournisseurs (achats à crédit non réglés).
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">Total des ventes</p>
              <p className="mt-1 text-3xl font-semibold text-emerald-600">{formatCurrency(totalAmount)}</p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">Nombre de ventes</p>
              <p className="mt-1 text-3xl font-semibold text-gray-900">{completedSales.length}</p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">Espèces</p>
              <p className="mt-1 text-3xl font-semibold text-gray-900">{formatCurrency(totalsByMethod.cash ?? 0)}</p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">À crédit</p>
              <p className="mt-1 text-3xl font-semibold text-amber-600">{formatCurrency(totalsByMethod.credit ?? 0)}</p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">Services rendus</p>
              <p className="mt-1 text-3xl font-semibold text-gray-900">{formatCurrency(servicesTotal)}</p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">Entrées de caisse</p>
              <p className="mt-1 text-3xl font-semibold text-emerald-600">{formatCurrency(cashIn)}</p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">Sorties de caisse</p>
              <p className="mt-1 text-3xl font-semibold text-red-600">{formatCurrency(cashOut)}</p>
            </div>
          </div>

          {canSeeProfit && (
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 font-medium text-gray-900">
                <TrendingUp size={18} className="text-emerald-600" />
                Bénéfices sur la période
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-sm text-gray-500">Chiffre d'affaires</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{formatCurrency(profitRevenue)}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-sm text-gray-500">Coût d'achat des produits vendus</p>
                  <p className="mt-1 text-2xl font-semibold text-red-600">{formatCurrency(costOfGoodsSold)}</p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-4">
                  <p className="text-sm text-emerald-700">Bénéfice brut</p>
                  <p className={`mt-1 text-2xl font-bold ${grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {formatCurrency(grossProfit)}
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-sm text-gray-500">Marge</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{marginPercent.toFixed(1)} %</p>
                </div>
              </div>
              {productsWithoutCost > 0 && (
                <p className="mt-3 flex items-center gap-1 text-xs text-amber-600">
                  <AlertTriangle size={14} />
                  {productsWithoutCost} produit(s) vendu(s) sans prix d'achat : le bénéfice est surestimé.
                </p>
              )}

              {productProfits.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-gray-500">
                      <tr>
                        <th className="pb-2">Produit</th>
                        <th className="pb-2">Qté vendue</th>
                        <th className="pb-2">Ventes</th>
                        <th className="pb-2">Coût</th>
                        <th className="pb-2">Bénéfice</th>
                        <th className="pb-2">Marge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productProfits.map((p) => {
                        const profit = p.revenue - p.cost;
                        return (
                          <tr key={p.productId} className="border-t border-gray-100">
                            <td className="py-2 text-gray-900">
                              {p.name}
                              {!p.hasCost && (
                                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                                  Prix d'achat manquant
                                </span>
                              )}
                            </td>
                            <td className="py-2 text-gray-700">
                              {p.quantity} {unitShort(p.unit)}
                            </td>
                            <td className="py-2 text-gray-700">{formatCurrency(p.revenue)}</td>
                            <td className="py-2 text-gray-500">{formatCurrency(p.cost)}</td>
                            <td className={`py-2 font-medium ${profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                              {formatCurrency(profit)}
                            </td>
                            <td className="py-2 text-gray-500">
                              {p.revenue > 0 ? `${((profit / p.revenue) * 100).toFixed(1)} %` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-3 font-medium text-gray-900">Ventes sur la période</h2>
            {sales.length === 0 ? (
              <p className="text-sm text-gray-500">Aucune vente enregistrée sur cette période.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-gray-500">
                  <tr>
                    <th className="pb-2">N°</th>
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Client</th>
                    <th className="pb-2">Articles vendus</th>
                    <th className="pb-2">Statut</th>
                    <th className="pb-2">Total</th>
                    {canSeeProfit && <th className="pb-2">Bénéfice</th>}
                    {canVoid && <th className="pb-2"></th>}
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.id} className="border-t border-gray-100">
                      <td className="py-2 text-gray-900">#{s.sale_number}</td>
                      <td className="py-2 text-gray-700">
                        {new Date(s.created_at).toLocaleString("fr-FR", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-2 text-gray-500">{s.customer_name ?? "—"}</td>
                      <td className="py-2 text-gray-700">
                        {(saleLineDetails[s.id] ?? []).length === 0 ? (
                          "—"
                        ) : (
                          <ul className="space-y-0.5">
                            {(saleLineDetails[s.id] ?? []).map((l, i) => (
                              <li key={i} className="whitespace-nowrap text-xs">
                                {l.name} <span className="text-gray-400">× {l.quantity} {unitShort(l.unit)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="py-2">
                        {s.status === "completed" ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                            Terminée
                          </span>
                        ) : (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">Annulée</span>
                        )}
                      </td>
                      <td className="py-2 text-gray-900">{formatCurrency(s.total_amount)}</td>
                      {canSeeProfit && (
                        <td className="py-2 font-medium">
                          {s.status === "completed" ? (
                            <span className={saleProfit(s.id) >= 0 ? "text-emerald-600" : "text-red-600"}>
                              {formatCurrency(saleProfit(s.id))}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      )}
                      {canVoid && (
                        <td className="py-2 text-right">
                          {s.status === "completed" &&
                            (voidingId === s.id ? (
                              <div className="flex items-center justify-end gap-2">
                                <input
                                  value={voidReason}
                                  onChange={(e) => setVoidReason(e.target.value)}
                                  placeholder="Motif"
                                  className="w-32 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs"
                                />
                                <button
                                  onClick={() => confirmVoid(s.id)}
                                  className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                                >
                                  Confirmer
                                </button>
                                <button
                                  onClick={() => {
                                    setVoidingId(null);
                                    setVoidReason("");
                                  }}
                                  className="text-xs text-gray-500 hover:text-gray-900"
                                >
                                  Annuler
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setVoidingId(s.id)}
                                className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-200"
                              >
                                Annuler la vente
                              </button>
                            ))}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-3 font-medium text-gray-900">Services rendus sur la période</h2>
            {serviceLines.length === 0 ? (
              <p className="text-sm text-gray-500">Aucun service vendu sur cette période.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {serviceLines.map((l, i) => (
                  <li key={i} className="flex justify-between border-t border-gray-100 pt-2 text-gray-900 first:border-0 first:pt-0">
                    <span>
                      {l.services?.name ?? "—"} <span className="text-gray-500">× {l.quantity}</span>
                    </span>
                    <span className="font-medium">{formatCurrency(l.line_total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-3 font-medium text-gray-900">Ouvertures et fermetures de caisse</h2>
            {caisseSessions.length === 0 ? (
              <p className="text-sm text-gray-500">Aucune caisse ouverte sur cette période.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-500">
                    <tr>
                      <th className="pb-2">Jour</th>
                      <th className="pb-2">Ouverture</th>
                      <th className="pb-2">Montant à l'ouverture</th>
                      <th className="pb-2">Fermeture</th>
                      <th className="pb-2">Montant à la fermeture</th>
                      <th className="pb-2">Attendu</th>
                      <th className="pb-2">Écart</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caisseSessions.map((c) => (
                      <tr key={c.id} className="border-t border-gray-100">
                        <td className="py-2 whitespace-nowrap text-gray-900">
                          {new Date(c.opened_at).toLocaleDateString("fr-FR", {
                            weekday: "short",
                            day: "2-digit",
                            month: "short",
                          })}
                        </td>
                        <td className="py-2 text-gray-700">
                          {new Date(c.opened_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                          <span className="block text-xs text-gray-400">{namesById[c.opened_by] ?? "—"}</span>
                        </td>
                        <td className="py-2 font-medium text-gray-900">{formatCurrency(c.opening_float)}</td>
                        <td className="py-2 text-gray-700">
                          {c.status === "open" || !c.closed_at ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                              Encore ouverte
                            </span>
                          ) : (
                            <>
                              {new Date(c.closed_at).toLocaleString("fr-FR", {
                                ...(new Date(c.closed_at).toDateString() !== new Date(c.opened_at).toDateString()
                                  ? { day: "2-digit", month: "short" }
                                  : {}),
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              <span className="block text-xs text-gray-400">
                                {c.closed_by ? (namesById[c.closed_by] ?? "—") : "—"}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="py-2 font-medium text-gray-900">
                          {c.closing_declared_cash !== null ? formatCurrency(c.closing_declared_cash) : "—"}
                        </td>
                        <td className="py-2 text-gray-500">
                          {c.expected_cash !== null ? formatCurrency(c.expected_cash) : "—"}
                        </td>
                        <td
                          className={`py-2 font-medium ${
                            c.variance === null || c.variance === 0
                              ? "text-gray-500"
                              : c.variance > 0
                                ? "text-emerald-600"
                                : "text-red-600"
                          }`}
                        >
                          {c.variance === null ? "—" : `${c.variance > 0 ? "+" : ""}${formatCurrency(c.variance)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-3 font-medium text-gray-900">Historique des mouvements de caisse</h2>
            {cashMovements.length === 0 ? (
              <p className="text-sm text-gray-500">Aucun mouvement de caisse sur cette période.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-500">
                    <tr>
                      <th className="pb-2">Date</th>
                      <th className="pb-2">Type</th>
                      <th className="pb-2">Motif</th>
                      <th className="pb-2">Par</th>
                      <th className="pb-2">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashMovements.map((m) => (
                      <tr key={m.id} className="border-t border-gray-100">
                        <td className="py-2 text-gray-700">
                          {new Date(m.created_at).toLocaleString("fr-FR", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              m.type === "in" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                            }`}
                          >
                            {m.type === "in" ? "Entrée" : "Sortie"}
                          </span>
                        </td>
                        <td className="py-2 text-gray-700">{m.reason ?? "—"}</td>
                        <td className="py-2 text-gray-500">{namesById[m.created_by] ?? "—"}</td>
                        <td
                          className={`py-2 font-medium ${m.type === "in" ? "text-emerald-600" : "text-red-600"}`}
                        >
                          {m.type === "in" ? "+" : "-"}
                          {formatCurrency(m.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 font-medium text-gray-900">
              <AlertTriangle size={18} className="text-amber-500" />
              Alertes stock bas
            </h2>
            {lowStock.length === 0 ? (
              <p className="text-sm text-gray-500">Aucune alerte pour l'instant.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {lowStock.map((r) => (
                  <li key={`${r.product_id}-${r.store_id}`} className="flex justify-between text-amber-600">
                    <span>{r.name}</span>
                    <span>
                      {r.quantity} {r.unit} restant(s)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canVoid && (
            <Link
              to="/audit-log"
              className="flex w-fit items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
            >
              <FileClock size={16} />
              Consulter le journal d'audit
            </Link>
          )}
        </>
      )}
    </div>
  );
}
