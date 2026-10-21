import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Search, AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { UNIT_OPTIONS, unitLabel } from "../lib/units";
import { stockStatus } from "../lib/stockStatus";
import { ErrorBox } from "../components/ErrorBox";
import { useAuth } from "../context/AuthContext";
import type { Tables } from "../types/database.types";

type Product = Tables<"products">;

interface StockRow {
  product_id: string;
  store_id: string;
  quantity: number;
  products: { name: string; sku: string | null; unit: string; reorder_threshold: number } | null;
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
  const [soldByProduct, setSoldByProduct] = useState<Record<string, number>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const [productQuery, setProductQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const selectedProductId = watch("product_id");
  const selectedProductUnit = products.find((p) => p.id === selectedProductId)?.unit ?? "";

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q),
    );
  }, [products, productQuery]);

  function selectProduct(p: Product) {
    setValue("product_id", p.id, { shouldValidate: true });
    setProductQuery(p.name);
    setShowSuggestions(false);
  }

  async function loadAll() {
    if (!currentOrgId) return;
    const [{ data: stockData }, { data: productsData }, { data: soldData }] = await Promise.all([
      supabase
        .from("product_stock")
        .select("product_id, store_id, quantity, products(name, sku, unit, reorder_threshold)"),
      supabase.from("products").select("*").eq("org_id", currentOrgId).eq("is_active", true).order("name"),
      supabase.from("stock_movements").select("product_id, quantity").eq("movement_type", "sale_out"),
    ]);
    setRows((stockData as unknown as StockRow[]) ?? []);
    setProducts(productsData ?? []);

    const soldMap: Record<string, number> = {};
    for (const m of soldData ?? []) {
      soldMap[m.product_id] = (soldMap[m.product_id] ?? 0) + m.quantity;
    }
    setSoldByProduct(soldMap);
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
    setProductQuery("");
    await loadAll();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Stock</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-xl space-y-3 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-gray-900">Ajustement manuel</h2>
        <div className="relative space-y-1">
          <label className="text-sm text-gray-600">Produit</label>
          <input type="hidden" {...register("product_id")} />
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={productQuery}
              onChange={(e) => {
                setProductQuery(e.target.value);
                setValue("product_id", "", { shouldValidate: false });
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setShowSuggestions(false)}
              placeholder="Rechercher un produit par nom ou code..."
              className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900"
            />
          </div>
          {showSuggestions && (
            <div className="absolute z-10 max-h-56 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
              {filteredProducts.length === 0 ? (
                <p className="px-3 py-2 text-sm text-gray-500">Aucun produit trouvé.</p>
              ) : (
                filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={() => selectProduct(p)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    <span className="text-gray-900">{p.name}</span>
                    {p.sku && <span className="text-xs text-gray-400">{p.sku}</span>}
                  </button>
                ))
              )}
            </div>
          )}
          {errors.product_id && <p className="text-sm text-red-600">{errors.product_id.message}</p>}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <label className="text-sm text-gray-600">Unité</label>
            <select
              disabled
              value={selectedProductUnit}
              className="w-full rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-gray-500"
            >
              <option value="">—</option>
              {UNIT_OPTIONS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm text-gray-600">Note</label>
            <input className="w-full rounded-md border border-gray-300 px-3 py-2" {...register("note")} />
          </div>
        </div>
        {errorMessage && <ErrorBox message={errorMessage} onDismiss={() => setErrorMessage(null)} />}
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
                  <th className="pb-2">Réf</th>
                  <th className="pb-2">Unité</th>
                  <th className="pb-2">Quantité vendue</th>
                  <th className="pb-2">Quantité restante</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const status = stockStatus(r.quantity);
                  const low = status !== "ok";
                  return (
                    <tr key={`${r.product_id}-${r.store_id}`} className="border-t border-gray-100">
                      <td className="py-2 text-gray-900">{r.products?.name ?? r.product_id}</td>
                      <td className="py-2 text-gray-500">{r.products?.sku ?? "—"}</td>
                      <td className="py-2 text-gray-500">{unitLabel(r.products?.unit)}</td>
                      <td className="py-2 text-gray-700">{soldByProduct[r.product_id] ?? 0}</td>
                      <td className={`py-2 font-medium ${low ? "text-amber-600" : "text-gray-900"}`}>
                        <span className="inline-flex items-center gap-1">
                          {low && <AlertTriangle size={14} className="text-amber-500" />}
                          {r.quantity} {r.products?.unit}
                          {status === "out" ? " (rupture)" : status === "low" ? " (stock bas)" : ""}
                        </span>
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
