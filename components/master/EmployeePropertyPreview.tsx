"use client";

import Image from "next/image";

type EmployeePropertyPreviewProps = {
  open: boolean;
  customerName: string;
  address: string;
  serviceType: string;
  frequency: string;
  lawnSize: string;
  mowingHeight: string;
  hasGate: boolean;
  hasDog: boolean;
  hasIrrigation: boolean;
  accessNotes: string;
  serviceNotes: string;
  propertyPhotoUrl?: string | null;
  onClose: () => void;
};

export function EmployeePropertyPreview({
  open,
  customerName,
  address,
  serviceType,
  frequency,
  lawnSize,
  mowingHeight,
  hasGate,
  hasDog,
  hasIrrigation,
  accessNotes,
  serviceNotes,
  propertyPhotoUrl,
  onClose,
}: EmployeePropertyPreviewProps) {
  if (!open) return null;

  return (
    <div className="employee-property-preview-backdrop" onMouseDown={onClose}>
      <section className="employee-property-preview" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>EMPLOYEE PROPERTY VIEW</span>
            <h2>{customerName}</h2>
            <p>{address}</p>
          </div>
          <button type="button" aria-label="Close preview" onClick={onClose}>×</button>
        </header>

        <div className="employee-property-photo">
          {propertyPhotoUrl ? (
            <Image src={propertyPhotoUrl} alt={`Property at ${address}`} fill sizes="520px" />
          ) : (
            <div className="employee-property-photo-empty">
              <span>⌂</span>
              <strong>Property photo</strong>
              <small>No house photo added yet</small>
            </div>
          )}
        </div>

        <div className="employee-property-service">
          <strong>{serviceType || "Service not set"}</strong>
          <b>{frequency || "Frequency not set"}</b>
        </div>

        <div className="employee-property-cards">
          <article>
            <small>PROPERTY</small>
            <strong>{lawnSize || "Size not set"}</strong>
            <span>Mowing height: {mowingHeight || "Not set"}</span>
          </article>
          <article>
            <small>ACCESS</small>
            <strong>{hasGate ? "Gate" : "No gate"} · {hasDog ? "Dog" : "No dog noted"}</strong>
            <span>{hasIrrigation ? "Irrigation present" : "No irrigation noted"}</span>
          </article>
        </div>

        <article className="employee-property-alert">
          <small>IMPORTANT BEFORE START</small>
          <strong>{accessNotes || "No special access alert."}</strong>
        </article>

        <article className="employee-property-notes">
          <small>SERVICE NOTES</small>
          <p>{serviceNotes || "No additional instructions."}</p>
        </article>

        <footer><button type="button" onClick={onClose}>Close preview</button></footer>
      </section>

      <style jsx global>{`
        .employee-property-preview-backdrop{position:fixed;inset:0;z-index:500;background:rgba(3,20,14,.65);display:grid;place-items:center;padding:20px}
        .employee-property-preview{width:min(520px,100%);max-height:92vh;overflow:auto;background:#f3f7f5;border-radius:24px;box-shadow:0 30px 90px rgba(0,0,0,.35)}
        .employee-property-preview header{padding:24px;background:linear-gradient(145deg,#073f30,#0b684c);color:#fff;display:flex;justify-content:space-between}
        .employee-property-preview header span{font-size:11px;font-weight:900;letter-spacing:.12em;color:#a8dbc8}
        .employee-property-preview header h2{margin:5px 0 3px}
        .employee-property-preview header p{margin:0;color:#d6eee5}
        .employee-property-preview header button{border:0;background:rgba(255,255,255,.15);color:#fff;width:36px;height:36px;border-radius:11px;font-size:22px}
        .employee-property-photo{position:relative;aspect-ratio:16/9;background:#dfeae5;overflow:hidden}
        .employee-property-photo img{object-fit:cover}
        .employee-property-photo-empty{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:#61766d}
        .employee-property-photo-empty span{font-size:34px;color:#0b5c43}
        .employee-property-photo-empty strong,.employee-property-photo-empty small{display:block;margin-top:4px}
        .employee-property-service{padding:16px 20px;display:flex;justify-content:space-between;background:#fff}
        .employee-property-cards{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px}
        .employee-property-cards article,.employee-property-alert,.employee-property-notes{background:#fff;border-radius:15px;padding:16px}
        .employee-property-cards small,.employee-property-alert small,.employee-property-notes small{display:block;font-size:10px;font-weight:900;letter-spacing:.1em;color:#61766d;margin-bottom:8px}
        .employee-property-cards strong,.employee-property-cards span{display:block}
        .employee-property-cards span{margin-top:6px;color:#5f746a}
        .employee-property-alert{margin:0 16px;background:#fff3d9;border:1px solid #ebc06b}
        .employee-property-notes{margin:12px 16px}
        .employee-property-notes p{margin:0}
        .employee-property-preview footer{padding:0 16px 18px}
        .employee-property-preview footer button{width:100%;border:0;border-radius:12px;padding:12px;background:#0b5c43;color:#fff;font-weight:850}
        @media(max-width:620px){.employee-property-preview-backdrop{padding:10px}.employee-property-preview{border-radius:18px}.employee-property-cards{grid-template-columns:1fr}}
      `}</style>
    </div>
  );
}
