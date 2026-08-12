import { AlertTriangle, X } from "lucide-react";
import { Link } from "react-router-dom";

interface ErrorBoxProps {
  message: string;
  fixLabel?: string;
  fixHref?: string;
  onFix?: () => void;
  onDismiss?: () => void;
}

// Blinking, high-visibility error box for operational mistakes (stock, caisse, achats...).
// Always pairs the error with a suggested corrective action when one is known.
export function ErrorBox({ message, fixLabel, fixHref, onFix, onDismiss }: ErrorBoxProps) {
  return (
    <div className="flex animate-blink items-start gap-3 rounded-lg border-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm shadow-red-200">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
      <div className="flex-1 space-y-1">
        <p className="font-medium leading-snug">{message}</p>
        {fixHref ? (
          <Link to={fixHref} className="inline-block text-xs font-semibold text-red-900 underline hover:text-red-950">
            {fixLabel ?? "Corriger"}
          </Link>
        ) : onFix ? (
          <button
            type="button"
            onClick={onFix}
            className="text-xs font-semibold text-red-900 underline hover:text-red-950"
          >
            {fixLabel ?? "Corriger"}
          </button>
        ) : null}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 text-red-400 hover:text-red-700">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
