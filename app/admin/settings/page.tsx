"use client";

import { FormEvent, useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function Settings() {
  const [code, setCode] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function token() {
    const supabase = getSupabaseBrowserClient() as any;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token as string | undefined;
  }

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    void (async () => {
      const access = await token();
      if (!access) return;
      const response = await fetch("/api/admin/company", { headers: { authorization: `Bearer ${access}` }, cache: "no-store" });
      const result = await response.json();
      if (response.ok) {
        setCode(result.company.referral_code || "");
        setCompany(result.company.name || "");
      } else setMessage(result.error || "Company settings could not be loaded.");
    })();
  }, []);

  async function saveCode() {
    setBusy(true);
    setMessage("");
    try {
      const access = await token();
      if (!access) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/admin/company", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${access}` },
        body: JSON.stringify({ referralCode: code }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Code could not be changed.");
      setCode(result.company.referral_code);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Code could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage("");
    if (newPassword.length < 8) return setPasswordMessage("The new password must contain at least 8 characters.");
    if (newPassword !== confirmPassword) return setPasswordMessage("The new passwords do not match.");
    if (currentPassword === newPassword) return setPasswordMessage("Choose a new password different from the current password.");

    setPasswordBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user?.email) throw new Error("Your session expired. Sign in again.");
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: userData.user.email, password: currentPassword });
      if (verifyError) throw new Error("The current password is incorrect.");
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setCurrentPassword("");setNewPassword("");setConfirmPassword("");setPasswordMessage("Password changed successfully.");
    } catch (error) {
      setPasswordMessage(error instanceof Error ? error.message : "Password could not be changed.");
    } finally { setPasswordBusy(false); }
  }

  return (
    <AdminShell active="Settings">
      <div className="app-top"><div><span className="eyebrow">Configuration</span><h1>Settings</h1><p className="section-intro">Company identity, account security and referral code.</p></div></div>
      <div className="settings-grid">
        <div className="settings-nav"><a>Company</a><a>Security</a><a>Taxes</a><a>Payments</a></div>
        <div className="stack">
          <section className="card profile-card">
            <h2>Change administrator password</h2>
            <p className="section-intro">Replace the temporary or current password with a private password known only by the administrator.</p>
            <form onSubmit={changePassword} className="form-grid">
              <div className="field"><label>Current or temporary password</label><input className="input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></div>
              <div className="field"><label>New password</label><input className="input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></div>
              <div className="field"><label>Confirm new password</label><input className="input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></div>
              <div><button className="btn btn-primary" type="submit" disabled={passwordBusy}>{passwordBusy ? "Changing…" : "Change password"}</button></div>
            </form>
            {passwordMessage && <div className="payment-message" style={{ marginTop: 16 }}>{passwordMessage}</div>}
          </section>
          <section className="card profile-card"><h2>Company referral code</h2><p className="section-intro">Share this code with clients. Quotes using it are routed directly to {company || "your company"}.</p><div className="form-grid"><div className="field"><label>Custom code</label><input className="input" value={code} minLength={4} maxLength={12} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="GREENLAWN" /></div></div><small>Use 4–12 letters or numbers. Codes must be unique across the platform.</small><div style={{ marginTop: 16 }}><button className="btn btn-primary" disabled={busy || code.length < 4} onClick={() => void saveCode()}>{busy ? "Saving…" : "Save company code"}</button></div>{message && <div className="payment-message" style={{ marginTop: 16 }}>{message}</div>}</section>
        </div>
      </div>
    </AdminShell>
  );
}
