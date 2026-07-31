import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { useAuth } from "../context/AuthContext";
import type { Tables } from "../types/database.types";

type Supplier = Tables<"suppliers">;
type Product = Tables<"products">;
type Purchase = Tables<"purchases">;

const schema = z.object({
  supplier_id: z.string().uuid("Choisir un fournisseur").optional().or(z.literal("")),
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { lines: [{ product_id: "", quantity: 1, unit_cost: 0 }] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });

  async function loadAll() {
    if (!currentOrgId) return;
    const [{ data: suppliersData }, { data: productsData }, { data: purchasesData }] = await Promise.all([
      supabase.from("suppliers").select("*").eq("org_id", currentOrgId).order("name"),
      supabase.from("products").select("*").eq("org_id", currentOrgId).order("name"),
      supabase
        .from("purchases")
        .select("*")
        .eq("org_id", currentOrgId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setSuppliers(suppliersData ?? []);
    setProducts(productsData ?? []);
    setPurchases(purchasesData ?? []);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId]);

  async function onSubmit(values: FormValues) {
    if (!currentOrgId || !currentStoreId) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    const { error } = await supabase.rpc("receive_purchase", {
      p_org_id: currentOrgId,
      p_store_id: currentStoreId,
      p_supplier_id: (values.supplier_id || null) as string,
      p_lines: values.lines,
    });

    if (error) {
      setErrorMessage(mapSupabaseError(error));
      return;
    }

    setSuccessMessage("Achat enregistré, stock mis à jour.");
    reset({ supplier_id: values.supplier_id, lines: [{ product_id: "", quantity: 1, unit_cost: 0 }] });
    await loadAll();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Achats</h1>

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
                placeholder="Coût unitaire"
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
                  <th className="pb-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="py-2 text-gray-900">{new Date(p.created_at).toLocaleString("fr-FR")}</td>
                    <td className="py-2 capitalize text-gray-700">{p.status}</td>
                    <td className="py-2 text-gray-900">{p.total_amount.toFixed(2)}</td>
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
