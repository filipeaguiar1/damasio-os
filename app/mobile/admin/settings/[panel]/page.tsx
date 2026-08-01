"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type CompanyDraft = { companyName: string; adminName: string; contactEmail: string; phone: string; recoveryEmail: string };
type MobileDraft = { liveAlerts: boolean; taskPhotos: boolean; routeReminders: boolean; compactCards: boolean; autoRefreshSeconds: number };
const EMPTY_COMPANY: CompanyDraft = { companyName: "", adminName: "", contactEmail: "", phone: "", recoveryEmail: "" };
const DEFAULT_MOBILE: MobileDraft = { liveAlerts: true, taskPhotos: true, routeReminders: true, compactCards: true, autoRefreshSeconds: 5 };

async function accessToken() {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

export default function MobileAdminSettingsEditor() {
  const panel = String(useParams().panel || "company");
  const isCompany = panel === "company";
  const [company, setCompany] = useState<CompanyDraft>(EMPTY_COMPANY);
  const [mobile, setMobile] = useState<MobileDraft>(DEFAULT_MOBILE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isCompany) {
      try { setMobile({ ...DEFAULT_MOBILE, ...JSON.parse(localStorage.getItem("damasio-mobile-admin-preferences") || "{}") }); } catch { setMobile(DEFAULT_MOBILE); }
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const response = await fetch("/api/company/profile", { headers: { authorization: `Bearer ${await accessToken()}` }, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Company profile could not be loaded.");
        setCompany({
          companyName: result.company?.name || "",
          adminName: result.profile?.full_name || "",
          contactEmail: result.company?.contact_email || result.profile?.email || "",
          phone: result.profile?.phone || "",
          recoveryEmail: result.profile?.recovery_email || "",
        });
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Company profile could not be loaded."); }
      finally { setLoading(false); }
    })();
  }, [isCompany]);

  async function save() {
    setBusy(true); setError(""); setMessage("");
    try {
      if (isCompany) {
        const response = await fetch("/api/company/profile", { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken()}` }, body: JSON.stringify(company) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Company profile could not be saved.");
        setMessage("Company profile saved.");
      } else {
        localStorage.setItem("damasio-mobile-admin-preferences", JSON.stringify(mobile));
        window.dispatchEvent(new CustomEvent("damasio-mobile-preferences-change", { detail: mobile }));
        setMessage("Mobile application preferences saved on this device.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Settings could not be saved."); }
    finally { setBusy(false); }
  }

  return <MobileRoleGuard allowed={["admin", "manager"]}><main className="mobile-app-shell role-mobile-shell mobile-native-subpage mobile-settings-editor">
    <header className="role-mobile-topbar"><MobileBackButton fallback="/mobile/admin/settings"/><div><strong>{isCompany ? "Company Profile" : "Mobile Application"}</strong><span>Edit settings</span></div><span className="role-mobile-avatar">⚙</span></header>
    <section className="mobile-native-hero"><span>EDIT SETTINGS</span><h1>{isCompany ? "Company information" : "Mobile experience"}</h1><p>{isCompany ? "Update the business and administrator details used throughout the app." : "Choose how this Admin device handles alerts, task evidence and route updates."}</p></section>
    {error && <div className="mobile-native-message" role="alert">{error}</div>}{message && <div className="mobile-native-message" role="status">{message}</div>}
    {loading ? <div className="mobile-native-empty"><strong>Loading settings…</strong></div> : isCompany ? <section className="mobile-settings-form">
      <label><span>Company name</span><input value={company.companyName} onChange={e => setCompany(v => ({ ...v, companyName: e.target.value }))}/></label>
      <label><span>Administrator name</span><input value={company.adminName} onChange={e => setCompany(v => ({ ...v, adminName: e.target.value }))}/></label>
      <label><span>Company email</span><input type="email" value={company.contactEmail} onChange={e => setCompany(v => ({ ...v, contactEmail: e.target.value }))}/></label>
      <label><span>Phone</span><input type="tel" value={company.phone} onChange={e => setCompany(v => ({ ...v, phone: e.target.value }))}/></label>
      <label><span>Recovery email</span><input type="email" value={company.recoveryEmail} onChange={e => setCompany(v => ({ ...v, recoveryEmail: e.target.value }))}/></label>
    </section> : <section className="mobile-settings-form mobile-settings-toggles">
      {[["liveAlerts", "Live alerts", "Refresh urgent task alerts automatically."], ["taskPhotos", "Task photos", "Show customer evidence directly in task cards."], ["routeReminders", "Route reminders", "Keep route and scheduled-date reminders visible."], ["compactCards", "Compact cards", "Use compact cards while keeping key information visible."]].map(([key, title, detail]) => <label className="mobile-setting-toggle" key={key}><div><strong>{title}</strong><small>{detail}</small></div><input type="checkbox" checked={Boolean(mobile[key as keyof MobileDraft])} onChange={e => setMobile(v => ({ ...v, [key]: e.target.checked }))}/></label>)}
      <label><span>Automatic refresh</span><select value={mobile.autoRefreshSeconds} onChange={e => setMobile(v => ({ ...v, autoRefreshSeconds: Number(e.target.value) }))}><option value={5}>Every 5 seconds</option><option value={15}>Every 15 seconds</option><option value={30}>Every 30 seconds</option></select></label>
    </section>}
    <button className="mobile-native-submit mobile-settings-save" disabled={busy || loading} onClick={() => void save()}>{busy ? "Saving…" : "Save Changes"}</button>
    <style jsx global>{`.mobile-settings-form{display:grid;gap:12px;padding:16px}.mobile-settings-form>label:not(.mobile-setting-toggle){display:grid;gap:7px;padding:14px;border:1px solid #dce8e1;border-radius:16px;background:#fff}.mobile-settings-form label>span{font-size:11px;font-weight:900;text-transform:uppercase;color:#50665b}.mobile-settings-form input,.mobile-settings-form select{width:100%;min-height:48px;border:1px solid #cbdad2;border-radius:12px;padding:0 12px;background:#fff;font-size:16px}.mobile-setting-toggle{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px;border:1px solid #dce8e1;border-radius:16px;background:#fff}.mobile-setting-toggle div{display:grid;gap:3px}.mobile-setting-toggle small{color:#687970}.mobile-setting-toggle input{width:24px;height:24px}.mobile-settings-save{position:sticky;bottom:calc(env(safe-area-inset-bottom) + 10px);margin:8px 16px 20px;width:calc(100% - 32px);z-index:4}`}</style>
  </main></MobileRoleGuard>;
}
