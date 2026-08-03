import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, AlertTriangle, FileClock } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { formatCurrency } from "../lib/currency";
import { useAuth } from "../context/AuthContext";
import type { Tables } from "../types/database.types";

type Sale = Tables<"sales">;
type LowStockRow = Tables<"low_stock_products">;
type Payment = Tables<"payments">;

interface CashMovementRow {
  type: string;
  amount: number;
}

interface ServiceLineRow {
  quantity: number;
  line_total: number;
  services: { name: string } | null;
}

function toDateInputValue(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function ReportPage() {
  const { currentOrgId, currentRole, currentPerms } = useAuth();
  const canVoid =
    currentRole === "proprietaire" || currentRole === "gerant" || currentPerms?.perm_invoices === true;

  const today = new Date();
  const [fromDate, setFromDate] = useState(toDateInputValue(today));
  const [toDate, setToDate] = useState(toDateInputValue(today));

  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovementRow[]>([]);
  const [serviceLines, setServiceLines] = useState<ServiceLineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  async function load() {
    if (!currentOrgId) return;
    setLoading(true);

    const rangeStart = new Date(`${fromDate}T00:00:00`).toISOString();
    const rangeEnd = new Date(`${toDate}T23:59:59.999`).toISOString();

    const [{ data: salesData }, { data: lowStockData }, { data: cashMovementsData }, { data: serviceLinesData }] =
      await Promise.all([
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
          .select("type, amount, caisse_sessions!inner(org_id)")
          .eq("caisse_sessions.org_id", currentOrgId)
          .gte("created_at", rangeStart)
          .lte("created_at", rangeEnd),
        supabase
          .from("sale_lines")
          .select("quantity, line_total, services(name), sales!inner(org_id, created_at, status)")
          .not("service_id", "is", null)
          .eq("sales.org_id", currentOrgId)
          .eq("sales.status", "completed")
          .gte("sales.created_at", rangeStart)
          .lte("sales.created_at", rangeEnd),
      ]);

    setSales(salesData ?? []);
    setLowStock(lowStockData ?? []);
    setCashMovements((cashMovementsData as unknown as CashMovementRow[]) ?? []);
    setServiceLines((serviceLinesData as unknown as ServiceLineRow[]) ?? []);

    if (salesData && salesData.length > 0) {
      const { data: paymentsData } = await supabase
        .from("payments")
        .select("*")
        .in(
          "sale_id",
          salesData.map((s) => s.id),
        );
      setPayments(paymentsData ?? []);
    } else {
      setPayments([]);
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

      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Chargement...</p>
      ) : (
        <>
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
                    <th className="pb-2">Statut</th>
                    <th className="pb-2">Total</th>
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
