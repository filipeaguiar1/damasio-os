"use client";

import { useEffect, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileCustomerNav } from "@/components/mobile/MobileCustomerNav";
import { loadCustomerPortal } from "@/lib/services/customerPortalService";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function CustomerAccountPage() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadCustomerPortal({ force: true }).then((board) => {
      setFullName(board.property?.customerName || "");
      setPhone(board.property?.phone || "");
      setEmail(board.property?.email || "");
    }).catch(() => setMessage("Customer profile could not be loaded."));
  }, []);

  async function save() {
    setBusy(true);
    setMessage("Saving profile...");
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/customer/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ fullName, phone }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Profile could not be saved.");
      setMessage("Profile updated successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <MobileRoleGuard allowed={["customer"]}><main className="mobile-app-shell role-mobile-shell mobile-customer-subpage">
    <header className="role-mobile-topbar"><MobileBackButton fallback="/mobile/customer"/><div><strong>Customer profile</strong><span>Personal account details</span></div><span className="role-mobile-avatar">👤</span></header>
    <section className="customer-native-hero profile"><span>PERSONAL PROFILE</span><h1>{fullName || "Customer"}</h1><p>{email || "Connected account"}</p></section>
    {message&&<div className="customer-native-message">{message}</div>}
    <section className="customer-profile-native customer-edit-form">
      <label>Full name<input value={fullName} onChange={(event)=>setFullName(event.target.value)} /></label>
      <label>Email<input value={email} disabled readOnly /></label>
      <label>Phone<input value={phone} onChange={(event)=>setPhone(event.target.value)} /></label>
      <button className="customer-profile-save" disabled={busy||fullName.trim().length<2} onClick={()=>void save()}>{busy?"Saving...":"Save profile"}</button>
      <p className="customer-profile-note">Email changes require account verification. Property address changes are restricted to Admin or Master.</p>
    </section>
    <MobileCustomerNav active="more"/>
  </main></MobileRoleGuard>;
}
