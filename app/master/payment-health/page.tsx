"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./payment-health.module.css";

type HealthStatus = "healthy" | "warning" | "critical";
type HealthData = {
  generatedAt: string;
  overallStatus: HealthStatus;
  stripe: { reachable: boolean; mode: "live" | "test" | "unavailable"; error: string | null };
  config: Record<string, boolean>;
  stages: Array<{ key: string; label: string; status: HealthStatus; detail: string }>;
  issues: Array<{ severity: HealthStatus; code: string; message: string }>;
  metrics: {
    organizations: number;
    activeCompanies: number;
    connectEnabled: number;
    connectStatus: Record<string, number>;
    invoices: Record<string, number>;
    payments: Record<string, number>;
    webhooks: Record<string, number>;
    agreements: { active: number; monthly: number; legacyRecurring: number };
    cycles: Record<string, number>;
    payouts: Record<string, number>;
    payoutBatches: Record<string, number>;
    reconciliation: { paidInvoicesWithoutPayment: number; amountMismatches: number; staleProcessing: number };
  };
  recentWebhookFailures: Array<{ eventType: string; attempts: number; error: string; receivedAt: string }>;
};

function statusLabel(status: HealthStatus) {
  if (status === "healthy") return "Healthy";
  if (status === "warning") return "Attention";
  return "Action required";
}

function entries(value: Record<string, number>) {
  const rows = Object.entries(value).sort((a, b) => b[1] - a[1]);
  return rows.length ? rows : [["none", 0] as [string, number]];
}

export default function PaymentHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Sign in as Master to view Payment Health.");
      const response = await fetch("/api/master/payment-health", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Payment Health could not be loaded.");
      setData(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment Health could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Master financial monitoring</span>
          <h1>Payment Health</h1>
          <p>Live end-to-end checks for monthly customer billing, Stripe Checkout, webhooks, invoice reconciliation, Stripe Connect and company payouts.</p>
        </div>
        <div className={styles.heroActions}>
          {data && <span className={`${styles.overall} ${styles[data.overallStatus]}`}>{statusLabel(data.overallStatus)}</span>}
          <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Checking…" : "Refresh now"}</button>
        </div>
      </section>

      {message && <div className={styles.message}>{message}</div>}

      {data && <>
        <section className={styles.topMetrics}>
          <article><span>Stripe</span><strong>{data.stripe.reachable ? data.stripe.mode.toUpperCase() : "OFFLINE"}</strong><small>{data.stripe.reachable ? "API reachable" : data.stripe.error || "Not configured"}</small></article>
          <article><span>Monthly contracts</span><strong>{data.metrics.agreements.monthly}</strong><small>{data.metrics.agreements.legacyRecurring} legacy recurring blocked</small></article>
          <article><span>Connect enabled</span><strong>{data.metrics.connectEnabled}/{data.metrics.activeCompanies}</strong><small>company accounts ready for transfer</small></article>
          <article><span>Reconciliation issues</span><strong>{data.metrics.reconciliation.paidInvoicesWithoutPayment + data.metrics.reconciliation.amountMismatches}</strong><small>{data.metrics.reconciliation.staleProcessing} stale checkout(s)</small></article>
        </section>

        <section className={styles.flow}>
          <header><span>End-to-end route</span><h2>Customer → Company payout</h2><p>Every stage is checked against live production state every 15 seconds.</p></header>
          <div className={styles.stageGrid}>
            {data.stages.map((stage, index) => <article key={stage.key} className={`${styles.stage} ${styles[stage.status]}`}>
              <div className={styles.stageTop}><b>{index + 1}</b><span>{statusLabel(stage.status)}</span></div>
              <strong>{stage.label}</strong>
              <p>{stage.detail}</p>
            </article>)}
          </div>
        </section>

        <section className={styles.twoColumn}>
          <article className={styles.panel}>
            <header><span>Blocking checks</span><h2>Issues</h2></header>
            {data.issues.length === 0 ? <div className={styles.clear}>✓ No billing blockers detected.</div> : <div className={styles.issueList}>
              {data.issues.map((issue) => <div key={`${issue.code}-${issue.message}`} className={`${styles.issue} ${styles[issue.severity]}`}>
                <span>{statusLabel(issue.severity)}</span><strong>{issue.message}</strong><small>{issue.code}</small>
              </div>)}
            </div>}
          </article>

          <article className={styles.panel}>
            <header><span>Production configuration</span><h2>Runtime checks</h2></header>
            <div className={styles.configList}>
              {Object.entries(data.config).map(([key, ok]) => <div key={key}><span>{key.replaceAll(/([A-Z])/g, " $1")}</span><strong className={ok ? styles.ok : styles.no}>{ok ? "Configured" : "Missing"}</strong></div>)}
            </div>
          </article>
        </section>

        <section className={styles.metricsPanel}>
          <header><span>Financial ledger</span><h2>Live status counts</h2></header>
          <div className={styles.metricGroups}>
            <MetricGroup title="Invoices" values={data.metrics.invoices} />
            <MetricGroup title="Payments" values={data.metrics.payments} />
            <MetricGroup title="Monthly cycles" values={data.metrics.cycles} />
            <MetricGroup title="Webhooks" values={data.metrics.webhooks} />
            <MetricGroup title="Payout items" values={data.metrics.payouts} />
            <MetricGroup title="Payout batches" values={data.metrics.payoutBatches} />
            <MetricGroup title="Stripe Connect" values={data.metrics.connectStatus} />
          </div>
        </section>

        {data.recentWebhookFailures.length > 0 && <section className={styles.panel}>
          <header><span>Stripe events</span><h2>Recent webhook failures</h2></header>
          <div className={styles.webhookList}>{data.recentWebhookFailures.map((event, index) => <article key={`${event.eventType}-${event.receivedAt}-${index}`}>
            <strong>{event.eventType}</strong><span>{new Date(event.receivedAt).toLocaleString("en-CA")}</span><small>{event.attempts} attempt(s) · {event.error}</small>
          </article>)}</div>
        </section>}

        <p className={styles.timestamp}>Last production check: {new Date(data.generatedAt).toLocaleString("en-CA")}</p>
      </>}
    </main>
  );
}

function MetricGroup({ title, values }: { title: string; values: Record<string, number> }) {
  return <article className={styles.metricGroup}><strong>{title}</strong>{entries(values).map(([key, value]) => <div key={key}><span>{key.replaceAll("_", " ")}</span><b>{value}</b></div>)}</article>;
}
