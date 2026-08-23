import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { defaultPricingConfig, normalizePricingConfig } from "@/lib/pricing";

export const dynamic="force-dynamic";

export async function GET(){
  try{
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!url||!serviceKey) return NextResponse.json({config:defaultPricingConfig},{headers:{"Cache-Control":"no-store"}});
    const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}}) as any;
    const{data,error}=await service.from("platform_pricing_settings").select("config").eq("id","global").maybeSingle();
    if(error) throw new Error(error.message);
    return NextResponse.json({config:normalizePricingConfig(data?.config||defaultPricingConfig)},{headers:{"Cache-Control":"no-store"}});
  }catch{
    return NextResponse.json({config:defaultPricingConfig},{headers:{"Cache-Control":"no-store"}});
  }
}
