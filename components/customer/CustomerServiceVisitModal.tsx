"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  CustomerPortalFeedback,
  CustomerPortalProperty,
  CustomerPortalVisit,
} from "@/lib/repositories/customerPortalRepository";
import type { PropertyPhotoHistory } from "@/lib/services/propertyPhotoService";

type PhotoVisit = PropertyPhotoHistory["visits"][number];
type Tab = "service" | "photos" | "property";

type Props = {
  visit: CustomerPortalVisit;
  property: CustomerPortalProperty | null;
  photoVisit?: PhotoVisit | null;
  profilePhotoUrl?: string | null;
  feedback?: CustomerPortalFeedback | null;
  onClose: () => void;
};

function dateLabel(value?: string | null) {
  return value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("en-CA", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })
    : "Completed service";
}

function timeLabel(value?: string | null) {
  return value
    ? new Date(value).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })
    : "Not recorded";
}

function durationLabel(seconds?: number | null) {
  if (!seconds) return "Not recorded";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes} min ${remainder}s` : `${remainder}s`;
}

function yesNo(value?: boolean | null) {
  return value ? "Yes" : "No";
}

export function CustomerServiceVisitModal({
  visit,
  property,
  photoVisit,
  profilePhotoUrl,
  feedback,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("service");
  const photos = photoVisit?.photos || [];
  const heroPhoto = photos[0]?.url || profilePhotoUrl || null;
  const summary = visit.customerVisibleSummary
    || photoVisit?.customer_visible_summary
    || visit.employeeNotes
    || photoVisit?.employee_notes
    || "Service completed.";
  const completedAt = visit.finishedAt || photoVisit?.finished_at || null;
  const duration = visit.durationSeconds ?? photoVisit?.duration_seconds ?? null;

  const address = useMemo(() => [
    property?.address || visit.address,
    property?.city,
    property?.province,
    property?.postalCode,
  ].filter(Boolean).join(", "), [property, visit.address]);

  useEffect(() => {
    setTab("service");
  }, [visit.id]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return <div className="customer-visit-modal-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="customer-visit-modal" role="dialog" aria-modal="true" aria-label={`Service completed on ${dateLabel(visit.scheduledDate)}`}>
      <header className="customer-visit-modal-hero">
        <div className="customer-visit-modal-photo">
          {heroPhoto ? <img src={heroPhoto} alt="Property after service" /> : <span>⌂</span>}
        </div>
        <div className="customer-visit-modal-title">
          <span>COMPLETED SERVICE</span>
          <h2>{visit.serviceName || photoVisit?.service_name || "Property Service"}</h2>
          <p>{dateLabel(visit.scheduledDate || photoVisit?.scheduled_date)} · {address || "Customer property"}</p>
        </div>
        <button type="button" className="customer-visit-modal-close" onClick={onClose} aria-label="Close service details">×</button>
      </header>

      <nav className="customer-visit-modal-tabs" aria-label="Service detail sections">
        <button type="button" className={tab === "service" ? "active" : ""} onClick={() => setTab("service")}>Service</button>
        <button type="button" className={tab === "photos" ? "active" : ""} onClick={() => setTab("photos")}>Photos <b>{photos.length}</b></button>
        <button type="button" className={tab === "property" ? "active" : ""} onClick={() => setTab("property")}>Property</button>
      </nav>

      <div className="customer-visit-modal-body">
        {tab === "service" && <div className="customer-visit-service-tab">
          <div className="customer-visit-facts">
            <article><span>Crew</span><strong>{visit.crewName || photoVisit?.crew_name || "Crew"}</strong></article>
            <article><span>Completed at</span><strong>{timeLabel(completedAt)}</strong></article>
            <article><span>Service time</span><strong>{durationLabel(duration)}</strong></article>
            <article><span>Photo proof</span><strong>{photos.length} photo{photos.length === 1 ? "" : "s"}</strong></article>
          </div>
          <article className="customer-visit-summary"><span>What was done</span><p>{summary}</p></article>
          {feedback && <article className="customer-visit-feedback"><span>Your feedback</span><strong>{feedback.rating || 0} ★</strong><p>{feedback.comment || "No written comment."}</p></article>}
        </div>}

        {tab === "photos" && <div className="customer-visit-photos-tab">
          {photos.length ? <div className="customer-visit-photo-grid">{photos.map((photo, index) => <a href={photo.url} target="_blank" rel="noreferrer" key={photo.id}>
            <img src={photo.url} alt={photo.caption || `Service photo ${index + 1}`} />
            <span>{photo.caption || `Service photo ${index + 1}`}</span>
            <small>{new Date(photo.createdAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</small>
          </a>)}</div> : <div className="customer-visit-empty"><i>▧</i><strong>No service photos were uploaded for this day.</strong><p>The completed service details remain available in the Service tab.</p></div>}
        </div>}

        {tab === "property" && <div className="customer-visit-property-tab">
          <article className="customer-property-standard-head">
            <div>{profilePhotoUrl ? <img src={profilePhotoUrl} alt="Property" /> : <span>🏡</span>}</div>
            <p><strong>{property?.address || visit.address || "Property"}</strong><small>{[property?.city, property?.province, property?.postalCode].filter(Boolean).join(", ")}</small></p>
          </article>
          <dl className="customer-property-standard-grid">
            <div><dt>Lot size</dt><dd>{property?.lotSize || "Not set"}</dd></div>
            <div><dt>Grass height</dt><dd>{property?.grassHeight || "Not set"}</dd></div>
            <div><dt>Gate</dt><dd>{yesNo(property?.gate)}</dd></div>
            <div><dt>Dog</dt><dd>{yesNo(property?.dog)}</dd></div>
            <div><dt>Irrigation</dt><dd>{yesNo(property?.irrigation)}</dd></div>
            <div><dt>Customer</dt><dd>{property?.customerName || "Customer"}</dd></div>
          </dl>
          <article className="customer-property-note"><span>Access notes</span><p>{property?.accessNotes || "No special access notes."}</p></article>
          {property?.propertyNotes && <article className="customer-property-note"><span>Property notes</span><p>{property.propertyNotes}</p></article>}
        </div>}
      </div>
    </section>

    <style jsx global>{`
      .customer-visit-modal-backdrop{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:24px;background:rgba(4,26,19,.66);backdrop-filter:blur(8px)}
      .customer-visit-modal{width:min(920px,100%);max-height:min(860px,calc(100dvh - 48px));overflow:hidden;border:1px solid rgba(255,255,255,.22);border-radius:28px;background:#f7faf8;box-shadow:0 32px 90px rgba(0,0,0,.32)}
      .customer-visit-modal-hero{position:relative;display:grid;grid-template-columns:150px minmax(0,1fr) 44px;gap:20px;align-items:center;padding:22px;background:linear-gradient(135deg,#073c2b,#0a6848);color:#fff}
      .customer-visit-modal-photo{width:150px;height:112px;overflow:hidden;border-radius:20px;background:rgba(255,255,255,.12);display:grid;place-items:center}.customer-visit-modal-photo img{width:100%;height:100%;object-fit:cover}.customer-visit-modal-photo span{font-size:48px}
      .customer-visit-modal-title span{color:#98e2b8;font-size:10px;font-weight:950;letter-spacing:.14em}.customer-visit-modal-title h2{margin:6px 0 5px;font-size:30px;line-height:1.08}.customer-visit-modal-title p{margin:0;color:rgba(255,255,255,.76);line-height:1.45}
      .customer-visit-modal-close{align-self:start;width:42px;height:42px;border:1px solid rgba(255,255,255,.3);border-radius:50%;background:rgba(255,255,255,.1);color:#fff;font-size:28px;line-height:1;cursor:pointer}
      .customer-visit-modal-tabs{display:flex;gap:8px;padding:14px 18px;border-bottom:1px solid #dce7e1;background:#fff}.customer-visit-modal-tabs button{min-height:42px;padding:0 18px;border:0;border-radius:12px;background:transparent;color:#617168;font-weight:850;cursor:pointer}.customer-visit-modal-tabs button.active{background:#e7f5ed;color:#075d40}.customer-visit-modal-tabs b{display:inline-grid;place-items:center;min-width:21px;height:21px;margin-left:5px;border-radius:11px;background:#d8ebe1;font-size:11px}
      .customer-visit-modal-body{max-height:calc(100dvh - 300px);overflow:auto;padding:20px}.customer-visit-service-tab,.customer-visit-property-tab{display:grid;gap:16px}.customer-visit-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.customer-visit-facts article{display:grid;gap:6px;padding:16px;border:1px solid #dce7e1;border-radius:16px;background:#fff}.customer-visit-facts span,.customer-visit-summary span,.customer-visit-feedback span,.customer-property-note span{color:#6a786f;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.customer-visit-facts strong{color:#13382b}
      .customer-visit-summary,.customer-visit-feedback,.customer-property-note{padding:18px;border:1px solid #dce7e1;border-radius:18px;background:#fff}.customer-visit-summary p,.customer-visit-feedback p,.customer-property-note p{margin:8px 0 0;color:#42564c;line-height:1.65}.customer-visit-feedback strong{display:block;margin-top:7px;color:#aa7412;font-size:22px}
      .customer-visit-photo-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.customer-visit-photo-grid a{display:grid;overflow:hidden;border:1px solid #dce7e1;border-radius:18px;background:#fff;color:inherit;text-decoration:none}.customer-visit-photo-grid img{width:100%;aspect-ratio:16/10;object-fit:cover}.customer-visit-photo-grid span{padding:12px 14px 2px;font-weight:850}.customer-visit-photo-grid small{padding:0 14px 13px;color:#718078}
      .customer-visit-empty{display:grid;place-items:center;min-height:260px;padding:28px;text-align:center;border:1px dashed #c8d9d0;border-radius:20px;background:#fff}.customer-visit-empty i{font-style:normal;font-size:42px;color:#6fa98e}.customer-visit-empty p{margin:6px 0 0;color:#718078}
      .customer-property-standard-head{display:grid;grid-template-columns:92px 1fr;gap:15px;align-items:center;padding:14px;border:1px solid #dce7e1;border-radius:18px;background:#fff}.customer-property-standard-head>div{width:92px;height:72px;overflow:hidden;border-radius:14px;background:#e8f1ec;display:grid;place-items:center}.customer-property-standard-head img{width:100%;height:100%;object-fit:cover}.customer-property-standard-head p{display:grid;gap:5px;margin:0}.customer-property-standard-head small{color:#718078}
      .customer-property-standard-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0}.customer-property-standard-grid div{padding:15px;border:1px solid #dce7e1;border-radius:15px;background:#fff}.customer-property-standard-grid dt{color:#6a786f;font-size:10px;font-weight:900;text-transform:uppercase}.customer-property-standard-grid dd{margin:6px 0 0;color:#15392d;font-weight:850}
      @media(max-width:720px){.customer-visit-modal-backdrop{padding:0;place-items:stretch}.customer-visit-modal{width:100%;max-height:100dvh;border:0;border-radius:0}.customer-visit-modal-hero{grid-template-columns:92px minmax(0,1fr) 38px;padding:18px 14px;gap:12px}.customer-visit-modal-photo{width:92px;height:82px;border-radius:15px}.customer-visit-modal-title h2{font-size:22px}.customer-visit-modal-title p{font-size:12px}.customer-visit-modal-close{width:36px;height:36px;font-size:23px}.customer-visit-modal-tabs{padding:10px;overflow:auto}.customer-visit-modal-tabs button{flex:1;min-width:max-content;padding:0 13px}.customer-visit-modal-body{max-height:calc(100dvh - 190px);padding:14px}.customer-visit-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.customer-visit-photo-grid{grid-template-columns:1fr}.customer-property-standard-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `}</style>
  </div>;
}
