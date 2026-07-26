"use client";

import type { Lead } from "@/lib/storage";

type Props = {
  property: Lead | null;
  onClose: () => void;
  onReturnToAvailable?: (property: Lead) => void | Promise<void>;
  busy?: boolean;
};

function value(value: unknown, fallback = "Not provided") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function CustomerPropertyModal({ property, onClose, onReturnToAvailable, busy = false }: Props) {
  if (!property) return null;
  const photo = property.photos?.[0];
  return <div className="customer-property-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="customer-property-modal" role="dialog" aria-modal="true" aria-label={`${property.name} property profile`} onMouseDown={event=>event.stopPropagation()}>
      <button className="customer-property-close" type="button" onClick={onClose} aria-label="Close property profile">×</button>
      <div className="customer-property-cover">
        {photo ? <img src={photo} alt={`${property.name} property`} /> : <div className="customer-property-placeholder"><span>4S</span><small>Property photo</small></div>}
        <div className="customer-property-cover-shade" />
        <div className="customer-property-title"><span>Customer property</span><h2>{property.name}</h2><p>{property.address}</p></div>
      </div>
      <div className="customer-property-body">
        <div className="customer-property-badges"><span>{value(property.service,"Property service")}</span><span>{value(property.serviceFrequency,"One time")}</span><span>{property.assignedCrew ? `Assigned to ${property.assignedCrew}` : "Available"}</span></div>
        <div className="customer-property-grid">
          <article><small>Contract</small><strong>{value((property as any).contractType || (property as any).contractStatus,"Active service")}</strong></article>
          <article><small>Property size</small><strong>{value((property as any).propertySize || (property as any).lotSize)}</strong></article>
          <article><small>Lawn size</small><strong>{value((property as any).lawnSize || (property as any).grassSize)}</strong></article>
          <article><small>Next visit</small><strong>{value(property.nextVisitDate || property.scheduledDate,"Not scheduled")}</strong></article>
        </div>
        <section className="customer-property-notes"><div><small>Worker instructions</small><h3>Property notes</h3></div><p>{value((property as any).propertyNotes || (property as any).notes || (property as any).customerNotes,"No special notes were provided for this property.")}</p></section>
        <div className="customer-property-actions">
          <button type="button" className="secondary" onClick={onClose}>Close</button>
          {onReturnToAvailable && property.assignedCrew && <button type="button" className="return" disabled={busy} onClick={()=>void onReturnToAvailable(property)}><span>↻</span>{busy?"Updating...":"Return to available"}</button>}
        </div>
      </div>
    </section>
    <style jsx global>{`
      .customer-property-backdrop{position:fixed;inset:0;z-index:500;display:grid;place-items:center;padding:18px;background:rgba(5,20,15,.72);backdrop-filter:blur(9px)}
      .customer-property-modal{position:relative;width:min(760px,100%);max-height:calc(100dvh - 36px);overflow:auto;border:1px solid rgba(255,255,255,.2);border-radius:28px;background:#f7faf8;box-shadow:0 30px 90px rgba(0,0,0,.38)}
      .customer-property-close{position:absolute;right:14px;top:14px;z-index:3;width:42px;height:42px;border:1px solid rgba(255,255,255,.5);border-radius:50%;background:rgba(7,33,25,.62);color:#fff;font-size:27px;cursor:pointer}
      .customer-property-cover{position:relative;min-height:280px;overflow:hidden;border-radius:27px 27px 0 0;background:linear-gradient(135deg,#0b654a,#123d31)}
      .customer-property-cover>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.customer-property-cover-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(3,18,13,.06),rgba(3,18,13,.82))}
      .customer-property-placeholder{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:#fff}.customer-property-placeholder span{font-size:64px;font-weight:950}.customer-property-placeholder small{letter-spacing:.14em;text-transform:uppercase}
      .customer-property-title{position:absolute;left:26px;right:72px;bottom:24px;color:#fff}.customer-property-title span{font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#b8ead7}.customer-property-title h2{margin:5px 0 4px;font-size:36px;line-height:1}.customer-property-title p{margin:0;color:rgba(255,255,255,.82)}
      .customer-property-body{padding:22px}.customer-property-badges{display:flex;gap:8px;flex-wrap:wrap}.customer-property-badges span{padding:8px 11px;border-radius:999px;background:#e8f4ee;color:#07583f;font-size:12px;font-weight:850}
      .customer-property-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:18px}.customer-property-grid article{padding:16px;border:1px solid #dce9e2;border-radius:17px;background:#fff}.customer-property-grid small{display:block;color:#6d7f76;font-size:10px;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.customer-property-grid strong{display:block;margin-top:6px;color:#17382d}
      .customer-property-notes{margin-top:14px;padding:18px;border:1px solid #dce9e2;border-radius:18px;background:#fff}.customer-property-notes small{font-size:10px;font-weight:850;letter-spacing:.1em;text-transform:uppercase;color:#0b7755}.customer-property-notes h3{margin:3px 0 0}.customer-property-notes p{margin:13px 0 0;line-height:1.55;color:#52675e}
      .customer-property-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.customer-property-actions button{min-height:48px;padding:0 18px;border-radius:14px;font-weight:850;cursor:pointer}.customer-property-actions .secondary{border:1px solid #cbdcd3;background:#fff;color:#17382d}.customer-property-actions .return{display:flex;align-items:center;gap:9px;border:0;background:#08704e;color:#fff}.customer-property-actions .return span{font-size:20px}
      @media(max-width:700px){.customer-property-backdrop{padding:8px}.customer-property-modal{max-height:calc(100dvh - 16px);border-radius:22px}.customer-property-cover{min-height:240px;border-radius:21px 21px 0 0}.customer-property-title{left:18px;bottom:18px}.customer-property-title h2{font-size:30px}.customer-property-body{padding:16px}.customer-property-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.customer-property-actions{display:grid;grid-template-columns:1fr}.customer-property-actions button{width:100%}}
    `}</style>
  </div>;
}
