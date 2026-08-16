import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { invalidateQuery } from "@/lib/performance/queryCache";

export type CustomerQuoteDecisionResult = {
  saved: boolean;
  quote_id: string;
  status: "approved" | "declined";
  job_id?: string | null;
  duplicate?: boolean;
};

export async function decideCustomerQuote(quoteId: string, approve: boolean) {
  const id = String(quoteId || "").trim();
  if (!id) throw new Error("Choose a valid quote.");

  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.rpc("customer_decide_quote", {
    p_quote_id: id,
    p_approve: Boolean(approve),
  });
  if (error) throw new Error(error.message);

  invalidateQuery("customer-portal:");
  return (data || {}) as CustomerQuoteDecisionResult;
}
