import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import type { Json, Tables } from "../types/database.types";

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

function isRecord(value: Json | null): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValue(v: Json | undefined) {
  if (v === undefined || v === null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Renders what actually changed: field-by-field diff for an update, or the
// full snapshot for a creation/deletion.
function EntryDetails({ entry }: { entry: AuditEntry }) {
  const oldData = isRecord(entry.old_data) ? entry.old_data : null;
  const newData = isRecord(entry.new_data) ? entry.new_data : null;

  if (entry.action === "UPDATE" && oldData && newData) {
    const keys = Array.from(new Set([...Object.keys(oldData), ...Object.keys(newData)])).filter(
      (k) => JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]),
    );
    if (keys.length === 0) return <p className="text-xs text-gray-400">Aucun champ modifié.</p>;
    return (
      <ul className="space-y-1 text-xs">
        {keys.map((k) => (
          <li key={k} className="text-gray-700">
            <span className="font-medium text-gray-900">{k}</span> : {formatValue(oldData[k])}
            {" → "}
            {formatValue(newData[k])}
          </li>
        ))}
      </ul>
    );
  }

  const snapshot = newData ?? oldData;
  if (!snapshot) return <p className="text-xs text-gray-400">Aucun détail disponible.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {Object.entries(snapshot).map(([k, v]) => (
        <li key={k} className="text-gray-700">
          <span className="font-medium text-gray-900">{k}</span> : {formatValue(v)}
        </li>
      ))}
    </ul>
  );
}

export function AuditLogPage() {
  const { currentOrgId } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [namesById, setNamesById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

      const userIds = Array.from(new Set((data ?? []).map((e) => e.user_id).filter((id): id is string => !!id)));
      if (userIds.length > 0) {
        const { data: profilesData } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
        setNamesById(Object.fromEntries((profilesData ?? []).map((p) => [p.id, p.full_name || "Utilisateur"])));
      } else {
        setNamesById({});
      }

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
        (utilisateurs, produits, ventes, caisse, clients). Cliquez sur une ligne pour voir le détail.
      </p>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm text-gray-500">Chargement...</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun évènement pour l'instant.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="w-6 pb-2"></th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Action</th>
                  <th className="pb-2">Table</th>
                  <th className="pb-2">Par</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const expanded = expandedId === e.id;
                  return (
                    <Fragment key={e.id}>
                      <tr
                        onClick={() => setExpandedId(expanded ? null : e.id)}
                        className="cursor-pointer border-t border-gray-100 hover:bg-gray-50"
                      >
                        <td className="py-2 text-gray-400">
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </td>
                        <td className="py-2 text-gray-500">{new Date(e.created_at).toLocaleString("fr-FR")}</td>
                        <td className="py-2 text-gray-900">{ACTION_LABELS[e.action] ?? e.action}</td>
                        <td className="py-2 text-gray-700">{TABLE_LABELS[e.entity_table] ?? e.entity_table}</td>
                        <td className="py-2 text-gray-700">
                          {e.user_id ? namesById[e.user_id] ?? "—" : "Système"}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-t border-gray-100 bg-gray-50">
                          <td></td>
                          <td colSpan={4} className="py-3 pr-4">
                            <p className="mb-1 text-xs text-gray-400">
                              ID de l'élément : {e.entity_id ?? "—"}
                            </p>
                            <EntryDetails entry={e} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
