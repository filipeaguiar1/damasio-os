"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileCustomerNav } from "@/components/mobile/MobileCustomerNav";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { signOutAccount } from "@/lib/auth/signOut";

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

export default function CustomerAccountPage() {
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
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, []);

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("Choose a valid image."); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setMessage("Preview ready. Confirm to save this profile photo.");
    event.target.value = "";
  }

  async function confirmAvatar() {
    if (!pendingFile) return;
    setBusy(true);
    setMessage("Saving profile photo...");
    try {
      const token = await accessToken();
      const form = new FormData();
      form.append("file", pendingFile);
      const response = await fetch("/api/customer/profile/avatar", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Profile photo could not be saved.");
      setAvatarUrl(result.url);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPendingFile(null);
      setMessage("Profile photo updated successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Profile photo could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMessage("Saving profile...");
    try {
      const token = await accessToken();
      const response = await fetch("/api/customer/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ fullName, phone }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Profile could not be saved.");
      setFullName(result.profile.fullName || fullName);
      setPhone(result.profile.phone || "");
      setMessage("Profile updated successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <MobileRoleGuard allowed={["customer"]}><main className="mobile-app-shell role-mobile-shell mobile-customer-subpage">
    <header className="role-mobile-topbar"><MobileBackButton fallback="/mobile/customer"/><div><strong>Customer profile</strong><span>Personal account details</span></div><span className="role-mobile-avatar role-mobile-profile-avatar">{displayPhoto?<img src={displayPhoto} alt="Customer profile"/>:customerInitials}</span></header>
    <section className="customer-native-hero profile"><span>PERSONAL PROFILE</span><h1>{fullName || "Customer"}</h1><p>{email || "Connected account"}</p></section>
    {message&&<div className="customer-native-message">{message}</div>}
    <section className="customer-profile-native customer-edit-form">
      <div className="customer-avatar-editor">
        <div className="customer-avatar-preview">{displayPhoto?<img src={displayPhoto} alt="Profile preview"/>:<span>{customerInitials}</span>}</div>
        <div><strong>Profile photo</strong><small>Choose a clear square photo. It will appear as a circular thumbnail.</small><label className="customer-photo-select">Choose photo<input type="file" accept="image/*" onChange={chooseAvatar}/></label></div>
      </div>
      {pendingFile&&<div className="customer-photo-confirm"><button type="button" onClick={()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);setPreviewUrl(null);setPendingFile(null);}}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={()=>void confirmAvatar()}>{busy?"Saving...":"Confirm photo"}</button></div>}
      <label>Full name<input value={fullName} onChange={(event)=>setFullName(event.target.value)} /></label>
      <label>Email<input value={email} disabled readOnly /></label>
      <label>Phone<input value={phone} onChange={(event)=>setPhone(event.target.value)} /></label>
      <button type="button" className="customer-profile-save" disabled={busy||fullName.trim().length<2} onClick={()=>void save()}>{busy?"Saving...":"Save profile"}</button>
      <button type="button" disabled={busy} onClick={()=>void signOutAccount("/mobile/login")} style={{minHeight:52,borderRadius:15,border:"1px solid #fecaca",background:"#fff7f7",color:"#b91c1c",fontWeight:900,fontSize:15,cursor:"pointer"}}>Sign Out</button>
      <p className="customer-profile-note">Email is locked to preserve account identity. Property address and service specifications are controlled by Admin or Master.</p>
    </section>
    <MobileCustomerNav active="more"/>
  </main></MobileRoleGuard>;
}
