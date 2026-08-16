import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type PaymentActionCustomer = {
  id:string;
  name:string;
  email:string|null;
  origin:string;
  servicePaymentMethod:string|null;
};

export type PaymentActionInvoice = {
  id:string;
  customerId:string;
  propertyId:string|null;
  number:string;
  status:string;
  totalCents:number;
  createdAt:string;
  visitId:string|null;
  billingEventId:string|null;
  stripeCheckoutSessionId:string|null;
  stripePaymentIntentId:string|null;
};

export type PaymentActionWorkspace = { customers:PaymentActionCustomer[]; invoices:PaymentActionInvoice[] };

async function token(){
  const supabase=getSupabaseBrowserClient() as any;
  const {data}=await supabase.auth.getSession();
  const accessToken=data.session?.access_token;
  if(!accessToken)throw new Error("Your company session expired. Sign in again.");
  return accessToken;
}

export async function getPaymentActionWorkspace():Promise<PaymentActionWorkspace>{
  const supabase=getSupabaseBrowserClient() as any;
  const {data,error}=await supabase.rpc("get_payments_contract_workspace",{p_scope:"company"});
  if(error)throw new Error(error.message);
  return {
    customers:Array.isArray(data?.customers)?data.customers:[],
    invoices:Array.isArray(data?.invoices)?data.invoices:[],
  };
}

export async function createInvoicePaymentLink(invoiceId:string,{fresh=false}:{fresh?:boolean}={}){
  const accessToken=await token();
  if(fresh){
    const cancelled=await fetch("/api/stripe/checkout",{method:"DELETE",headers:{"content-type":"application/json",authorization:`Bearer ${accessToken}`},body:JSON.stringify({invoiceId})});
    if(!cancelled.ok&&cancelled.status!==409){const result=await cancelled.json().catch(()=>({}));throw new Error(result.error||"Previous checkout could not be reset.");}
  }
  const response=await fetch("/api/stripe/checkout",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${accessToken}`},body:JSON.stringify({invoiceId})});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||"Payment link could not be created.");
  if(!result.url)throw new Error("Stripe did not return a payment link.");
  return {url:String(result.url),reused:Boolean(result.reused)};
}

export async function requestAdvancePayment(customerId:string,amount:number,note?:string){
  const accessToken=await token();
  const response=await fetch("/api/admin/payments/actions",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${accessToken}`},body:JSON.stringify({action:"advance",customerId,amount,note:note||undefined})});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||"Advance payment request could not be created.");
  return result as {url:string;sessionId:string;amount:number};
}

export async function updatePaymentPreference(customerId:string,method:"card"|"account_balance"){
  const accessToken=await token();
  const response=await fetch("/api/admin/payments/actions",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${accessToken}`},body:JSON.stringify({action:"preference",customerId,method})});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||"Payment preference could not be updated.");
  return result;
}
