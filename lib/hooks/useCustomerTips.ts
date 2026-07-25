"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function useCustomerTips() {
  const searchParams = useSearchParams();
  const [opening, setOpening] = useState(false);
  const [payingWallet, setPayingWallet] = useState(false);
  const [message, setMessage] = useState("");

  const token = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Sign in before sending a tip.");
    return accessToken;
  }, []);

  const confirm = useCallback(async (sessionId: string) => {
    try {
      setMessage("Confirming your tip...");
      const accessToken = await token();
      const response = await fetch("/api/stripe/tips/confirm", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ sessionId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Tip could not be confirmed.");
      setMessage(result.message || "Thank you. Your tip was confirmed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tip could not be confirmed.");
    }
  }, [token]);

  useEffect(() => {
    const sessionId = searchParams.get("tip_session_id");
    if (searchParams.get("tip") === "success" && sessionId) void confirm(sessionId);
    if (searchParams.get("tip") === "cancelled") setMessage("Tip checkout was cancelled. No charge was made.");
  }, [confirm, searchParams]);

  const sendTip = useCallback(async (amount: number, note = "") => {
    if (!Number.isFinite(amount) || amount < 1 || amount > 500) {
      setMessage("Choose a tip between $1 and $500.");
      return;
    }
    setOpening(true);
    setMessage("Opening secure Stripe Checkout for your tip...");
    try {
      const accessToken = await token();
      const returnPath = window.location.pathname.startsWith("/mobile/") ? "/mobile/customer/payments" : "/customer/payments";
      const response = await fetch("/api/stripe/tips", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ amount, note, returnPath }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Tip checkout could not be opened.");
      if (!result.url) throw new Error("Stripe did not return a checkout link.");
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tip checkout could not be opened.");
      setOpening(false);
    }
  }, [token]);

  const sendWalletTip = useCallback(async (amount: number, note = "") => {
    if (!Number.isFinite(amount) || amount < 1 || amount > 500) {
      setMessage("Choose a tip between $1 and $500.");
      return null;
    }
    setPayingWallet(true);
    setMessage("Paying tip from wallet credits...");
    try {
      const accessToken = await token();
      const response = await fetch("/api/stripe/tips/wallet", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ amount, note }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The tip could not be paid from wallet credits.");
      setMessage(result.message || "Tip paid successfully from wallet credits.");
      return Number(result.balanceCredits || 0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The tip could not be paid from wallet credits.");
      return null;
    } finally {
      setPayingWallet(false);
    }
  }, [token]);

  return { opening, payingWallet, message, sendTip, sendWalletTip, clearMessage: () => setMessage("") };
}
