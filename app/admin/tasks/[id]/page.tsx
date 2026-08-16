"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { getAdminTaskWorkspace, resolveLiveTask, unassignLiveTask, type AdminLiveTask } from "@/lib/db/tasksRepository";
import styles from "@/components/admin/TaskCenter.module.css";

function dateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString("en-CA") : "Not recorded";
}

function dateOnly(value?: string | null) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-CA") : "Not scheduled";
}

function timer(seconds?: number | null) {
  if (!seconds) return "Not recorded";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const [task, setTask] = useState<AdminLiveTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const workspace = await getAdminTaskWorkspace();
      setTask(workspace.tasks.find((item) => item.id === params.id) || null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Work Order could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [params.id]);

  async function unassign() {
    if (!task || task.status !== "assigned") return;
    if (!window.confirm("Return this Work Order to the Admin queue?")) return;
    try {
      await unassignLiveTask(task.id);
      setMessage("Work Order returned to Admin.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not unassign Work Order.");
    }
  }

  async function resolve() {
    if (!task || task.status !== "completed") return;
    const summary = window.prompt("Optional final Admin note:", task.completionSummary || "Issue resolved during return visit.");
    if (summary === null) return;
    try {
      await resolveLiveTask(task.id, summary);
      setMessage("Work Order resolved.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not resolve Work Order.");
    }
  }

  return <AdminShell active="Tasks">
    <div className={styles.shell}>
      <section className={styles.hero}><div><small>WORK ORDER DETAIL</small><h1>Return Visit Record</h1><p>Canonical Customer, Property, assignment, timer and completion evidence.</p></div><div className={styles.heroActions}><Link href={task?.status === "resolved" ? "/admin/tasks/history" : "/admin/tasks/open"}>Back to queue</Link></div></section>
      {message && <div className={styles.message}>{message}</div>}
      {loading ? <section className={styles.panel}><div className={styles.empty}><strong>Loading Work Order…</strong></div></section> : !task ? <section className={styles.panel}><div className={styles.empty}><strong>Work Order not found.</strong><p>It may have been resolved, removed, or belongs to another company.</p></div></section> : <section className={styles.workspace}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><span>{task.priority} priority</span><h2>{task.title}</h2><p>{task.customerName} · {task.address}</p></div></header>
          <div className={styles.form}>
            <div className={styles.propertyHint}><i>⌂</i><div><strong>{task.customerName}</strong><small>{task.address}{task.city ? ` · ${task.city}, ${task.province || ""}` : ""}</small></div></div>
            <div className={styles.field}><label>Customer issue</label><div>{task.issue}</div></div>
            <div className={styles.formGrid}><div className={styles.field}><label>Status</label><div>{task.status.replaceAll("_", " ")}</div></div><div className={styles.field}><label>Assigned to</label><div>{task.employeeName || task.crewName || "Waiting for Admin"}</div></div></div>
            <div className={styles.formGrid}><div className={styles.field}><label>Return date</label><div>{dateOnly(task.scheduledDate)}</div></div><div className={styles.field}><label>Timer</label><div>{timer(task.durationSeconds)}</div></div></div>
            <div className={styles.formGrid}><div className={styles.field}><label>Started</label><div>{dateTime(task.workStartedAt)}</div></div><div className={styles.field}><label>Finished</label><div>{dateTime(task.workFinishedAt || task.resolvedAt)}</div></div></div>
            <div className={styles.field}><label>Completion summary</label><div>{task.completionSummary || "No completion note yet."}</div></div>
            <div className={styles.actions}><Link href={`/admin/customers/${task.customerId}`}>Open Customer / Property</Link>{task.status === "assigned" && <button className={styles.danger} onClick={() => void unassign()}>Unassign</button>}{task.status === "completed" && <button className={styles.primary} onClick={() => void resolve()}>Resolve</button>}</div>
          </div>
        </article>
        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><span>EVIDENCE</span><h2>{task.photos.length} attachment{task.photos.length === 1 ? "" : "s"}</h2><p>Private task-photo records stay connected to this Work Order.</p></div></header>
          <div className={styles.queue}>{task.photos.length ? task.photos.map((photo) => <div className={styles.task} key={photo.id}><i className={styles.house}>▧</i><div className={styles.taskMain}><div className={styles.titleLine}><strong>{photo.type === "completion" ? "Completion evidence" : "Issue evidence"}</strong></div><p>{photo.caption || "No caption"}</p><small>{dateTime(photo.createdAt)}</small></div></div>) : <div className={styles.empty}><strong>No evidence attached.</strong><p>Employee completion photos and Customer issue photos will appear here when registered.</p></div>}</div>
        </article>
      </section>}
    </div>
  </AdminShell>;
}
