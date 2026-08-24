"use client";

import Link from "next/link";
import { RoleGuard } from "@/components/auth/RoleGuard";
import { ContractPaymentsWorkspace } from "@/components/payments/ContractPaymentsWorkspace";
import { MasterManualInvoiceWorkspace } from "@/components/payments/MasterManualInvoiceWorkspace";
import { MasterPayoutReconciliation } from "@/components/payments/MasterPayoutReconciliation";
import { PaymentDisputeWorkspace } from "@/components/payments/PaymentDisputeWorkspace";

export default function MasterPaymentsPage(){return <RoleGuard allowed={["master"]}><main style={{minHeight:"100vh",padding:"24px",background:"#f4f8f5"}}><div style={{maxWidth:1500,margin:"0 auto"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}><Link href="/master" style={{color:"#0d6844",fontWeight:900,textDecoration:"none"}}>← Master Control Plane</Link><span style={{color:"#73827a",fontSize:12}}>Platform-wide billing oversight</span></div><div style={{marginBottom:16,padding:"14px 16px",borderRadius:16,background:"#fff8e8",border:"1px solid #f1d699",color:"#6b4c0f"}}><strong>Manual billing is Master-only.</strong><div style={{marginTop:4,fontSize:13}}>Company Admins cannot create standalone payment requests. Every extra invoice below is tied to a completed Visit, audited, and sent through the secure customer invoice flow.</div></div><MasterPayoutReconciliation/><MasterManualInvoiceWorkspace/><PaymentDisputeWorkspace scope="master"/><ContractPaymentsWorkspace scope="master"/></div></main></RoleGuard>}
