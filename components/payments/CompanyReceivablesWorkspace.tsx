"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./CompanyReceivablesWorkspace.module.css";

type Entry = {
  id: string;
  customerName: string;
  visit_id?: string | null;
  amount_cents: number;
  outstandingCents: number;
  state: string;
  hold_reason?: string | null;
  stripe_transfer_id?: string | null;
  released_at?: string | null;
  created_at: string;
};

type Withdrawal = {
  id: string;
  amount_cents: number;
  status: string;
  system_generated: boolean;
  stripe_payout_id?: string | null;
  estimated_arrival_at?: string | null;
  failure_message?: string | null;
  requested_at: string;
  paid_at?: string | null;
};

type Snapshot = {
  company: { id: string; name: string };
  stripe: { status: string; payoutSchedule?: string | null; availableCents: number; pendingCents: number; error?: string | null };
  balances: { pendingCents: number; internalAvailableCents: number; processingCents: number; paidOutCents: number; withdrawableCents: number };
  reconciliation: { safe: boolean; stripeDifferenceCents: number; note: string };
  ledger: Entry[];
  withdrawals: Withdrawal[];
  generatedAt: string;
};

function money(cents = 0) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

function date(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function statusClass(state: string) {
  if (state === "available" || state === "release_ready") return styles.available;
  if (["pending", "hold"].includes(state)) return styles.hold;
  if (["reserved", "processing", "transferring"].includes(state)) return styles.processing;
  if (["paid", "paid_out"].includes(state)) return styles.paid;
  if (["failed", "reversed", "disputed"].includes(state)) return styles.issue;
  return "";
}

export function CompanyReceivablesWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("");
  const [historyTab, setHistoryTab] = useState<"earnings" | "withdrawals">("earnings");

  const token = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || "";
  }, []);

  const load = useCallback(async () => {
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Sign in as Company Admin.");
      const response = await fetch("/api/company/receivables", {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Receivables could not be loaded.");
      setSnapshot(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Receivables could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  const requestedCents = useMemo(() => Math.round(Number(amount || 0) * 100), [amount]);
  const maxCents = snapshot?.balances.withdrawableCents || 0;
  const validAmount = Number.isSafeInteger(requestedCents) && requestedCents >= 100 && requestedCents <= maxCents;

  async function withdraw(event: FormEvent) {
    event.preventDefault();
    if (!validAmount) return;
    setBusy(true);
    setMessage("");
    try {
      const accessToken = await token();
      const response = await fetch("/api/company/receivables/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ amountCents: requestedCents }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Withdrawal could not be created.");
      setAmount("");
      setMessage(result.estimatedArrivalAt
        ? `Withdrawal submitted. Stripe estimates arrival around ${date(result.estimatedArrivalAt)}.`
        : "Withdrawal submitted to Stripe. Bank timing will update automatically.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Withdrawal could not be created.");
    } finally {
      setBusy(false);
    }
  }

  const balances = snapshot?.balances || { pendingCents: 0, internalAvailableCents: 0, processingCents: 0, paidOutCents: 0, withdrawableCents: 0 };
  const stripe = snapshot?.stripe || { status: "not_started", availableCents: 0, pendingCents: 0 };

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div className={styles.heroTop}>
        <div><span className={styles.eyebrow}>Company receivables</span><h1>Balance & Withdrawals</h1><p>Customer money is released only after payment and service checks. Withdrawals are capped by both the internal 4 Ever Seasons ledger and Stripe's actually available connected-account balance.</p></div>
        <div className={styles.secureBadge}><i className={styles.secureDot} />Stripe reconciliation active</div>
      </div>
      <div className={styles.metrics}>
        <article className={styles.metric}><span>Pending / Hold</span><strong>{money(balances.pendingCents)}</strong><small>Waiting for service, feedback, Task resolution or Stripe release.</small></article>
        <article className={styles.metric}><span>Available</span><strong>{money(balances.withdrawableCents)}</strong><small>Safe amount you can request right now.</small></article>
        <article className={styles.metric}><span>Processing</span><strong>{money(balances.processingCents)}</strong><small>Already reserved for a bank payout.</small></article>
        <article className={styles.metric}><span>Paid out</span><strong>{money(balances.paidOutCents)}</strong><small>Completed withdrawals recorded by the platform.</small></article>
      </div>
    </section>

    <section className={styles.grid}>
      <div className={styles.panel}>
        <header className={styles.panelHeader}><div><span>Safe withdrawal</span><h2>Withdraw available funds</h2><p>You may request any amount up to the safe available balance. The server re-checks Stripe before every payout and rejects anything above either balance.</p></div><button className={styles.secondary} type="button" onClick={() => void load()} disabled={loading}>{loading ? "Syncing…" : "Refresh"}</button></header>
        <div className={styles.withdrawCard}>
          <div className={styles.balanceLine}>
            <div><span>Maximum withdrawable now</span><strong>{money(maxCents)}</strong></div>
            <div className={styles.stripeMini}><span>Stripe connected account</span><strong>{money(stripe.availableCents)} available · {money(stripe.pendingCents)} pending</strong></div>
          </div>
          <form className={styles.form} onSubmit={withdraw}>
            <div className={styles.inputWrap}><b>$</b><input className={styles.input} type="number" min="1" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div>
            <button className={styles.secondary} type="button" disabled={maxCents < 100} onClick={() => setAmount((maxCents / 100).toFixed(2))}>Use max</button>
            <button className={styles.button} type="submit" disabled={!validAmount || busy || stripe.status !== "enabled"}>{busy ? "Submitting…" : "Withdraw funds"}</button>
          </form>
          <div className={styles.note}>No company user can manually release held earnings. Only the automated audit or an authenticated Master override can move a hold toward release. Stripe still performs its own available-balance check before the bank payout.</div>
        </div>
        {message && <div className={styles.message}>{message}</div>}
        {snapshot && <div className={`${styles.reconcile} ${!snapshot.reconciliation.safe ? styles.warning : ""}`}><strong>Reconciliation:</strong> {snapshot.reconciliation.note}</div>}
      </div>

      <aside className={styles.side}>
        <section className={styles.sideCard}><span>Money flow</span><h3>Protected by two balances</h3><p>The platform ledger decides what the company has earned. Stripe decides what has actually settled and can leave the connected account. The withdrawal limit is always the lower of those two numbers.</p><dl><div><dt>Ledger available</dt><dd>{money(balances.internalAvailableCents)}</dd></div><div><dt>Stripe available</dt><dd>{money(stripe.availableCents)}</dd></div><div><dt>Payout schedule</dt><dd>{stripe.payoutSchedule || "manual"}</dd></div></dl></section>
      </aside>
    </section>

    <section className={styles.panel}>
      <header className={styles.panelHeader}><div><span>Audit history</span><h2>Every dollar has a source</h2><p>See why money is pending, available, processing or paid. Company users cannot edit these records.</p></div><div className={styles.tabs}><button type="button" className={`${styles.tab} ${historyTab === "earnings" ? styles.tabActive : ""}`} onClick={() => setHistoryTab("earnings")}>Earnings</button><button type="button" className={`${styles.tab} ${historyTab === "withdrawals" ? styles.tabActive : ""}`} onClick={() => setHistoryTab("withdrawals")}>Withdrawals</button></div></header>
      {historyTab === "earnings" ? <div className={styles.list}>
        {!snapshot?.ledger.length ? <div className={styles.empty}>No receivable activity yet.</div> : snapshot.ledger.map((entry) => <article className={styles.row} key={entry.id}>
          <div className={styles.rowMain}><div className={styles.icon}>$</div><div className={styles.rowText}><strong>{entry.customerName}</strong><span>{entry.visit_id ? `Visit ${entry.visit_id.slice(0, 8)}` : "Service period / invoice"}</span><small>{date(entry.created_at)}{entry.hold_reason ? ` · ${entry.hold_reason}` : ""}</small></div></div>
          <div className={styles.rowRight}><strong>{money(entry.outstandingCents || entry.amount_cents)}</strong><em className={`${styles.pill} ${statusClass(entry.state)}`}>{entry.state.replaceAll("_", " ")}</em></div>
        </article>)}
      </div> : <div className={`${styles.list} ${styles.withdrawHistory}`}>
        {!snapshot?.withdrawals.length ? <div className={styles.empty}>No withdrawals yet.</div> : snapshot.withdrawals.map((withdrawal) => <article className={styles.row} key={withdrawal.id}>
          <div className={styles.rowMain}><div className={styles.icon}>↗</div><div className={styles.rowText}><strong>{withdrawal.system_generated ? "Safety payout" : "Bank withdrawal"}</strong><span>{withdrawal.stripe_payout_id || "Stripe payout pending"}</span><small>{date(withdrawal.requested_at)}{withdrawal.estimated_arrival_at ? ` · estimated ${date(withdrawal.estimated_arrival_at)}` : ""}{withdrawal.failure_message ? ` · ${withdrawal.failure_message}` : ""}</small></div></div>
          <div className={styles.rowRight}><strong>{money(withdrawal.amount_cents)}</strong><em className={`${styles.pill} ${statusClass(withdrawal.status)}`}>{withdrawal.status}</em></div>
        </article>)}
      </div>}
    </section>
  </div>;
}
