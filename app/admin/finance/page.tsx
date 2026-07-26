"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import { ContractPaymentsWorkspace } from "@/components/payments/ContractPaymentsWorkspace";
import styles from "@/components/payments/ContractPaymentsWorkspace.module.css";

type View = "payments";

export default function Finance() {
  const view: View = "payments";

  return (
    <AdminShell active="Payments">
      <div className={styles.tabs} style={{ marginBottom: 16, width: "fit-content" }}>
        <button type="button" className={view === "payments" ? styles.active : ""}>Payments & Contracts</button>
      </div>

      <ContractPaymentsWorkspace scope="company" />
    </AdminShell>
  );
}
