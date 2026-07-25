"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileCustomerNav } from "@/components/mobile/MobileCustomerNav";
import { useCustomerBilling } from "@/lib/hooks/useCustomerBilling";
import { useCustomerWallet } from "@/lib/hooks/useCustomerWallet";
import { loadCustomerPortal } from "@/lib/services/customerPortalService";
import { getPropertyPhotoHistory, uploadPropertyProfilePhoto, type PropertyPhotoHistory } from "@/lib/services/propertyPhotoService";
import type { CustomerPortalBoard } from "@/lib/repositories/customerPortalRepository";

const empty: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };
const config: Record<string, { title: string; subtitle: string; eyebrow: string; icon: string }> = {
  services: { title: "My Services", subtitle: "Appointments and active work", eyebrow: "PROPERTY CARE", icon: "✦" },
  history: { title: "History", subtitle: "Completed services", eyebrow: "SERVICE RECORD", icon: "↶" },
  estimates: { title: "Estimates", subtitle: "Review your quotes", eyebrow: "QUOTES", icon: "▤" },
  invoices: { title: "Invoices", subtitle: "Billing documents", eyebrow: "BILLING", icon: "≡" },
  payments: { title: "Payments", subtitle: "Balance and deposits", eyebrow: "ACCOUNT BALANCE", icon: "$" },
  feedback: { title: "Feedback", subtitle: "Reviews and follow-up", eyebrow: "YOUR EXPERIENCE", icon: "★" },
  profile: { title: "My Property", subtitle: "Home and access details", eyebrow: "PROPERTY PROFILE", icon: "○" },
  issues: { title: "Return Visits", subtitle: "Service issues", eyebrow: "FOLLOW-UP", icon: "!" },
  more: { title: "More", subtitle: "Customer tools", eyebrow: "MY ACCOUNT", icon: "•••" },
};

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

