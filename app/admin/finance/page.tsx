"use client";

import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ContractPaymentsWorkspace } from "@/components/payments/ContractPaymentsWorkspace";
import { CompanyStripeConnectCard } from "@/components/payments/CompanyStripeConnectCard";
import { CompanyReceivablesWorkspace } from "@/components/payments/CompanyReceivablesWorkspace";
import { PaymentDisputeWorkspace } from "@/components/payments/PaymentDisputeWorkspace";
import styles from "@/components/payments/ContractPaymentsWorkspace.module.css";

export default function Finance() {
  const [view, setView] = useState<"payments" | "receivables">("payments");

  return <AdminShell active="Payments">
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:16,flexWrap:"wrap"}}>
      <div className={styles.tabs} style={{width:"fit-content"}}>
        <button type="button" className={view === "payments" ? styles.active : ""} onClick={() => setView("payments")}>Payments & Contracts</button>
        <button type="button" className={view === "receivables" ? styles.active : ""} onClick={() => setView("receivables")}>Receivables</button>
      </div>
    </div>

    {view === "payments" ? <>
      <ContractPaymentsWorkspace scope="company" />
      <PaymentDisputeWorkspace scope="company" />
    </> : <>
      <CompanyStripeConnectCard />
      <CompanyReceivablesWorkspace />
    </>}
  </AdminShell>;
}
