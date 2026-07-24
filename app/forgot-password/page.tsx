"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSupabaseConfigured()) {
      setMessage("Password recovery is not configured yet.");
      return;
    }
    setBusy(true);
    setMessage("Sending a secure recovery link…");
    try {
      const supabase = getSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
      if (error) throw error;
      setMessage("Check your login email for the password reset link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The recovery email could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <span className="eyebrow">Account recovery</span>
        <h1>Reset your password</h1>
        <p>Enter the login email used for your account.</p>
        <label className="field">
          Login email
          <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
        </label>
        {message && <p className="auth-message">{message}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Send recovery link"}</button>
        <Link className="btn btn-white" href="/login">Back to sign in</Link>
      </form>
    </main>
  );
}
