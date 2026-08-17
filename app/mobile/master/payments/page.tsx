"use client";

import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { PaymentDisputeWorkspace } from "@/components/payments/PaymentDisputeWorkspace";
import { ContractPaymentsWorkspace } from "@/components/payments/ContractPaymentsWorkspace";

export default function MobileMasterPayments(){return <MobileRoleGuard allowed={["master"]}><main className="mobile-app-shell role-mobile-shell mobile-master-payments"><header className="role-mobile-topbar"><MobileBackButton fallback="/mobile/master"/><div><strong>Master Payments</strong><span>Disputes & platform finance</span></div><span className="role-mobile-avatar">!</span></header><section className="mmp-hero"><span>PLATFORM OVERSIGHT</span><h1>Payment disputes</h1><p>Every dispute is visible here. Company response deadline: 3 days.</p></section><section className="mmp-content"><PaymentDisputeWorkspace scope="master"/><ContractPaymentsWorkspace scope="master"/></section><style jsx global>{`.mobile-master-payments{min-height:100dvh;background:#f3f7f4;padding-bottom:28px}.mmp-hero{margin:14px;padding:20px;border-radius:22px;background:linear-gradient(135deg,#202d26,#816416);color:#fff}.mmp-hero span{font-size:9px;font-weight:950;letter-spacing:.12em;color:#f5d981}.mmp-hero h1{margin:6px 0;font-size:34px}.mmp-hero p{margin:0;color:rgba(255,255,255,.75)}.mmp-content{padding:0 14px}.mmp-content>div>section:first-child{display:none}`}</style></main></MobileRoleGuard>}
