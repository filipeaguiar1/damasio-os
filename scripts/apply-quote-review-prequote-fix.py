from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Expected source block not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


def append_once(path: str, marker: str, block: str) -> None:
    file = Path(path)
    text = file.read_text()
    if marker in text:
        return
    file.write_text(text.rstrip() + "\n\n" + block.strip() + "\n")


# 1) Public quote wizard: keep the review card inside its shell and link a persisted pre-quote to final submission.
quote_path = "components/home/QuoteWizard.tsx"
replace_once(
    quote_path,
    '  const [preQuoteAlerted, setPreQuoteAlerted] = useState(false);',
    '  const [preQuoteAlerted, setPreQuoteAlerted] = useState(false);\n  const [preQuoteId, setPreQuoteId] = useState("");',
)
replace_once(
    quote_path,
    '''    if (!preQuoteAlerted) {
      setPreQuoteAlerted(true);
      void fetch("/api/public/quote-alert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          address: lead.address,
          service: serviceLabels[service],
          estimatedTotal: isManualQuote ? null : quote.total,
          website: "",
        }),
      }).catch(error => console.error("Pre-quote alert request failed", error));
    }''',
    '''    if (!preQuoteAlerted) {
      setPreQuoteAlerted(true);
      void fetch("/api/public/quote-alert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          address: lead.address,
          service: serviceLabels[service],
          estimatedTotal: isManualQuote ? null : quote.total,
          notes: [lead.notes, detailsSummary].filter(Boolean).join(" | "),
          referralCode,
          website: "",
        }),
      }).then(async response => {
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.preQuoteId) setPreQuoteId(String(result.preQuoteId));
      }).catch(error => console.error("Pre-quote alert request failed", error));
    }''',
)
replace_once(
    quote_path,
    '''          referralCode,
          estimatedTotal: isManualQuote ? null : quote.total,''',
    '''          referralCode,
          preQuoteId,
          estimatedTotal: isManualQuote ? null : quote.total,''',
)
replace_once(
    quote_path,
    'setService(item.key); setPreQuoteAlerted(false); setMsg("");',
    'setService(item.key); setPreQuoteAlerted(false); setPreQuoteId(""); setMsg("");',
)
replace_once(
    quote_path,
    '{step === 4 && <div className="stack quote-step">',
    '{step === 4 && <div className="stack quote-step quote-step-review">',
)
replace_once(
    quote_path,
    '<button className="btn btn-outline" disabled={busy} onClick={() => setStep(2)}>Edit service</button><button className="btn btn-outline" disabled={busy} onClick={() => setStep(3)}>Edit contact</button>',
    '<button className="btn btn-outline" disabled={busy} onClick={() => { setPreQuoteAlerted(false); setStep(2); }}>Edit service</button><button className="btn btn-outline" disabled={busy} onClick={() => { setPreQuoteAlerted(false); setStep(3); }}>Edit contact</button>',
)

