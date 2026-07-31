import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { useAuth } from "../context/AuthContext";
import type { Tables } from "../types/database.types";

type Service = Tables<"services">;

const schema = z.object({
  name: z.string().min(2, "Nom trop court").max(150),
  description: z.string().max(500).optional().or(z.literal("")),
  price: z.coerce.number().min(0, "Doit être positif"),
});

type FormValues = z.infer<typeof schema>;

const DEFAULT_VALUES: FormValues = { name: "", description: "", price: 0 };
const inputClass = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900";

export function ServicesPage() {
  const { currentOrgId, currentRole, currentPerms } = useAuth();
  const canWrite =
    currentRole === "proprietaire" || currentRole === "gerant" || currentPerms?.perm_catalog === true;

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULT_VALUES });

  async function loadServices() {
    if (!currentOrgId) return;
    setLoading(true);
    const { data } = await supabase
      .from("services")
      .select("*")
      .eq("org_id", currentOrgId)
      .order("name");
    setServices(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadServices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId]);

  function startEdit(s: Service) {
    setErrorMessage(null);
    setEditingId(s.id);
    reset({ name: s.name, description: s.description ?? "", price: s.price });
  }

  function cancelEdit() {
    setEditingId(null);
    reset(DEFAULT_VALUES);
  }

  async function onSubmit(values: FormValues) {
    if (!currentOrgId) return;
    setErrorMessage(null);

    const payload = {
      name: values.name,
      description: values.description || null,
      price: values.price,
    };

    const { error } = editingId
      ? await supabase.from("services").update(payload).eq("id", editingId)
      : await supabase.from("services").insert({ org_id: currentOrgId, ...payload });

    if (error) {
      setErrorMessage(mapSupabaseError(error));
      return;
    }
    setEditingId(null);
    reset(DEFAULT_VALUES);
    await loadServices();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Services</h1>
      <p className="text-sm text-gray-500">
        Toute prestation facturable qui n'est pas un article physique en stock (réparation,
        livraison, main d'œuvre, etc.).
      </p>

      {canWrite && (
        <form onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-3 rounded-xl bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-gray-900">{editingId ? "Modifier le service" : "Ajouter un service"}</h2>
            {editingId && (
              <button type="button" onClick={cancelEdit} className="text-xs text-gray-500 hover:text-gray-900">
                Annuler
              </button>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-sm text-gray-600">Nom</label>
            <input className={inputClass} {...register("name")} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="space-y-1">
            <label className="text-sm text-gray-600">Description</label>
            <textarea className={inputClass} rows={3} {...register("description")} />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-gray-600">Prix</label>
            <input type="number" step="0.01" className={inputClass} {...register("price")} />
            {errors.price && <p className="text-sm text-red-600">{errors.price.message}</p>}
          </div>
          {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {editingId ? "Enregistrer les modifications" : "Ajouter"}
          </button>
        </form>
      )}

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-3 font-medium text-gray-900">Liste</h2>
        {loading ? (
          <p className="text-sm text-gray-500">Chargement...</p>
        ) : services.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun service pour l'instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="pb-2">Nom</th>
                <th className="pb-2">Description</th>
                <th className="pb-2">Prix</th>
                {canWrite && <th className="pb-2"></th>}
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="py-2 text-gray-900">{s.name}</td>
                  <td className="py-2 text-gray-500">{s.description ?? "—"}</td>
                  <td className="py-2 text-gray-700">{s.price.toFixed(2)}</td>
                  {canWrite && (
                    <td className="py-2 text-right">
                      <button
                        onClick={() => startEdit(s)}
                        className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-200"
                      >
                        Modifier
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
