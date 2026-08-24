"use client";

import { CompanyReceivablesWorkspace } from "@/components/payments/CompanyReceivablesWorkspace";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";

export default function MobileAdminReceivablesPage() {
  return <MobileRoleGuard allowed={["admin"]}>
    <main className="mobile-app-shell role-mobile-shell mobile-admin-receivables-page">
      <header className="role-mobile-topbar">
        <MobileBackButton fallback="/mobile/admin" />
        <div><strong>Receivables</strong><span>Balance, earnings and withdrawals</span></div>
        <span className="role-mobile-avatar">$</span>
      </header>
      <section className="mobile-admin-receivables-intro">
        <span>YOUR COMPANY BALANCE</span>
        <h1>Know what is available.</h1>
        <p>See pending earnings, available balance, processing withdrawals and completed payouts in one place.</p>
      </section>
      <section className="mobile-admin-receivables-content"><CompanyReceivablesWorkspace /></section>
      <style jsx global>{`
        .mobile-admin-receivables-page{min-height:100dvh;overflow-x:hidden;padding-bottom:max(24px,env(safe-area-inset-bottom));background:#f3f7f4}
        .mobile-admin-receivables-intro{margin:14px 14px 0;padding:20px;border-radius:22px;background:linear-gradient(135deg,#0a3427,#11764b);color:#fff;box-shadow:0 18px 42px rgba(10,52,39,.2)}
        .mobile-admin-receivables-intro span{display:block;color:#9ee2bc;font-size:10px;font-weight:950;letter-spacing:.12em}
        .mobile-admin-receivables-intro h1{margin:8px 0 7px;font-size:clamp(30px,9vw,42px);line-height:.98;letter-spacing:-.055em}
        .mobile-admin-receivables-intro p{margin:0;color:rgba(255,255,255,.72);font-size:13px;line-height:1.55}
        .mobile-admin-receivables-content{padding:14px}
        @media(min-width:760px){.mobile-admin-receivables-intro,.mobile-admin-receivables-content{width:min(900px,calc(100% - 32px));margin-left:auto;margin-right:auto}}
      `}</style>
    </main>
  </MobileRoleGuard>;
}
