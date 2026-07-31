import { useRef, useState } from "react";
import { Download, Upload, AlertTriangle } from "lucide-react";
import { supabase, FUNCTIONS_URL } from "../lib/supabaseClient";
import { mapEdgeFunctionError, mapSupabaseError } from "../lib/errorMessages";
import type { Json } from "../types/database.types";

const CONFIRM_PHRASE = "RESTAURER";

export function BackupsPage() {
  const [downloading, setDownloading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  async function downloadBackup() {
    setErrorMessage(null);
    setSuccessMessage(null);
    setDownloading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Vous devez être connecté.");

      const res = await fetch(`${FUNCTIONS_URL}/download-backup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(mapEdgeFunctionError(data.error));
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const fileName = match?.[1] ?? `manariyo-backup-${new Date().toISOString().slice(0, 10)}.json`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setSuccessMessage("Sauvegarde téléchargée.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setDownloading(false);
    }
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setRestoreError(null);
    setRestoreSuccess(false);
    setConfirmText("");
    setPendingFile(file);
  }

  function cancelRestore() {
    setPendingFile(null);
    setConfirmText("");
    setRestoreError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function confirmRestore() {
    if (!pendingFile || confirmText !== CONFIRM_PHRASE) return;
    setRestoreError(null);
    setRestoring(true);

    try {
      const text = await pendingFile.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("Ce fichier n'est pas un JSON valide.");
      }

      const { error } = await supabase.rpc("restore_backup", { p_payload: payload as Json });
      if (error) throw new Error(mapSupabaseError(error));

      setRestoreSuccess(true);
      // The whole data set (including memberships/roles) was just replaced -
      // reload so every cached client state is refetched from scratch.
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "Une erreur est survenue.");
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Sauvegardes</h1>
        <p className="text-sm text-gray-500">
          Téléchargez à tout moment un fichier JSON contenant toutes les données du magasin
          (produits, stock, ventes, clients, utilisateurs...). Conservez-le dans un endroit sûr.
        </p>
      </div>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-3 font-medium text-gray-900">Télécharger</h2>
        <button
          onClick={downloadBackup}
          disabled={downloading}
          className="flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          <Download size={16} />
          {downloading ? "Préparation..." : "Télécharger une sauvegarde (JSON)"}
        </button>

        {errorMessage && <p className="mt-3 text-sm text-red-600">{errorMessage}</p>}
        {successMessage && <p className="mt-3 text-sm text-emerald-600">{successMessage}</p>}

        <p className="mt-4 text-xs text-gray-400">
          Chaque téléchargement est enregistré dans le journal d'audit.
        </p>
      </div>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-3 font-medium text-gray-900">Restaurer (en cas de panne ou de données corrompues)</h2>

        <div className="mb-4 flex gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>
            Cette action remplace <strong>toutes</strong> les données actuelles (produits, stock,
            ventes, clients, utilisateurs...) par celles du fichier choisi. C'est irréversible :
            tout ce qui a été créé après cette sauvegarde sera perdu. Ne l'utilisez qu'en cas de
            panne ou de données corrompues.
          </p>
        </div>

        {!pendingFile ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={onFileSelected}
              className="hidden"
              id="restore-file-input"
            />
            <label
              htmlFor="restore-file-input"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              <Upload size={16} />
              Choisir un fichier de sauvegarde
            </label>
          </>
        ) : restoreSuccess ? (
          <p className="text-sm text-emerald-600">
            Restauration terminée. La page va se recharger automatiquement...
          </p>
        ) : (
          <div className="max-w-md space-y-3">
            <p className="text-sm text-gray-700">
              Fichier sélectionné : <span className="font-medium">{pendingFile.name}</span>
            </p>
            <div className="space-y-1">
              <label className="text-sm text-gray-600">
                Tapez <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> pour confirmer
              </label>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2"
                autoComplete="off"
              />
            </div>

            {restoreError && <p className="text-sm text-red-600">{restoreError}</p>}

            <div className="flex gap-2">
              <button
                onClick={confirmRestore}
                disabled={confirmText !== CONFIRM_PHRASE || restoring}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {restoring ? "Restauration en cours..." : "Restaurer maintenant"}
              </button>
              <button
                onClick={cancelRestore}
                disabled={restoring}
                className="rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
