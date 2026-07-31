import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { useAuth } from "../context/AuthContext";

const slugRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const schema = z.object({
  name: z.string().min(2, "Nom trop court").max(100),
  slug: z
    .string()
    .min(2, "Identifiant trop court")
    .max(50)
    .regex(slugRe, "Minuscules, chiffres et tirets uniquement"),
});

type FormValues = z.infer<typeof schema>;

export function OnboardingPage() {
  const navigate = useNavigate();
  const { refreshMemberships } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("bootstrap_organization", {
        p_name: values.name,
        p_slug: values.slug,
      });
      if (error) {
        setErrorMessage(mapSupabaseError(error));
        return;
      }
      await refreshMemberships();
      navigate("/", { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-sm space-y-4 rounded-xl bg-white p-8 shadow-md"
      >
        <h1 className="text-xl font-semibold text-gray-900">Créer votre organisation</h1>
        <p className="text-sm text-gray-500">
          Vous serez propriétaire de cette organisation et pourrez ensuite inviter votre équipe.
        </p>

        <div className="space-y-1">
          <label className="text-sm text-gray-600">Nom de l'entreprise</label>
          <input
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900"
            {...register("name")}
          />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-600">Identifiant (slug)</label>
          <input
            placeholder="ex: boutique-nyamwe"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900"
            {...register("slug")}
          />
          {errors.slug && <p className="text-sm text-red-600">{errors.slug.message}</p>}
        </div>

        {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-red-600 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {submitting ? "Création..." : "Créer l'organisation"}
        </button>
      </form>
    </div>
  );
}