# 2) Pre-quote API: persist the customer who reached review, then send a best-effort alert.
Path("app/api/public/quote-alert/route.ts").write_text(r'''import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { sendQuoteAlert } from "@/lib/server/quoteEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 8;
const buckets = new Map<string, { count: number; reset: number }>();

const preQuoteAlert = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).optional().default(""),
  address: z.string().trim().min(5).max(300),
  service: z.string().trim().min(2).max(120),
  estimatedTotal: z.number().nonnegative().nullable().optional(),
  notes: z.string().trim().max(1500).optional().default(""),
  referralCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/).optional().or(z.literal("")),
  website: z.string().max(0).optional(),
}).strict();

function allow(ip: string) {
  const now = Date.now();
  const current = buckets.get(ip);
  if (!current || current.reset < now) {
    buckets.set(ip, { count: 1, reset: now + WINDOW_MS });
    return true;
  }
  if (current.count >= MAX_REQUESTS) return false;
  current.count += 1;
  return true;
}

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allow(ip)) return NextResponse.json({ ok: true, rateLimited: true });

  try {
    const parsed = preQuoteAlert.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid pre-quote alert." }, { status: 400 });
    const body = parsed.data;
    if (body.website) return NextResponse.json({ ok: true });

    const client = serverClient();
    let preQuoteId: string | null = null;
    let companyId: string | null = null;
    let companyName: string | null = null;

    if (client) {
      if (body.referralCode) {
        const company = await client.from("organizations")
          .select("id,name")
          .eq("referral_code", body.referralCode)
          .eq("active", true)
          .is("deleted_at", null)
          .maybeSingle();
        if (!company.error && company.data) {
          companyId = String(company.data.id);
          companyName = String(company.data.name || "");
        }
      }

      const notes = [
        "QUOTE_STAGE:prequote",
        body.notes || null,
        typeof body.estimatedTotal === "number" ? `Average estimate shown: $${body.estimatedTotal.toFixed(2)}` : null,
        body.referralCode ? `Company referral code: ${body.referralCode}` : null,
      ].filter(Boolean).join(" | ");

      const existing = await client.from("lead_center")
        .select("id")
        .eq("status", "new")
        .ilike("email", body.email)
        .eq("address", body.address)
        .eq("service_requested", body.service)
        .like("notes", "%QUOTE_STAGE:prequote%")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!existing.error && existing.data?.id) {
        preQuoteId = String(existing.data.id);
        const updated = await client.from("lead_center").update({
          assigned_company_id: companyId,
          full_name: body.name,
          email: body.email,
          phone: body.phone || null,
          address: body.address,
          service_requested: body.service,
          notes,
          updated_at: new Date().toISOString(),
        }).eq("id", preQuoteId);
        if (updated.error) console.error("Pre-quote update failed", updated.error);
      } else {
        const created = await client.from("lead_center").insert({
          assigned_company_id: companyId,
          full_name: body.name,
          email: body.email,
          phone: body.phone || null,
          address: body.address,
          service_requested: body.service,
          notes,
          status: "new",
        }).select("id").single();
        if (created.error) {
          console.error("Pre-quote persistence failed", created.error);
        } else {
          preQuoteId = String(created.data.id);
        }
      }
    } else {
      console.error("Pre-quote persistence skipped: Supabase server credentials are not configured");
    }

    const emailDelivered = await sendQuoteAlert({
      stage: "prequote",
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      service: body.service,
      estimatedTotal: body.estimatedTotal ?? null,
      leadId: preQuoteId,
      companyName,
    });

    return NextResponse.json({ ok: true, preQuoteId, emailDelivered });
  } catch (error) {
    console.error("Pre-quote alert route failed", error);
    return NextResponse.json({ ok: true, preQuoteId: null, emailDelivered: false });
  }
}
''')

# 3) Final quote API: mark the submitted quote and close its linked pre-quote.
referral_path = "app/api/public/quote-referral/route.ts"
replace_once(
    referral_path,
    '  referralCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/).optional().or(z.literal("")),\n  estimatedTotal:',
    '  referralCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/).optional().or(z.literal("")),\n  preQuoteId: z.string().uuid().optional().or(z.literal("")),\n  estimatedTotal:',
)
replace_once(
    referral_path,
    '''    const notes = [
      body.notes,''',
    '''    const notes = [
      "QUOTE_STAGE:submitted",
      body.notes,''',
)
replace_once(
    referral_path,
    '''    await sendQuoteAlert({
      stage: "complete",
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      service: body.service,
      estimatedTotal: body.estimatedTotal ?? null,
      leadId: data.id,
      companyName,
    });

    return NextResponse.json({ saved: true, leadId: data.id, customerId, propertyId, companyName }, { status: 201 });''',
    '''    if (body.preQuoteId) {
      const existingPreQuote = await client.from("lead_center").select("notes").eq("id", body.preQuoteId).maybeSingle();
      if (!existingPreQuote.error && existingPreQuote.data) {
        const closed = await client.from("lead_center").update({
          status: "converted",
          notes: [existingPreQuote.data.notes, `PREQUOTE_COMPLETED_BY:${data.id}`].filter(Boolean).join(" | "),
          updated_at: new Date().toISOString(),
        }).eq("id", body.preQuoteId);
        if (closed.error) console.error("Linked pre-quote could not be closed", closed.error);
      }
    }

    const emailDelivered = await sendQuoteAlert({
      stage: "complete",
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      service: body.service,
      estimatedTotal: body.estimatedTotal ?? null,
      leadId: data.id,
      companyName,
    });

    return NextResponse.json({ saved: true, leadId: data.id, customerId, propertyId, companyName, emailDelivered }, { status: 201 });''',
)

