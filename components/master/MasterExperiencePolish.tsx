"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Row = {
  id: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  service: string;
  status: string;
  assignedCompanyId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  estimatedTotal?: number | null;
  propertyDetails?: Record<string, unknown> | null;
  notes?: string | null;
};

type ApiResult = { rows: Row[]; page: number; pageSize: number; total: number; totalPages: number; error?: string };

function pretty(value: unknown) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
}

function viewedAt(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function MasterExperiencePolish() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [quoteTable, setQuoteTable] = useState<HTMLElement | null>(null);
  const [subtab, setSubtab] = useState<"quotes" | "prequote">("quotes");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const lastHost = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let stopped = false;
    const sync = () => {
      if (stopped) return;
      const heading = Array.from(document.querySelectorAll<HTMLElement>(".master-header h2")).find(node => node.textContent?.trim() === "Quote Review");
      if (!heading) {
        if (lastHost.current) lastHost.current.remove();
        lastHost.current = null;
        setMount(null);
        setQuoteTable(null);
        return;
      }
      const header = heading.closest<HTMLElement>(".master-header");
      if (!header?.parentElement) return;
      const siblingTable = Array.from(header.parentElement.children).find(node => node !== header && node instanceof HTMLElement && node.classList.contains("master-table-wrap")) as HTMLElement | undefined;
      if (!lastHost.current || !lastHost.current.isConnected) {
        const host = document.createElement("div");
        host.className = "master-quote-subtabs-host";
        header.insertAdjacentElement("afterend", host);
        lastHost.current = host;
        setMount(host);
      }
      setQuoteTable(siblingTable || null);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      stopped = true;
      observer.disconnect();
      if (lastHost.current) lastHost.current.remove();
      if (quoteTable) quoteTable.style.display = "";
    };
  }, []);

  useEffect(() => {
    if (!quoteTable) return;
    quoteTable.style.display = subtab === "prequote" ? "none" : "";
    return () => { quoteTable.style.display = ""; };
  }, [quoteTable, subtab]);

  useEffect(() => {
    if (!mount) return;
    const timer = window.setTimeout(() => void loadRows(), search ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [mount, page, status, search]);

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabaseBrowserClient() as any;
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Your Master login expired.");
      const params = new URLSearchParams({ page: String(page), pageSize: "25", status });
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(`/api/master/prequote-leads?${params.toString()}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error || "Pre-quote leads could not be loaded.");
      setRows(result.rows || []);
      setTotal(result.total || 0);
      setTotalPages(result.totalPages || 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pre-quote leads could not be loaded.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { setPage(1); }, [search, status]);

  const range = useMemo(() => {
    if (!total) return "0 leads";
    const first = (page - 1) * 25 + 1;
    const last = Math.min(total, first + rows.length - 1);
    return `${first}–${last} of ${total}`;
  }, [page, rows.length, total]);

  const panel = mount ? createPortal(
    <div className="master-quote-subtabs">
      <div className="master-quote-tabs" role="tablist" aria-label="Quote desk views">
        <button className={subtab === "quotes" ? "active" : ""} onClick={() => setSubtab("quotes")}>Quotes</button>
        <button className={subtab === "prequote" ? "active" : ""} onClick={() => setSubtab("prequote")}>Pre-Quote Leads <span>{total}</span></button>
      </div>
      {subtab === "prequote" && <section className="prequote-workspace">
        <div className="prequote-overview">
          <div><span>PRE-QUOTE PIPELINE</span><h3>People who viewed an estimate</h3><p>Contact details are retained only after the customer chooses to view the estimate. These are leads, not Customers or scheduled work.</p></div>
          <div className="prequote-total"><strong>{total}</strong><small>captured</small></div>
        </div>
        <div className="prequote-toolbar">
          <label className="prequote-search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, phone, address or service" /></label>
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Lead status">
            <option value="all">All statuses</option><option value="new">New</option><option value="offered">Contacted / offered</option><option value="converted">Converted</option><option value="lost">Lost</option>
          </select>
          <button className="prequote-refresh" onClick={() => void loadRows()}>Refresh</button>
        </div>
        {error && <div className="prequote-error">{error}</div>}
        <div className="prequote-table-shell">
          <div className="prequote-table-head"><span>{range}</span><small>25 per page</small></div>
          <div className="prequote-table-scroll">
            <table className="prequote-table"><thead><tr><th>Lead</th><th>Service</th><th>Estimate</th><th>Location</th><th>Contact</th><th>Viewed</th><th></th></tr></thead>
              <tbody>{rows.map(row => <tr key={row.id}>
                <td><strong>{row.fullName}</strong><small>{row.status}</small></td>
                <td><strong>{row.service}</strong></td>
                <td>{typeof row.estimatedTotal === "number" ? <strong>${row.estimatedTotal.toFixed(2)}</strong> : <span>—</span>}</td>
                <td><strong>{row.city || "—"}</strong><small>{row.address || ""}</small></td>
                <td><strong>{row.phone || "—"}</strong><small>{row.email || ""}</small></td>
                <td>{viewedAt(row.createdAt)}</td>
                <td><button onClick={() => setSelected(row)}>View</button></td>
              </tr>)}</tbody>
            </table>
          </div>
          {!loading && !rows.length && <div className="prequote-empty">No pre-quote leads match these filters.</div>}
          {loading && <div className="prequote-empty">Loading pre-quote leads…</div>}
          <div className="prequote-pagination"><button disabled={page <= 1 || loading} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</button><span>Page {page} of {totalPages}</span><button disabled={page >= totalPages || loading} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>Next</button></div>
        </div>
      </section>}
      {selected && <div className="prequote-drawer-backdrop" onMouseDown={() => setSelected(null)}><aside className="prequote-drawer" onMouseDown={e => e.stopPropagation()}>
        <button className="prequote-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
        <span className="prequote-drawer-kicker">PRE-QUOTE LEAD</span><h3>{selected.fullName}</h3><p className="prequote-drawer-service">{selected.service}{typeof selected.estimatedTotal === "number" ? ` · $${selected.estimatedTotal.toFixed(2)}` : ""}</p>
        <div className="prequote-detail-grid"><div><span>Email</span><strong>{selected.email || "—"}</strong></div><div><span>Phone</span><strong>{selected.phone || "—"}</strong></div><div className="wide"><span>Address</span><strong>{selected.address || "—"}</strong></div><div><span>Status</span><strong>{pretty(selected.status)}</strong></div><div><span>Viewed</span><strong>{viewedAt(selected.createdAt)}</strong></div></div>
        {selected.propertyDetails && <div className="prequote-property"><h4>Estimate choices</h4><div>{Object.entries(selected.propertyDetails).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => <span key={key}><small>{pretty(key)}</small><strong>{pretty(value)}</strong></span>)}</div></div>}
        {selected.notes && <div className="prequote-notes"><span>Notes</span><p>{selected.notes}</p></div>}
      </aside></div>}
    </div>, mount) : null;

  return <>
    <style>{`
      .master-shell{background:#f4f7f5!important}.master-sidebar{background:linear-gradient(180deg,#071f18 0%,#0a2f23 56%,#09271e 100%)!important;border-right:1px solid rgba(255,255,255,.06);box-shadow:18px 0 55px rgba(5,29,21,.08)}
      .master-sidebar h1{letter-spacing:-.045em}.master-sidebar nav{gap:5px!important}.master-sidebar nav button{border-radius:13px!important;padding:11px 12px!important;transition:background .16s ease,transform .16s ease!important}.master-sidebar nav button:hover{transform:translateX(2px)}
      .master-user{position:relative!important;margin-top:22px!important;padding:18px 16px 16px 62px!important;border:1px solid rgba(255,255,255,.11)!important;border-radius:20px!important;background:rgba(255,255,255,.07)!important;box-shadow:0 16px 36px rgba(0,0,0,.12)!important;display:grid!important;gap:3px!important;overflow:hidden}
      .master-user:before{content:"M";position:absolute;left:15px;top:16px;width:36px;height:36px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(145deg,#e9f7ee,#bfe2c9);color:#0a3c2b;font-size:15px;font-weight:950;box-shadow:0 8px 20px rgba(0,0,0,.13)}
      .master-user strong{font-size:14px!important;color:#fff}.master-user small{font-size:11px!important;color:rgba(255,255,255,.62)!important;overflow:hidden;text-overflow:ellipsis}.master-user button{grid-column:1/-1;margin-top:10px!important;border:1px solid rgba(255,255,255,.14)!important;background:rgba(255,255,255,.06)!important;color:#fff!important;border-radius:11px!important;padding:9px 10px!important;text-align:left!important}.master-user button:hover{background:rgba(255,255,255,.12)!important}
      .master-content{padding:38px 44px 60px!important;max-width:1600px;width:100%}.master-header{padding:6px 0 24px!important;border-bottom:1px solid rgba(13,61,44,.08);margin-bottom:22px!important}.master-header h2{letter-spacing:-.045em!important}.master-header p{max-width:760px;line-height:1.6!important}.master-table-wrap,.master-company-card,.master-season-panel{border-color:rgba(13,61,44,.09)!important;box-shadow:0 18px 55px rgba(13,61,44,.07)!important}.master-table-wrap{border-radius:22px!important;overflow:hidden!important}.master-table th{background:#f6f9f7!important;color:#527062!important;font-size:11px!important;letter-spacing:.055em!important;text-transform:uppercase!important}.master-table td{vertical-align:middle!important}.master-summary{border-radius:18px!important;background:#fff!important;box-shadow:0 12px 30px rgba(13,61,44,.07)!important}
      .master-quote-subtabs-host{margin:-6px 0 20px}.master-quote-tabs{display:inline-flex;gap:5px;padding:5px;border:1px solid rgba(13,61,44,.09);background:#eaf0ec;border-radius:14px}.master-quote-tabs button{border:0;background:transparent;color:#537064;border-radius:10px;padding:10px 15px;font-weight:900;cursor:pointer}.master-quote-tabs button.active{background:#fff;color:#0b3e2d;box-shadow:0 5px 18px rgba(13,61,44,.1)}.master-quote-tabs button span{display:inline-grid;place-items:center;min-width:23px;height:20px;padding:0 6px;margin-left:6px;border-radius:99px;background:#dcebe1;color:#18523b;font-size:10px}
      .prequote-workspace{margin-top:18px}.prequote-overview{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;padding:25px 27px;border-radius:24px;background:linear-gradient(140deg,#0a3427,#0e5239);color:#fff;box-shadow:0 22px 55px rgba(8,48,35,.16)}.prequote-overview>div:first-child{max-width:720px}.prequote-overview span,.prequote-drawer-kicker{font-size:10px;font-weight:950;letter-spacing:.14em;color:#a8dac0}.prequote-overview h3{font-size:27px;letter-spacing:-.035em;margin:7px 0 7px}.prequote-overview p{margin:0;color:rgba(255,255,255,.72);font-size:13px;line-height:1.6}.prequote-total{min-width:112px;padding:15px 17px;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.07);border-radius:18px;text-align:center}.prequote-total strong{display:block;font-size:33px}.prequote-total small{color:rgba(255,255,255,.64)}
      .prequote-toolbar{display:flex;gap:10px;margin:16px 0}.prequote-search{flex:1;display:flex;align-items:center;gap:8px;background:#fff;border:1px solid rgba(13,61,44,.11);border-radius:14px;padding:0 13px;box-shadow:0 8px 25px rgba(13,61,44,.04)}.prequote-search span{color:#6c8479;font-size:18px}.prequote-search input{width:100%;border:0;outline:0;padding:12px 0;background:transparent}.prequote-toolbar select,.prequote-refresh{border:1px solid rgba(13,61,44,.11);background:#fff;border-radius:14px;padding:0 14px;color:#214b3a;font-weight:800}.prequote-refresh{cursor:pointer}.prequote-error{padding:12px 14px;background:#fff1ef;border:1px solid #f0c2ba;color:#8b392b;border-radius:13px;margin-bottom:12px}
      .prequote-table-shell{background:#fff;border:1px solid rgba(13,61,44,.09);border-radius:22px;overflow:hidden;box-shadow:0 20px 55px rgba(13,61,44,.07)}.prequote-table-head{display:flex;justify-content:space-between;padding:13px 18px;border-bottom:1px solid #edf1ee;color:#456656;font-size:12px;font-weight:800}.prequote-table-scroll{overflow:auto}.prequote-table{width:100%;border-collapse:collapse;min-width:1020px}.prequote-table th{padding:13px 15px;text-align:left;background:#f8faf9;color:#71847a;font-size:10px;text-transform:uppercase;letter-spacing:.075em}.prequote-table td{padding:14px 15px;border-top:1px solid #edf1ee;font-size:12px;color:#2e493d}.prequote-table td strong{display:block;color:#183e30}.prequote-table td small{display:block;color:#829188;margin-top:4px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.prequote-table td button{border:1px solid #bdd5c6;background:#f2f8f4;color:#174a35;border-radius:10px;padding:7px 10px;font-weight:900;cursor:pointer}.prequote-table tbody tr:hover{background:#fbfdfc}.prequote-empty{text-align:center;padding:30px;color:#718078}.prequote-pagination{display:flex;justify-content:flex-end;align-items:center;gap:12px;padding:13px 16px;border-top:1px solid #edf1ee}.prequote-pagination button{border:1px solid #d7e2db;background:#fff;border-radius:10px;padding:8px 11px;font-weight:800;color:#244d3b}.prequote-pagination button:disabled{opacity:.4}.prequote-pagination span{font-size:12px;color:#63766c}
      .prequote-drawer-backdrop{position:fixed;inset:0;z-index:220;background:rgba(4,20,14,.42);backdrop-filter:blur(3px);display:flex;justify-content:flex-end}.prequote-drawer{position:relative;width:min(520px,94vw);height:100%;overflow:auto;background:#f8faf9;padding:34px 30px;box-shadow:-24px 0 70px rgba(0,0,0,.18)}.prequote-close{position:absolute;right:22px;top:20px;border:0;background:#e7efea;color:#244c3a;width:34px;height:34px;border-radius:11px;font-size:22px;cursor:pointer}.prequote-drawer h3{font-size:29px;margin:9px 0 4px;color:#123b2b;letter-spacing:-.04em}.prequote-drawer-service{color:#5f746a;margin:0 0 22px}.prequote-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.prequote-detail-grid>div,.prequote-property,.prequote-notes{padding:14px;border:1px solid #dfe8e2;background:#fff;border-radius:15px}.prequote-detail-grid .wide{grid-column:1/-1}.prequote-detail-grid span,.prequote-notes>span{display:block;color:#819087;text-transform:uppercase;letter-spacing:.07em;font-size:9px;font-weight:950;margin-bottom:5px}.prequote-detail-grid strong{font-size:12px;color:#264b3a;overflow-wrap:anywhere}.prequote-property{margin-top:12px}.prequote-property h4{margin:0 0 10px;color:#244b39}.prequote-property>div{display:grid;grid-template-columns:1fr 1fr;gap:7px}.prequote-property span{padding:10px;background:#f4f8f5;border-radius:10px}.prequote-property small{display:block;font-size:9px;color:#849087;margin-bottom:3px}.prequote-property strong{font-size:11px;color:#214838}.prequote-notes{margin-top:12px}.prequote-notes p{font-size:12px;line-height:1.55;color:#52665d;margin:0}
      @media(max-width:980px){.master-content{padding:24px 18px 50px!important}.prequote-overview{flex-direction:column}.prequote-toolbar{flex-direction:column}.prequote-toolbar select,.prequote-refresh{min-height:44px}.prequote-detail-grid,.prequote-property>div{grid-template-columns:1fr}.prequote-detail-grid .wide{grid-column:auto}}
    `}</style>
    {panel}
  </>;
}
