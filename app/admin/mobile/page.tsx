import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { fieldModeCards, getFieldModeSummary } from "@/lib/mobile/fieldMode";

const statusLabel: Record<string, string> = {
  online: "Ready",
  "offline-ready": "Offline foundation",
  "needs-sync": "Sync rule",
};

export default function MobileFieldPage() {
  const summary = getFieldModeSummary();
  return (
    <AdminShell active="Mobile">
      <div className="business-hero">
        <div>
          <span className="eyebrow">V48 Mobile Field Foundation</span>
          <h1>Mobile workflow for employees, built on the same ERP data flow.</h1>
          <p>Field work stays centered on the property Service Screen, route status and visit history.</p>
        </div>
        <div className="hero-actions">
          <Link className="btn btn-primary" href="/employee/route">Open Employee Route</Link>
          <Link className="btn btn-white" href="/admin/command">Command Center</Link>
        </div>
      </div>

      <section className="business-metrics">
        <div className="business-metric"><span>Mobile Areas</span><strong>{summary.total}</strong><small>field workflow cards</small></div>
        <div className="business-metric"><span>Offline Base</span><strong>{summary.offlineReady}</strong><small>prepared for next step</small></div>
        <div className="business-metric warn"><span>Sync Rules</span><strong>{summary.needsSync}</strong><small>must stay database-first</small></div>
        <Link href="/admin/routes" className="business-metric"><span>Routes</span><strong>Live</strong><small>employee route source</small></Link>
      </section>

      <section className="suite-grid">
        {fieldModeCards.map((card) => (
          <div className="suite-card" key={card.title}>
            <b>{statusLabel[card.status]}</b>
            <h2>{card.title}</h2>
            <p>{card.description}</p>
            <span>{card.action} →</span>
          </div>
        ))}
      </section>

      <section className="card table-card" style={{ marginTop: 20 }}>
        <div className="table-head">
          <div>
            <h2>Mobile rules</h2>
            <p className="section-intro">No separate mobile database, no visual-only status and no duplicated property data.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Rule</th><th>Decision</th></tr></thead>
            <tbody>
              <tr><td>Start / Finish</td><td>Only inside the property service workflow.</td></tr>
              <tr><td>Completed task</td><td>Removed from employee view and kept for Admin review/history.</td></tr>
              <tr><td>Offline data</td><td>Queued locally first, then synced back to the same visit record.</td></tr>
              <tr><td>Photos</td><td>Attached to visit/property history, not loose gallery data.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
