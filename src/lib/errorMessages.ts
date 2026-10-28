// Never render error.message / raw Postgres or Auth error text in the UI.
// Everything shown to the user must go through one of these mappers.

const EDGE_FUNCTION_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "Requête invalide.",
  AUTH_INVALID: "Identifiants invalides.",
  ACCOUNT_LOCKED: "Compte temporairement bloqué suite à plusieurs échecs. Réessayez dans 15 minutes.",
  FORBIDDEN: "Action non autorisée.",
  UNAUTHORIZED: "Vous devez être connecté.",
  NOT_FOUND: "Aucun compte ne correspond à cet email.",
  USER_CREATE_FAILED: "Impossible de créer ce compte (email peut-être déjà utilisé).",
  MEMBERSHIP_CREATE_FAILED: "Impossible d'attribuer ce rôle.",
  PASSWORD_UPDATE_FAILED: "Impossible de modifier ce mot de passe.",
  METHOD_NOT_ALLOWED: "Une erreur est survenue.",
  SERVER_ERROR: "Une erreur est survenue.",
};

export function mapEdgeFunctionError(code: string | undefined): string {
  if (code && EDGE_FUNCTION_ERRORS[code]) {
    return EDGE_FUNCTION_ERRORS[code];
  }
  return "Une erreur est survenue.";
}

const POSTGRES_ERROR_CODES: Record<string, string> = {
  "23505": "Cet élément existe déjà.",
  "23503": "Cette action fait référence à un élément inexistant.",
  "23514": "Valeur invalide.",
  "42501": "Action non autorisée.",
};

export function mapSupabaseError(error: { code?: string } | null | undefined): string {
  if (error?.code && POSTGRES_ERROR_CODES[error.code]) {
    return POSTGRES_ERROR_CODES[error.code];
  }
  return "Une erreur est survenue.";
}