# 4) Master Quote Review: canonical server pre-quotes/submitted quotes, collapsible groups, and search.
master_path = "app/master/page.tsx"
replace_once(
    master_path,
    '  const[query,setQuery]=useState("");',
    '  const[query,setQuery]=useState("");\n  const[quoteQuery,setQuoteQuery]=useState("");',
)
replace_once(
    master_path,
    '  const filteredCompanies=useMemo(()=>activeCompanies.filter(c=>`${c.name} ${c.slug} ${c.contact_email||""}`.toLowerCase().includes(query.toLowerCase())),[activeCompanies,query]);',
    '''  const filteredCompanies=useMemo(()=>activeCompanies.filter(c=>`${c.name} ${c.slug} ${c.contact_email||""}`.toLowerCase().includes(query.toLowerCase())),[activeCompanies,query]);
  const quoteSearch=quoteQuery.trim().toLowerCase();
  const quoteLeadMatches=(lead:Lead)=>`${lead.id} ${lead.full_name} ${lead.email||""} ${lead.phone||""} ${lead.address||""} ${lead.service_requested||""} ${lead.notes||""}`.toLowerCase().includes(quoteSearch);
  const pendingPreQuotes=leads.filter(lead=>String(lead.notes||"").includes("QUOTE_STAGE:prequote")&&lead.status!=="converted"&&quoteLeadMatches(lead));
  const submittedQuoteLeads=leads.filter(lead=>{const notes=String(lead.notes||"");const submitted=notes.includes("QUOTE_STAGE:submitted")||(!notes.includes("QUOTE_STAGE:prequote")&&notes.includes("Average estimate shown:"));return submitted&&quoteLeadMatches(lead)});
  const filteredQuotes=quotes.filter(quote=>`${quote.id} ${quote.number} ${quote.customer} ${quote.email||""} ${quote.phone||""} ${quote.address||""} ${quote.title||""}`.toLowerCase().includes(quoteSearch));
  const leadEstimate=(lead:Lead)=>{const match=String(lead.notes||"").match(/Average estimate shown: \\$(\\d+(?:\\.\\d+)?)/i);return match?Number(match[1]):null};''',
)
replace_once(
    master_path,
    '<button className={tab==="quotes"?"active":""} onClick={()=>setTab("quotes")}>Quote Review <span>{quotes.filter(q=>q.status==="draft").length}</span></button>',
    '<button className={tab==="quotes"?"active":""} onClick={()=>setTab("quotes")}>Quote Review <span>{pendingPreQuotes.length+submittedQuoteLeads.filter(q=>q.status==="new"||q.status==="offered").length+(submittedQuoteLeads.length?0:quotes.filter(q=>q.status==="draft").length)}</span></button>',
)
master = Path(master_path).read_text()
start_token = '      {tab==="quotes"&&<>'
end_token = '      {tab==="payouts"&&<>'
start = master.find(start_token)
end = master.find(end_token, start + 1)
if start < 0 or end < 0:
    raise SystemExit("Quote Review render block boundaries were not found")
