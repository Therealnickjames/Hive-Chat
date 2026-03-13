"use client";

import { Suspense, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError("Username can only contain letters, numbers, and underscores");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, displayName, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        return;
      }

      // Auto sign-in after successful registration
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Account created but sign-in failed. Please log in manually.");
        return;
      }

      const finalRedirect =
        redirectTo !== "/"
          ? redirectTo
          : sessionStorage.getItem("authRedirect") || "/";
      sessionStorage.removeItem("authRedirect");
      router.push(finalRedirect);
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
          Create an account
        </h1>
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
            htmlFor="displayName"
            className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-muted"
          >
            Display Name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={32}
            className="w-full rounded bg-background-tertiary px-3 py-2 text-text-primary outline-none ring-1 ring-transparent transition focus:ring-brand"
          />
        </div>

        <div>
          <label
            htmlFor="username"
            className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-muted"
          >
            Username
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={20}
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
            minLength={8}
            className="w-full rounded bg-background-tertiary px-3 py-2 text-text-primary outline-none ring-1 ring-transparent transition focus:ring-brand"
          />
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-muted"
          >
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="w-full rounded bg-background-tertiary px-3 py-2 text-text-primary outline-none ring-1 ring-transparent transition focus:ring-brand"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-brand py-2.5 font-medium text-black transition hover:bg-brand-hover disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Continue"}
        </button>

        <p className="text-sm text-text-muted">
          Already have an account?{" "}
          <Link
            href={`/login${redirectTo !== "/" ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`}
            className="text-text-link hover:underline"
          >
            Log In
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
