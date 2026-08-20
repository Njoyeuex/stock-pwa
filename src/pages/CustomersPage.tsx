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

type Customer = Tables<"customers">;

interface CustomerRow extends Customer {
  balance: number;
}

const customerSchema = z.object({
  name: z.string().min(2, "Nom trop court").max(150),
  phone: z.string().max(30).optional().or(z.literal("")),
});
type CustomerFormValues = z.infer<typeof customerSchema>;

const repaymentSchema = z.object({
  amount: z.coerce.number().positive("Doit être positif"),
  note: z.string().max(200).optional().or(z.literal("")),
});
type RepaymentFormValues = z.infer<typeof repaymentSchema>;
const inputClass = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900";

export function CustomersPage() {
  const { currentOrgId, currentStoreId } = useAuth();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [repayError, setRepayError] = useState<string | null>(null);
  const [repayingId, setRepayingId] = useState<string | null>(null);
  const [openCaisseSessionId, setOpenCaisseSessionId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues>({ resolver: zodResolver(customerSchema) });

  const repaymentForm = useForm<RepaymentFormValues>({ resolver: zodResolver(repaymentSchema) });

  async function loadCustomers() {
    if (!currentOrgId) return;
    setLoading(true);
    const [{ data }, { data: sessionData }] = await Promise.all([
      supabase
        .from("customers")
        .select("*, customer_credit_balances(balance)")
        .eq("org_id", currentOrgId)
        .order("name"),
      currentStoreId
        ? supabase
            .from("caisse_sessions")
            .select("id")
            .eq("store_id", currentStoreId)
            .eq("status", "open")
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    setCustomers(
      ((data ?? []) as unknown as (Customer & { customer_credit_balances: { balance: number } | null })[]).map(
        (c) => ({ ...c, balance: c.customer_credit_balances?.balance ?? 0 }),
      ),
    );
    setOpenCaisseSessionId(sessionData?.id ?? null);
    setLoading(false);
  }

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId, currentStoreId]);

  async function onSubmitCustomer(values: CustomerFormValues) {
    if (!currentOrgId) return;
    setErrorMessage(null);
    const { error } = await supabase.from("customers").insert({
      org_id: currentOrgId,
      name: values.name,
      phone: values.phone || null,
    });
    if (error) {
      setErrorMessage(mapSupabaseError(error));
      return;
    }
    reset();
    await loadCustomers();
  }

  async function onSubmitRepayment(values: RepaymentFormValues) {
    if (!repayingId) return;
    if (!openCaisseSessionId) {
      setRepayError("Aucune caisse ouverte. L'argent remboursé doit être ajouté à la caisse.");
      return;
    }
    setRepayError(null);
    const { error } = await supabase.rpc("record_customer_repayment", {
      p_customer_id: repayingId,
      p_amount: values.amount,
      p_caisse_session_id: openCaisseSessionId,
      p_note: values.note || undefined,
    });
    if (error) {
      setRepayError(mapSupabaseError(error));
      return;
    }
    repaymentForm.reset();
    setRepayingId(null);
    await loadCustomers();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Clients</h1>

      <form onSubmit={handleSubmit(onSubmitCustomer)} className="max-w-md space-y-3 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-gray-900">Ajouter un client</h2>
        <div className="space-y-1">
          <label className="text-sm text-gray-600">Nom</label>
          <input className={inputClass} {...register("name")} />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>
        <div className="space-y-1">
          <label className="text-sm text-gray-600">Téléphone</label>
          <input className={inputClass} {...register("phone")} />
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
        {repayError && (
          <div className="mb-3">
            <ErrorBox
              message={repayError}
              fixLabel={!openCaisseSessionId ? "Ouvrir la caisse" : undefined}
              fixHref={!openCaisseSessionId ? "/pos" : undefined}
              onDismiss={() => setRepayError(null)}
            />
          </div>
        )}
        {loading ? (
          <p className="text-sm text-gray-500">Chargement...</p>
        ) : customers.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun client pour l'instant.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="pb-2">Nom</th>
                  <th className="pb-2">Téléphone</th>
                  <th className="pb-2">Solde à crédit</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="py-2 text-gray-900">{c.name}</td>
                  <td className="py-2 text-gray-700">{c.phone ?? "—"}</td>
                  <td className={`py-2 font-medium ${c.balance > 0 ? "text-amber-600" : "text-gray-500"}`}>
                    {formatCurrency(c.balance)}
                  </td>
                  <td className="py-2 text-right">
                    {c.balance > 0 &&
                      (repayingId === c.id ? (
                        <form
                          onSubmit={repaymentForm.handleSubmit(onSubmitRepayment)}
                          className="flex items-center justify-end gap-2"
                        >
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Montant"
                            className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                            {...repaymentForm.register("amount")}
                          />
                          <button
                            type="submit"
                            disabled={!openCaisseSessionId}
                            title={!openCaisseSessionId ? "Ouvrez la caisse pour enregistrer un remboursement." : undefined}
                            className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            onClick={() => setRepayingId(null)}
                            className="text-xs text-gray-500 hover:text-gray-900"
                          >
                            Annuler
                          </button>
                        </form>
                      ) : (
                        <button
                          onClick={() => setRepayingId(c.id)}
                          className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-200"
                        >
                          Enregistrer un remboursement
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
