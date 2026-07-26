"use client";

import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { ContractPaymentsWorkspace } from "@/components/payments/ContractPaymentsWorkspace";

export default function Finance() {
  return (
    <AdminShell active="Payments">
      <ContractPaymentsWorkspace scope="company" />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Link className="btn btn-outline" href="/admin/invoices">Open full invoice manager</Link>
      </div>
    </AdminShell>
  );
}
