import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type CustomerQuoteDecision = {
  saved: boolean;
  quote_id: string;
  status: "approved" | "declined";
  job_id: string | null;
  duplicate?: boolean;
};

export async function decideCustomerQuote(quoteId: string, approve: boolean): Promise<CustomerQuoteDecision> {
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.rpc("customer_decide_quote", {
    p_quote_id: quoteId,
    p_approve: approve,
  });
  if (error) throw new Error(error.message);
  return data as CustomerQuoteDecision;
}
