import{NextRequest,NextResponse}from"next/server";
import{createClient}from"@supabase/supabase-js";
export const dynamic="force-dynamic";

export async function POST(request:NextRequest){
  try{
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!url||!key)return NextResponse.json({saved:false});
    const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const body=await request.json() as{name?:string;email?:string;phone?:string;address?:string;service?:string;notes?:string;referralCode?:string};
    const fullName=String(body.name||"").trim(),email=String(body.email||"").trim().toLowerCase(),code=String(body.referralCode||"").trim().toUpperCase();
    if(fullName.length<2||!email||!body.address||!body.service)throw new Error("Complete the customer, address and service information.");
    let companyId:string|null=null,companyName:string|null=null;
    if(code){const{data,error}=await client.from("organizations").select("id,name").eq("referral_code",code).eq("active",true).is("deleted_at",null).maybeSingle();if(error)throw error;if(!data)throw new Error("Company code was not found or is inactive.");companyId=data.id;companyName=data.name;}
    const{data,error}=await client.from("lead_center").insert({assigned_company_id:companyId,full_name:fullName,email,phone:body.phone||null,address:body.address,service_requested:body.service,notes:[body.notes,code?`Company referral code: ${code}`:null].filter(Boolean).join(" | ")||null,status:companyId?"offered":"new"}).select("id").single();
    if(error)throw error;return NextResponse.json({saved:true,leadId:data.id,companyName});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Quote referral could not be saved."},{status:400})}
}
