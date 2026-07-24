"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function CompanySetupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [message, setMessage] = useState("Loading your company profile…");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function accessToken() {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Your invitation session expired. Sign in again.");
    return token;
  }

  useEffect(() => {
    void (async () => {
      try {
        const token = await accessToken();
        const response = await fetch("/api/company/profile", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Company profile could not be loaded.");
        setCompanyName(result.company?.name || "");
        setAdminName(result.profile?.full_name || "");
        setContactEmail(result.company?.contact_email || result.profile?.email || "");
        setMessage("Confirm the details below to finish setting up your workspace.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Company profile could not be loaded.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("Saving your company profile…");
    try {
      const token = await accessToken();
      const response = await fetch("/api/company/profile", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ companyName, adminName, contactEmail }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Company profile could not be saved.");
      router.replace(result.redirectTo || "/admin");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Company profile could not be saved.");
      setSaving(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card wide" onSubmit={submit}>
        <span className="eyebrow">Company setup</span>
        <h1>Complete your company profile</h1>
        <p>{message}</p>

        <label className="field">
          Company name
          <input className="input" value={companyName} onChange={(event) => setCompanyName(event.target.value)} required minLength={2} disabled={loading || saving} />
        </label>

        <label className="field">
          Administrator name
          <input className="input" value={adminName} onChange={(event) => setAdminName(event.target.value)} required minLength={2} disabled={loading || saving} />
        </label>

        <label className="field">
          Company contact email
          <input className="input" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} required disabled={loading || saving} />
        </label>

        <button className="btn btn-primary" type="submit" disabled={loading || saving}>
          {saving ? "Saving…" : "Save and open dashboard"}
        </button>
      </form>
    </main>
  );
}
