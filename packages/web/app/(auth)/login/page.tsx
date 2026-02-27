"use client";

import { Suspense, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Persist redirect target across auth flow (survives page reloads)
  useEffect(() => {
    if (redirectTo !== "/") {
      sessionStorage.setItem("authRedirect", redirectTo);
    }
  }, [redirectTo]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password");
      } else {
        const finalRedirect =
          redirectTo !== "/"
            ? redirectTo
            : sessionStorage.getItem("authRedirect") || "/";
        sessionStorage.removeItem("authRedirect");
        router.push(finalRedirect);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg bg-background-floating p-8 shadow-xl">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-text-primary">Welcome back!</h1>
        <p className="mt-1 text-text-secondary">
          We&apos;re so excited to see you again!
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded bg-status-dnd/10 px-3 py-2 text-sm text-status-dnd">
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="email"
            className="mb-2 block text-xs font-bold uppercase text-text-secondary"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded bg-background-tertiary px-3 py-2 text-text-primary outline-none ring-1 ring-transparent transition focus:ring-brand"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-2 block text-xs font-bold uppercase text-text-secondary"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded bg-background-tertiary px-3 py-2 text-text-primary outline-none ring-1 ring-transparent transition focus:ring-brand"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-brand py-2.5 font-medium text-background-floating transition hover:bg-brand-hover disabled:opacity-50"
        >
          {loading ? "Logging in..." : "Log In"}
        </button>

        <p className="text-sm text-text-muted">
          Need an account?{" "}
          <Link
            href={`/register${redirectTo !== "/" ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`}
            className="text-text-link hover:underline"
          >
            Register
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
