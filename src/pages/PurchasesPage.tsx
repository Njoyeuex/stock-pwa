import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Lock } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { formatCurrency } from "../lib/currency";
import { useAuth } from "../context/AuthContext";
import type { Tables } from "../types/database.types";

type Supplier = Tables<"suppliers">;
type Product = Tables<"products">;
type Purchase = Tables<"purchases">;

const PAYMENT_SOURCE_LABELS: Record<string, string> = { caisse: "Caisse", other: "Autre" };

const schema = z.object({
  supplier_id: z.string().uuid("Choisir un fournisseur").optional().or(z.literal("")),
  payment_source: z.enum(["caisse", "other"]),
  lines: z
    .array(
      z.object({
        product_id: z.string().uuid("Choisir un produit"),
        quantity: z.coerce.number().positive("Doit être positif"),
        unit_cost: z.coerce.number().min(0, "Doit être positif"),
      }),
    )
    .min(1, "Ajoutez au moins une ligne"),
});

type FormValues = z.infer<typeof schema>;

export function PurchasesPage() {
  const { currentOrgId, currentStoreId } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [openCaisseSessionId, setOpenCaisseSessionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { payment_source: "other", lines: [{ product_id: "", quantity: 1, unit_cost: 0 }] },
  });

  const paymentSource = watch("payment_source");
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });

  async function loadAll() {
    if (!currentOrgId) return;
    const [{ data: suppliersData }, { data: productsData }, { data: purchasesData }, { data: sessionData }] =
      await Promise.all([
        supabase.from("suppliers").select("*").eq("org_id", currentOrgId).order("name"),
        supabase.from("products").select("*").eq("org_id", currentOrgId).order("name"),
        supabase
          .from("purchases")
          .select("*")
          .eq("org_id", currentOrgId)
          .order("created_at", { ascending: false })
          .limit(20),
        currentStoreId
          ? supabase
              .from("caisse_sessions")
              .select("id")
              .eq("store_id", currentStoreId)
              .eq("status", "open")
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
    setSuppliers(suppliersData ?? []);
    setProducts(productsData ?? []);
    setPurchases(purchasesData ?? []);
    setOpenCaisseSessionId(sessionData?.id ?? null);
    setLoaded(true);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId, currentStoreId]);

  async function onSubmit(values: FormValues) {
    if (!currentOrgId || !currentStoreId) return;
    if (values.payment_source === "caisse" && !openCaisseSessionId) {
      setErrorMessage("Aucune caisse ouverte. Ouvrez la caisse ou choisissez une autre provenance.");
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);

    const { error } = await supabase.rpc("receive_purchase", {
      p_org_id: currentOrgId,
      p_store_id: currentStoreId,
      p_supplier_id: (values.supplier_id || null) as string,
      p_lines: values.lines,
      p_payment_source: values.payment_source,
      p_caisse_session_id: values.payment_source === "caisse" ? openCaisseSessionId ?? undefined : undefined,
    });

    if (error) {
      setErrorMessage(mapSupabaseError(error));
      return;
    }

    setSuccessMessage(
      values.payment_source === "caisse"
        ? "Achat enregistré, stock mis à jour et montant débité de la caisse."
        : "Achat enregistré, stock mis à jour.",
    );
    reset({
      supplier_id: values.supplier_id,
      payment_source: values.payment_source,
      lines: [{ product_id: "", quantity: 1, unit_cost: 0 }],
    });
    await loadAll();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Achats</h1>

      {loaded && !openCaisseSessionId ? (
        <div className="max-w-2xl rounded-xl bg-white p-8 text-center shadow-sm">
          <Lock size={32} className="mx-auto mb-3 text-gray-300" />
          <h2 className="mb-1 text-lg font-semibold text-gray-900">Ouvrez la caisse pour enregistrer un achat</h2>
          <p className="mb-4 text-sm text-gray-500">
            Aucun achat ne peut être enregistré tant que la caisse n'est pas ouverte, quelle que soit la
            provenance des fonds.
          </p>
          <Link
            to="/pos"
            className="inline-block rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Aller ouvrir la caisse
          </Link>
        </div>
      ) : (
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-gray-900">Nouvel achat</h2>

        <div className="space-y-1">
          <label className="text-sm text-gray-600">Fournisseur</label>
          <select
            className="w-full rounded-md border border-gray-300 px-3 py-2"
            {...register("supplier_id")}
          >
            <option value="">Aucun</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-600">Provenance des fonds</label>
          <div className="grid grid-cols-2 gap-1.5">
            {(["other", "caisse"] as const).map((value) => (
              <label
                key={value}
                className={`flex cursor-pointer items-center justify-center rounded-md py-2 text-sm font-medium ${
                  paymentSource === value ? "bg-blue-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                <input type="radio" value={value} className="sr-only" {...register("payment_source")} />
                {PAYMENT_SOURCE_LABELS[value]}
              </label>
            ))}
          </div>
          {paymentSource === "caisse" && (
            <p className="text-xs text-gray-400">Le montant total sera débité de la caisse actuellement ouverte.</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm text-gray-600">Lignes</label>
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-1 gap-2 border-b border-gray-100 pb-3 last:border-0 last:pb-0 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-start sm:border-0 sm:pb-0"
            >
              <div>
                <select
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                  {...register(`lines.${index}.product_id` as const)}
                >
                  <option value="">Produit...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {errors.lines?.[index]?.product_id && (
                  <p className="text-xs text-red-600">{errors.lines[index]?.product_id?.message}</p>
                )}
              </div>
              <input
                type="number"
                step="0.001"
                placeholder="Qté"
                className="w-full rounded-md border border-gray-300 px-3 py-2"
                {...register(`lines.${index}.quantity` as const)}
              />
              <input
                type="number"
                step="0.01"
                placeholder="Coût unitaire (FBU)"
                className="w-full rounded-md border border-gray-300 px-3 py-2"
                {...register(`lines.${index}.unit_cost` as const)}
              />
              <button
                type="button"
                onClick={() => remove(index)}
                className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200"
              >
                Retirer
              </button>
            </div>
          ))}
          {errors.lines?.root && <p className="text-sm text-red-600">{errors.lines.root.message}</p>}
          <button
            type="button"
            onClick={() => append({ product_id: "", quantity: 1, unit_cost: 0 })}
            className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200"
          >
            + Ajouter une ligne
          </button>
        </div>

        {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
        {successMessage && <p className="text-sm text-emerald-600">{successMessage}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          Enregistrer l'achat
        </button>
      </form>
      )}

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-3 font-medium text-gray-900">Achats récents</h2>
        {purchases.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun achat pour l'instant.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Statut</th>
                  <th className="pb-2">Provenance</th>
                  <th className="pb-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="py-2 text-gray-900">{new Date(p.created_at).toLocaleString("fr-FR")}</td>
                    <td className="py-2 capitalize text-gray-700">{p.status}</td>
                    <td className="py-2 text-gray-700">{PAYMENT_SOURCE_LABELS[p.payment_source] ?? p.payment_source}</td>
                    <td className="py-2 text-gray-900">{formatCurrency(p.total_amount)}</td>
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