export default function MobileCustomerSection() {
  const section = String(useParams().section || "more");
  const page = config[section] || config.more;
  const router = useRouter();
  const [board, setBoard] = useState<CustomerPortalBoard>(empty);
  const [photoHistory, setPhotoHistory] = useState<PropertyPhotoHistory | null>(null);
  const [open, setOpen] = useState("");
  const [message, setMessage] = useState("");
  const [editingAmount, setEditingAmount] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [selectedDeposit, setSelectedDeposit] = useState<number | null>(null);

  const billing = useCustomerBilling();
  const wallet = useCustomerWallet();

  function refresh() {
    void loadCustomerPortal({ force: true })
      .then(setBoard)
      .catch(() => setMessage("Your connected customer information is temporarily unavailable."));
  }

  useEffect(() => refresh(), []);
  useEffect(() => {
    if (board.property?.propertyId) {
      void getPropertyPhotoHistory(board.property.propertyId).then(setPhotoHistory).catch(() => setPhotoHistory(null));
    }
  }, [board.property?.propertyId]);

  const activeVisits = useMemo(() => board.visits.filter((item) => !["completed", "cancelled"].includes(item.status)), [board.visits]);
  const history = useMemo(() => board.visits.filter((item) => item.status === "completed").sort((a, b) => String(b.scheduledDate).localeCompare(String(a.scheduledDate))), [board.visits]);
  const activeIssues = useMemo(() => board.tasks.filter((item) => !["completed", "resolved"].includes(item.status)), [board.tasks]);
  const next = activeVisits[0] || null;
  const parsedCustom = Number(customAmount);
  const validCustom = Number.isInteger(parsedCustom) && parsedCustom >= 5 && parsedCustom <= 1000;
  const depositAmount = editingAmount ? (validCustom ? parsedCustom : 0) : selectedDeposit || 0;
  const visibleMessage = message || billing.message || wallet.message;

  function chooseDeposit(amount: number) {
    setSelectedDeposit(amount);
    setEditingAmount(false);
    setCustomAmount("");
  }

  function chooseCustom() {
    setSelectedDeposit(null);
    setEditingAmount(true);
  }

  function addFunds() {
    if (!Number.isInteger(depositAmount) || depositAmount < 5 || depositAmount > 1000) {
      setMessage("Choose an amount between $5 and $1,000 CAD.");
      return;
    }
    void wallet.topUp(depositAmount);
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const propertyId = board.property?.propertyId;
    if (!file || !propertyId) return;
    try {
      setMessage("Uploading property photo...");
      const url = await uploadPropertyProfilePhoto(propertyId, file);
      setPhotoHistory((current) => ({ ...(current || { visits: [] }), profilePhotoUrl: url }));
      setMessage("Official property photo updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Property photo could not be uploaded.");
    } finally {
      event.target.value = "";
    }
  }

  const activeNav = section === "services" || section === "history" ? "services" : section === "payments" || section === "invoices" || section === "estimates" ? "billing" : "more";
  const address = board.property?.address || "Customer account";

  return (
    <MobileRoleGuard allowed={["customer"]}>
      <main className="mobile-app-shell role-mobile-shell mobile-customer-subpage">
        <header className="role-mobile-topbar">
          <MobileBackButton fallback="/mobile/customer" />
          <div><strong>{page.title}</strong><span>{page.subtitle}</span></div>
          <span className="role-mobile-avatar">{page.icon}</span>
        </header>

        <section className={`customer-native-hero ${section}`}>
          <span>{page.eyebrow}</span>
          <h1>{section === "payments" ? `${money(wallet.balanceCredits)} available.` : section === "issues" ? `${activeIssues.length} active follow-up${activeIssues.length === 1 ? "" : "s"}.` : page.title}</h1>
          <p>{address}</p>
        </section>

        {visibleMessage && <div className="customer-native-message">{visibleMessage}<button onClick={() => { setMessage(""); billing.clearMessage(); wallet.clearMessage(); }}>×</button></div>}

        {section === "services" && <section className="customer-service-stack">
          {next ? <article className="customer-next-card"><span>Next appointment</span><strong>{niceDate(next.scheduledDate)}</strong><p>{next.serviceName} · {next.crewName || "Crew pending"}</p><div><b>{next.status}</b><small>{next.address || address}</small></div></article> : <Empty icon="◷" title="Waiting for scheduling" text="Your next connected visit will appear here." />}
          <h2>Current services</h2>
          {activeVisits.map((item) => <CustomerRow key={item.id} icon="•" title={item.serviceName} subtitle={niceDate(item.scheduledDate)} status={item.status} onClick={() => setOpen(item.id)} />)}
        </section>}

        {section === "history" && <section className="customer-native-list customer-service-history">
          {history.map((item) => <article key={item.id} className={open === item.id ? "open" : ""}><button onClick={() => setOpen(open === item.id ? "" : item.id)}><i>✓</i><div><strong>{item.serviceName}</strong><span>{niceDate(item.scheduledDate)} · {item.crewName || "Crew"}</span></div><b>›</b></button>{open === item.id && <div className="customer-row-detail"><p>{item.customerVisibleSummary || item.employeeNotes || "Service completed."}</p><span>{item.address || address}</span></div>}</article>)}
          {!history.length && <Empty icon="↶" title="No completed services" text="Completed visits will appear here." />}
        </section>}

        {section === "estimates" && <section className="customer-document-list">
          {board.quotes.map((quote) => <article key={quote.id}><header><div><span>{quote.quoteNumber}</span><strong>{quote.serviceName || "Property service"}</strong><small>{new Date(quote.createdAt).toLocaleDateString("en-CA")} · {quote.status}</small></div><b>{money(quote.total)}</b></header><p>{quote.notes || quote.address || address}</p></article>)}
          {!board.quotes.length && <Empty icon="▤" title="No estimates" text="Quotes connected to your account will appear here." />}
        </section>}

        {section === "invoices" && <section className="customer-document-list">
          {billing.invoices.map((item) => <article key={item.id}><header><div><span>{item.number}</span><strong>{item.service}</strong><small>{new Date(item.createdAt).toLocaleDateString("en-CA")}</small></div><b>{money(item.total)}</b></header><div className="customer-invoice-status"><span>{item.status.replaceAll("_", " ")}</span><small>{item.status === "paid" ? "Confirmed" : "Awaiting payment"}</small></div>{item.status !== "paid" && <button className="customer-pay-button" disabled={billing.payingId === item.id || billing.source !== "live"} onClick={() => void billing.checkout(item.id)}>{billing.payingId === item.id ? "Opening Stripe..." : "Pay by card"}</button>}</article>)}
          {billing.loading ? <Empty icon="…" title="Loading invoices" text="Checking connected billing records." /> : !billing.invoices.length && <Empty icon="≡" title="No invoices" text="Invoices connected to your account will appear here." />}
        </section>}

        {section === "payments" && <section className="customer-payment-native">
          <div className="customer-balance-grid"><article><span>Available balance</span><strong>{wallet.loading ? "…" : money(wallet.balanceCredits)}</strong><small>Real funds for services and tips</small></article><article><span>Amount due</span><strong>{money(billing.summary.due)}</strong><small>{billing.summary.paidCount} paid invoices</small></article></div>
          <h2>Add funds</h2>
          <div className="customer-wallet-topups">{[10, 20, 50, 100].map((amount) => { const selected = !editingAmount && selectedDeposit === amount; return <button key={amount} className={selected ? "selected" : ""} disabled={wallet.openingCredits > 0} onClick={() => chooseDeposit(amount)}><strong>{selected ? `✓ $${amount}` : `$${amount}`}</strong><span>CAD</span></button>; })}<button className={editingAmount ? "selected" : ""} disabled={wallet.openingCredits > 0} onClick={chooseCustom}><strong>Custom</strong><span>Choose amount</span></button></div>
          {editingAmount && <div className="customer-wallet-custom"><span>$</span><input aria-label="Custom deposit amount" type="number" min={5} max={1000} step={1} placeholder="Enter amount" value={customAmount} onChange={(event) => setCustomAmount(event.target.value)} />{customAmount && !validCustom && <small>Enter $5–$1,000 CAD</small>}</div>}
          <div className="customer-wallet-total"><span>Deposit amount</span><strong>{money(depositAmount)}</strong><button disabled={wallet.openingCredits > 0 || depositAmount < 5 || depositAmount > 1000} onClick={addFunds}>{wallet.openingCredits > 0 ? "Opening Stripe..." : "Continue to payment"}</button></div>
          <p className="customer-wallet-note">Deposited funds stay synchronized across mobile and desktop.</p>

          <h2>Balance history</h2>
          {wallet.transactions.length ? <><div className="customer-wallet-history-box"><div className="customer-wallet-history">{wallet.transactions.slice(0, 10).map((item) => <article key={item.id}><div><strong>{item.description || item.type}</strong><span>{new Date(item.createdAt).toLocaleDateString("en-CA")}</span></div><b>{item.credits > 0 ? "+" : ""}{money(item.credits)}</b></article>)}</div></div><div className="customer-history-footer"><small>Showing up to 10 transactions</small>{wallet.transactions.length > 10 && <Link href="/mobile/customer/balance-history">Open full history →</Link>}</div></> : <Empty icon="$" title="No balance activity" text="Deposits and account payments will appear here." />}
        </section>}

        {section === "issues" && <section className="customer-native-list">{board.tasks.map((item) => <article key={item.id}><button onClick={() => setOpen(open === item.id ? "" : item.id)}><i>↺</i><div><strong>{item.title}</strong><span>{item.status} · {niceDate(item.scheduledDate)}</span></div><b>›</b></button>{open === item.id && <div className="customer-row-detail"><p>{item.customerIssue}</p>{item.completionSummary && <span>{item.completionSummary}</span>}</div>}</article>)}{!board.tasks.length && <Empty icon="✓" title="No return visits" text="Your connected follow-up list is clear." />}</section>}

        {section === "profile" && <section className="customer-profile-native"><div className="customer-property-photo">{photoHistory?.profilePhotoUrl ? <img src={photoHistory.profilePhotoUrl} alt="Property" /> : <span>🏠</span>}</div><label>Official property photo<input type="file" accept="image/*" onChange={upload} /></label>{board.property ? <dl><div><dt>Name</dt><dd>{board.property.customerName}</dd></div><div><dt>Address</dt><dd>{board.property.address}</dd></div><div><dt>City</dt><dd>{board.property.city}, {board.property.province}</dd></div><div><dt>Postal code</dt><dd>{board.property.postalCode || "Not set"}</dd></div><div><dt>Lot size</dt><dd>{board.property.lotSize || "Not set"}</dd></div><div><dt>Access notes</dt><dd>{board.property.accessNotes || "No special access note"}</dd></div></dl> : <Empty icon="○" title="Property not connected" text="Your quote information has not been linked to this login yet." />}</section>}

        {section === "feedback" && <section className="customer-native-list">{history.map((item) => { const review = board.feedback.find((value) => value.visitId === item.id); return <CustomerRow key={item.id} icon={review ? "✓" : "★"} title={item.serviceName} subtitle={review ? `${review.rating || 0} stars · ${review.comment || "Reviewed"}` : "Waiting for your review"} status={niceDate(item.scheduledDate)} onClick={() => router.push("/mobile/customer")} />; })}{!history.length && <Empty icon="★" title="Nothing to review" text="Completed services will appear here." />}</section>}

        {section === "more" && <section className="customer-more-grid">{[["History", "↶", "history"], ["Estimates", "▤", "estimates"], ["Invoices", "≡", "invoices"], ["Feedback", "★", "feedback"], ["Return Visits", "!", "issues"], ["Profile", "○", "profile"]].map(([label, icon, path]) => <button key={path} onClick={() => router.push(`/mobile/customer/${path}`)}><i>{icon}</i><strong>{label}</strong><span>Open ›</span></button>)}</section>}

        <MobileCustomerNav active={activeNav} />
      </main>
    </MobileRoleGuard>
  );
}

function niceDate(value?: string | null) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }) : "Pending";
}

function Empty({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="customer-native-empty"><i>{icon}</i><strong>{title}</strong><p>{text}</p></div>;
}

function CustomerRow({ icon, title, subtitle, status, onClick }: { icon: string; title: string; subtitle: string; status: string; onClick: () => void }) {
  return <article><button onClick={onClick}><i>{icon}</i><div><strong>{title}</strong><span>{subtitle}</span></div><em>{status}</em></button></article>;
}
