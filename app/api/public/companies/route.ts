import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return NextResponse.json({ companies: [] });
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Public company discovery only needs stable display identifiers. Contact
  // details and referral codes stay server-side and must not be enumerable.
  const { data, error } = await client
    .from("organizations")
    .select("id,name,slug")
    .eq("active", true)
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ companies: [] });
  }

  return NextResponse.json({ companies: data ?? [] });
}
