"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { CanonicalVisitDetailDrawer } from "@/components/operations/CanonicalVisitDetailDrawer";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Row = {
  id: string;
  company_id: string;
  companyName: string;
  batch_id?: string | null;
  visit_id?: string | null;
  customerName: string;
  address: string;
  serviceName: string;
  status: string;
  hold_reason?: string | null;
  transfer_amount: number;
  amount_total: number;
  platform_fee: number;
  service_completed_at?: string | null;
  scheduledDate?: string | null;
  visitStatus?: string | null;
  durationSeconds?: number | null;
};
type Batch = { id:string; company_id:string; companyName:string; week_start:string; week_end:string; scheduled_payout_date:string; status:string; total_transfer_amount:number };
type Company = { id:string; name:string };
type ApiResult = { rows:Row[]; batches:Batch[]; companies:Company[]; page:number; pageSize:number; total:number; totalPages:number; error?:string };

function money(value: unknown) { return `$${Number(value || 0).toFixed(2)}`; }
function date(value?: string | null) { if (!value) return "—"; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(); }
function pretty(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()); }
function statusTone(value: string) { return value === "transferred" ? "done" : value === "eligible" || value === "approved" ? "ready" : value === "cancelled" || value === "refunded" ? "muted" : value === "held_task" ? "hold" : "wait"; }

