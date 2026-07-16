import {getSupabaseBrowserClient} from "@/lib/supabase/client";

export type CompanyReferral={id:string;fullName:string;email?:string;phone?:string;address?:string;serviceRequested?:string;notes?:string;status:string;createdAt?:string};

export async function listCompanyReferrals():Promise<CompanyReferral[]>{
  const supabase=getSupabaseBrowserClient();const{data,error}=await supabase.rpc("get_company_referral_inbox" as never);
  if(error)throw new Error(error.message);return Array.isArray(data)?data as CompanyReferral[]:[];
}
export async function respondCompanyReferral(id:string,accept:boolean):Promise<CompanyReferral[]>{
  const supabase=getSupabaseBrowserClient();const{data,error}=await supabase.rpc("respond_company_referral" as never,{p_lead_id:id,p_accept:accept} as never);
  if(error)throw new Error(error.message);return Array.isArray(data)?data as CompanyReferral[]:[];
}
