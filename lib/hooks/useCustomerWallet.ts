"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type WalletTransaction = {
  id: string;
  type: string;
  credits: number;
  balanceAfterCredits: number;
  description?: string | null;
  createdAt: string;
};

export function useCustomerWallet() {
  const searchParams = useSearchParams();
  const [balanceCredits, setBalanceCredits] = useState(0);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingCredits, setOpeningCredits] = useState(0);
  const [message, setMessage] = useState("");

  const token = useCallback(async () => {
    if (!isSupabaseConfigured()) throw new Error("Account balance requires a connected customer account.");
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Sign in before using your account balance.");
    return accessToken;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const accessToken = await token();
      const response = await fetch("/api/stripe/wallet", {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Account balance could not be loaded.");
      setBalanceCredits(Number(result.balanceCredits || 0));
      setTransactions(result.transactions || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Account balance could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const confirm = useCallback(async (sessionId: string) => {
    setMessage("Confirming your deposit...");
    try {
      const accessToken = await token();
      const response = await fetch("/api/stripe/wallet/confirm", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ sessionId })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Deposit could not be confirmed.");
      setBalanceCredits(Number(result.balanceCredits || 0));
      setMessage(result.credited ? "Funds added successfully." : "This payment was already added to your balance.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Deposit could not be confirmed.");
    }
  }, [load, token]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    if (searchParams.get("wallet_topup") === "success" && sessionId) void confirm(sessionId);
    if (searchParams.get("wallet_topup") === "cancelled") setMessage("Deposit was cancelled. No charge was made.");
  }, [confirm, searchParams]);

  const topUp = useCallback(async (amount: number) => {
    if (!Number.isInteger(amount) || amount < 5 || amount > 1000) {
      setMessage("Choose a whole amount between $5 and $1,000 CAD.");
      return;
    }

    setOpeningCredits(amount);
    setMessage("Opening secure Stripe Checkout...");
    try {
      const accessToken = await token();
      const returnPath = window.location.pathname.startsWith("/mobile/")
        ? "/mobile/customer/payments"
        : "/customer/payments";
      const response = await fetch("/api/stripe/wallet", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ credits: amount, returnPath })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Deposit checkout could not be opened.");
      if (!result.url) throw new Error("Stripe did not return a checkout link.");
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Deposit checkout could not be opened.");
      setOpeningCredits(0);
    }
  }, [token]);

  return {
    balanceCredits,
    transactions,
    loading,
    openingCredits,
    message,
    topUp,
    reload: load,
    clearMessage: () => setMessage("")
  };
}
