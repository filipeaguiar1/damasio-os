"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  DAMASIO_SYNC_EVENT,
  formatDuration,
  getOperationsIntelligence,
  getUnifiedVisitHistory,
  getWorkflowEvents,
} from "@/lib/storage";

export default function WorkflowPage() {
  const [tick, setTick] = useState(0);

  function refresh() {
    setTick((value) => value + 1);
  }

  useEffect(() => {
    const onSync = () => refresh();
    window.addEventListener(DAMASIO_SYNC_EVENT, onSync as EventListener);
    window.addEventListener("storage", onSync);
    return () => {
      window.removeEventListener(DAMASIO_SYNC_EVENT, onSync as EventListener);
      window.removeEventListener("storage", onSync);
    };
  }, []);

  const data = useMemo(() => {
    void tick;
    return {
      intelligence: getOperationsIntelligence(),
      visits: getUnifiedVisitHistory(),
      events: getWorkflowEvents(),
    };
  }, [tick]);

  return (
    <AdminShell active="Workflow">
      <div className="app-top">
        <div>
          <span className="eyebrow">V42.7 Operations Intelligence</span>
          <h1>Workflow Engine</h1>
          <p className="section-intro">Central lifecycle view for Start, Finish, Feedback and Return Tasks without changing the approved layout.</p>
        </div>
        <button className="btn btn-outline" onClick={refresh}>Refresh</button>
      </div>

      <section className="business-metrics">
        <div className="business-metric"><span>Active Jobs</span><strong>{data.intelligence.activeJobs}</strong><small>employee started</small></div>
        <div className="business-metric"><span>Completed Visits</span><strong>{data.intelligence.completedJobs}</strong><small>unified history</small></div>
        <div className="business-metric warn"><span>Open Tasks</span><strong>{data.intelligence.openTasks}</strong><small>return visits/issues</small></div>
        <div className="business-metric"><span>Feedbacks</span><strong>{data.intelligence.feedbacks}</strong><small>customer responses</small></div>
      </section>

      <section className="card table-card" style={{ marginTop: 20 }}>
        <div className="table-head"><div><h2>Unified Visit History</h2><p className="section-intro">Each row groups the visit, employee, time, photos, comments, feedback and linked tasks.</p></div><Link href="/admin/routes" className="btn btn-outline dark-safe">Open Routes</Link></div>
        <div className="table-wrap"><table><thead><tr><th>Visit</th><th>Employee</th><th>Time</th><th>Photos</th><th>Comment</th><th>Tasks</th></tr></thead><tbody>{data.visits.length === 0 ? <tr><td colSpan={6}>No completed or active visits yet.</td></tr> : data.visits.slice(0, 20).map((visit) => <tr key={visit.id}><td><strong>{visit.customer}</strong><br/><small>{visit.address}</small><br/><small>{visit.service}</small></td><td>{visit.employee}<br/><small>{visit.crew}</small></td><td>{visit.startedAt ? new Date(visit.startedAt).toLocaleString() : "-"}<br/><small>{visit.finishedAt ? `Finished ${new Date(visit.finishedAt).toLocaleTimeString()}` : "In progress"}</small><br/><small>{formatDuration(visit.durationSeconds)}</small></td><td>{visit.photos.length}</td><td>{visit.comment || "-"}</td><td>{visit.tasks.length}</td></tr>)}</tbody></table></div>
      </section>

      <section className="card table-card" style={{ marginTop: 20 }}>
        <div className="table-head"><div><h2>Workflow Events</h2><p className="section-intro">Lifecycle transitions are recorded automatically as the operation moves forward.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Time</th><th>Entity</th><th>Transition</th><th>Actor</th><th>Note</th></tr></thead><tbody>{data.events.length === 0 ? <tr><td colSpan={5}>No workflow events yet. Start or finish a house to create the first event.</td></tr> : data.events.slice(0, 25).map((event) => <tr key={event.id}><td>{new Date(event.createdAt).toLocaleString()}</td><td>{event.entityType}<br/><small>{event.entityId}</small></td><td>{event.fromStage || "-"} → {event.toStage}</td><td>{event.actor}</td><td>{event.note}</td></tr>)}</tbody></table></div>
      </section>
    </AdminShell>
  );
}
