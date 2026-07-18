import type { Lead, Expense, Recurrence } from "./storage";

export function generateInsights(leads: Lead[], expenses: Expense[], recurrences: Recurrence[] = []) {
  const revenue = leads.reduce((sum, lead) => sum + lead.total, 0);
  const hst = revenue - revenue / 1.13;
  const expenseTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const net = revenue - hst - expenseTotal;
  const openQuotes = leads.filter((lead) => lead.status === "quoted" || lead.status === "new").length;
  const extraRequests = leads.filter((lead) => lead.service === "Extra Service Request").length;
  const avgRatingLeads = leads.filter((lead) => lead.feedback);
  const avgRating = avgRatingLeads.length ? avgRatingLeads.reduce((sum, lead) => sum + (lead.feedback?.rating || 0), 0) / avgRatingLeads.length : 0;
  const recurringActive = recurrences.filter(r => r.active).length;

  const insights = [
    openQuotes > 0 ? `Follow-up needed: ${openQuotes} open lead(s).` : "No open quote follow-ups right now.",
    extraRequests > 0 ? `${extraRequests} extra service request(s) need manual pricing.` : "No extra service requests pending.",
    recurringActive > 0 ? `${recurringActive} active recurring service(s) are generating predictable work.` : "No active recurring services yet.",
    revenue > 0 ? `Estimated HST collected from quotes is about $${hst.toFixed(2)}.` : "No quote revenue captured yet.",
    expenseTotal > 0 ? `Expenses entered: $${expenseTotal.toFixed(2)}. Estimated net before income tax: $${net.toFixed(2)}.` : "No expenses entered yet.",
    avgRating > 0 ? `Average worker rating is ${avgRating.toFixed(1)} stars.` : "No customer ratings yet."
  ];

  return { revenue, hst, expenseTotal, net, openQuotes, extraRequests, avgRating, recurringActive, insights };
}

export function generateFollowUpMessage(customerName: string, service: string) {
  return `Hi ${customerName}, this is 4Ever Seasons. Thanks for requesting a quote for ${service}. I wanted to follow up and see if you would like us to schedule the service. We can also answer any questions about pricing, timing, or payment options.`;
}

export function generateSeasonalCampaign(season: "spring" | "fall") {
  if (season === "spring") return "Hi, this is 4Ever Seasons. Spring Cleanup season is starting soon. We can help clean up leaves, garden beds, edges, and prepare your property for the season. Reply YES if you would like a quote.";
  return "Hi, this is 4Ever Seasons. Fall Cleanup season is coming up. We can help remove leaves, clean garden beds, and prepare your property before winter. Reply YES if you would like a quote.";
}
