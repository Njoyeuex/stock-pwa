import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { useAuth } from "../context/AuthContext";
import type { Tables } from "../types/database.types";

type Product = Tables<"products">;

interface StockRow {
  product_id: string;
  store_id: string;
  quantity: number;
  products: { name: string; unit: string; reorder_threshold: number } | null;
}

const schema = z.object({
  product_id: z.string().uuid("Choisir un produit"),
  delta: z.coerce.number().refine((v) => v !== 0, "Doit être différent de zéro"),
  note: z.string().max(200).optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

export function StockPage() {
  const { currentOrgId, currentStoreId } = useAuth();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function loadAll() {
    if (!currentOrgId) return;
    const [{ data: stockData }, { data: productsData }] = await Promise.all([
      supabase.from("product_stock").select("product_id, store_id, quantity, products(name, unit, reorder_threshold)"),
      supabase.from("products").select("*").eq("org_id", currentOrgId).order("name"),
    ]);
    setRows((stockData as unknown as StockRow[]) ?? []);
    setProducts(productsData ?? []);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId]);

  async function onSubmit(values: FormValues) {
    if (!currentOrgId || !currentStoreId) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    const { error } = await supabase.rpc("adjust_stock", {
      p_org_id: currentOrgId,
      p_store_id: currentStoreId,
      p_product_id: values.product_id,
      p_quantity_delta: values.delta,
      p_note: values.note || undefined,
    });

    if (error) {
      setErrorMessage(mapSupabaseError(error));
      return;
    }

    setSuccessMessage("Stock ajusté.");
    reset();
    await loadAll();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Stock</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-xl space-y-3 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-gray-900">Ajustement manuel</h2>
        <div className="space-y-1">
          <label className="text-sm text-gray-600">Produit</label>
          <select className="w-full rounded-md border border-gray-300 px-3 py-2" {...register("product_id")}>
            <option value="">Choisir...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {errors.product_id && <p className="text-sm text-red-600">{errors.product_id.message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm text-gray-600">Quantité (+ entrée / - sortie)</label>
            <input
              type="number"
              step="0.001"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              {...register("delta")}
            />
            {errors.delta && <p className="text-sm text-red-600">{errors.delta.message}</p>}
          </div>
          <div className="space-y-1">
            <label className="text-sm text-gray-600">Note</label>
            <input className="w-full rounded-md border border-gray-300 px-3 py-2" {...register("note")} />
          </div>
        </div>
        {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
        {successMessage && <p className="text-sm text-emerald-600">{successMessage}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          Ajuster
        </button>
      </form>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-3 font-medium text-gray-900">Niveaux de stock</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun mouvement de stock pour l'instant.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="pb-2">Produit</th>
                  <th className="pb-2">Quantité</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const low = r.products && r.quantity <= r.products.reorder_threshold;
                  return (
                    <tr key={`${r.product_id}-${r.store_id}`} className="border-t border-gray-100">
                      <td className="py-2 text-gray-900">{r.products?.name ?? r.product_id}</td>
                      <td className={`py-2 ${low ? "text-amber-600" : "text-gray-900"}`}>
                        {r.quantity} {r.products?.unit}
                        {low && " (stock bas)"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
