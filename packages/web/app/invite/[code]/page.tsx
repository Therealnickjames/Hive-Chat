"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

interface InviteInfo {
  serverName: string;
  serverIconUrl: string | null;
  memberCount: number;
  invitedBy: string;
}

export default function InvitePage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    async function fetchInvite() {
      try {
        const res = await fetch(`/api/invites/${params.code}`);
        if (res.ok) {
          const data = await res.json();
          setInviteInfo(data);
        } else {
          const data = await res.json();
          setError(data.error || "This invite is invalid or has expired");
        }
      } catch {
        setError("Failed to load invite");
      }
    }
    fetchInvite();
  }, [params.code]);

  async function handleJoin() {
    if (!session) {
      sessionStorage.setItem("authRedirect", `/invite/${params.code}`);
      router.push(`/login?redirect=/invite/${params.code}`);
      return;
    }

    setJoining(true);
    setError("");

    try {
      const res = await fetch(`/api/invites/${params.code}/accept`, {
        method: "POST",
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/servers/${data.serverId}`);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to join server");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-primary">
      <div className="w-full max-w-sm rounded-lg bg-background-floating p-8 text-center shadow-xl">
        {error && !inviteInfo ? (
          <>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-status-dnd/20">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                className="text-status-dnd"
              >
                <path
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-2h2v2h-2zm0-4V7h2v6h-2z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-text-primary">Invalid Invite</h1>
            <p className="mt-2 text-sm text-text-secondary">{error}</p>
            <button
              onClick={() => router.push("/")}
              className="mt-6 rounded bg-brand px-6 py-2.5 font-medium text-background-floating transition hover:bg-brand-hover"
            >
              Go Home
            </button>
          </>
        ) : inviteInfo ? (
          <>
            <p className="mb-2 text-xs font-bold uppercase text-text-muted">
              You&apos;ve been invited to join
            </p>

            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/20">
              {inviteInfo.serverIconUrl ? (
                <img
                  src={inviteInfo.serverIconUrl}
                  alt={inviteInfo.serverName}
                  className="h-16 w-16 rounded-2xl object-cover"
                />
              ) : (
                <span className="text-2xl font-bold text-brand">
                  {inviteInfo.serverName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            <h1 className="text-xl font-bold text-text-primary">
              {inviteInfo.serverName}
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              {inviteInfo.memberCount}{" "}
              {inviteInfo.memberCount === 1 ? "member" : "members"}
            </p>

            {error && <p className="mt-3 text-sm text-status-dnd">{error}</p>}

            <button
              onClick={handleJoin}
              disabled={joining}
              className="mt-6 w-full rounded bg-brand px-6 py-2.5 font-medium text-background-floating transition hover:bg-brand-hover disabled:opacity-50"
            >
              {sessionStatus === "loading"
                ? "Loading..."
                : joining
                  ? "Joining..."
                  : session
                    ? "Join Server"
                    : "Log In to Join"}
            </button>
          </>
        ) : (
          <p className="text-text-muted">Loading invite...</p>
        )}
      </div>
    </div>
  );
}
