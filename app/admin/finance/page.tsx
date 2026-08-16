"use client";

import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { ContractPaymentsWorkspace } from "@/components/payments/ContractPaymentsWorkspace";
import styles from "@/components/payments/ContractPaymentsWorkspace.module.css";

type View = "payments";

export default function Finance() {
  const view: View = "payments";

  return (
    <AdminShell active="Payments">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div className={styles.tabs} style={{ width: "fit-content" }}>
          <button type="button" className={view === "payments" ? styles.active : ""}>Payments & Contracts</button>
        </div>
        <Link href="/admin/finance/actions" className={styles.button} style={{ textDecoration: "none" }}>Payment Actions</Link>
      </div>

      <ContractPaymentsWorkspace scope="company" />
    </AdminShell>
  );
}
