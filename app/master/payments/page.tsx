"use client";

import Link from "next/link";
import { RoleGuard } from "@/components/auth/RoleGuard";
import { ContractPaymentsWorkspace } from "@/components/payments/ContractPaymentsWorkspace";

export default function MasterPaymentsPage() {
  return (
    <RoleGuard allowed={["master"]}>
      <main style={{ minHeight: "100vh", padding: "24px", background: "#f4f8f5" }}>
        <div style={{ maxWidth: 1500, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <Link href="/master" style={{ color: "#0d6844", fontWeight: 900, textDecoration: "none" }}>← Master Control Plane</Link>
            <span style={{ color: "#73827a", fontSize: 12 }}>Platform-owned customer contracts</span>
          </div>
          <ContractPaymentsWorkspace scope="master" />
        </div>
      </main>
    </RoleGuard>
  );
}
