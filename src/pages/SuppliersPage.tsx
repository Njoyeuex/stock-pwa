import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { formatCurrency } from "../lib/currency";
import { ErrorBox } from "../components/ErrorBox";
import { useAuth } from "../context/AuthContext";
import type { Tables } from "../types/database.types";

type Supplier = Tables<"suppliers">;

interface SupplierRow extends Supplier {
  balance: number;
  nextDueDate: string | null;
}

const schema = z.object({
  name: z.string().min(2, "Nom trop court").max(150),
  phone: z.string().max(30).optional().or(z.literal("")),
  nif: z.string().max(50).optional().or(z.literal("")),
  address: z.string().max(255).optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;
const inputClass = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900";

export function SuppliersPage() {
  const { currentOrgId, currentStoreId } = useAuth();
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [openCaisseSessionId, setOpenCaisseSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [repayingId, setRepayingId] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [repayFromCaisse, setRepayFromCaisse] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function loadSuppliers() {
    if (!currentOrgId) return;
    setLoading(true);

    const [{ data: suppliersData }, { data: balancesData }, { data: creditMovements }, { data: sessionData }] =
      await Promise.all([
        supabase.from("suppliers").select("*").eq("org_id", currentOrgId).order("created_at", { ascending: true }),
        supabase.from("supplier_credit_balances").select("supplier_id, balance"),
        supabase
          .from("supplier_credit_movements")
          .select("supplier_id, due_date")
          .eq("org_id", currentOrgId)
          .eq("type", "purchase_credit")
          .not("due_date", "is", null),
        currentStoreId
          ? supabase
              .from("caisse_sessions")
              .select("id")
              .eq("store_id", currentStoreId)
              .eq("status", "open")
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

    const balanceBySupplier = new Map((balancesData ?? []).map((b) => [b.supplier_id, b.balance]));
    // Earliest still-relevant due date per supplier (shown only when a debt remains).
    const earliestDue = new Map<string, string>();
    for (const m of creditMovements ?? []) {
      if (!m.due_date) continue;
      const current = earliestDue.get(m.supplier_id);
      if (!current || m.due_date < current) earliestDue.set(m.supplier_id, m.due_date);
    }

    setSuppliers(
      (suppliersData ?? []).map((s) => ({
        ...s,
        balance: balanceBySupplier.get(s.id) ?? 0,
        nextDueDate: (balanceBySupplier.get(s.id) ?? 0) > 0 ? earliestDue.get(s.id) ?? null : null,
      })),
    );
    setOpenCaisseSessionId(sessionData?.id ?? null);
    setLoading(false);
  }

  useEffect(() => {
    loadSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId, currentStoreId]);

  async function onSubmit(values: FormValues) {
    if (!currentOrgId) return;
    setErrorMessage(null);
    const { error } = await supabase.from("suppliers").insert({
      org_id: currentOrgId,
      name: values.name,
      phone: values.phone || null,
      nif: values.nif || null,
      address: values.address || null,
    });
    if (error) {
      setErrorMessage(mapSupabaseError(error));
      return;
    }
    reset();
    await loadSuppliers();
  }

  function startRepay(supplierId: string) {
    setActionError(null);
    setRepayingId(supplierId);
    setRepayAmount("");
    setRepayFromCaisse(false);
  }

  async function confirmRepay(supplierId: string) {
    const amount = Number(repayAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      setActionError("Montant invalide.");
      return;
    }
    if (repayFromCaisse && !openCaisseSessionId) {
      setActionError("Aucune caisse ouverte pour un remboursement depuis la caisse.");
      return;
    }
    setActionError(null);
    const { error } = await supabase.rpc("record_supplier_repayment", {
      p_supplier_id: supplierId,
      p_amount: amount,
      p_from_caisse: repayFromCaisse,
      p_caisse_session_id: repayFromCaisse ? openCaisseSessionId ?? undefined : undefined,
    });
    if (error) {
      setActionError(mapSupabaseError(error));
      return;
    }
    setRepayingId(null);
    setRepayAmount("");
    setRepayFromCaisse(false);
    await loadSuppliers();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Fournisseurs</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-3 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-gray-900">Ajouter un fournisseur</h2>
        <div className="space-y-1">
          <label className="text-sm text-gray-600">Nom</label>
          <input className={inputClass} {...register("name")} />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>
        <div className="space-y-1">
          <label className="text-sm text-gray-600">Téléphone</label>
          <input className={inputClass} {...register("phone")} />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-gray-600">NIF</label>
          <input className={inputClass} placeholder="Numéro d'identification fiscale" {...register("nif")} />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-gray-600">Adresse</label>
          <input className={inputClass} {...register("address")} />
        </div>
        {errorMessage && <ErrorBox message={errorMessage} onDismiss={() => setErrorMessage(null)} />}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          Ajouter
        </button>
      </form>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-3 font-medium text-gray-900">Liste</h2>
        {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}
        {loading ? (
          <p className="text-sm text-gray-500">Chargement...</p>
        ) : suppliers.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun fournisseur pour l'instant.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="pb-2">Nom</th>
                  <th className="pb-2">Téléphone</th>
                  <th className="pb-2">NIF</th>
                  <th className="pb-2">Dette</th>
                  <th className="pb-2">Échéance</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="border-t border-gray-100 align-top">
                    <td className="py-2 text-gray-900">{s.name}</td>
                    <td className="py-2 text-gray-700">{s.phone ?? "—"}</td>
                    <td className="py-2 text-gray-700">{s.nif ?? "—"}</td>
                    <td className={`py-2 font-medium ${s.balance > 0 ? "text-amber-600" : "text-gray-400"}`}>
                      {s.balance > 0 ? formatCurrency(s.balance) : "—"}
                    </td>
                    <td className="py-2 text-gray-700">
                      {s.nextDueDate ? new Date(s.nextDueDate).toLocaleDateString("fr-FR") : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {s.balance > 0 &&
                        (repayingId === s.id ? (
                          <div className="flex flex-col items-end gap-2">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Montant"
                              value={repayAmount}
                              onChange={(e) => setRepayAmount(e.target.value)}
                              className="w-32 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                            />
                            <label className="flex items-center gap-1.5 text-xs text-gray-600">
                              <input
                                type="checkbox"
                                checked={repayFromCaisse}
                                onChange={(e) => setRepayFromCaisse(e.target.checked)}
                              />
                              Depuis la caisse
                            </label>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => confirmRepay(s.id)}
                                className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                              >
                                Valider
                              </button>
                              <button
                                onClick={() => setRepayingId(null)}
                                className="text-xs text-gray-500 hover:text-gray-900"
                              >
                                Annuler
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => startRepay(s.id)}
                            className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-200"
                          >
                            Rembourser
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
