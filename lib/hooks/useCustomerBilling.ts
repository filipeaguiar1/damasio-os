"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type CustomerBillingInvoice = {
  id: string;
  number: string;
  status: string;
  total: number;
  subtotal?: number;
  tax?: number;
  service: string;
  createdAt: string;
};

type BillingSource = "live" | "none";

export function useCustomerBilling() {
  const [invoices, setInvoices] = useState<CustomerBillingInvoice[]>([]);
  const [source, setSource] = useState<BillingSource>("none");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [payingId, setPayingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");

    if (!isSupabaseConfigured()) {
      setInvoices([]);
      setSource("none");
      setMessage("Billing is unavailable until the live database is connected.");
      setLoading(false);
      return;
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) {
        setInvoices([]);
        setSource("none");
        setMessage("Sign in with a connected customer account to view billing.");
        return;
      }

      const response = await fetch("/api/customer/invoices", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Invoices could not be loaded.");
      setInvoices(result.invoices || []);
      setSource("live");
    } catch (error) {
      setInvoices([]);
      setSource("none");
      setMessage(error instanceof Error ? error.message : "Invoices could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const checkout = useCallback(async (invoiceId: string) => {
    if (source !== "live") {
      setMessage("Live billing is required to create a Stripe Checkout session.");
      return;
    }

    setPayingId(invoiceId);
    setMessage("Opening secure Stripe Checkout...");
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Sign in before paying.");
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ invoiceId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Checkout could not be opened.");
      if (!result.url) throw new Error("Stripe did not return a secure checkout link.");
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout could not be opened.");
      setPayingId("");
    }
  }, [source]);

  const summary = useMemo(() => {
    const open = invoices.filter((invoice) => invoice.status !== "paid");
    return {
      openCount: open.length,
      paidCount: invoices.length - open.length,
      due: open.reduce((sum, invoice) => sum + invoice.total, 0),
    };
  }, [invoices]);

  return {
    invoices,
    source,
    loading,
    message,
    payingId,
    summary,
    checkout,
    reload: load,
    clearMessage: () => setMessage(""),
  };
}
