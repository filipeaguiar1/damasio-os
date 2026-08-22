"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  assignLiveTask,
  createAdminLiveTask,
  getAdminTaskWorkspace,
  resolveLiveTask,
  unassignLiveTask,
  type AdminLiveTask,
  type AdminTaskProperty,
  type AdminTaskWorker,
  type AdminTaskWorkspace,
} from "@/lib/db/tasksRepository";
import styles from "./TaskCenter.module.css";

type Mode = "all" | "open" | "history";
const emptyWorkspace: AdminTaskWorkspace = { tasks: [], properties: [], workers: [] };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function prettyDate(value?: string | null) {
  if (!value) return "Not scheduled";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function duration(seconds?: number | null) {
  if (!seconds) return "Not recorded";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function statusClass(status: string) {
  if (status === "in_progress") return styles.progress;
  if (status === "completed") return styles.completed;
  if (status === "resolved") return styles.resolved;
  if (status === "assigned") return styles.assigned;
  return "";
}

function workerName(task: AdminLiveTask) {
  return task.employeeName || task.crewName || "Waiting for assignment";
}

function PropertyIcon(){
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.2 12 4l8 7.2V20H4v-8.8Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M9 20v-6h6v6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>;
}

export function TaskCenter({ mode = "all" }: { mode?: Mode }) {
  const [workspace, setWorkspace] = useState<AdminTaskWorkspace>(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [propertyQuery, setPropertyQuery] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "urgent">("normal");
  const [scheduledDate, setScheduledDate] = useState(today());
  const [targetValue, setTargetValue] = useState("");
  const [assigningId, setAssigningId] = useState("");
  const [assignTarget, setAssignTarget] = useState("");
  const [assignDate, setAssignDate] = useState(today());

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const value = await getAdminTaskWorkspace();
      setWorkspace(value);
      if (propertyId && !value.properties.some((item) => item.id === propertyId)) setPropertyId("");
      if (targetValue && !value.workers.some((item) => `${item.kind}:${item.id}` === targetValue)) setTargetValue("");
      if (!silent) setMessage("");
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : "Task workspace could not be loaded.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedProperty: AdminTaskProperty | null = workspace.properties.find((item) => item.id === propertyId) || null;
  const propertyNeedle = propertyQuery.trim().toLowerCase();
  const visibleProperties = useMemo(() => workspace.properties.filter((item) =>
    !propertyNeedle || `${item.customerName} ${item.address} ${item.city || ""} ${item.postalCode || ""}`.toLowerCase().includes(propertyNeedle)
  ).slice(0, 150), [workspace.properties, propertyNeedle]);

  const counts = useMemo(() => ({
    open: workspace.tasks.filter((task) => ["open", "returned_to_admin"].includes(task.status)).length,
    assigned: workspace.tasks.filter((task) => task.status === "assigned").length,
    inProgress: workspace.tasks.filter((task) => task.status === "in_progress").length,
    awaitingAdmin: workspace.tasks.filter((task) => task.status === "completed").length,
  }), [workspace.tasks]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workspace.tasks.filter((task) => {
      if (mode === "history" && task.status !== "resolved") return false;
      if (mode !== "history" && task.status === "resolved") return false;
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      return !needle || `${task.customerName} ${task.address} ${task.title} ${task.issue} ${workerName(task)}`.toLowerCase().includes(needle);
    });
  }, [workspace.tasks, query, statusFilter, mode]);

  function workerFromValue(value: string): AdminTaskWorker | null {
    const [kind, id] = value.split(":");
    return workspace.workers.find((item) => item.kind === kind && item.id === id) || null;
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const title = String(form.get("title") || "").trim();
    const issue = String(form.get("issue") || "").trim();
    if (!propertyId) return setMessage("Choose a real Customer property first.");
    if (!title || !issue) return setMessage("Add a title and the reason for the return visit.");

    setBusy(true);
    setMessage("");
    try {
      const taskId = await createAdminLiveTask({ propertyId, title, issue, priority, scheduledDate: scheduledDate || null });
      const target = workerFromValue(targetValue);
      if (target) await assignLiveTask(taskId, target, scheduledDate || null);
      formElement.reset();
      setPropertyId("");
      setPropertyQuery("");
      setPriority("normal");
      setScheduledDate(today());
      setTargetValue("");
      setMessage(target ? "Work Order created and assigned to the selected Employee/Crew." : "Work Order created in the Admin queue.");
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Work Order could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAssignment(task: AdminLiveTask) {
    const target = workerFromValue(assignTarget);
    if (!target) return setMessage("Choose an Employee or Crew.");
    setBusy(true);
    try {
      await assignLiveTask(task.id, target, assignDate || null);
      setAssigningId("");
      setAssignTarget("");
      setMessage(`Work Order assigned to ${target.name}.`);
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Assignment could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function unassign(task: AdminLiveTask) {
    if (!window.confirm("Return this Work Order to the Admin queue? The Employee/Crew assignment will be removed.")) return;
    setBusy(true);
    try {
      await unassignLiveTask(task.id);
      setMessage("Work Order returned to the Admin queue.");
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Work Order could not be unassigned.");
    } finally {
      setBusy(false);
    }
  }

  async function resolve(task: AdminLiveTask) {
    if (task.status !== "completed") return setMessage("Only completed Work Orders can be resolved by Admin.");
    const summary = window.prompt("Optional final Admin note:", task.completionSummary || "Issue resolved during return visit.");
    if (summary === null) return;
    setBusy(true);
    try {
      await resolveLiveTask(task.id, summary);
      setMessage("Work Order resolved and moved to History.");
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Work Order could not be resolved.");
    } finally {
      setBusy(false);
    }
  }

  function beginAssign(task: AdminLiveTask) {
    setAssigningId(task.id);
    setAssignTarget("");
    setAssignDate(task.scheduledDate || today());
  }

  const title = mode === "history" ? "Resolved Work Orders" : mode === "open" ? "Open Work Orders" : "Work Order Center";
  const subtitle = mode === "history"
    ? "Search resolved return visits without losing the Customer or Property connection."
    : "Create and dispatch return visits from real Customer properties. No local demo houses are used here.";

  return <AdminShell active="Tasks">
    <div className={styles.shell}>
      <section className={styles.hero}>
        <div><small>CANONICAL TASK WORKSPACE</small><h1>{title}</h1><p>{subtitle}</p></div>
        <div className={styles.heroActions}>
          {mode !== "all" && <Link href="/admin/tasks">Task Center</Link>}
          {mode !== "open" && <Link href="/admin/tasks/open">Open Queue</Link>}
          {mode !== "history" && <Link href="/admin/tasks/history">History</Link>}
          <button type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </section>

      <section className={styles.metrics}>
        <article className={styles.metric}><span>Waiting for Admin</span><strong>{counts.open}</strong><small>not assigned</small></article>
        <article className={styles.metric}><span>Assigned</span><strong>{counts.assigned}</strong><small>scheduled return work</small></article>
        <article className={styles.metric}><span>In progress</span><strong>{counts.inProgress}</strong><small>Employee working now</small></article>
        <article className={styles.metric}><span>Awaiting Admin</span><strong>{counts.awaitingAdmin}</strong><small>completed, ready to resolve</small></article>
      </section>

      {message && <div className={styles.message}>{message}</div>}

      <section className={`${styles.workspace} ${mode === "history" ? styles.historyLayout : ""}`}>
        {mode !== "history" && <article className={styles.panel}>
          <header className={styles.panelHeader}><div><span>New return visit</span><h2>Create Work Order</h2><p>Select the actual property first. The Task will stay attached to the canonical Customer and Property.</p></div></header>
          <form className={styles.form} onSubmit={createTask}>
            <div className={`${styles.field} ${styles.propertySearch}`}>
              <label>Find Customer / Property</label>
              <input value={propertyQuery} onChange={(event) => setPropertyQuery(event.target.value)} placeholder="Search name, street or postal code" />
              <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} required>
                <option value="">Select a real property</option>
                {visibleProperties.map((property) => <option key={property.id} value={property.id}>{property.customerName} — {property.address}</option>)}
              </select>
            </div>
            {selectedProperty && <div className={styles.propertyHint}><i><PropertyIcon/></i><div><strong>{selectedProperty.customerName}</strong><small>{selectedProperty.address}{selectedProperty.city ? ` · ${selectedProperty.city}, ${selectedProperty.province || ""}` : ""}</small></div></div>}
            <div className={styles.field}><label>Work Order title</label><input name="title" placeholder="Example: Gate / lawn correction" required /></div>
            <div className={styles.field}><label>Customer issue / instructions</label><textarea name="issue" placeholder="Describe exactly what needs to be corrected." required /></div>
            <div className={styles.formGrid}>
              <div className={styles.field}><label>Priority</label><select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}><option value="low">Low</option><option value="normal">Normal</option><option value="urgent">Urgent</option></select></div>
              <div className={styles.field}><label>Return date</label><input type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} /></div>
            </div>
            <div className={styles.field}><label>Assign now (optional)</label><select value={targetValue} onChange={(event) => setTargetValue(event.target.value)}><option value="">Keep with Admin</option>{workspace.workers.map((worker) => <option key={`${worker.kind}:${worker.id}`} value={`${worker.kind}:${worker.id}`}>{worker.kind === "crew" ? "Crew" : "Employee"} · {worker.name}</option>)}</select></div>
            <button className={styles.submit} disabled={busy || !propertyId}>{busy ? "Saving…" : targetValue ? "Create & assign Work Order" : "Create Work Order"}</button>
          </form>
        </article>}

        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><span>{mode === "history" ? "Resolved archive" : "Live queue"}</span><h2>{filtered.length} Work Order{filtered.length === 1 ? "" : "s"}</h2><p>Search by Customer, property, issue or worker. Status remains live across Admin, Employee and Customer views.</p></div></header>
          <div className={styles.queueTools}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Work Orders" />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{mode === "history" ? <option value="resolved">Resolved</option> : <><option value="open">Open</option><option value="returned_to_admin">Returned to Admin</option><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="completed">Completed</option></>}</select>
          </div>
          <div className={styles.queue}>
            {loading ? <div className={styles.empty}><strong>Loading Work Orders…</strong></div> : filtered.length === 0 ? <div className={styles.empty}><strong>No Work Orders in this view.</strong><p>Try another filter or create a return visit from a real property.</p></div> : filtered.map((task) => <div className={styles.task} key={task.id}>
              <i className={styles.house}><PropertyIcon/></i>
              <div className={styles.taskMain}>
                <div className={styles.titleLine}><strong>{task.title}</strong><span className={`${styles.pill} ${task.priority === "urgent" ? styles.urgent : ""}`}>{task.priority}</span><span className={`${styles.pill} ${statusClass(task.status)}`}>{task.status.replaceAll("_", " ")}</span></div>
                <p>{task.customerName} · {task.address}</p>
                <small>{task.issue}</small>
                <div className={styles.meta}><span>{workerName(task)}</span><span>{prettyDate(task.scheduledDate)}</span>{task.durationSeconds ? <span>{duration(task.durationSeconds)}</span> : null}</div>
              </div>
              <div className={styles.actions}>
                <Link href={`/admin/tasks/${task.id}`}>Open</Link>
                {!['resolved','in_progress'].includes(task.status) && <button type="button" onClick={() => beginAssign(task)}>{task.status === "assigned" ? "Reassign" : "Assign"}</button>}
                {task.status === "assigned" && <button type="button" onClick={() => void unassign(task)}>Unassign</button>}
                {task.status === "completed" && <button type="button" className={styles.primary} onClick={() => void resolve(task)}>Resolve</button>}
              </div>
              {assigningId === task.id && <div className={styles.assignBox}>
                <select value={assignTarget} onChange={(event) => setAssignTarget(event.target.value)}><option value="">Choose Employee / Crew</option>{workspace.workers.map((worker) => <option key={`${worker.kind}:${worker.id}`} value={`${worker.kind}:${worker.id}`}>{worker.kind === "crew" ? "Crew" : "Employee"} · {worker.name}</option>)}</select>
                <input type="date" value={assignDate} onChange={(event) => setAssignDate(event.target.value)} />
                <button type="button" disabled={busy || !assignTarget} onClick={() => void saveAssignment(task)}>Save assignment</button>
              </div>}
            </div>)}
          </div>
        </article>
      </section>
    </div>
  </AdminShell>;
}