import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { defaultPricingConfig, normalizePricingConfig } from "@/lib/pricing";

export const dynamic = "force-dynamic";

function env(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!anonKey||!serviceKey) throw new Error("Master pricing is not configured.");
  return{url,anonKey,serviceKey};
}

async function requireMaster(request:NextRequest){
  const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!token) throw new Error("Sign in as Master.");
  const{url,anonKey,serviceKey}=env();
  const authClient=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}}) as any;
  const{data:auth,error:authError}=await authClient.auth.getUser(token);
  if(authError||!auth.user) throw new Error("Your login expired. Sign in again.");
  const{data:profile,error:profileError}=await authClient.from("profiles").select("id,role,active").eq("id",auth.user.id).maybeSingle();
  if(profileError||!profile?.active||profile.role!=="master") throw new Error("Only an active Master can manage pricing.");
  const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}}) as any;
  return{service,masterId:auth.user.id};
}

export async function GET(request:NextRequest){
  try{
    const{service}=await requireMaster(request);
    const{data,error}=await service.from("platform_pricing_settings").select("config,updated_at").eq("id","global").maybeSingle();
    if(error) throw new Error(error.message);
    return NextResponse.json({config:normalizePricingConfig(data?.config||defaultPricingConfig),updatedAt:data?.updated_at||null});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Pricing could not be loaded."},{status:401});}
}

export async function PATCH(request:NextRequest){
  try{
    const{service,masterId}=await requireMaster(request);
    const body=await request.json();
    const config=normalizePricingConfig(body?.config);
    const{error}=await service.from("platform_pricing_settings").upsert({id:"global",config,updated_by:masterId,updated_at:new Date().toISOString()},{onConflict:"id"});
    if(error) throw new Error(error.message);
    return NextResponse.json({config,message:"Pricing saved. New public quotes now use these values."});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Pricing could not be saved."},{status:400});}
}
