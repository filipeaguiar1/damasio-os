"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readDemoSession, type DemoRole } from "@/lib/auth/demoAuth";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Role = DemoRole | "manager";
type GuardState = "checking" | "ready" | "error";

function home(role: Role) {
  if (role === "master") return "/master";
  if (role === "admin" || role === "manager") return "/admin";
  if (role === "employee") return "/employee";
  return "/customer";
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error || "");
}

function transientAuthError(error: unknown) {
  return /abort|signal is aborted|fetch|network|load failed|timed out|timeout|econnreset/i.test(messageOf(error));
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function resolveAccount(client: any) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;

      let user = sessionData?.session?.user || null;
      if (!user) {
        const { data: authData, error: authError } = await client.auth.getUser();
        if (authError && !transientAuthError(authError)) throw authError;
        user = authData?.user || null;
      }

      if (!user) {
        if (attempt < 4) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        return { user: null, profile: null };
      }

      const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("role,active")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) throw new Error("Account profile was not found.");
      return { user, profile };
    } catch (error) {
      lastError = error;
      if (attempt === 4 || !transientAuthError(error)) throw error;
      await sleep(300 * (attempt + 1));
    }
  }

  throw lastError || new Error("Account verification failed.");
}

export function RoleGuard({ allowed, children }: { allowed: Role[]; children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<GuardState>("checking");
  const [errorMessage, setErrorMessage] = useState("");
  const allowedKey = allowed.join(",");

  useEffect(() => {
    let active = true;

    void (async () => {
      const demo = readDemoSession();
      if (demo) {
        if (allowed.includes(demo.role)) {
          if (active) setState("ready");
        } else {
          router.replace(home(demo.role));
        }
        return;
      }

      if (!isSupabaseConfigured()) {
        router.replace("/login");
        return;
      }

      const client = getSupabaseBrowserClient() as any;
      try {
        const { user, profile } = await resolveAccount(client);
        if (!active) return;
        if (!user) {
          router.replace("/login");
          return;
        }
        if (!profile?.active) {
          await client.auth.signOut().catch(() => undefined);
          if (active) router.replace("/login?inactive=1");
          return;
        }

        const role = profile.role as Role;
        if (allowed.includes(role)) {
          setErrorMessage("");
          setState("ready");
        } else {
          router.replace(home(role));
        }
      } catch (error) {
        if (!active) return;
        console.error("RoleGuard account verification failed", error);
        setErrorMessage("We could not verify this session. Your account was not signed out.");
        setState("error");
      }
    })();

    return () => {
      active = false;
    };
  }, [allowedKey, router]);

  if (state === "ready") return <>{children}</>;

  if (state === "error") {
    return <main className="auth-page"><section className="auth-card"><span className="eyebrow">Secure access</span><h1>Connection interrupted</h1><p>{errorMessage}</p><button type="button" onClick={() => window.location.reload()}>Retry securely</button></section></main>;
  }

  return <main className="auth-page"><section className="auth-card"><span className="eyebrow">Secure access</span><h1>Checking your account…</h1></section></main>;
}
