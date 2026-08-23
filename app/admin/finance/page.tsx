"use client";

import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { ContractPaymentsWorkspace } from "@/components/payments/ContractPaymentsWorkspace";
import { CompanyStripeConnectCard } from "@/components/payments/CompanyStripeConnectCard";
import { PaymentDisputeWorkspace } from "@/components/payments/PaymentDisputeWorkspace";
import styles from "@/components/payments/ContractPaymentsWorkspace.module.css";

export default function Finance() {
  return <AdminShell active="Payments">
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:16,flexWrap:"wrap"}}><div className={styles.tabs} style={{width:"fit-content"}}><button type="button" className={styles.active}>Payments & Contracts</button></div><Link href="/admin/finance/actions" className={styles.button} style={{textDecoration:"none"}}>Payment Actions</Link></div>
    <CompanyStripeConnectCard />
    <ContractPaymentsWorkspace scope="company" />
    <PaymentDisputeWorkspace scope="company" />
  </AdminShell>;
}
