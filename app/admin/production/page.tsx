import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { getProductionReadinessSummary, productionReadinessItems } from "@/lib/production/readiness";

const label: Record<string, string> = {
  ready: "Ready",
  warning: "Needs test",
  blocked: "Blocked",
};

export default function ProductionReadinessPage() {
  const summary = getProductionReadinessSummary();
  return (
    <AdminShell active="Production">
      <div className="business-hero">
        <div>
          <span className="eyebrow">V49 Production Readiness</span>
          <h1>Go-live checklist for turning 4Ever Seasons into a commercial SaaS.</h1>
          <p>Focus: stability, integration, tenant safety, payments, mobile field testing and operational confidence.</p>
        </div>
        <div className="hero-actions">
          <Link className="btn btn-primary" href="/admin/command">Command Center</Link>
          <Link className="btn btn-white" href="/admin/routes">Employee Routes</Link>
        </div>
      </div>

      <section className="business-metrics">
        <div className="business-metric"><span>Ready</span><strong>{summary.ready}</strong><small>can move forward</small></div>
        <div className="business-metric warn"><span>Needs Test</span><strong>{summary.warning}</strong><small>requires QA</small></div>
        <div className="business-metric danger"><span>Blocked</span><strong>{summary.blocked}</strong><small>must be built before sales</small></div>
      </section>

      <section className="card table-card" style={{ marginTop: 20 }}>
        <div className="table-head">
          <div>
            <h2>Production Checklist</h2>
            <p className="section-intro">Use this screen before major demos, investor reviews or selling to another company.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Area</th><th>Status</th><th>Check</th><th>Detail</th><th>Next Action</th></tr></thead>
            <tbody>
              {productionReadinessItems.map((item) => (
                <tr key={`${item.area}-${item.title}`}>
                  <td>{item.area}</td>
                  <td><span className={`pill ${item.status === "blocked" ? "danger" : item.status === "warning" ? "warn" : ""}`}>{label[item.status]}</span></td>
                  <td><strong>{item.title}</strong></td>
                  <td>{item.detail}</td>
                  <td>{item.nextAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
