"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: redirectTo,
      });

      if (!result || result.error || !result.ok) {
        setError("Invalid email or password");
      } else {
        // Force a full-page navigation after credentials login to avoid client-router/session race conditions.
        const destination = result.url || redirectTo || "/";
        const nextUrl = new URL(destination, window.location.origin);

        if (nextUrl.pathname === "/login") {
          setError("Invalid email or password");
          return;
        }

        window.location.assign(nextUrl.toString());
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/[0.04] bg-background-floating p-8 panel-shadow">
      <div className="mb-6 text-center">
        <div className="mb-3 font-display text-sm font-bold tracking-[0.18em] text-brand">
          TAVOK
        </div>
        <h1 className="text-xl font-semibold text-text-primary">
          Welcome back
        </h1>
        <p className="mt-1 text-[12.5px] text-text-muted">
          Sign in to continue
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
            className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-muted"
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
            className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-muted"
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
          className="w-full rounded bg-brand py-2.5 font-medium text-black transition hover:bg-brand-hover disabled:opacity-50"
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
