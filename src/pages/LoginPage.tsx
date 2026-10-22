import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Lock } from "lucide-react";
import { login, AuthApiError } from "../lib/authApi";
import { Logo } from "../components/Logo";

const schema = z.object({
  email: z.string().min(1, "Email requis").email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

type FormValues = z.infer<typeof schema>;

function formatRemaining(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const diff = lockedUntil.getTime() - Date.now();
      if (diff <= 0) {
        setLockedUntil(null);
        setRemainingMs(0);
      } else {
        setRemainingMs(diff);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lockedUntil]);

  const isLocked = lockedUntil !== null && remainingMs > 0;

  async function onSubmit(values: FormValues) {
    if (isLocked) return;
    setErrorMessage(null);
    setSubmitting(true);
    try {
      await login(values.email, values.password);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof AuthApiError && err.lockedUntil) {
        setLockedUntil(new Date(err.lockedUntil));
      }
      setErrorMessage(err instanceof Error ? err.message : "Une erreur est survenue.");
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
        <div className="flex items-center gap-3">
          <Logo size={44} />
          <div>
            <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-gray-900">Magasin Manariyo</h1>
            <p className="text-sm text-gray-500">Connexion</p>
          </div>
        </div>

        <fieldset disabled={isLocked || submitting} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm text-gray-600">Email</label>
            <input
              type="email"
              autoComplete="username"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 disabled:bg-gray-100"
              {...register("email")}
            />
            {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-sm text-gray-600">Mot de passe</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-10 text-gray-900 disabled:bg-gray-100"
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                title={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-700"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
          </div>

          {isLocked ? (
            <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              <Lock size={16} />
              Compte temporairement bloqué. Réessayez dans {formatRemaining(remainingMs)}.
            </div>
          ) : (
            errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>
          )}

          <button
            type="submit"
            className="w-full rounded-md bg-red-600 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isLocked ? "Bloqué" : submitting ? "Connexion..." : "Se connecter"}
          </button>
        </fieldset>
      </form>
    </div>
  );
}
