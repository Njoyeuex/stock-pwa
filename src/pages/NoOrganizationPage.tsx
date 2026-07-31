import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { logout } from "../lib/authApi";

export function NoOrganizationPage() {
  const { session } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-8 text-center shadow-md">
        <h1 className="text-xl font-semibold text-gray-900">Aucune organisation</h1>
        <p className="text-sm text-gray-500">
          Le compte <span className="text-gray-900">{session?.user.email}</span> n'est rattaché à
          aucune organisation pour l'instant.
        </p>
        <p className="text-sm text-gray-500">
          Si vous deviez rejoindre une organisation existante, demandez à son propriétaire de vous
          inviter. Sinon, vous pouvez créer la vôtre.
        </p>
        <Link
          to="/onboarding"
          className="inline-block w-full rounded-md bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Créer mon organisation
        </Link>
        <button onClick={() => logout()} className="block w-full text-sm text-gray-500 underline">
          Déconnexion
        </button>
      </div>
    </div>
  );
}
