import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { adminCreateUser, adminDeleteUser, AuthApiError } from "../lib/authApi";
import { ROLE_LABELS } from "../lib/roles";
import { useAuth, type AppRole, type MembershipPermissions } from "../context/AuthContext";

interface MemberRow extends MembershipPermissions {
  id: string;
  user_id: string;
  role: AppRole;
  is_active: boolean;
  full_name: string | null;
}

// Only the propriétaire assigns roles, and only to roles it makes sense to hand out here;
// magasinier accounts are not created through this form.
const CREATABLE_ROLES: AppRole[] = ["gerant", "caissier", "vendeur"];

const PERMISSION_FIELDS: { key: keyof MembershipPermissions; label: string }[] = [
  { key: "perm_caisse", label: "Ouvrir ou fermer la caisse" },
  { key: "perm_catalog", label: "Modifier ou supprimer produits / services" },
  { key: "perm_invoices", label: "Modifier ou supprimer les factures (annuler une vente)" },
  { key: "perm_users", label: "Créer ou supprimer des utilisateurs" },
  { key: "perm_view_users", label: "Voir les utilisateurs" },
  { key: "perm_view_reports", label: "Voir les rapports" },
];

const schema = z.object({
  full_name: z.string().min(2, "Nom trop court").max(150),
  email: z.string().min(1, "Email requis").email("Email invalide"),
  password: z.string().min(8, "8 caractères minimum"),
  role: z.enum(["gerant", "caissier", "vendeur"]),
  perm_caisse: z.boolean(),
  perm_catalog: z.boolean(),
  perm_invoices: z.boolean(),
  perm_users: z.boolean(),
  perm_view_users: z.boolean(),
  perm_view_reports: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

export function UsersPage() {
  const { currentOrgId, currentStoreId, currentRole, currentPerms, storeName, session } = useAuth();
  const isOwner = currentRole === "proprietaire";
  const canManageUsers = isOwner || currentPerms?.perm_users === true;
  const canViewUsers = canManageUsers || currentPerms?.perm_view_users === true;

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      role: "vendeur",
      perm_caisse: false,
      perm_catalog: false,
      perm_invoices: false,
      perm_users: false,
      perm_view_users: false,
      perm_view_reports: false,
    },
  });

  async function loadMembers() {
    if (!currentOrgId) return;
    setLoading(true);
    const { data: membershipsData } = await supabase
      .from("memberships")
      .select(
        "id, user_id, role, is_active, perm_caisse, perm_catalog, perm_invoices, perm_users, perm_view_users, perm_view_reports",
      )
      .eq("org_id", currentOrgId)
      .order("created_at", { ascending: true });

    const rows = membershipsData ?? [];
    let profilesById = new Map<string, string | null>();
    if (rows.length > 0) {
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in(
          "id",
          rows.map((r) => r.user_id),
        );
      profilesById = new Map((profilesData ?? []).map((p) => [p.id, p.full_name]));
    }

    setMembers(rows.map((r) => ({ ...r, full_name: profilesById.get(r.user_id) ?? null })));
    setLoading(false);
  }

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId]);

  async function onSubmit(values: FormValues) {
    if (!currentOrgId || !currentStoreId) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await adminCreateUser({
        org_id: currentOrgId,
        store_id: currentStoreId,
        email: values.email,
        password: values.password,
        full_name: values.full_name,
        role: values.role,
        perm_caisse: values.perm_caisse,
        perm_catalog: values.perm_catalog,
        perm_invoices: values.perm_invoices,
        perm_users: values.perm_users,
        perm_view_users: values.perm_view_users,
        perm_view_reports: values.perm_view_reports,
      });
    } catch (err) {
      setErrorMessage(err instanceof AuthApiError ? err.message : "Une erreur est survenue.");
      return;
    }

    setSuccessMessage("Compte créé avec succès.");
    setShowPassword(false);
    reset({
      full_name: "",
      email: "",
      password: "",
      role: "vendeur",
      perm_caisse: false,
      perm_catalog: false,
      perm_invoices: false,
      perm_users: false,
      perm_view_users: false,
      perm_view_reports: false,
    });
    await loadMembers();
  }

  async function changeRole(membershipId: string, role: AppRole) {
    setActionError(null);
    const { error } = await supabase.from("memberships").update({ role }).eq("id", membershipId);
    if (error) {
      setActionError(mapSupabaseError(error));
      return;
    }
    await loadMembers();
  }

  async function togglePermission(membershipId: string, key: keyof MembershipPermissions, value: boolean) {
    setActionError(null);
    const update: Partial<MembershipPermissions> = { [key]: value };
    const { error } = await supabase.from("memberships").update(update).eq("id", membershipId);
    if (error) {
      setActionError(mapSupabaseError(error));
      return;
    }
    await loadMembers();
  }

  async function toggleActive(membershipId: string, nextActive: boolean) {
    setActionError(null);
    const { error } = await supabase
      .from("memberships")
      .update({ is_active: nextActive })
      .eq("id", membershipId);
    if (error) {
      setActionError(mapSupabaseError(error));
      return;
    }
    await loadMembers();
  }

  async function confirmDelete(membershipId: string) {
    if (!currentOrgId) return;
    setActionError(null);
    try {
      await adminDeleteUser({ org_id: currentOrgId, membership_id: membershipId });
    } catch (err) {
      setActionError(err instanceof AuthApiError ? err.message : "Une erreur est survenue.");
      return;
    }
    setDeletingId(null);
    await loadMembers();
  }

  if (!canViewUsers) {
    return null;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Utilisateurs</h1>
        <p className="text-sm text-gray-500">
          Comptes rattachés à {storeName ?? "votre magasin"}. Chaque compte que vous créez ici est
          automatiquement limité à ce magasin, avec les droits du rôle choisi.
          {isOwner
            ? " Vous seul pouvez attribuer un rôle, des permissions, bloquer ou supprimer un compte."
            : canManageUsers
              ? " Vous pouvez créer et supprimer des comptes ; seul le propriétaire gère les rôles, permissions et blocages."
              : " Vous pouvez uniquement consulter la liste des comptes."}
        </p>
      </div>

      {canManageUsers && (
        <form onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-3 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="font-medium text-gray-900">Créer un compte</h2>

          <div className="space-y-1">
            <label className="text-sm text-gray-600">Nom complet</label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              {...register("full_name")}
            />
            {errors.full_name && <p className="text-sm text-red-600">{errors.full_name.message}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-sm text-gray-600">Email</label>
            <input
              type="email"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              {...register("email")}
            />
            {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-sm text-gray-600">Mot de passe</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className="w-full rounded-md border border-gray-300 px-3 py-2 pr-10"
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-sm text-gray-600">Rôle</label>
            <select className="w-full rounded-md border border-gray-300 px-3 py-2" {...register("role")}>
              {CREATABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          {isOwner && (
            <div className="space-y-2 rounded-md border border-gray-200 p-3">
              <p className="text-sm text-gray-600">Permissions supplémentaires (pouvoir)</p>
              {PERMISSION_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" {...register(f.key)} />
                  {f.label}
                </label>
              ))}
            </div>
          )}

          {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
          {successMessage && <p className="text-sm text-emerald-600">{successMessage}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isSubmitting ? "Création..." : "Créer le compte"}
          </button>
        </form>
      )}

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-3 font-medium text-gray-900">Comptes existants</h2>
        {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}
        {loading ? (
          <p className="text-sm text-gray-500">Chargement...</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="pb-2">Nom</th>
                <th className="pb-2">Rôle</th>
                <th className="pb-2">Permissions</th>
                <th className="pb-2">Statut</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.user_id === session?.user.id;
                const isManageable = !isSelf && m.role !== "proprietaire";
                return (
                  <tr key={m.id} className="border-t border-gray-100 align-top">
                    <td className="py-2 text-gray-900">{m.full_name ?? "—"}</td>
                    <td className="py-2">
                      {isOwner && isManageable ? (
                        <select
                          value={m.role}
                          onChange={(e) => changeRole(m.id, e.target.value as AppRole)}
                          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
                        >
                          {/* Comptes existants créés avant ce changement peuvent encore avoir le rôle magasinier ;
                              on l'affiche tel quel même si ce rôle n'est plus proposé à la création. */}
                          {!CREATABLE_ROLES.includes(m.role) && (
                            <option value={m.role}>{ROLE_LABELS[m.role]}</option>
                          )}
                          {CREATABLE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-gray-700">{ROLE_LABELS[m.role]}</span>
                      )}
                    </td>
                    <td className="py-2">
                      {isOwner && isManageable ? (
                        <div className="space-y-1">
                          {PERMISSION_FIELDS.map((f) => (
                            <label key={f.key} className="flex items-center gap-1.5 text-xs text-gray-600">
                              <input
                                type="checkbox"
                                checked={m[f.key]}
                                onChange={(e) => togglePermission(m.id, f.key, e.target.checked)}
                              />
                              {f.label}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {PERMISSION_FIELDS.filter((f) => m[f.key]).map((f) => (
                            <span
                              key={f.key}
                              className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800"
                            >
                              {f.label}
                            </span>
                          ))}
                          {PERMISSION_FIELDS.every((f) => !m[f.key]) && (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2">
                      {m.is_active ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                          Actif
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Bloqué</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {canManageUsers && isManageable && (
                        <div className="flex flex-col items-end gap-2">
                          {isOwner && (
                            <button
                              onClick={() => toggleActive(m.id, !m.is_active)}
                              className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-200"
                            >
                              {m.is_active ? "Bloquer" : "Débloquer"}
                            </button>
                          )}
                          {deletingId === m.id ? (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => confirmDelete(m.id)}
                                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                              >
                                Confirmer
                              </button>
                              <button
                                onClick={() => setDeletingId(null)}
                                className="text-xs text-gray-500 hover:text-gray-900"
                              >
                                Annuler
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeletingId(m.id)}
                              className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-200"
                            >
                              Supprimer
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
