"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { PortalShell } from "@/components/admin/PortalShell";
import { loadCustomerPortal } from "@/lib/services/customerPortalService";
import {
  getPropertyPhotoHistory,
  uploadPropertyProfilePhoto,
} from "@/lib/services/propertyPhotoService";
import type { CustomerPortalBoard } from "@/lib/repositories/customerPortalRepository";

const emptyBoard: CustomerPortalBoard = {
  property: null,
  visits: [],
  tasks: [],
  requests: [],
  quotes: [],
  feedback: [],
};

export default function Profile() {
  const [board, setBoard] = useState<CustomerPortalBoard>(emptyBoard);
  const [photo, setPhoto] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadCustomerPortal()
      .then(async (nextBoard) => {
        setBoard(nextBoard);
        if (nextBoard.property?.propertyId) {
          const history = await getPropertyPhotoHistory(nextBoard.property.propertyId);
          setPhoto(history.profilePhotoUrl);
        }
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Property could not be loaded."));
  }, []);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const propertyId = board.property?.propertyId;
    if (!file || !propertyId) return;
    setBusy(true);
    setMessage("Uploading the official property photo...");
    try {
      const url = await uploadPropertyProfilePhoto(propertyId, file);
      setPhoto(url);
      setMessage("Official property photo updated for the customer, Admin and crew.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Property photo could not be uploaded.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  const property = board.property;
  return (
    <PortalShell type="Customer" active="Profile">
      <div className="property-center-hero">
        <div>
          <span>PROPERTY PROFILE</span>
          <h1>{property?.customerName || "My property"}</h1>
          <p>{property ? `${property.address}, ${property.city}, ${property.province}` : "Loading your connected property..."}</p>
        </div>
        <label className={busy ? "property-photo-action busy" : "property-photo-action"}>
          {busy ? "Uploading..." : "Update house photo"}
          <input type="file" accept="image/*" disabled={busy || !property} onChange={upload} />
        </label>
      </div>

      {message && <div className="billing-message">{message}</div>}

      <div className="property-center-grid">
        <section className="property-photo-panel">
          {photo ? <img src={photo} alt="Official property" /> : <div><i>⌂</i><strong>No official photo yet</strong><span>Add a clear front photo so the crew recognizes the house.</span></div>}
        </section>
        <section className="property-detail-panel">
          <header><span>CONNECTED DETAILS</span><h2>Service information</h2></header>
          <dl>
            <div><dt>Customer</dt><dd>{property?.customerName || "Not available"}</dd></div>
            <div><dt>Phone</dt><dd>{property?.phone || "Not provided"}</dd></div>
            <div><dt>Lot size</dt><dd>{property?.lotSize || "Not set"}</dd></div>
            <div><dt>Grass height</dt><dd>{property?.grassHeight || "Not set"}</dd></div>
            <div><dt>Gate</dt><dd>{property?.gate ? "Yes" : "No"}</dd></div>
            <div><dt>Dog</dt><dd>{property?.dog ? "Yes" : "No"}</dd></div>
            <div><dt>Irrigation</dt><dd>{property?.irrigation ? "Yes" : "No"}</dd></div>
            <div className="wide"><dt>Access notes</dt><dd>{property?.accessNotes || "No special access note"}</dd></div>
          </dl>
        </section>
      </div>
    </PortalShell>
  );
}
