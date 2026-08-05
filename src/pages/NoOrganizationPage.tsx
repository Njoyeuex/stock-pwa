import { useAuth } from "../context/AuthContext";
import { logout } from "../lib/authApi";

export function NoOrganizationPage() {
  const { session } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-8 text-center shadow-md">
        <h1 className="text-xl font-semibold text-gray-900">Accès non attribué</h1>
        <p className="text-sm text-gray-500">
          Le compte <span className="text-gray-900">{session?.user.email}</span> n'a pas encore
          d'accès au magasin.
        </p>
        <p className="text-sm text-gray-500">
          Demandez au propriétaire de vous attribuer un rôle depuis la page Utilisateurs, puis
          reconnectez-vous.
        </p>
        <button onClick={() => logout()} className="block w-full text-sm text-gray-500 underline">
          Déconnexion
        </button>
      </div>
    </div>
  );
}
