"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/admin/PortalShell";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || "CU").toUpperCase();
}

async function accessToken() {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  return token;
}

export default function CustomerProfilePage() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const displayPhoto = previewUrl || avatarUrl;
  const customerInitials = useMemo(() => initials(fullName || "Customer"), [fullName]);

  useEffect(() => {
    void (async () => {
      try {
        const token = await accessToken();
        const response = await fetch("/api/customer/profile", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Customer profile could not be loaded.");
        setFullName(result.profile.fullName || "");
        setPhone(result.profile.phone || "");
        setEmail(result.profile.email || "");
        setAvatarUrl(result.profile.avatarUrl || null);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Customer profile could not be loaded.");
      }
    })();
  }, []);

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setMessage("Preview ready. Confirm to save this profile photo.");
    event.target.value = "";
  }

  async function confirmAvatar() {
    if (!pendingFile) return;
    setBusy(true);
    try {
      const token = await accessToken();
      const form = new FormData();
      form.append("file", pendingFile);
      const response = await fetch("/api/customer/profile/avatar", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Profile photo could not be saved.");
      setAvatarUrl(result.url);
      setPendingFile(null);
      setPreviewUrl(null);
      setMessage("Profile photo updated successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Profile photo could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const token = await accessToken();
      const response = await fetch("/api/customer/profile", { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ fullName, phone }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Profile could not be saved.");
      setMessage("Profile updated successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <PortalShell type="Customer" active="Profile">
    <div className="property-center-hero"><div><span>PERSONAL PROFILE</span><h1>{fullName || "Customer"}</h1><p>{email || "Connected account"}</p></div></div>
    {message&&<div className="billing-message">{message}</div>}
    <div className="property-center-grid">
      <section className="property-photo-panel customer-account-photo-panel"><div className="customer-avatar-preview large">{displayPhoto?<img src={displayPhoto} alt="Customer profile"/>:<span>{customerInitials}</span>}</div><label className="property-photo-action">Choose profile photo<input type="file" accept="image/*" onChange={chooseAvatar}/></label>{pendingFile&&<div className="customer-photo-confirm"><button onClick={()=>{setPendingFile(null);setPreviewUrl(null);}}>Cancel</button><button className="primary" disabled={busy} onClick={()=>void confirmAvatar()}>{busy?"Saving...":"Confirm photo"}</button></div>}</section>
      <section className="property-detail-panel customer-edit-form"><header><span>ACCOUNT DETAILS</span><h2>Edit your information</h2></header><label>Full name<input value={fullName} onChange={event=>setFullName(event.target.value)}/></label><label>Email<input value={email} disabled readOnly/></label><label>Phone<input value={phone} onChange={event=>setPhone(event.target.value)}/></label><button className="customer-profile-save" disabled={busy||fullName.trim().length<2} onClick={()=>void save()}>{busy?"Saving...":"Save profile"}</button><p>Email remains locked to preserve account identity.</p></section>
    </div>
  </PortalShell>;
}
