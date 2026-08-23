"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function label(status: string) {
  if (status === "enabled") return "Payouts enabled";
  if (status === "restricted") return "Action required";
  if (status === "onboarding") return "Onboarding incomplete";
  return "Not connected";
}

export function CompanyStripeConnectCard() {
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const token = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || "";
  }, []);

  const refresh = useCallback(async () => {
    try {
      const accessToken = await token();
      if (!accessToken) return setStatus("not_started");
      const response = await fetch("/api/company/stripe-connect", {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Stripe payout status could not be loaded.");
      setStatus(result.status || "not_started");
      setMessage(result.disabledReason ? `Stripe: ${result.disabledReason}` : "");
    } catch (error) {
      setStatus("not_started");
      setMessage(error instanceof Error ? error.message : "Stripe payout status could not be loaded.");
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function connect() {
    setBusy(true);
    setMessage("");
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Sign in as Company Admin first.");
      const response = await fetch("/api/company/stripe-connect", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Stripe Connect could not be opened.");
      if (!result.url) throw new Error("Stripe did not return an onboarding link.");
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Stripe Connect could not be opened.");
      setBusy(false);
    }
  }

  const enabled = status === "enabled";
  return <section style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:18,flexWrap:"wrap",marginBottom:16,padding:"18px 20px",background:enabled?"#f2faf5":"#fffaf0",border:`1px solid ${enabled?"#cde7d7":"#ead8a6"}`,borderRadius:16}}>
    <div><span style={{display:"block",fontSize:10,fontWeight:900,letterSpacing:1,textTransform:"uppercase",color:"#688077"}}>Company payouts</span><strong style={{display:"block",marginTop:5,fontSize:17,color:"#173b2c"}}>{status === "loading" ? "Checking Stripe Connect…" : label(status)}</strong><small style={{display:"block",marginTop:5,color:"#738078"}}>{enabled ? "Customer money can flow through the platform and be transferred to this company's Stripe account after payout release." : "Connect the company's Stripe account before accepting live platform payouts."}</small>{message && <small style={{display:"block",marginTop:6,color:"#8a433c"}}>{message}</small>}</div>
    <button type="button" onClick={() => void connect()} disabled={busy || status === "loading"} style={{border:0,borderRadius:11,padding:"12px 16px",background:"#0f6d49",color:"#fff",fontWeight:900,cursor:"pointer"}}>{busy ? "Opening Stripe…" : enabled ? "Open Stripe Express" : "Connect Stripe payouts"}</button>
  </section>;
}
