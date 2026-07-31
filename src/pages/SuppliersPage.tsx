import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { useAuth } from "../context/AuthContext";
import type { Tables } from "../types/database.types";

type Supplier = Tables<"suppliers">;

const schema = z.object({
  name: z.string().min(2, "Nom trop court").max(150),
  phone: z.string().max(30).optional().or(z.literal("")),
  email: z.string().email("Email invalide").max(255).optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;
const inputClass = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900";

export function SuppliersPage() {
  const { currentOrgId } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function loadSuppliers() {
    if (!currentOrgId) return;
    setLoading(true);
    const { data } = await supabase
      .from("suppliers")
      .select("*")
      .eq("org_id", currentOrgId)
      .order("created_at", { ascending: true });
    setSuppliers(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId]);

  async function onSubmit(values: FormValues) {
    if (!currentOrgId) return;
    setErrorMessage(null);
    const { error } = await supabase.from("suppliers").insert({
      org_id: currentOrgId,
      name: values.name,
      phone: values.phone || null,
      email: values.email || null,
    });
    if (error) {
      setErrorMessage(mapSupabaseError(error));
      return;
    }
    reset();
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
          <label className="text-sm text-gray-600">Email</label>
          <input className={inputClass} {...register("email")} />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
        </div>
        {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
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
                  <th className="pb-2">Email</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="border-t border-gray-100">
                    <td className="py-2 text-gray-900">{s.name}</td>
                    <td className="py-2 text-gray-700">{s.phone ?? "—"}</td>
                    <td className="py-2 text-gray-700">{s.email ?? "—"}</td>
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
