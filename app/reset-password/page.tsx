"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("Checking your recovery session…");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [companyOnboarding, setCompanyOnboarding] = useState(false);

  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      setCompanyOnboarding(params.get("onboarding") === "company");
      const supabase = getSupabaseBrowserClient() as any;
      const code = params.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setMessage(error.message);
          return;
        }
      }
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setMessage("This recovery link is invalid or expired. Request a new one from the Master panel.");
        return;
      }
      setReady(true);
      setMessage(params.get("onboarding") === "company" ? "Create your password to activate company access." : "Choose a new password for your account.");
    })();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setMessage("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setMessage("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      if (companyOnboarding) {
        setMessage("Password created. Opening company setup…");
        router.replace("/company/setup");
        return;
      }
      setMessage("Password updated successfully. Redirecting to sign in…");
      await supabase.auth.signOut();
      router.replace("/login");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your password could not be updated.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <span className="eyebrow">{companyOnboarding ? "Company activation" : "Secure recovery"}</span>
        <h1>{companyOnboarding ? "Create your password" : "Create a new password"}</h1>
        <p>{message}</p>
        {ready && <>
          <label className="field">New password<input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete="new-password" /></label>
          <label className="field">Confirm password<input className="input" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={8} autoComplete="new-password" /></label>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Updating…" : companyOnboarding ? "Create password and continue" : "Update password"}</button>
        </>}
      </form>
    </main>
  );
}
