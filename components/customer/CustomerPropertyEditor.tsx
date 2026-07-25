"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type PropertyView = {
  propertyId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  address: string;
  city: string;
  province: string;
  postalCode: string | null;
  lotSize: string | null;
  grassHeight: string | null;
  gate: boolean;
  dog: boolean;
  irrigation: boolean;
  accessNotes: string | null;
  propertyNotes: string | null;
  customerComment: string;
  photoUrl: string | null;
};

async function accessToken() {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  return token;
}

export function CustomerPropertyEditor({ mobile = false }: { mobile?: boolean }) {
  const [property, setProperty] = useState<PropertyView | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [customerComment, setCustomerComment] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const displayPhoto = previewUrl || photoUrl;

  async function loadProperty() {
    const token = await accessToken();
    const response = await fetch("/api/customer/property", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Property could not be loaded.");
    setProperty(result.property || null);
    setCustomerComment(result.property?.customerComment || "");
    setPhotoUrl(result.property?.photoUrl || null);
  }

  useEffect(() => {
    void loadProperty().catch((error) => setMessage(error instanceof Error ? error.message : "Property could not be loaded."));
  }, []);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("Choose a valid image."); return; }
    if (file.size > 10 * 1024 * 1024) { setMessage("Image must be smaller than 10 MB."); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setMessage("Preview ready. Confirm to save this house photo.");
    event.target.value = "";
  }

  function cancelPhoto() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPendingFile(null);
    setMessage("Photo change cancelled.");
  }

  async function confirmPhoto() {
    if (!pendingFile) { setMessage("Choose a photo before confirming."); return; }
    setBusy(true);
    setMessage("Saving house photo...");
    try {
      const token = await accessToken();
      const form = new FormData();
      form.append("file", pendingFile, pendingFile.name || "property-photo.jpg");
      const response = await fetch("/api/customer/property/photo", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "House photo could not be saved.");
      setPhotoUrl(String(result.url));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPendingFile(null);
      setMessage("House photo updated successfully.");
      await loadProperty();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "House photo could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveComment() {
    setBusy(true);
    setMessage("Saving your comment...");
    try {
      const token = await accessToken();
      const response = await fetch("/api/customer/property", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ customerComment }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Comment could not be saved.");
      setMessage("Property comment saved successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Comment could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <div className={mobile ? "customer-property-editor mobile" : "customer-property-editor desktop"}>
    {message && <div className={mobile ? "customer-native-message" : "billing-message"}>{message}</div>}
    <section className="customer-house-photo-card">
      <div className="customer-house-photo-frame">{displayPhoto ? <img src={displayPhoto} alt="Front of property" /> : <div><i>⌂</i><strong>No house photo yet</strong><span>Use a clear landscape photo of the front of the house.</span></div>}</div>
      <div className="customer-house-photo-copy"><strong>Front house photo</strong><p>For best results, turn the phone sideways and capture the entire front of the property.</p><label className="customer-photo-select">Choose photo<input type="file" accept="image/*" onChange={choosePhoto} /></label></div>
      {pendingFile && <div className="customer-photo-confirm"><button type="button" disabled={busy} onClick={cancelPhoto}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={confirmPhoto}>{busy ? "Saving..." : "Confirm photo"}</button></div>}
    </section>

    <section className="customer-property-locked-card">
      <header><div><span>PRIMARY PROPERTY</span><h2>Property and service details</h2></div><b>Admin controlled</b></header>
      <dl>
        <div className="wide"><dt>Address</dt><dd>{property ? [property.address, property.city, property.province, property.postalCode].filter(Boolean).join(", ") : "Not connected"}</dd></div>
        <div><dt>Lot size</dt><dd>{property?.lotSize || "Not set"}</dd></div>
        <div><dt>Grass height</dt><dd>{property?.grassHeight || "Not set"}</dd></div>
        <div><dt>Gate</dt><dd>{property?.gate ? "Yes" : "No"}</dd></div>
        <div><dt>Dog</dt><dd>{property?.dog ? "Yes" : "No"}</dd></div>
        <div><dt>Irrigation</dt><dd>{property?.irrigation ? "Yes" : "No"}</dd></div>
        <div className="wide"><dt>Access notes</dt><dd>{property?.accessNotes || "No access notes"}</dd></div>
      </dl>
      <p className="customer-property-lock-note">Address, lot size, cut height and service specifications can only be changed by Admin or Master.</p>
    </section>

    <section className="customer-property-comment-card">
      <label>Your comment<textarea value={customerComment} maxLength={1500} rows={5} placeholder="Add access details, temporary instructions or something the crew should know." onChange={event => setCustomerComment(event.target.value)} /></label>
      <div><small>{customerComment.length}/1500</small><button type="button" disabled={busy} onClick={() => void saveComment()}>{busy ? "Saving..." : "Save comment"}</button></div>
    </section>
  </div>;
}
