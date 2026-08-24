import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { productPhotoUrl } from "../lib/productImages";
import { formatCurrency } from "../lib/currency";
import { UNIT_OPTIONS, unitLabel } from "../lib/units";
import { ErrorBox } from "../components/ErrorBox";
import { useAuth } from "../context/AuthContext";
import type { Tables } from "../types/database.types";

type Product = Tables<"products">;
type Category = Tables<"product_categories">;

const productSchema = z.object({
  name: z.string().min(2, "Nom trop court").max(200),
  sku: z.string().max(50).optional().or(z.literal("")),
  barcode: z.string().max(50).optional().or(z.literal("")),
  unit: z.string().min(1).max(20),
  category_id: z.string().uuid().optional().or(z.literal("")),
  sale_price: z.coerce.number().min(0, "Doit être positif"),
  cost_price: z.coerce.number().min(0, "Doit être positif").optional(),
  reorder_threshold: z.coerce.number().min(0, "Doit être positif"),
  initial_quantity: z.coerce.number().min(0, "Doit être positif ou nul").optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

const categorySchema = z.object({ name: z.string().min(2, "Nom trop court").max(100) });
type CategoryFormValues = z.infer<typeof categorySchema>;

const DEFAULT_PRODUCT_VALUES: ProductFormValues = {
  name: "",
  sku: "",
  barcode: "",
  unit: "piece",
  category_id: "",
  sale_price: 0,
  cost_price: undefined,
  reorder_threshold: 0,
  initial_quantity: 0,
};

const inputClass = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900";

export function ProductsPage() {
  const { currentOrgId, currentStoreId, currentRole, currentPerms } = useAuth();
  const canWrite =
    currentRole === "proprietaire" || currentRole === "gerant" || currentPerms?.perm_catalog === true;
  const canDelete = currentRole === "proprietaire" || currentRole === "gerant";

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const productForm = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: DEFAULT_PRODUCT_VALUES,
  });
  const categoryForm = useForm<CategoryFormValues>({ resolver: zodResolver(categorySchema) });

  async function loadAll() {
    if (!currentOrgId) return;
    setLoading(true);
    const [{ data: productsData }, { data: categoriesData }] = await Promise.all([
      supabase.from("products").select("*").eq("org_id", currentOrgId).eq("is_active", true).order("name"),
      supabase.from("product_categories").select("*").eq("org_id", currentOrgId).order("name"),
    ]);
    setProducts(productsData ?? []);
    setCategories(categoriesData ?? []);

    if (productsData && productsData.length > 0) {
      const { data: costsData } = await supabase
        .from("product_costs")
        .select("product_id, cost_price")
        .in(
          "product_id",
          productsData.map((p) => p.id),
        );
      const map: Record<string, number> = {};
      for (const c of costsData ?? []) map[c.product_id] = c.cost_price;
      setCosts(map);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId]);

  async function onSubmitCategory(values: CategoryFormValues) {
    if (!currentOrgId) return;
    setErrorMessage(null);
    const { error } = await supabase
      .from("product_categories")
      .insert({ org_id: currentOrgId, name: values.name });
    if (error) {
      setErrorMessage(mapSupabaseError(error));
      return;
    }
    categoryForm.reset();
    await loadAll();
  }

  function startEdit(p: Product) {
    setErrorMessage(null);
    setPhotoFile(null);
    setEditingId(p.id);
    productForm.reset({
      name: p.name,
      sku: p.sku ?? "",
      barcode: p.barcode ?? "",
      unit: p.unit,
      category_id: p.category_id ?? "",
      sale_price: p.sale_price,
      cost_price: costs[p.id],
      reorder_threshold: p.reorder_threshold,
      initial_quantity: 0,
    });
  }

  async function deleteProduct(p: Product) {
    if (
      !window.confirm(
        `Supprimer "${p.name}" du magasin ? Il n'apparaîtra plus dans le catalogue, la caisse ni le stock.`,
      )
    ) {
      return;
    }
    setErrorMessage(null);
    const { error } = await supabase.rpc("delete_product", { p_product_id: p.id });
    if (error) {
      setErrorMessage(mapSupabaseError(error));
      return;
    }
    if (editingId === p.id) cancelEdit();
    await loadAll();
  }

  function cancelEdit() {
    setEditingId(null);
    setPhotoFile(null);
    productForm.reset(DEFAULT_PRODUCT_VALUES);
  }

  async function onSubmitProduct(values: ProductFormValues) {
    if (!currentOrgId) return;
    setErrorMessage(null);

    const payload = {
      name: values.name,
      sku: values.sku || null,
      barcode: values.barcode || null,
      unit: values.unit,
      category_id: values.category_id || null,
      sale_price: values.sale_price,
      reorder_threshold: values.reorder_threshold,
    };

    let productId = editingId;

    if (editingId) {
      const { error } = await supabase.from("products").update(payload).eq("id", editingId);
      if (error) {
        setErrorMessage(mapSupabaseError(error));
        return;
      }
    } else {
      const { data: created, error } = await supabase
        .from("products")
        .insert({ org_id: currentOrgId, ...payload })
        .select("id")
        .single();
      if (error || !created) {
        setErrorMessage(mapSupabaseError(error));
        return;
      }
      productId = created.id;

      if (values.initial_quantity && values.initial_quantity > 0 && currentStoreId) {
        const { error: stockError } = await supabase.rpc("adjust_stock", {
          p_org_id: currentOrgId,
          p_store_id: currentStoreId,
          p_product_id: productId,
          p_quantity_delta: values.initial_quantity,
          p_note: "Quantité initiale à la création du produit",
        });
        if (stockError) {
          setErrorMessage("Produit créé, mais l'ajout du stock initial a échoué. Ajustez le stock manuellement.");
        }
      }
    }

    if (values.cost_price !== undefined && productId) {
      const { error: costError } = await supabase
        .from("product_costs")
        .upsert({ product_id: productId, cost_price: values.cost_price });
      if (costError) {
        setErrorMessage(mapSupabaseError(costError));
        return;
      }
    }

    if (photoFile && productId) {
      const ext = photoFile.name.split(".").pop() ?? "jpg";
      const path = `${currentOrgId}/${productId}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(path, photoFile, { upsert: true, contentType: photoFile.type });

      if (uploadError) {
        setErrorMessage("Produit enregistré, mais l'envoi de la photo a échoué.");
      } else {
        await supabase.from("products").update({ image_path: path }).eq("id", productId);
      }
    }

    setPhotoFile(null);
    setEditingId(null);
    productForm.reset(DEFAULT_PRODUCT_VALUES);
    await loadAll();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Catalogue produits</h1>

      {canWrite && (
        <div className="grid gap-6 md:grid-cols-2">
          <form
            onSubmit={categoryForm.handleSubmit(onSubmitCategory)}
            className="space-y-3 rounded-xl bg-white p-6 shadow-sm"
          >
            <h2 className="font-medium text-gray-900">Ajouter une catégorie</h2>
            <input className={inputClass} placeholder="Nom de la catégorie" {...categoryForm.register("name")} />
            {categoryForm.formState.errors.name && (
              <p className="text-sm text-red-600">{categoryForm.formState.errors.name.message}</p>
            )}
            <button
              type="submit"
              disabled={categoryForm.formState.isSubmitting}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Ajouter
            </button>
          </form>

          <form
            onSubmit={productForm.handleSubmit(onSubmitProduct)}
            className="space-y-3 rounded-xl bg-white p-6 shadow-sm md:col-span-1"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-gray-900">
                {editingId ? "Modifier le produit" : "Ajouter un produit"}
              </h2>
              {editingId && (
                <button type="button" onClick={cancelEdit} className="text-xs text-gray-500 hover:text-gray-900">
                  Annuler
                </button>
              )}
            </div>

            <input className={inputClass} placeholder="Nom" {...productForm.register("name")} />
            {productForm.formState.errors.name && (
              <p className="text-sm text-red-600">{productForm.formState.errors.name.message}</p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <input className={inputClass} placeholder="SKU" {...productForm.register("sku")} />
              <input className={inputClass} placeholder="Code-barres" {...productForm.register("barcode")} />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-500">Photo de l'article (sert de référence visuelle)</label>
              <input
                type="file"
                accept="image/*"
                className="w-full text-sm text-gray-600"
                onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500">Quantité {editingId ? "" : "initiale"}</label>
                <input
                  type="number"
                  step="0.001"
                  disabled={!!editingId}
                  placeholder="Quantité"
                  className={`${inputClass} disabled:bg-gray-100 disabled:text-gray-400`}
                  {...productForm.register("initial_quantity")}
                />
                {editingId && <p className="mt-1 text-xs text-gray-400">Ajustez le stock depuis la page Stock.</p>}
              </div>
              <div>
                <label className="text-xs text-gray-500">Unité</label>
                <select className={inputClass} {...productForm.register("unit")}>
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <select className={inputClass} {...productForm.register("category_id")}>
              <option value="">Sans catégorie</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <label className="text-xs text-gray-500">Prix de vente</label>
                <input type="number" step="0.01" className={inputClass} {...productForm.register("sale_price")} />
              </div>
              <div>
                <label className="text-xs text-gray-500">Coût d'achat</label>
                <input type="number" step="0.01" className={inputClass} {...productForm.register("cost_price")} />
              </div>
              <div>
                <label className="text-xs text-gray-500">Seuil de réappro.</label>
                <input
                  type="number"
                  step="0.01"
                  className={inputClass}
                  {...productForm.register("reorder_threshold")}
                />
              </div>
            </div>

            {errorMessage && <ErrorBox message={errorMessage} onDismiss={() => setErrorMessage(null)} />}

            <button
              type="submit"
              disabled={productForm.formState.isSubmitting}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {editingId ? "Enregistrer les modifications" : "Ajouter le produit"}
            </button>
          </form>
        </div>
      )}

      {!canWrite && errorMessage && <ErrorBox message={errorMessage} onDismiss={() => setErrorMessage(null)} />}

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-3 font-medium text-gray-900">Produits</h2>
        {loading ? (
          <p className="text-sm text-gray-500">Chargement...</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun produit pour l'instant.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="pb-2">Photo</th>
                  <th className="pb-2">Nom</th>
                  <th className="pb-2">SKU</th>
                  <th className="pb-2">Unité</th>
                  <th className="pb-2">Prix de vente</th>
                  {currentRole !== "caissier" && currentRole !== "vendeur" && <th className="pb-2">Coût</th>}
                  <th className="pb-2">Seuil réappro.</th>
                  {(canWrite || canDelete) && <th className="pb-2"></th>}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const photoUrl = productPhotoUrl(p.image_path);
                  return (
                    <tr key={p.id} className="border-t border-gray-100">
                      <td className="py-2">
                        {photoUrl ? (
                          <img src={photoUrl} alt={p.name} className="h-10 w-10 rounded-md object-cover" />
                        ) : (
                          <div className="h-10 w-10 rounded-md bg-gray-100" />
                        )}
                      </td>
                      <td className="py-2 text-gray-900">{p.name}</td>
                      <td className="py-2 text-gray-500">{p.sku ?? "—"}</td>
                      <td className="py-2 text-gray-700">{unitLabel(p.unit)}</td>
                      <td className="py-2 text-gray-700">{formatCurrency(p.sale_price)}</td>
                      {currentRole !== "caissier" && currentRole !== "vendeur" && (
                        <td className="py-2 text-gray-700">
                          {costs[p.id] !== undefined ? formatCurrency(costs[p.id]) : "—"}
                        </td>
                      )}
                      <td className="py-2 text-gray-700">{p.reorder_threshold}</td>
                      {(canWrite || canDelete) && (
                        <td className="py-2 text-right">
                          <div className="flex justify-end gap-2">
                            {canWrite && (
                              <button
                                onClick={() => startEdit(p)}
                                className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-200"
                              >
                                Modifier
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => deleteProduct(p)}
                                className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                              >
                                Supprimer
                              </button>
                            )}
                          </div>
                        </td>
                      )}
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
