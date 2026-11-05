"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function OwnerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
      router.replace("/owner");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <form className="auth-card" onSubmit={(event) => void signIn(event)}>
      <div className="season-title auth-logo"><span>4EVER</span><strong>SEASONS</strong></div>
      <span className="eyebrow">Private owner access</span>
      <h1>Felipe's workspace</h1>
      <p>Only the authorized owner account can access customers, payments, and service history.</p>
      <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
      <label>Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Signing in..." : "Open workspace"}</button>
      {error && <p role="alert" className="auth-message">{error}</p>}
      <Link href="/">Back to website</Link>
    </form>
  </main>;
}
