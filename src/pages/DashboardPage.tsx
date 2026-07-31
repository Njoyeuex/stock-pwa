import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Plus } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { productPhotoUrl } from "../lib/productImages";
import { stockStatus } from "../lib/stockStatus";
import { useAuth } from "../context/AuthContext";

interface InventoryRow {
  id: string;
  sku: string | null;
  name: string;
  image_path: string | null;
  sale_price: number;
  reorder_threshold: number;
  updated_at: string;
  category: string | null;
  quantity: number;
}

interface ProductQueryRow {
  id: string;
  sku: string | null;
  name: string;
  image_path: string | null;
  sale_price: number;
  reorder_threshold: number;
  updated_at: string;
  product_categories: { name: string } | null;
}

const STATUS_LABELS: Record<string, string> = { out: "Rupture", low: "Stock bas", ok: "En stock" };
const STATUS_CLASSES: Record<string, string> = {
  out: "bg-red-100 text-red-700",
  low: "bg-amber-100 text-amber-700",
  ok: "bg-emerald-100 text-emerald-700",
};

export function DashboardPage() {
  const { currentOrgId, currentRole } = useAuth();
  const canManage = currentRole === "proprietaire" || currentRole === "gerant";

  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      if (!currentOrgId) return;
      setLoading(true);

      const { data: productsData } = await supabase
        .from("products")
        .select("id, sku, name, image_path, sale_price, reorder_threshold, updated_at, product_categories(name)")
        .eq("org_id", currentOrgId)
        .order("updated_at", { ascending: false });

      const products = (productsData as unknown as ProductQueryRow[]) ?? [];

      let quantityByProduct = new Map<string, number>();
      if (products.length > 0) {
        const { data: stockData } = await supabase
          .from("product_stock")
          .select("product_id, quantity")
          .in(
            "product_id",
            products.map((p) => p.id),
          );

        for (const s of stockData ?? []) {
          quantityByProduct.set(s.product_id, (quantityByProduct.get(s.product_id) ?? 0) + s.quantity);
        }
      }

      setRows(
        products.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          image_path: p.image_path,
          sale_price: p.sale_price,
          reorder_threshold: p.reorder_threshold,
          updated_at: p.updated_at,
          category: p.product_categories?.name ?? null,
          quantity: quantityByProduct.get(p.id) ?? 0,
        })),
      );
      setLoading(false);
    }

    load();
  }, [currentOrgId]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.sku ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un article..."
              className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 sm:w-64"
            />
          </div>
          {canManage && (
            <Link
              to="/products"
              className="flex items-center justify-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              <Plus size={16} />
              Ajouter un article
            </Link>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        {loading ? (
          <p className="p-6 text-sm text-gray-500">Chargement...</p>
        ) : filteredRows.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">
            {rows.length === 0 ? "Aucun article dans le catalogue pour l'instant." : "Aucun résultat."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 text-left text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">Photo</th>
                  <th className="px-4 py-3 font-medium">Titre</th>
                  <th className="px-4 py-3 font-medium">Catégorie</th>
                  <th className="px-4 py-3 font-medium">Qté</th>
                  <th className="px-4 py-3 font-medium">Prix</th>
                  <th className="px-4 py-3 font-medium">Dernière modif.</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const photoUrl = productPhotoUrl(r.image_path);
                  const status = stockStatus(r.quantity, r.reorder_threshold);
                  return (
                    <tr key={r.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-3 text-gray-500">{r.sku ?? "—"}</td>
                      <td className="px-4 py-3">
                        {photoUrl ? (
                          <img src={photoUrl} alt={r.name} className="h-10 w-10 rounded-md object-cover" />
                        ) : (
                          <div className="h-10 w-10 rounded-md bg-gray-100" />
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                      <td className="px-4 py-3 text-gray-700">{r.category ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-700">{r.quantity}</td>
                      <td className="px-4 py-3 text-gray-700">{r.sale_price.toFixed(2)}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(r.updated_at).toLocaleString("fr-FR", {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "2-digit",
                          month: "short",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASSES[status]}`}>
                          {STATUS_LABELS[status]}
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
