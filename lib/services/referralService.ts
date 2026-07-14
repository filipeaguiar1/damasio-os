import{listCompanyReferrals,respondCompanyReferral,type CompanyReferral}from"@/lib/repositories/referralRepository";
import{addCustomerWithProperty}from"@/lib/services/customerPropertyService";

function frequency(service?:string){const value=(service||"").toLowerCase();return value.includes("biweekly")||value.includes("bi-weekly")?"biweekly" as const:value.includes("monthly")?"monthly" as const:value.includes("weekly")?"weekly" as const:"one_time" as const}
function readDemo():CompanyReferral[]{try{return(JSON.parse(localStorage.getItem("damasio_master_leads")||"[]") as any[]).filter(x=>x.assigned_company_id==="demo-company").map(x=>({id:x.id,fullName:x.full_name,email:x.email,phone:x.phone,address:x.address,serviceRequested:x.service_requested,notes:x.notes,status:x.status,createdAt:x.created_at}))}catch{return[]}}
export async function loadCompanyReferrals(){try{return await listCompanyReferrals()}catch{return typeof window!=="undefined"?readDemo():[]}}
export async function answerCompanyReferral(referral:CompanyReferral,accept:boolean){
  try{return await respondCompanyReferral(referral.id,accept)}catch{
    if(accept)await addCustomerWithProperty({fullName:referral.fullName,email:referral.email,phone:referral.phone,addressLine1:referral.address||"Address pending",customerNotes:`Master referral ${referral.id}${referral.notes?` | ${referral.notes}`:""}`,serviceName:referral.serviceRequested||"Property Service",frequency:frequency(referral.serviceRequested),subtotal:0});
    const rows=readDemo().map(item=>item.id===referral.id?{...item,status:accept?"converted":"declined"}:item);
    try{const raw=JSON.parse(localStorage.getItem("damasio_master_leads")||"[]") as any[];localStorage.setItem("damasio_master_leads",JSON.stringify(raw.map(item=>item.id===referral.id?{...item,status:accept?"converted":"declined",accepted_at:accept?new Date().toISOString():undefined}:item)))}catch{}
    return rows;
  }
}
