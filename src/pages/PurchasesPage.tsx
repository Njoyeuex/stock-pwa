import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { formatCurrency } from "../lib/currency";
import { unitLabel, unitShort } from "../lib/units";
import { ErrorBox } from "../components/ErrorBox";
import { useAuth } from "../context/AuthContext";
import type { Tables } from "../types/database.types";

type Supplier = Tables<"suppliers">;
type Product = Tables<"products">;
type Purchase = Tables<"purchases">;

interface PurchaseLineDetail {
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  unitCost: number;
}

const PAID_SOURCE_LABELS: Record<string, string> = { caisse: "Caisse", other: "Autre" };

const schema = z.object({
  supplier_id: z.string().uuid("Choisir un fournisseur").optional().or(z.literal("")),
  paid_source: z.enum(["caisse", "other"]),
  credit_amount: z.coerce.number().min(0, "Doit être positif ou nul"),
  due_date: z.string().optional().or(z.literal("")),
  lines: z
    .array(
      z.object({
        product_id: z.string().uuid("Choisir un produit"),
        quantity: z.coerce.number().positive("Doit être positif"),
        unit_cost: z.coerce.number().min(0, "Doit être positif"),
        sku: z.string().max(50).optional().or(z.literal("")),
        sale_price: z.coerce.number().min(0, "Doit être positif").optional(),
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
  const [purchaseLineDetails, setPurchaseLineDetails] = useState<Record<string, PurchaseLineDetail[]>>({});
  const [openCaisseSessionId, setOpenCaisseSessionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      paid_source: "other",
      credit_amount: 0,
      due_date: "",
      lines: [{ product_id: "", quantity: 1, unit_cost: 0, sku: "", sale_price: 0 }],
    },
  });

  function onSelectProduct(index: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    setValue(`lines.${index}.sku` as const, product?.sku ?? "");
    setValue(`lines.${index}.sale_price` as const, product?.sale_price ?? 0);
  }

  const paidSource = watch("paid_source");
  const watchedLines = watch("lines");
  const total = (watchedLines ?? []).reduce(
    (sum, l) => sum + (Number(l?.quantity) || 0) * (Number(l?.unit_cost) || 0),
    0,
  );
  const creditAmount = Math.min(Math.max(Number(watch("credit_amount")) || 0, 0), total);
  const paidAmount = total - creditAmount;

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

    if (purchasesData && purchasesData.length > 0) {
      const { data: lineRows } = await supabase
        .from("purchase_lines")
        .select("purchase_id, quantity, unit_cost, products(name, sku, unit)")
        .in(
          "purchase_id",
          purchasesData.map((p) => p.id),
        );

      const detailMap: Record<string, PurchaseLineDetail[]> = {};
      for (const row of (lineRows as unknown as {
        purchase_id: string;
        quantity: number;
        unit_cost: number | null;
        products: { name: string; sku: string | null; unit: string } | null;
      }[]) ?? []) {
        if (!row.products) continue;
        if (!detailMap[row.purchase_id]) detailMap[row.purchase_id] = [];
        detailMap[row.purchase_id].push({
          name: row.products.name,
          sku: row.products.sku,
          unit: row.products.unit,
          quantity: row.quantity,
          unitCost: row.unit_cost ?? 0,
        });
      }
      setPurchaseLineDetails(detailMap);
    } else {
      setPurchaseLineDetails({});
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId, currentStoreId]);

  async function onSubmit(values: FormValues) {
    if (!currentOrgId || !currentStoreId) return;

    const credit = Math.min(Math.max(values.credit_amount || 0, 0), total);
    const paid = total - credit;

    if (credit > 0 && !values.supplier_id) {
      setErrorMessage("Choisissez un fournisseur pour la partie à crédit.");
      return;
    }
    if (credit > 0 && !values.due_date) {
      setErrorMessage("Indiquez la date d'échéance de la partie à crédit.");
      return;
    }
    if (values.paid_source === "caisse" && paid > 0 && !openCaisseSessionId) {
      setErrorMessage("Aucune caisse ouverte. Ouvrez la caisse ou payez la partie immédiate autrement.");
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);

    const { error } = await supabase.rpc("receive_purchase", {
      p_org_id: currentOrgId,
      p_store_id: currentStoreId,
      p_supplier_id: (values.supplier_id || null) as string,
      p_lines: values.lines,
      p_paid_source: values.paid_source,
      p_caisse_session_id:
        values.paid_source === "caisse" && paid > 0 ? openCaisseSessionId ?? undefined : undefined,
      p_credit_amount: credit,
      p_due_date: credit > 0 ? values.due_date : undefined,
    });

    if (error) {
      setErrorMessage(mapSupabaseError(error));
      return;
    }

    const parts: string[] = ["Achat enregistré, stock mis à jour"];
    if (paid > 0 && values.paid_source === "caisse") parts.push(`${formatCurrency(paid)} débité de la caisse`);
    if (credit > 0) parts.push(`${formatCurrency(credit)} à crédit`);

    let productUpdateError: string | null = null;
    for (const line of values.lines) {
      const product = products.find((p) => p.id === line.product_id);
      if (!product) continue;
      const nextSku = line.sku || null;
      const nextSalePrice = line.sale_price ?? product.sale_price;
      if (nextSku === product.sku && nextSalePrice === product.sale_price) continue;
      const { error: updateError } = await supabase
        .from("products")
        .update({ sku: nextSku, sale_price: nextSalePrice })
        .eq("id", product.id);
      if (updateError) productUpdateError = mapSupabaseError(updateError);
    }
    if (productUpdateError) {
      setSuccessMessage(null);
      setErrorMessage(`${parts.join(" — ")}, mais la mise à jour du SKU/prix de vente a échoué : ${productUpdateError}`);
    } else {
      setSuccessMessage(parts.join(" — ") + ".");
    }

    reset({
      supplier_id: values.supplier_id,
      paid_source: values.paid_source,
      credit_amount: 0,
      due_date: "",
      lines: [{ product_id: "", quantity: 1, unit_cost: 0, sku: "", sale_price: 0 }],
    });
    await loadAll();
  }

  const caisseBlocking = paidSource === "caisse" && paidAmount > 0 && !openCaisseSessionId;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Achats</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-gray-900">Nouvel achat</h2>

        <div className="space-y-1">
          <label className="text-sm text-gray-600">Fournisseur</label>
          <select className="w-full rounded-md border border-gray-300 px-3 py-2" {...register("supplier_id")}>
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
          {fields.map((field, index) => {
            const selectedProductId = watchedLines?.[index]?.product_id;
            const selectedProduct = products.find((p) => p.id === selectedProductId);
            return (
              <div
                key={field.id}
                className="grid grid-cols-1 gap-2 border-b border-gray-100 pb-3 last:border-0 last:pb-0 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-start sm:border-0 sm:pb-0"
              >
                <div>
                  <select
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
                    {...register(`lines.${index}.product_id` as const, {
                      onChange: (e) => onSelectProduct(index, e.target.value),
                    })}
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
                <div className="flex items-center rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                  {selectedProduct ? unitLabel(selectedProduct.unit) : "Unité"}
                </div>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Coût d'achat (FBU)"
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
                {selectedProduct && (
                  <div className="grid grid-cols-2 gap-2 sm:col-span-4">
                    <div>
                      <label className="text-xs text-gray-500">SKU</label>
                      <input
                        placeholder="SKU"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        {...register(`lines.${index}.sku` as const)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Prix de vente (FBU)</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Prix de vente"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        {...register(`lines.${index}.sale_price` as const)}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {errors.lines?.root && <p className="text-sm text-red-600">{errors.lines.root.message}</p>}
          <button
            type="button"
            onClick={() => append({ product_id: "", quantity: 1, unit_cost: 0, sku: "", sale_price: 0 })}
            className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200"
          >
            + Ajouter une ligne
          </button>
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-gray-600">Total de l'achat</span>
            <span className="font-semibold text-gray-900">{formatCurrency(total)}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm text-gray-600">Montant à crédit (dette fournisseur)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0"
                className="w-full rounded-md border border-gray-300 px-3 py-2"
                {...register("credit_amount")}
              />
              <p className="text-xs text-gray-400">Laissez 0 si l'achat est entièrement payé maintenant.</p>
            </div>
            {creditAmount > 0 && (
              <div className="space-y-1">
                <label className="text-sm text-gray-600">Date d'échéance</label>
                <input
                  type="date"
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                  {...register("due_date")}
                />
              </div>
            )}
          </div>

          {paidAmount > 0 && (
            <div className="mt-3 space-y-1">
              <label className="text-sm text-gray-600">
                Provenance des {formatCurrency(paidAmount)} payés maintenant
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {(["other", "caisse"] as const).map((value) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-center justify-center rounded-md py-2 text-sm font-medium ${
                      paidSource === value ? "bg-blue-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    <input type="radio" value={value} className="sr-only" {...register("paid_source")} />
                    {PAID_SOURCE_LABELS[value]}
                  </label>
                ))}
              </div>
              {caisseBlocking && (
                <ErrorBox
                  message="Aucune caisse ouverte actuellement. Ouvrez la caisse pour payer cette part au comptant, ou réglez-la autrement."
                  fixLabel="Ouvrir la caisse"
                  fixHref="/pos"
                />
              )}
              {paidSource === "caisse" && openCaisseSessionId && (
                <p className="text-xs text-gray-400">
                  {formatCurrency(paidAmount)} seront débités de la caisse actuellement ouverte.
                </p>
              )}
            </div>
          )}

          {creditAmount > 0 && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {formatCurrency(creditAmount)} resteront dus à ce fournisseur, à régler avant l'échéance indiquée.
            </p>
          )}
        </div>

        {errorMessage && <ErrorBox message={errorMessage} onDismiss={() => setErrorMessage(null)} />}
        {successMessage && <p className="text-sm text-emerald-600">{successMessage}</p>}

        <button
          type="submit"
          disabled={isSubmitting || caisseBlocking || total <= 0}
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
                  <th className="pb-2">Articles achetés</th>
                  <th className="pb-2">Quantité</th>
                  <th className="pb-2">Total</th>
                  <th className="pb-2">Payé</th>
                  <th className="pb-2">Crédit</th>
                  <th className="pb-2">Échéance</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="py-2 text-gray-900">{new Date(p.created_at).toLocaleString("fr-FR")}</td>
                    <td className="py-2 text-gray-700">
                      {(purchaseLineDetails[p.id] ?? []).length === 0 ? (
                        "—"
                      ) : (
                        <ul className="space-y-0.5">
                          {(purchaseLineDetails[p.id] ?? []).map((l, i) => (
                            <li key={i} className="whitespace-nowrap text-xs">
                              {l.name}
                              {l.sku && <span className="text-gray-400"> ({l.sku})</span>}{" "}
                              <span className="text-gray-400">
                                × {l.quantity} {unitShort(l.unit)} — {unitLabel(l.unit)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-2 text-gray-700">
                      {(purchaseLineDetails[p.id] ?? []).reduce((sum, l) => sum + l.quantity, 0)}
                    </td>
                    <td className="py-2 text-gray-900">{formatCurrency(p.total_amount)}</td>
                    <td className="py-2 text-gray-700">
                      {formatCurrency(p.paid_amount)}
                      {p.paid_amount > 0 && (
                        <span className="text-xs text-gray-400"> ({PAID_SOURCE_LABELS[p.payment_source] ?? p.payment_source})</span>
                      )}
                    </td>
                    <td className={`py-2 ${p.credit_amount > 0 ? "font-medium text-amber-600" : "text-gray-400"}`}>
                      {p.credit_amount > 0 ? formatCurrency(p.credit_amount) : "—"}
                    </td>
                    <td className="py-2 text-gray-700">
                      {p.due_date ? new Date(p.due_date).toLocaleDateString("fr-FR") : "—"}
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
