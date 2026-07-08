"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { getCustomerPropertyDirectory } from "@/lib/services/customerPropertyService";
import type { CustomerPropertyRecord } from "@/lib/repositories/customerPropertyRepository";
import {
  addQuoteToProperty,
  addTaskToProperty,
  changeQuoteStatus,
  loadOperationsBoard,
  markTaskResolved,
} from "@/lib/services/operationsService";
import type { OperationsBoard, OperationQuote, OperationTask } from "@/lib/repositories/operationsRepository";

const emptyBoard: OperationsBoard = { quotes: [], jobs: [], tasks: [], activity: [] };

export default function OperationsPage() {
  const [board, setBoard] = useState<OperationsBoard>(emptyBoard);
  const [directory, setDirectory] = useState<CustomerPropertyRecord[]>([]);
  const [selected, setSelected] = useState("");
  const [serviceName, setServiceName] = useState("Weekly Lawn Care");
  const [subtotal, setSubtotal] = useState("120");
  const [taskTitle, setTaskTitle] = useState("Return visit required");
  const [taskIssue, setTaskIssue] = useState("");
  const [priority, setPriority] = useState<OperationTask["priority"]>("normal");
  const [message, setMessage] = useState("Loading operations...");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [nextBoard, nextDirectory] = await Promise.all([
        loadOperationsBoard(),
        getCustomerPropertyDirectory(),
      ]);
      setBoard(nextBoard);
      setDirectory(nextDirectory);
      if (!selected && nextDirectory[0]) setSelected(nextDirectory[0].propertyId);
      setMessage("Connected to Supabase operations.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load operations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = useMemo(
    () => directory.find((item) => item.propertyId === selected) || directory[0] || null,
    [directory, selected],
  );
  const openTasks = board.tasks.filter((task) => task.status !== "resolved");
  const approvedQuotes = board.quotes.filter((quote) => quote.status === "approved");

  async function createQuote() {
    if (!current) return setMessage("Create a customer/property first.");
    try {
      const next = await addQuoteToProperty({
        customerId: current.customerId,
        propertyId: current.propertyId,
        serviceName,
        subtotal: Number(subtotal || 0),
        notes: serviceName,
      });
      setBoard(next);
      setMessage("Quote saved in Supabase.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quote was not saved.");
    }
  }

  async function setQuoteStatus(id: string, status: OperationQuote["status"]) {
    try {
      const next = await changeQuoteStatus(id, status);
      setBoard(next);
      setMessage(status === "approved" ? "Quote approved. Job and workflow tasks created automatically." : "Quote status updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quote was not updated.");
    }
  }

  async function createTask() {
    if (!current) return setMessage("Create a customer/property first.");
    try {
      const next = await addTaskToProperty({
        customerId: current.customerId,
        propertyId: current.propertyId,
        title: taskTitle,
        customerIssue: taskIssue || taskTitle,
        priority,
      });
      setBoard(next);
      setTaskIssue("");
      setMessage("Task saved in Supabase.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task was not saved.");
    }
  }

  async function resolveTask(id: string) {
    try {
      const next = await markTaskResolved(id, "Resolved from Admin operations board.");
      setBoard(next);
      setMessage("Task resolved and saved to Activity History.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task was not resolved.");
    }
  }

  return (
    <AdminShell active="Operations">
      <div className="app-top">
        <div>
          <span className="eyebrow">V42.3 Workflow Operations</span>
          <h1>Operations Database</h1>
          <p className="section-intro">Quotes, Jobs, Tasks and Activity History now use Supabase workflow automation.</p>
        </div>
        <button className="btn btn-outline" onClick={refresh} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
      </div>

      <section className="business-metrics">
        <div className="business-metric"><span>Quotes</span><strong>{board.quotes.length}</strong><small>{approvedQuotes.length} approved</small></div>
        <div className="business-metric"><span>Jobs</span><strong>{board.jobs.length}</strong><small>Created from approved quotes</small></div>
        <div className="business-metric warn"><span>Open Tasks</span><strong>{openTasks.length}</strong><small>Return visits / issues</small></div>
        <div className="business-metric"><span>Activity</span><strong>{board.activity.length}</strong><small>Latest history records</small></div>
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <h2>Control Panel</h2>
        <p className="section-intro">{message}</p>
        <div className="grid-2">
          <div className="profile-card">
            <h3>Create Quote</h3>
            <div className="field"><label>Property</label><select className="input" value={selected} onChange={(event) => setSelected(event.target.value)}>{directory.map((item) => <option key={item.propertyId} value={item.propertyId}>{item.fullName} — {item.addressLine1}</option>)}</select></div>
            <div className="field"><label>Service</label><input className="input" value={serviceName} onChange={(event) => setServiceName(event.target.value)} /></div>
            <div className="field"><label>Subtotal</label><input className="input" value={subtotal} onChange={(event) => setSubtotal(event.target.value)} /></div>
            <button className="btn btn-primary" onClick={createQuote}>Save Quote</button>
          </div>

          <div className="profile-card">
            <h3>Create Task</h3>
            <div className="field"><label>Title</label><input className="input" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></div>
            <div className="field"><label>Issue</label><textarea className="input" value={taskIssue} onChange={(event) => setTaskIssue(event.target.value)} /></div>
            <div className="field"><label>Priority</label><select className="input" value={priority} onChange={(event) => setPriority(event.target.value as OperationTask["priority"])}><option value="low">Low</option><option value="normal">Normal</option><option value="urgent">Urgent</option></select></div>
            <button className="btn btn-primary" onClick={createTask}>Save Task</button>
          </div>
        </div>
      </section>

      <section className="card table-card" style={{ marginTop: 20 }}>
        <div className="table-head"><div><h2>Quotes</h2></div></div>
        <div className="table-wrap"><table><thead><tr><th>Quote</th><th>Customer</th><th>Service</th><th>Total</th><th>Status</th></tr></thead><tbody>{board.quotes.length === 0 ? <tr><td colSpan={5}>No quotes yet.</td></tr> : board.quotes.map((quote) => <tr key={quote.id}><td><strong>{quote.quoteNumber}</strong><br/><small>{new Date(quote.createdAt).toLocaleDateString()}</small></td><td>{quote.customerName}<br/><small>{quote.address}</small></td><td>{quote.serviceName}</td><td>${Number(quote.total || 0).toFixed(2)}</td><td><select className="input" value={quote.status} onChange={(event) => setQuoteStatus(quote.id, event.target.value as OperationQuote["status"])}><option value="draft">Draft</option><option value="sent">Sent</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="expired">Expired</option></select></td></tr>)}</tbody></table></div>
      </section>

      <section className="card table-card" style={{ marginTop: 20 }}>
        <div className="table-head"><div><h2>Jobs</h2></div></div>
        <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Service</th><th>Frequency</th><th>Status</th></tr></thead><tbody>{board.jobs.length === 0 ? <tr><td colSpan={4}>Approve a quote to create a job.</td></tr> : board.jobs.map((job) => <tr key={job.id}><td>{job.customerName}<br/><small>{job.address}</small></td><td>{job.serviceName}</td><td>{job.frequency}</td><td>{job.active ? "Active" : "Inactive"}</td></tr>)}</tbody></table></div>
      </section>

      <section className="card table-card" style={{ marginTop: 20 }}>
        <div className="table-head"><div><h2>Tasks</h2></div></div>
        <div className="table-wrap"><table><thead><tr><th>Task</th><th>Customer</th><th>Priority</th><th>Status</th><th>Action</th></tr></thead><tbody>{board.tasks.length === 0 ? <tr><td colSpan={5}>No tasks yet.</td></tr> : board.tasks.map((task) => <tr key={task.id}><td><strong>{task.title}</strong><br/><small>{task.customerIssue}</small></td><td>{task.customerName}<br/><small>{task.address}</small></td><td>{task.priority}</td><td>{task.status}</td><td>{task.status === "resolved" ? <small>{task.completionSummary || "Resolved"}</small> : <button className="btn btn-outline" onClick={() => resolveTask(task.id)}>Resolve</button>}</td></tr>)}</tbody></table></div>
      </section>

      <section className="card table-card" style={{ marginTop: 20 }}>
        <div className="table-head"><div><h2>Activity History</h2></div></div>
        <div className="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>{board.activity.length === 0 ? <tr><td colSpan={4}>No activity yet.</td></tr> : board.activity.slice(0, 15).map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.action}</td><td>{item.entityType}</td><td>{item.details}</td></tr>)}</tbody></table></div>
      </section>
    </AdminShell>
  );
}
