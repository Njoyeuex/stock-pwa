import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import type { Tables } from "../types/database.types";

type AuditEntry = Tables<"audit_log">;

const ACTION_LABELS: Record<string, string> = {
  INSERT: "Création",
  UPDATE: "Modification",
  DELETE: "Suppression",
  backup_downloaded: "Téléchargement",
};

const TABLE_LABELS: Record<string, string> = {
  memberships: "Accès utilisateur",
  products: "Produit",
  sales: "Vente",
  caisse_sessions: "Session de caisse",
  customers: "Client",
  backup: "Sauvegarde",
};

export function AuditLogPage() {
  const { currentOrgId } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!currentOrgId) return;
      setLoading(true);
      const { data } = await supabase
        .from("audit_log")
        .select("*")
        .eq("org_id", currentOrgId)
        .order("created_at", { ascending: false })
        .limit(200);
      setEntries(data ?? []);
      setLoading(false);
    }
    load();
  }, [currentOrgId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/reports" className="text-gray-500 hover:text-gray-900">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">Journal d'audit</h1>
      </div>
      <p className="text-sm text-gray-500">
        Historique des créations, modifications et suppressions sur les données sensibles
        (utilisateurs, produits, ventes, caisse, clients).
      </p>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm text-gray-500">Chargement...</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun évènement pour l'instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="pb-2">Date</th>
                <th className="pb-2">Action</th>
                <th className="pb-2">Table</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-gray-100">
                  <td className="py-2 text-gray-500">
                    {new Date(e.created_at).toLocaleString("fr-FR")}
                  </td>
                  <td className="py-2 text-gray-900">{ACTION_LABELS[e.action] ?? e.action}</td>
                  <td className="py-2 text-gray-700">{TABLE_LABELS[e.entity_table] ?? e.entity_table}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