export function MasterPayoutsExperience() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const hiddenNodes = useRef<HTMLElement[]>([]);
  const hostRef = useRef<HTMLElement | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [companyId, setCompanyId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [collapsedCompanies, setCollapsedCompanies] = useState<Set<string>>(new Set());
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());

  useEffect(() => {
    let stopped = false;
    const sync = () => {
      if (stopped) return;
      const heading = Array.from(document.querySelectorAll<HTMLElement>(".master-header h2")).find(node => node.textContent?.trim() === "Payouts");
      if (!heading) {
        hiddenNodes.current.forEach(node => { node.style.display = ""; });
        hiddenNodes.current = [];
        hostRef.current?.remove();
        hostRef.current = null;
        setMount(null);
        return;
      }
      const header = heading.closest<HTMLElement>(".master-header");
      if (!header?.parentElement) return;
      if (!hostRef.current || !hostRef.current.isConnected) {
        const host = document.createElement("div");
        host.className = "master-payout-experience-host";
        header.insertAdjacentElement("afterend", host);
        hostRef.current = host;
        setMount(host);
      }
      const siblings = Array.from(header.parentElement.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== header && node !== hostRef.current);
      const payoutNodes = siblings.filter(node => node.classList.contains("master-season-panel") || node.classList.contains("master-table-wrap"));
      hiddenNodes.current.forEach(node => { if (!payoutNodes.includes(node)) node.style.display = ""; });
      payoutNodes.forEach(node => { node.style.display = "none"; });
      hiddenNodes.current = payoutNodes;
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { stopped = true; observer.disconnect(); hiddenNodes.current.forEach(node => { node.style.display = ""; }); hostRef.current?.remove(); };
  }, []);

  useEffect(() => { setPage(1); }, [search, status, companyId, from, to]);

  async function load() {
    if (!mount) return;
    setLoading(true); setError("");
    try {
      const supabase = getSupabaseBrowserClient() as any;
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Your Master session expired.");
      const params = new URLSearchParams({ page:String(page), pageSize:"50", status });
      if (search.trim()) params.set("search", search.trim());
      if (companyId) params.set("companyId", companyId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await fetch(`/api/master/payout-workspace?${params.toString()}`, { headers:{ authorization:`Bearer ${token}` }, cache:"no-store" });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error || "Payout workspace could not be loaded.");
      setRows(result.rows || []); setBatches(result.batches || []); setCompanies(result.companies || []); setTotal(result.total || 0); setTotalPages(result.totalPages || 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Payout workspace could not be loaded."); setRows([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (!mount) return; const timer = window.setTimeout(() => void load(), search ? 280 : 0); return () => window.clearTimeout(timer); }, [mount, page, status, companyId, from, to, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, { name:string; rows:Row[] }>();
    for (const row of rows) {
      const current = map.get(row.company_id) || { name:row.companyName, rows:[] };
      current.rows.push(row); map.set(row.company_id, current);
    }
    return [...map.entries()];
  }, [rows]);

  const readyTotal = useMemo(() => rows.filter(row => ["eligible","approved"].includes(row.status)).reduce((sum,row) => sum + Number(row.transfer_amount || 0), 0), [rows]);
  const toggleCompany = (id:string) => setCollapsedCompanies(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleBatch = (id:string) => setCollapsedBatches(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const panel = mount ? createPortal(<section className="payout-pro-workspace">
    <div className="payout-pro-toolbar">
      <label className="payout-pro-search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Customer, address, company or service ID" /></label>
      <select value={companyId} onChange={e=>setCompanyId(e.target.value)}><option value="">All companies</option>{companies.map(company=><option key={company.id} value={company.id}>{company.name}</option>)}</select>
      <select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All statuses</option><option value="pending_feedback">Pending feedback</option><option value="held_task">Held by task</option><option value="eligible">Eligible</option><option value="approved">Approved</option><option value="transferred">Transferred</option><option value="cancelled">Cancelled</option></select>
      <label className="payout-date"><small>From</small><input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label>
      <label className="payout-date"><small>To</small><input type="date" value={to} onChange={e=>setTo(e.target.value)} /></label>
      <button onClick={()=>void load()} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button>
    </div>

    <div className="payout-pro-metrics"><article><span>Visible services</span><strong>{total}</strong></article><article><span>Ready / approved</span><strong>{money(readyTotal)}</strong></article><article><span>Pending feedback</span><strong>{rows.filter(row=>row.status==="pending_feedback").length}</strong></article><article><span>Held by task</span><strong>{rows.filter(row=>row.status==="held_task").length}</strong></article></div>
    {error && <div className="payout-pro-error">{error}</div>}

    <div className="payout-pro-companies">
      {grouped.map(([id, group]) => {
        const collapsed = collapsedCompanies.has(id);
        const subtotal = group.rows.reduce((sum,row)=>sum+Number(row.transfer_amount||0),0);
        return <section className="payout-company" key={id}>
          <button className="payout-company-head" onClick={()=>toggleCompany(id)}><span>{collapsed?"▸":"▾"}</span><div><strong>{group.name}</strong><small>{group.rows.length} service{group.rows.length===1?"":"s"} on this page</small></div><b>{money(subtotal)}</b></button>
          {!collapsed && <div className="payout-service-list">{group.rows.map(row => <button type="button" className={`payout-service ${row.visit_id?"clickable":"invalid"}`} key={row.id} onClick={()=>row.visit_id&&setSelectedVisitId(row.visit_id)} disabled={!row.visit_id}>
            <div className="payout-service-main"><strong>{row.customerName}</strong><small>{row.address}</small><span>{row.serviceName} · {row.scheduledDate || date(row.service_completed_at)}</span></div>
            <div className="payout-service-company"><small>{row.companyName}</small><strong>{money(row.transfer_amount)}</strong><span>Gross {money(row.amount_total)} · Fee {money(row.platform_fee)}</span></div>
            <div className={`payout-service-status ${statusTone(row.status)}`}><strong>{pretty(row.status)}</strong><small>{row.hold_reason || (row.status==="eligible"?"Ready for weekly review":"Canonical service state")}</small></div>
            <div className="payout-service-open"><span>{row.visit_id?"View service ›":"Invalid service link"}</span></div>
          </button>)}</div>}
        </section>;
      })}
      {!loading && !grouped.length && <div className="payout-pro-empty">No payout services match these filters.</div>}
      {loading && <div className="payout-pro-empty">Refreshing canonical payout status…</div>}
    </div>

    <div className="payout-pro-pagination"><span>{total ? `${(page-1)*50+1}–${Math.min(total,page*50)} of ${total}` : "0 services"}</span><div><button disabled={page<=1||loading} onClick={()=>setPage(value=>Math.max(1,value-1))}>Previous</button><b>Page {page} of {totalPages}</b><button disabled={page>=totalPages||loading} onClick={()=>setPage(value=>Math.min(totalPages,value+1))}>Next</button></div></div>

    <section className="payout-batches"><header><div><span>WEEKLY BATCHES</span><h3>Batch review</h3><p>Expand only the weeks you need. Cancelled services are automatically removed before transfer.</p></div><b>{batches.length}</b></header>{batches.map(batch=>{const collapsed=collapsedBatches.has(batch.id);return <article key={batch.id}><button onClick={()=>toggleBatch(batch.id)}><span>{collapsed?"▸":"▾"}</span><div><strong>{batch.companyName}</strong><small>{batch.week_start} → {batch.week_end}</small></div><div><strong>{money(batch.total_transfer_amount)}</strong><small>Friday {batch.scheduled_payout_date}</small></div><em>{pretty(batch.status)}</em></button>{!collapsed&&<div className="payout-batch-detail"><span>Batch ID {batch.id.slice(0,8).toUpperCase()}</span><span>Work week {batch.week_start} to {batch.week_end}</span><span>Payout {batch.scheduled_payout_date}</span><strong>{pretty(batch.status)}</strong></div>}</article>})}{!batches.length&&<div className="payout-pro-empty">No payout batches for this filter.</div>}</section>

    <CanonicalVisitDetailDrawer visitId={selectedVisitId} onClose={()=>setSelectedVisitId(null)} />
    <style jsx global>{`
      .payout-pro-workspace{display:grid;gap:16px;margin-top:2px}.payout-pro-toolbar{display:grid;grid-template-columns:minmax(260px,1.4fr) minmax(170px,.7fr) 170px 145px 145px auto;gap:9px;align-items:end;padding:14px;border:1px solid #dce7e1;border-radius:18px;background:#fff;box-shadow:0 12px 34px rgba(13,61,44,.05)}.payout-pro-toolbar input,.payout-pro-toolbar select,.payout-pro-toolbar>button{height:45px;border:1px solid #cddbd3;border-radius:11px;background:#fff;padding:0 11px}.payout-pro-toolbar>button{background:#0b684c;color:#fff;border-color:#0b684c;font-weight:850;cursor:pointer}.payout-pro-search{display:flex;align-items:center;gap:8px;height:45px;border:1px solid #cddbd3;border-radius:11px;padding:0 11px}.payout-pro-search input{border:0;height:auto;padding:0;width:100%;outline:0}.payout-date{display:grid;gap:4px}.payout-date small{font-size:9px;font-weight:900;color:#718078;text-transform:uppercase}.payout-pro-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.payout-pro-metrics article{padding:15px 17px;border:1px solid #dce7e1;border-radius:16px;background:#fff}.payout-pro-metrics span,.payout-pro-metrics strong{display:block}.payout-pro-metrics span{font-size:10px;font-weight:900;color:#718078;text-transform:uppercase}.payout-pro-metrics strong{margin-top:5px;font-size:22px;color:#123f31}.payout-pro-error{padding:13px 15px;border-radius:13px;background:#fff0f0;color:#9d2f2f}
      .payout-pro-companies{display:grid;gap:10px}.payout-company{border:1px solid #dbe6e0;border-radius:18px;background:#fff;overflow:hidden;box-shadow:0 11px 30px rgba(13,61,44,.04)}.payout-company-head{width:100%;display:grid;grid-template-columns:24px 1fr auto;gap:10px;align-items:center;padding:15px 17px;border:0;background:#f8fbf9;text-align:left;cursor:pointer}.payout-company-head>span{color:#0b684c}.payout-company-head div strong,.payout-company-head div small{display:block}.payout-company-head div small{margin-top:2px;color:#738078}.payout-company-head>b{font-size:17px;color:#0a4b36}.payout-service-list{display:grid}.payout-service{display:grid;grid-template-columns:minmax(250px,1.35fr) minmax(170px,.7fr) minmax(210px,.9fr) 105px;gap:14px;align-items:center;width:100%;padding:14px 17px;border:0;border-top:1px solid #edf2ef;background:#fff;text-align:left}.payout-service.clickable{cursor:pointer}.payout-service.clickable:hover{background:#f2f8f5}.payout-service.invalid{opacity:.55}.payout-service-main strong,.payout-service-main small,.payout-service-main span,.payout-service-company small,.payout-service-company strong,.payout-service-company span,.payout-service-status strong,.payout-service-status small{display:block}.payout-service-main strong{color:#153c30}.payout-service-main small{margin-top:3px;color:#5f7167}.payout-service-main span,.payout-service-company span{margin-top:4px;color:#7a8880;font-size:11px}.payout-service-company small{color:#64766d}.payout-service-company strong{margin-top:3px}.payout-service-status{padding:9px 11px;border-radius:12px}.payout-service-status strong{font-size:11px}.payout-service-status small{margin-top:3px;line-height:1.35;font-size:10px}.payout-service-status.ready{background:#e6f5ec;color:#0b684c}.payout-service-status.wait{background:#fff5dc;color:#8b6114}.payout-service-status.hold{background:#fff0e8;color:#9b4b21}.payout-service-status.done{background:#e8f0ff;color:#2458a8}.payout-service-status.muted{background:#eef1ef;color:#6a7770}.payout-service-open{text-align:right}.payout-service-open span{font-size:11px;font-weight:900;color:#0b684c}.payout-pro-empty{padding:24px;text-align:center;color:#718078;background:#fff;border:1px dashed #d8e4dd;border-radius:15px}.payout-pro-pagination{display:flex;justify-content:space-between;align-items:center;color:#63756b}.payout-pro-pagination>div{display:flex;gap:8px;align-items:center}.payout-pro-pagination button{border:1px solid #d2ded7;background:#fff;border-radius:9px;padding:8px 11px}.payout-pro-pagination b{font-size:11px}
      .payout-batches{border:1px solid #dbe6e0;border-radius:18px;background:#fff;overflow:hidden}.payout-batches>header{display:flex;justify-content:space-between;gap:16px;padding:17px;background:#f7faf8;border-bottom:1px solid #e5ede9}.payout-batches>header span{font-size:9px;font-weight:950;letter-spacing:.11em;color:#0b684c}.payout-batches>header h3{margin:4px 0}.payout-batches>header p{margin:0;color:#697a71}.payout-batches>header>b{align-self:center;padding:7px 10px;border-radius:999px;background:#e5f2eb;color:#0b684c}.payout-batches>article>button{width:100%;display:grid;grid-template-columns:24px 1fr 180px 100px;gap:10px;align-items:center;padding:13px 16px;border:0;border-top:1px solid #edf2ef;background:#fff;text-align:left;cursor:pointer}.payout-batches>article>button div strong,.payout-batches>article>button div small{display:block}.payout-batches>article>button div small{margin-top:2px;color:#75847c}.payout-batches>article>button em{font-style:normal;font-size:10px;font-weight:900;color:#0b684c}.payout-batch-detail{display:flex;flex-wrap:wrap;gap:10px 20px;padding:11px 50px;background:#f7faf8;color:#64766d;font-size:11px}.payout-batch-detail strong{color:#0b684c}
      @media(max-width:1150px){.payout-pro-toolbar{grid-template-columns:1fr 1fr 1fr}.payout-service{grid-template-columns:1.2fr .7fr .8fr}.payout-service-open{grid-column:1/-1;text-align:left}}
      @media(max-width:760px){.payout-pro-toolbar{grid-template-columns:1fr}.payout-pro-metrics{grid-template-columns:1fr 1fr}.payout-service{grid-template-columns:1fr}.payout-service-open{text-align:left}.payout-pro-pagination{align-items:flex-start;gap:10px;flex-direction:column}.payout-batches>article>button{grid-template-columns:20px 1fr}.payout-batches>article>button>div:nth-of-type(2),.payout-batches>article>button>em{grid-column:2}.payout-batch-detail{padding-left:44px}}
    `}</style>
  </section>, mount) : null;

  return panel;
}