new_quote_block = r'''      {tab==="quotes"&&<><header className="master-header"><div><span className="master-kicker">MASTER QUOTE DESK</span><h2>Quote Review</h2><p>Track customers who reached the estimate review, then review completed website quote requests in one place.</p></div><div className="master-summary"><b>{pendingPreQuotes.length+submittedQuoteLeads.filter(q=>q.status==="new"||q.status==="offered").length}</b><span>waiting review</span></div></header><div className="master-quote-toolbar"><input className="input" value={quoteQuery} onChange={e=>setQuoteQuery(e.target.value)} placeholder="Find customer or quote" aria-label="Find customer or quote"/>{quoteQuery&&<button className="master-inline-button" onClick={()=>setQuoteQuery("")}>Clear</button>}</div><details open className="master-quote-group"><summary><span><strong>Pre-quotes</strong><small>Customer reached the review screen but has not submitted the request.</small></span><b>{pendingPreQuotes.length}</b></summary><div className="master-table-wrap"><table className="master-table"><thead><tr><th>Customer</th><th>Service</th><th>Preliminary</th><th>Reached review</th><th>Action</th></tr></thead><tbody>{pendingPreQuotes.map(lead=>{const estimate=leadEstimate(lead);return <tr key={`pre-${lead.id}`}><td><strong>{lead.full_name}</strong><small>{lead.email||lead.phone||"No contact"}</small></td><td>{lead.service_requested||"Property service"}<small>{lead.address||""}</small></td><td>{estimate===null?"Admin review":`$${estimate.toFixed(2)}`}</td><td>{lead.created_at?new Date(lead.created_at).toLocaleString():"—"}</td><td><button className="master-inline-button" onClick={()=>openLead(lead)}>Open / prepare</button></td></tr>})}</tbody></table>{!pendingPreQuotes.length&&<div className="master-empty">No pending pre-quotes match this search.</div>}</div></details><details open className="master-quote-group"><summary><span><strong>Submitted quotes</strong><small>Customer pressed Send quote request and the request reached the platform.</small></span><b>{submittedQuoteLeads.length||filteredQuotes.length}</b></summary>{submittedQuoteLeads.length?<div className="master-table-wrap"><table className="master-table"><thead><tr><th>Quote / customer</th><th>Service</th><th>Requested</th><th>Status</th><th>Action</th></tr></thead><tbody>{submittedQuoteLeads.map(lead=>{const estimate=leadEstimate(lead);return <tr key={`submitted-${lead.id}`}><td><strong>WEB-{lead.id.slice(0,8).toUpperCase()}</strong><small>{lead.full_name} · {lead.email||lead.phone||"No contact"}</small></td><td>{lead.service_requested||"Property service"}<small>{lead.address||""}</small></td><td>{estimate===null?"Admin review":`$${estimate.toFixed(2)}`}</td><td><span className="master-status">{lead.status}</span></td><td><button className="master-inline-button" onClick={()=>openLead(lead)}>Open / edit</button></td></tr>})}</tbody></table></div>:<div className="master-table-wrap"><table className="master-table"><thead><tr><th>Quote / customer</th><th>Service</th><th>Requested</th><th>Final total</th><th>Status</th><th>Action</th></tr></thead><tbody>{filteredQuotes.map(q=><tr key={q.id}><td><strong>{q.number}</strong><small>{q.customer} · {q.email}</small></td><td>{q.title}<small>{q.address}</small></td><td>${q.total.toFixed(2)}</td><td><input className="input" type="number" min="0" step="0.01" value={quoteAmounts[q.id]??q.total} onChange={e=>setQuoteAmounts(v=>({...v,[q.id]:e.target.value}))}/></td><td><span className="master-status">{q.status}</span></td><td><div className="row"><button className="master-inline-button" onClick={()=>reviseQuote(q)}>Save</button><button className="master-inline-button" disabled={q.status==="approved"||q.status==="declined"} onClick={()=>sendQuote(q)}>Send + invite</button></div></td></tr>)}</tbody></table>{!filteredQuotes.length&&<div className="master-empty">No submitted quotes match this search.</div>}</div>}</details></>}
'''
master = master[:start] + new_quote_block + master[end:]
Path(master_path).write_text(master)

