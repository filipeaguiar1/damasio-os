"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Detail = {
  visit: any;
  customer: any;
  property: any;
  job: any;
  company: any;
  photos: any[];
  feedback: any[];
  tasks: any[];
};

type Props = {
  visitId: string | null;
  onClose: () => void;
};

function fullAddress(property: any) {
  return [property?.address_line1, property?.city, property?.province, property?.postal_code].filter(Boolean).join(", ") || "Address not set";
}

function displayDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function duration(seconds?: number | null) {
  if (!Number.isFinite(Number(seconds))) return "—";
  const total = Math.max(0, Number(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes} min`;
}

function pretty(value: unknown) {
  return String(value ?? "—").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

export function CanonicalVisitDetailDrawer({ visitId, onClose }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<"overview" | "photos" | "history">("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visitId) {
      setDetail(null);
      setError("");
      setTab("overview");
      return;
    }
    let alive = true;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const supabase = getSupabaseBrowserClient() as any;
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (!token) throw new Error("Your session expired. Sign in again.");
        const response = await fetch(`/api/operations/visit-detail?visitId=${encodeURIComponent(visitId)}`, {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Service detail could not be loaded.");
        if (alive) setDetail(result);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "Service detail could not be loaded.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [visitId]);

  const visitPhotos = useMemo(() => (detail?.photos || []).filter(photo => String(photo.visit_id || "") === String(visitId || "")), [detail, visitId]);
  const propertyPhotos = useMemo(() => (detail?.photos || []).filter(photo => String(photo.visit_id || "") !== String(visitId || "")), [detail, visitId]);

  if (!visitId) return null;
  const property = detail?.property;
  const visit = detail?.visit;
  const customer = detail?.customer;
  const job = detail?.job;

  return <div className="canonical-visit-backdrop" onMouseDown={onClose}>
    <aside className="canonical-visit-drawer" onMouseDown={event => event.stopPropagation()}>
      <header>
        <div>
          <span>CANONICAL SERVICE RECORD</span>
          <h2>{customer?.full_name || "Service visit"}</h2>
          <p>{fullAddress(property)}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close">×</button>
      </header>

      {loading && <div className="canonical-visit-state">Loading service history…</div>}
      {error && <div className="canonical-visit-error">{error}</div>}

      {detail && <>
        <div className="canonical-visit-summary">
          <div><small>Service</small><strong>{job?.service_name || "Service"}</strong><span>{pretty(job?.service_frequency || job?.frequency || "one time")}</span></div>
          <div><small>Status</small><strong>{pretty(visit?.status)}</strong><span>{visit?.scheduled_date || "—"}</span></div>
          <div><small>Time</small><strong>{duration(visit?.duration_seconds)}</strong><span>{visit?.finished_at ? `Finished ${displayDate(visit.finished_at)}` : "Not finished"}</span></div>
        </div>

        <nav className="canonical-visit-tabs">
          <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button>
          <button className={tab === "photos" ? "active" : ""} onClick={() => setTab("photos")}>Photos <span>{visitPhotos.length}</span></button>
          <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>History <span>{(detail.feedback || []).length + (detail.tasks || []).length}</span></button>
        </nav>

        {tab === "overview" && <div className="canonical-visit-body">
          <section className="canonical-visit-property">
            <div className="canonical-property-photo">
              {property?.official_photo_url ? <img src={property.official_photo_url} alt="Property" /> : <div><span>⌂</span><strong>Property photo</strong><small>No official house photo</small></div>}
            </div>
            <div className="canonical-property-grid">
              <article><small>PROPERTY SIZE</small><strong>{pretty(property?.lot_size || "Not set")}</strong></article>
              <article><small>MOWING HEIGHT</small><strong>{pretty(property?.grass_height || "Not set")}</strong></article>
              <article><small>ACCESS</small><strong>{property?.gate ? "Gate" : "No gate"} · {property?.dog ? "Dog" : "No dog noted"}</strong></article>
              <article><small>IRRIGATION</small><strong>{property?.irrigation ? "Present" : "Not noted"}</strong></article>
            </div>
          </section>
          <section className="canonical-visit-timeline">
            <article><small>Scheduled</small><strong>{visit?.scheduled_date || "—"}</strong></article>
            <article><small>Started</small><strong>{displayDate(visit?.started_at)}</strong></article>
            <article><small>Finished</small><strong>{displayDate(visit?.finished_at)}</strong></article>
            <article><small>Duration</small><strong>{duration(visit?.duration_seconds)}</strong></article>
          </section>
          <section className="canonical-visit-notes">
            <article><small>ACCESS NOTES</small><p>{property?.access_notes || "No access notes."}</p></article>
            <article><small>SERVICE / PROPERTY NOTES</small><p>{property?.property_notes || "No property service notes."}</p></article>
            {visit?.employee_notes && <article><small>EMPLOYEE NOTES</small><p>{visit.employee_notes}</p></article>}
            {visit?.customer_visible_summary && <article><small>SERVICE SUMMARY</small><p>{visit.customer_visible_summary}</p></article>}
          </section>
          <section className="canonical-payment-state"><span>Payout state</span><strong>{pretty(visit?.payment_release_status || (visit?.payment_hold ? "held" : "not released"))}</strong><p>{visit?.payment_release_reason || "Financial release follows the canonical Visit lifecycle."}</p></section>
        </div>}

        {tab === "photos" && <div className="canonical-visit-body">
          <section className="canonical-photo-section"><header><div><small>SERVICE EVIDENCE</small><h3>Photos from this Visit</h3></div><b>{visitPhotos.length}</b></header><div className="canonical-photo-grid">{visitPhotos.map(photo => <article key={photo.id}>{photo.url ? <img src={photo.url} alt={photo.caption || photo.photo_type || "Service photo"} /> : <div className="canonical-photo-empty">Photo unavailable</div>}<footer><strong>{pretty(photo.photo_type || "Service photo")}</strong><small>{photo.caption || displayDate(photo.created_at)}</small></footer></article>)}{!visitPhotos.length && <div className="canonical-empty">No photos were registered for this service Visit.</div>}</div></section>
          {!!propertyPhotos.length && <section className="canonical-photo-section secondary"><header><div><small>PROPERTY REFERENCE</small><h3>House / property photos</h3></div><b>{propertyPhotos.length}</b></header><div className="canonical-photo-grid">{propertyPhotos.slice(0, 8).map(photo => <article key={photo.id}>{photo.url ? <img src={photo.url} alt={photo.caption || "Property photo"} /> : <div className="canonical-photo-empty">Photo unavailable</div>}<footer><strong>{pretty(photo.photo_type || "Property")}</strong><small>{photo.caption || displayDate(photo.created_at)}</small></footer></article>)}</div></section>}
        </div>}

        {tab === "history" && <div className="canonical-visit-body">
          <section className="canonical-history-section"><header><small>FEEDBACK</small><h3>Customer feedback for this service</h3></header>{(detail.feedback || []).map(row => <article key={row.id}><div><strong>{row.rating ? `${row.rating}/5` : "Feedback"}</strong><span>{displayDate(row.created_at)}</span></div><p>{row.comment || "No written comment."}</p></article>)}{!detail.feedback?.length && <div className="canonical-empty">No feedback registered for this Visit.</div>}</section>
          <section className="canonical-history-section"><header><small>TASKS</small><h3>Issues and follow-up</h3></header>{(detail.tasks || []).map(row => <article key={row.id}><div><strong>{row.title || "Task"}</strong><span>{pretty(row.status)}</span></div><p>{row.customer_issue || row.completion_summary || "No additional detail."}</p></article>)}{!detail.tasks?.length && <div className="canonical-empty">No tasks linked to this Visit.</div>}</section>
        </div>}
      </>}
    </aside>
    <style jsx global>{`
      .canonical-visit-backdrop{position:fixed;inset:0;z-index:900;background:rgba(3,20,14,.62);display:flex;justify-content:flex-end;backdrop-filter:blur(4px)}
      .canonical-visit-drawer{width:min(720px,96vw);height:100vh;overflow:auto;background:#f4f8f6;box-shadow:-24px 0 70px rgba(0,0,0,.24)}
      .canonical-visit-drawer>header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;gap:18px;padding:24px 26px;background:linear-gradient(145deg,#073f30,#0b684c);color:#fff}.canonical-visit-drawer>header span{font-size:10px;font-weight:950;letter-spacing:.13em;color:#a8dbc8}.canonical-visit-drawer>header h2{margin:5px 0 3px;font-size:27px}.canonical-visit-drawer>header p{margin:0;color:#d5eee4}.canonical-visit-drawer>header button{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.1);color:#fff;width:38px;height:38px;border-radius:12px;font-size:22px;cursor:pointer}
      .canonical-visit-state,.canonical-visit-error,.canonical-empty{padding:22px;color:#64746c}.canonical-visit-error{color:#9f2f2f;background:#fff1f1}
      .canonical-visit-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#dce8e1;border-bottom:1px solid #d5e2db}.canonical-visit-summary>div{background:#fff;padding:15px 18px}.canonical-visit-summary small,.canonical-property-grid small,.canonical-visit-timeline small,.canonical-visit-notes small,.canonical-photo-section small,.canonical-history-section small{display:block;font-size:9px;font-weight:950;letter-spacing:.1em;color:#718179}.canonical-visit-summary strong,.canonical-visit-summary span{display:block}.canonical-visit-summary strong{margin-top:5px}.canonical-visit-summary span{margin-top:3px;color:#687a70;font-size:11px}
      .canonical-visit-tabs{display:flex;gap:5px;padding:12px 16px;background:#eef4f1;border-bottom:1px solid #d8e4de;position:sticky;top:92px;z-index:1}.canonical-visit-tabs button{border:0;background:transparent;padding:9px 13px;border-radius:10px;color:#607168;font-weight:850;cursor:pointer}.canonical-visit-tabs button.active{background:#fff;color:#0a4f38;box-shadow:0 5px 16px rgba(13,61,44,.09)}.canonical-visit-tabs span{margin-left:5px;padding:2px 6px;border-radius:999px;background:#dcebe3;font-size:9px}
      .canonical-visit-body{display:grid;gap:14px;padding:16px}.canonical-visit-property,.canonical-visit-timeline,.canonical-visit-notes,.canonical-photo-section,.canonical-history-section,.canonical-payment-state{background:#fff;border:1px solid #dbe6e0;border-radius:18px;overflow:hidden;box-shadow:0 10px 28px rgba(13,61,44,.04)}
      .canonical-visit-property{display:grid;grid-template-columns:230px 1fr}.canonical-property-photo{min-height:190px;background:#e4ece8;position:relative}.canonical-property-photo img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0}.canonical-property-photo>div{height:100%;display:grid;place-content:center;text-align:center;color:#66776f}.canonical-property-photo>div span{font-size:34px;color:#0b684c}.canonical-property-photo>div strong,.canonical-property-photo>div small{display:block;margin-top:4px}.canonical-property-grid{display:grid;grid-template-columns:1fr 1fr}.canonical-property-grid article{padding:17px;border-left:1px solid #edf2ef;border-bottom:1px solid #edf2ef}.canonical-property-grid strong{display:block;margin-top:6px}
      .canonical-visit-timeline{display:grid;grid-template-columns:repeat(4,1fr)}.canonical-visit-timeline article{padding:15px;border-right:1px solid #edf2ef}.canonical-visit-timeline strong{display:block;margin-top:6px;font-size:12px}.canonical-visit-notes{display:grid;grid-template-columns:1fr 1fr}.canonical-visit-notes article{padding:16px;border-right:1px solid #edf2ef;border-bottom:1px solid #edf2ef}.canonical-visit-notes p,.canonical-payment-state p{margin:7px 0 0;line-height:1.55;color:#56675f}.canonical-payment-state{padding:16px}.canonical-payment-state span{font-size:10px;font-weight:900;color:#64766c}.canonical-payment-state strong{display:block;margin-top:4px;color:#0a563d}
      .canonical-photo-section>header,.canonical-history-section>header{display:flex;justify-content:space-between;align-items:center;padding:16px 17px;border-bottom:1px solid #edf2ef}.canonical-photo-section h3,.canonical-history-section h3{margin:4px 0 0}.canonical-photo-section>header b{padding:6px 9px;border-radius:999px;background:#e8f4ed;color:#0b684c}.canonical-photo-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:12px}.canonical-photo-grid article{border:1px solid #e0e9e4;border-radius:13px;overflow:hidden;background:#f8faf9}.canonical-photo-grid img,.canonical-photo-empty{width:100%;aspect-ratio:16/10;object-fit:cover;background:#e5ece8}.canonical-photo-empty{display:grid;place-items:center;color:#718078}.canonical-photo-grid footer{padding:10px}.canonical-photo-grid footer strong,.canonical-photo-grid footer small{display:block}.canonical-photo-grid footer small{margin-top:3px;color:#75847c}.canonical-photo-section.secondary{opacity:.94}
      .canonical-history-section>article{padding:14px 17px;border-bottom:1px solid #edf2ef}.canonical-history-section>article>div{display:flex;justify-content:space-between;gap:10px}.canonical-history-section>article span{color:#6d7d74;font-size:11px}.canonical-history-section>article p{margin:7px 0 0;color:#56675f}
      @media(max-width:700px){.canonical-visit-summary{grid-template-columns:1fr}.canonical-visit-tabs{top:110px;overflow:auto}.canonical-visit-property{grid-template-columns:1fr}.canonical-property-photo{min-height:210px}.canonical-visit-timeline{grid-template-columns:1fr 1fr}.canonical-visit-notes{grid-template-columns:1fr}.canonical-photo-grid{grid-template-columns:1fr}}
    `}</style>
  </div>;
}
