"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./workspace.module.css";

type Payment = { id: string; amount: number; method: string; status: string; paidAt: string; invoiceNumber: string | null; description: string };
type Invoice = { id: string; number: string; description: string; amount: number; status: string; date: string };
type Visit = { id: string; date: string; status: string; finishedAt: string | null; summary: string };
type Photo = { id: string; type: string | null; caption: string | null; date: string; visitId: string | null };
type Customer = { id: string; name: string; email: string | null; phone: string | null; notes: string | null; addresses: string[]; payments: Payment[]; invoices: Invoice[]; visits: Visit[]; photos: Photo[] };
type Request = { id: string; full_name: string; email: string | null; phone: string | null; address: string | null; service_requested: string | null; status: string; created_at: string; notes: string | null };
type Overview = { customers: Customer[]; requests: Request[] };

const money = (amount: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(Number(amount) || 0);
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("en-CA") : "—";

function VisitPhotoUpload({ visitId }: { visitId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState("before");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error("Sign in again.");
      const form = new FormData();
      form.append("visitId", visitId);
      form.append("type", type);
      form.append("file", file);
      const response = await fetch("/api/owner/photos", {
        method: "POST",
        headers: { authorization: "Bearer " + data.session.access_token },
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the photo.");
      setMessage("Photo saved securely.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload photo.");
    } finally {
      setBusy(false);
    }
  }
  return <div className={styles.upload}>
    <select aria-label="Photo type" value={type} onChange={(event) => setType(event.target.value)}>
      <option value="before">Before</option><option value="after">After</option><option value="completion">Completed work</option><option value="issue">Issue</option>
    </select>
    <input aria-label="Choose service photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} />
    <button className={styles.secondary} onClick={() => void upload()} type="button" disabled={!file || busy}>{busy ? "Saving..." : "Save photo"}</button>
    {message && <small role="status">{message}</small>}
  </div>;
}

export default function OwnerWorkspacePage() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoError, setPhotoError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const client = getSupabaseBrowserClient();
        const { data: session } = await client.auth.getSession();
        const token = session.session?.access_token;
        if (!token) { router.replace("/owner/login"); return; }
        const result = await fetch("/api/owner/overview", { headers: { authorization: "Bearer " + token }, cache: "no-store" });
        const body = await result.json();
        if (!result.ok) throw new Error(body.error || "Could not load workspace.");
        if (active) setData(body);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not load workspace.");
      } finally {
        if (active) setBusy(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [router]);

  const customers = useMemo(() => (data?.customers || []).filter((customer) =>
    [customer.name, customer.email, customer.phone, ...customer.addresses].join(" ").toLowerCase().includes(search.toLowerCase())
  ), [data, search]);
  const totals = useMemo(() => ({
    paid: (data?.customers || []).flatMap((customer) => customer.payments).filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    visits: (data?.customers || []).reduce((sum, customer) => sum + customer.visits.length, 0),
    photos: (data?.customers || []).reduce((sum, customer) => sum + customer.photos.length, 0),
  }), [data]);

  async function logout() {
    await getSupabaseBrowserClient().auth.signOut();
    router.replace("/owner/login");
  }

  async function openPhoto(photoId: string) {
    setPhotoError("");
    try {
      const { data: session } = await getSupabaseBrowserClient().auth.getSession();
      if (!session.session) throw new Error("Sign in again.");
      const response = await fetch("/api/owner/photos?id=" + encodeURIComponent(photoId), {
        headers: { authorization: "Bearer " + session.session.access_token }, cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Photo could not be loaded.");
      setPhotoUrls((previous) => ({ ...previous, [photoId]: body.url }));
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Photo could not be loaded.");
    }
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>4Ever Seasons · Owner only</span><h1>My service workspace</h1><p>Private customers, service history, payments and photos in one place.</p></div>
      <div className={styles.actions}><Link href="/" className={styles.secondary}>Website</Link><button className={styles.secondary} onClick={() => void logout()}>Sign out</button></div>
    </header>
    {busy && <p role="status">Loading your private workspace...</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {data && <>
      <section className={styles.metrics}>
        <div><small>Customers</small><strong>{data.customers.length}</strong></div>
        <div><small>Service visits</small><strong>{totals.visits}</strong></div>
        <div><small>Payment history · paid</small><strong>{money(totals.paid)}</strong></div>
        <div><small>Saved photos</small><strong>{totals.photos}</strong></div>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHead}><div><h2>Service requests</h2><p>Recent submissions, including requests waiting for your review.</p></div></div>
        {data.requests.length === 0 ? <p className={styles.muted}>No private service requests have been received yet.</p> :
          <div className={styles.scroll}><table><thead><tr><th>Customer</th><th>Address</th><th>Service</th><th>Date</th><th>Status</th></tr></thead><tbody>
            {data.requests.map((request) => <tr key={request.id}><td><strong>{request.full_name}</strong><small>{request.email || request.phone || ""}</small></td><td>{request.address || "—"}</td><td>{request.service_requested || "Property service"}</td><td>{date(request.created_at)}</td><td>{request.status}</td></tr>)}
          </tbody></table></div>}
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHead}><div><h2>Customers</h2><p>Select a customer to expand their individual history.</p></div><input aria-label="Search customers" placeholder="Search name, email or address" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        {customers.length === 0 && <p className={styles.muted}>No matching customers. New requests appear above until confirmed and registered.</p>}
        <div className={styles.customerList}>{customers.map((customer) => <details className={styles.customer} key={customer.id}>
          <summary><span><strong>{customer.name}</strong><small>{customer.addresses.join(" · ") || "No property registered"} · {customer.email || customer.phone || "No contact details"}</small></span><span className={styles.count}>{customer.payments.length} payments · {customer.visits.length} visits · {customer.photos.length} photos</span></summary>
          <div className={styles.details}>
            <p><strong>Contact:</strong> {customer.email || "—"} · {customer.phone || "—"}</p>
            {customer.notes && <p><strong>Notes:</strong> {customer.notes}</p>}
            <h3>Payments</h3>
            {customer.payments.length ? <div className={styles.scroll}><table><thead><tr><th>Date</th><th>What for</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead><tbody>
              {customer.payments.map((p) => <tr key={p.id}><td>{date(p.paidAt)}</td><td>{p.description}{p.invoiceNumber ? " · " + p.invoiceNumber : ""}</td><td>{money(p.amount)}</td><td>{p.method}</td><td>{p.status}</td></tr>)}
            </tbody></table></div> : <p className={styles.muted}>No payments recorded.</p>}
            <h3>Invoices</h3>
            {customer.invoices.length ? <div className={styles.scroll}><table><thead><tr><th>Issued</th><th>Invoice</th><th>Service</th><th>Total</th><th>Status</th></tr></thead><tbody>
              {customer.invoices.map((invoice) => <tr key={invoice.id}><td>{date(invoice.date)}</td><td>{invoice.number}</td><td>{invoice.description}</td><td>{money(invoice.amount)}</td><td>{invoice.status}</td></tr>)}
            </tbody></table></div> : <p className={styles.muted}>No invoices recorded.</p>}
            <h3>Visit history</h3>
            {customer.visits.length ? <ul>{customer.visits.map((visit) => <li key={visit.id}><strong>{date(visit.date)} · {visit.status}</strong>{visit.summary ? " · " + visit.summary : ""}<VisitPhotoUpload visitId={visit.id} /></li>)}</ul> : <p className={styles.muted}>No visits recorded.</p>}
            <h3>Photo archive</h3>
            {customer.photos.length ? <ul>{customer.photos.map((photo) => <li key={photo.id}>{date(photo.date)} · {photo.type || "Service photo"}{photo.caption ? " · " + photo.caption : ""} <button type="button" className={styles.secondary} onClick={() => void openPhoto(photo.id)}>View photo</button>{photoUrls[photo.id] && <a href={photoUrls[photo.id]} target="_blank" rel="noopener noreferrer">Open secure image</a>}</li>)}</ul> : <p className={styles.muted}>No photos saved for this customer.</p>}{photoError && <p role="alert" className={styles.error}>{photoError}</p>}
          </div>
        </details>)}</div>
      </section>
    </>}
  </main>;
}