# 5) Email destination is explicit/configurable, defaulting to Support.
email_path = "lib/server/quoteEmail.ts"
replace_once(
    email_path,
    'const SUPPORT_EMAIL = "support@4everseasons.com";',
    'const SUPPORT_EMAIL = process.env.QUOTE_ALERT_TO_EMAIL || "support@4everseasons.com";',
)

# 6) Public desktop/mobile containment. This directly addresses the white panel protruding from the quote card.
append_once(
    "app/public-site-polish.css",
    "/* quote-review-containment-20260823 */",
    r'''/* quote-review-containment-20260823 */
.public-home .hero-quote-panel,
.public-home .quote-card,
.public-home .quote-step,
.public-home .quote-result,
.public-home .quote-scope-summary{
  width:100%;
  max-width:100%;
  min-width:0;
  box-sizing:border-box;
}
.public-home .quote-card{overflow:hidden}
.public-home .quote-step-review{gap:10px}
.public-home .quote-step-review .quote-result{padding:14px}
.public-home .quote-step-review .quote-scope-summary{gap:10px;padding:12px}
.public-home .quote-step-review .quote-scope-summary dl{gap:7px}
.public-home .quote-step-review .quote-scope-summary dl div{padding:8px}
.public-home .quote-step-review .quote-actions-final{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  width:100%;
  min-width:0;
  gap:8px;
}
.public-home .quote-step-review .quote-actions-final .btn{
  width:100%;
  min-width:0;
  padding-left:9px;
  padding-right:9px;
}
@media(max-width:640px){
  .public-home .quote-step-review .quote-scope-summary dl{grid-template-columns:1fr}
  .public-home .quote-step-review .quote-actions-final{grid-template-columns:1fr}
  .public-home .quote-step-review .quote-result{padding:12px}
  .public-home .quote-step-review .quote-scope-summary{padding:10px}
}''',
)

# 7) Master collapsible quote groups/search styling.
append_once(
    "app/master-platform-polish.css",
    "/* master-quote-review-groups-20260823 */",
    r'''/* master-quote-review-groups-20260823 */
.master-quote-toolbar{
  display:flex;
  align-items:center;
  gap:10px;
  margin:0 0 14px;
}
.master-quote-toolbar .input{width:min(520px,100%)}
.master-quote-group{
  margin:0 0 14px;
  border:1px solid #dce5df;
  border-radius:14px;
  background:#fff;
  overflow:hidden;
}
.master-quote-group>summary{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  padding:15px 18px;
  cursor:pointer;
  list-style:none;
  background:#f7faf8;
}
.master-quote-group>summary::-webkit-details-marker{display:none}
.master-quote-group>summary span{display:grid;gap:3px;min-width:0}
.master-quote-group>summary strong{color:#173b2c;font-size:15px}
.master-quote-group>summary small{color:#6d7b73;font-size:12px;line-height:1.35}
.master-quote-group>summary b{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:30px;
  height:30px;
  padding:0 8px;
  border-radius:999px;
  background:#e8f1eb;
  color:#24533d;
  font-size:12px;
}
.master-quote-group[open]>summary{border-bottom:1px solid #e3e9e5}
.master-quote-group>.master-table-wrap{margin:0;border:0;border-radius:0;box-shadow:none}
@media(max-width:720px){
  .master-quote-toolbar{align-items:stretch;flex-direction:column}
  .master-quote-toolbar .input{width:100%;max-width:none}
  .master-quote-group>summary{padding:13px 14px}
  .master-quote-group>.master-table-wrap{overflow-x:auto}
}''',
)

print("Applied quote layout, pre-quote persistence, Master quote review, search, and email-routing code changes.")
