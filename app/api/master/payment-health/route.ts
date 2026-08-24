import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";
type Status = "healthy" | "warning" | "critical";

function worst(statuses: Status[]): Status {
  return statuses.includes("critical") ? "critical" : statuses.includes("warning") ? "warning" : "healthy";
}
function countBy(rows: any[], key: string) {
  return rows.reduce<Record<string, number>>((acc, row) => { const v = String(row?.[key] ?? "unknown"); acc[v] = (acc[v] || 0) + 1; return acc; }, {});
}

async function requireMaster(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Payment Health database access is not configured.");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } }) as any;
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error: profileError } = await authClient.from("profiles").select("id,role,active").eq("id", auth.user.id).maybeSingle();
  if (profileError || !profile?.active || profile.role !== "master") throw new Error("Only an active Master can view Payment Health.");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

export async function GET(request: NextRequest) {
  try {
    const db = await requireMaster(request);
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    let stripeReachable = false;
    let stripeMode: "live" | "test" | "unavailable" = "unavailable";
    let stripeError: string | null = null;
    if (stripeKey) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
        const balance = await stripe.balance.retrieve();
        stripeReachable = true;
        stripeMode = (balance as Stripe.Balance & { livemode?: boolean }).livemode ? "live" : "test";
      } catch (error) { stripeError = error instanceof Error ? error.message.slice(0, 300) : "Stripe API could not be reached."; }
    }

    const [orgsR,invoicesR,paymentsR,webhooksR,agreementsR,cyclesR,eventsR,payoutsR,balancesR,withdrawalsR] = await Promise.all([
      db.from("organizations").select("id,active,stripe_connect_status,stripe_connected_account_id,stripe_payouts_enabled_at,stripe_payout_schedule").is("deleted_at", null).limit(5000),
      db.from("invoices").select("id,status,total,created_at,stripe_payment_intent_id,stripe_checkout_session_id,billing_cycle_id,billing_event_id,visit_id").order("created_at", { ascending:false }).limit(5000),
      db.from("payments").select("id,status,amount,invoice_id,stripe_payment_intent_id,created_at").order("created_at", { ascending:false }).limit(5000),
      db.from("stripe_webhook_events").select("event_id,event_type,status,attempts,last_error,received_at,processed_at").order("received_at", { ascending:false }).limit(250),
      db.from("billing_agreements").select("id,active,payment_status,collection_timing,billing_model,service_frequency,stripe_sync_status").eq("active", true).limit(5000),
      db.from("billing_cycles").select("id,state,charge_due_on,last_error,created_at").order("created_at", { ascending:false }).limit(5000),
      db.from("visit_billing_events").select("id,state,visit_id,last_error,created_at").order("created_at", { ascending:false }).limit(5000),
      db.from("company_payout_items").select("id,status,invoice_id,payment_id,transfer_amount,stripe_transfer_id,created_at").order("created_at", { ascending:false }).limit(5000),
      db.from("company_balance_entries").select("id,company_id,state,amount_cents,paid_out_cents,reserved_cents,stripe_transfer_id,released_at,created_at,updated_at").order("created_at", { ascending:false }).limit(5000),
      db.from("company_withdrawals").select("id,company_id,status,amount_cents,stripe_payout_id,requested_at,processed_at,paid_at,failure_message").order("requested_at", { ascending:false }).limit(3000),
    ]);
    for (const r of [orgsR,invoicesR,paymentsR,webhooksR,agreementsR,cyclesR,eventsR,payoutsR,balancesR,withdrawalsR]) if (r.error) throw new Error(r.error.message);

    const orgs=orgsR.data||[], invoices=invoicesR.data||[], payments=paymentsR.data||[], webhooks=webhooksR.data||[], agreements=agreementsR.data||[], cycles=cyclesR.data||[], events=eventsR.data||[], payouts=payoutsR.data||[], balances=balancesR.data||[], withdrawals=withdrawalsR.data||[];
    const paidByInvoice = new Map<string,any>(); payments.forEach((p:any)=>{if(p.invoice_id&&p.status==="paid") paidByInvoice.set(String(p.invoice_id),p);});
    const paidWithoutPayment=invoices.filter((i:any)=>i.status==="paid"&&!paidByInvoice.has(String(i.id)));
    const mismatches=invoices.filter((i:any)=>i.status==="paid"&&paidByInvoice.has(String(i.id))&&Math.abs(Number(i.total)-Number(paidByInvoice.get(String(i.id)).amount))>.009);
    const failedWebhooks=webhooks.filter((e:any)=>e.status==="failed");
    const staleWebhook=webhooks.filter((e:any)=>e.status==="processing"&&Date.parse(e.received_at)<Date.now()-10*60*1000);
    const monthly=agreements.filter((a:any)=>a.service_frequency==="monthly"&&a.collection_timing==="period_prepaid"&&a.billing_model==="monthly_fixed_subscription");
    const perVisit=agreements.filter((a:any)=>["one_time","weekly","biweekly","custom"].includes(String(a.service_frequency))&&a.collection_timing==="after_visit"&&["per_visit_fixed_payout","per_visit_percentage_fee"].includes(String(a.billing_model)));
    const invalidAgreements=agreements.filter((a:any)=>a.payment_status==="active"&&!monthly.includes(a)&&!perVisit.includes(a)&&a.collection_timing!=="manual");
    const failedCycles=cycles.filter((c:any)=>c.state==="payment_failed");
    const failedVisits=events.filter((e:any)=>e.state==="charge_failed");
    const connectEnabled=orgs.filter((o:any)=>o.active!==false&&o.stripe_connect_status==="enabled"&&o.stripe_connected_account_id&&o.stripe_payouts_enabled_at).length;
    const activeCompanies=orgs.filter((o:any)=>o.active!==false).length;
    const manualSchedules=orgs.filter((o:any)=>o.stripe_connect_status==="enabled"&&o.stripe_payout_schedule==="manual").length;
    const impossibleBalance=balances.filter((b:any)=>Number(b.paid_out_cents||0)+Number(b.reserved_cents||0)>Number(b.amount_cents||0));
    const staleTransfers=balances.filter((b:any)=>b.state==="transferring"&&Date.parse(b.updated_at)<Date.now()-30*60*1000);
    const oldAvailable=balances.filter((b:any)=>b.state==="available"&&b.released_at&&Date.parse(b.released_at)<Date.now()-75*86400000);
    const failedWithdrawals=withdrawals.filter((w:any)=>w.status==="failed");
    const staleWithdrawals=withdrawals.filter((w:any)=>w.status==="processing"&&Date.parse(w.requested_at)<Date.now()-7*86400000);
    const transferredMissingId=payouts.filter((p:any)=>p.status==="transferred"&&!p.stripe_transfer_id);

    const stages:Array<{key:string;label:string;status:Status;detail:string}>=[];
    stages.push({key:"stripe",label:"Stripe API & webhooks",status:stripeReachable&&Boolean(process.env.STRIPE_WEBHOOK_SECRET)?"healthy":"critical",detail:stripeReachable?`Stripe ${stripeMode.toUpperCase()} reachable.`:stripeError||"Stripe unreachable."});
    stages.push({key:"billing",label:"Customer billing modes",status:invalidAgreements.length?"critical":failedCycles.length||failedVisits.length?"warning":"healthy",detail:`${perVisit.length} per-Visit agreement(s), ${monthly.length} monthly agreement(s), ${invalidAgreements.length} invalid active agreement(s).`});
    stages.push({key:"invoice",label:"Invoice → Payment",status:paidWithoutPayment.length||mismatches.length?"critical":"healthy",detail:`${invoices.length} invoice(s), ${payments.length} payment(s), ${paidWithoutPayment.length} paid invoice(s) without payment ledger.`});
    stages.push({key:"webhook",label:"Stripe reconciliation",status:failedWebhooks.length||staleWebhook.length?"critical":"healthy",detail:`${failedWebhooks.length} failed and ${staleWebhook.length} stale webhook event(s).`});
    stages.push({key:"connect",label:"Company Stripe Connect",status:activeCompanies>0&&connectEnabled===0?"critical":connectEnabled<activeCompanies||manualSchedules<connectEnabled?"warning":"healthy",detail:`${connectEnabled}/${activeCompanies} active company account(s) payout-enabled; ${manualSchedules} use protected manual payout schedule.`});
    stages.push({key:"balance",label:"Company receivables ledger",status:impossibleBalance.length||staleTransfers.length||transferredMissingId.length?"critical":oldAvailable.length?"warning":"healthy",detail:`${balances.length} ledger entry(s), ${staleTransfers.length} stale transfer(s), ${oldAvailable.length} balance(s) near safety-payout threshold.`});
    stages.push({key:"withdrawal",label:"On-demand withdrawals",status:failedWithdrawals.length?"critical":staleWithdrawals.length?"warning":"healthy",detail:`${withdrawals.length} withdrawal(s), ${failedWithdrawals.length} failed, ${staleWithdrawals.length} stale processing.`});

    const issues:Array<{severity:Status;code:string;message:string}>=[];
    if(!stripeReachable)issues.push({severity:"critical",code:"stripe_unreachable",message:stripeError||"Stripe API is not reachable."});
    if(!process.env.STRIPE_WEBHOOK_SECRET)issues.push({severity:"critical",code:"webhook_secret_missing",message:"STRIPE_WEBHOOK_SECRET is missing."});
    if(!process.env.STRIPE_CONNECT_WEBHOOK_SECRET)issues.push({severity:"warning",code:"connect_webhook_missing",message:"STRIPE_CONNECT_WEBHOOK_SECRET is missing; account status relies on active refresh."});
    if(!process.env.CRON_SECRET)issues.push({severity:"critical",code:"cron_secret_missing",message:"CRON_SECRET is missing; billing and receivables reconciliation cannot run safely."});
    if(invalidAgreements.length)issues.push({severity:"critical",code:"invalid_billing_mode",message:`${invalidAgreements.length} active agreement(s) do not match canonical per-Visit/monthly billing rules.`});
    if(paidWithoutPayment.length)issues.push({severity:"critical",code:"invoice_without_payment",message:`${paidWithoutPayment.length} paid invoice(s) have no matching paid payment record.`});
    if(mismatches.length)issues.push({severity:"critical",code:"amount_mismatch",message:`${mismatches.length} invoice/payment amount mismatch(es).`});
    if(failedWebhooks.length)issues.push({severity:"critical",code:"failed_webhook",message:`${failedWebhooks.length} Stripe webhook event(s) failed reconciliation.`});
    if(impossibleBalance.length)issues.push({severity:"critical",code:"ledger_overallocated",message:`${impossibleBalance.length} company balance entry/entries are over-allocated.`});
    if(staleTransfers.length)issues.push({severity:"critical",code:"stale_transfer",message:`${staleTransfers.length} company earning transfer(s) are stuck in processing.`});
    if(failedWithdrawals.length)issues.push({severity:"critical",code:"withdrawal_failed",message:`${failedWithdrawals.length} company withdrawal(s) failed and need review.`});
    if(oldAvailable.length)issues.push({severity:"warning",code:"manual_payout_age",message:`${oldAvailable.length} available balance entry/entries reached the 75-day safety threshold.`});

    return NextResponse.json({generatedAt:new Date().toISOString(),overallStatus:worst(stages.map(s=>s.status)),stripe:{reachable:stripeReachable,mode:stripeMode,error:stripeError},stages,issues,metrics:{activeCompanies,connectEnabled,manualSchedules,invoices:countBy(invoices,"status"),payments:countBy(payments,"status"),webhooks:countBy(webhooks,"status"),agreements:{active:agreements.length,perVisit:perVisit.length,monthly:monthly.length,invalid:invalidAgreements.length},cycles:countBy(cycles,"state"),visitBilling:countBy(events,"state"),payoutItems:countBy(payouts,"status"),companyBalance:countBy(balances,"state"),withdrawals:countBy(withdrawals,"status"),reconciliation:{paidWithoutPayment:paidWithoutPayment.length,amountMismatches:mismatches.length,staleTransfers:staleTransfers.length,oldAvailable:oldAvailable.length}}});
  } catch (error) {
    console.error("Payment Health failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment Health could not be loaded." }, { status: 401 });
  }
}
