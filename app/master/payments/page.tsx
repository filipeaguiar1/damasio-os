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
          <div style={{ marginBottom: 16, padding: "14px 16px", borderRadius: 16, background: "#fff8e8", border: "1px solid #f1d699", color: "#6b4c0f" }}>
            <strong>Stripe processing belongs to the platform.</strong>
            <div style={{ marginTop: 4, fontSize: 13 }}>Platform revenue is customer charge minus the exact company payout. Estimated domestic-card processing is 2.9% + CA$0.30 per successful transaction and is deducted only from the platform share. Actual Stripe fees remain the source of truth after settlement.</div>
          </div>
          <ContractPaymentsWorkspace scope="master" />
        </div>
      </main>
    </RoleGuard>
  );
}
