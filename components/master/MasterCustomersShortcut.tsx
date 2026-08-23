"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type QuoteRemovalItem = {
  id: string;
  source: "server" | "local";
  stage: "prequote" | "submitted";
  customer: string;
  email?: string;
  phone?: string;
  address?: string;
  service?: string;
  status?: string;
  createdAt?: string;
  number?: string;
};

const LOCAL_ESTIMATE_KEY = "damasio_os_estimates";
const REOPEN_QUOTES_KEY = "damasio_master_reopen_quotes";
const STYLE_ID = "damasio-master-navigation-runtime-style";

function installMasterNavigationStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .master-sidebar{overflow:hidden!important}
    .master-sidebar nav{
      max-height:calc(100dvh - 250px)!important;
      overflow-y:auto!important;
      overscroll-behavior:contain;
      padding-right:4px!important;
      scrollbar-width:thin;
      scrollbar-color:rgba(196,219,207,.55) transparent;
    }
    .master-sidebar nav::-webkit-scrollbar{width:6px}
    .master-sidebar nav::-webkit-scrollbar-track{background:transparent}
    .master-sidebar nav::-webkit-scrollbar-thumb{background:rgba(196,219,207,.48);border-radius:999px}
    .master-sidebar nav a{
      min-height:43px!important;
      display:flex!important;
      align-items:center!important;
      justify-content:space-between!important;
      gap:12px!important;
      padding:10px 12px!important;
      border:1px solid #285243!important;
      border-radius:10px!important;
      background:#0d392b!important;
      color:#d2e1d9!important;
      font-weight:760!important;
      line-height:1.15!important;
      text-decoration:none!important;
      box-sizing:border-box!important;
      box-shadow:0 2px 5px rgba(3,24,17,.045)!important;
    }
    .master-sidebar nav a:hover{
      color:#fff!important;
      background:#124735!important;
      border-color:#3b6755!important;
    }
    .master-sidebar nav a.active{
      color:#103c2b!important;
      background:#edf4ef!important;
      border-color:#b8cfc1!important;
      box-shadow:0 8px 17px rgba(3,24,17,.16)!important;
    }
    .master-sidebar nav a>span{
      min-width:25px!important;
      min-height:23px!important;
      display:grid!important;
      place-items:center!important;
      padding:0 6px!important;
      border-radius:7px!important;
      background:rgba(255,255,255,.08)!important;
      border:1px solid rgba(255,255,255,.09)!important;
      color:inherit!important;
      font-size:10px!important;
      font-weight:850!important;
    }
    .master-sidebar nav a.active>span{
      background:#dbe9e0!important;
      border-color:#c5d9cc!important;
    }
    .master-nav-portal-link{flex:none!important}
    .master-quote-remove-trigger{white-space:nowrap}
    .master-quote-removal-backdrop{
      position:fixed;inset:0;z-index:10050;display:grid;place-items:center;
      padding:24px;background:rgba(5,22,16,.58);backdrop-filter:blur(3px)
    }
    .master-quote-removal-modal{
      width:min(720px,100%);max-height:min(720px,86dvh);display:flex;flex-direction:column;
      overflow:hidden;border:1px solid #bfd0c5;border-radius:18px;background:#f8faf8;
      color:#17281f;box-shadow:0 28px 70px rgba(4,25,17,.34)
    }
    .master-quote-removal-head{
      display:flex;align-items:flex-start;justify-content:space-between;gap:18px;
      padding:20px 22px;border-bottom:1px solid #d8e2dc;background:#eef4f0
    }
    .master-quote-removal-head h3{margin:2px 0 4px;font-size:23px;letter-spacing:-.025em}
    .master-quote-removal-head p{margin:0;color:#65756c;font-size:13px;line-height:1.45}
    .master-quote-removal-head button{
      width:36px;height:36px;border:1px solid #c4d2c9;border-radius:10px;background:#fff;
      color:#214736;font-size:22px;cursor:pointer
    }
    .master-quote-removal-tools{
      display:flex;align-items:center;justify-content:space-between;gap:12px;
      padding:12px 18px;border-bottom:1px solid #e0e7e3;background:#fff
    }
    .master-quote-removal-tools label{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800}
    .master-quote-removal-tools span{font-size:12px;color:#6b7a72}
    .master-quote-removal-list{overflow:auto;padding:10px 14px 14px;display:grid;gap:8px}
    .master-quote-removal-item{
      display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;
      padding:12px 13px;border:1px solid #d4dfd8;border-radius:12px;background:#fff;cursor:pointer
    }
    .master-quote-removal-item:hover{border-color:#9fb8aa;background:#f5f9f6}
    .master-quote-removal-item input{width:18px;height:18px;accent-color:#126b49}
    .master-quote-removal-copy{display:grid;gap:3px;min-width:0}
    .master-quote-removal-copy strong{font-size:14px;color:#18382a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .master-quote-removal-copy small{font-size:12px;color:#6b7a72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .master-quote-removal-stage{
      padding:5px 8px;border-radius:999px;background:#e5efe9;color:#2b5b43;
      font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.04em
    }
    .master-quote-removal-stage.prequote{background:#f2ead6;color:#725b22}
    .master-quote-removal-empty{padding:34px 18px;text-align:center;color:#718078}
    .master-quote-removal-message{margin:0 18px 10px;padding:10px 12px;border-radius:9px;background:#f5e8e5;color:#7a3026;font-size:12px}
    .master-quote-removal-actions{
      display:flex;justify-content:flex-end;gap:10px;padding:14px 18px;
      border-top:1px solid #dce5df;background:#f4f7f5
    }
    .master-quote-removal-actions button{
      min-height:40px;padding:0 15px;border-radius:9px;border:1px solid #b9c9c0;
      background:#fff;color:#234a38;font-weight:850;cursor:pointer
    }
    .master-quote-removal-actions button.danger{background:#8f2f27;border-color:#8f2f27;color:#fff}
    .master-quote-removal-actions button:disabled{opacity:.48;cursor:not-allowed}
    @media(max-width:720px){
      .master-sidebar nav{max-height:none!important;overflow:visible!important;padding-right:0!important}
      .master-quote-removal-backdrop{padding:12px}
      .master-quote-removal-modal{max-height:90dvh;border-radius:14px}
      .master-quote-removal-item{grid-template-columns:auto 1fr}
      .master-quote-removal-stage{grid-column:2;justify-self:start}
      .master-quote-removal-actions{flex-wrap:wrap}
    }
  `;
  document.head.appendChild(style);
}

function localQuoteItems(): QuoteRemovalItem[] {
  if (typeof window === "undefined") return [];
  try {
    const rows = JSON.parse(window.localStorage.getItem(LOCAL_ESTIMATE_KEY) || "[]") as any[];
    return rows.map((row) => ({
      id: String(row.id),
      source: "local" as const,
      stage: "submitted" as const,
      customer: String(row.customer || "Customer"),
      email: String(row.email || ""),
      phone: String(row.phone || ""),
      address: String(row.address || ""),
      service: String(row.title || "Property service"),
      status: String(row.status || "draft"),
      createdAt: String(row.createdAt || ""),
      number: String(row.number || ""),
    }));
  } catch {
    return [];
  }
}

async function masterAccessToken() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  return String(data.session?.access_token || "");
}

export function MasterCustomersShortcut() {
  const pathname = usePathname();
  const [nav, setNav] = useState<HTMLElement | null>(null);
  const [quoteToolbar, setQuoteToolbar] = useState<HTMLElement | null>(null);
  const [bodyReady, setBodyReady] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [quoteItems, setQuoteItems] = useState<QuoteRemovalItem[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteMessage, setQuoteMessage] = useState("");

  const refreshQuoteItems = useCallback(async () => {
    setQuoteBusy(true);
    setQuoteMessage("");
    try {
      const token = await masterAccessToken();
      let serverItems: QuoteRemovalItem[] = [];
      if (token) {
        const response = await fetch("/api/master/quote-management", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Quote records could not be loaded.");
        serverItems = (result.items || []).map((item: any) => ({ ...item, source: "server" as const }));
      }
      const hasServerSubmitted = serverItems.some((item) => item.stage === "submitted");
      const localItems = hasServerSubmitted ? [] : localQuoteItems();
      setQuoteItems([...serverItems, ...localItems]);
      setSelectedKeys((current) => current.filter((key) => [...serverItems, ...localItems].some((item) => `${item.source}:${item.id}` === key)));
    } catch (error) {
      setQuoteMessage(error instanceof Error ? error.message : "Quote records could not be loaded.");
    } finally {
      setQuoteBusy(false);
    }
  }, []);

  useEffect(() => {
    setBodyReady(true);
    installMasterNavigationStyles();

    const sync = () => {
      const nextNav = document.querySelector<HTMLElement>(".master-sidebar nav");
      const nextToolbar = document.querySelector<HTMLElement>(".master-quote-toolbar");
      setNav((current) => current === nextNav ? current : nextNav);
      setQuoteToolbar((current) => current === nextToolbar ? current : nextToolbar);

      document.querySelectorAll<HTMLAnchorElement>('a[href="/master/pricing"],a[href="/master/payments"]').forEach((link) => {
        if (link.closest(".master-sidebar nav")) return;
        if (link.dataset.masterFloatingHidden === "1") return;
        link.dataset.masterFloatingHidden = "1";
        link.style.setProperty("display", "none", "important");
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/master" || !nav) return;
    if (window.sessionStorage.getItem(REOPEN_QUOTES_KEY) !== "1") return;
    const quoteButton = Array.from(nav.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Quote Review"));
    if (!quoteButton) return;
    window.sessionStorage.removeItem(REOPEN_QUOTES_KEY);
    quoteButton.click();
  }, [nav, pathname]);

  useEffect(() => {
    if (pathname === "/master" && quoteToolbar) void refreshQuoteItems();
  }, [pathname, quoteToolbar, refreshQuoteItems]);

  const allSelected = useMemo(
    () => quoteItems.length > 0 && quoteItems.every((item) => selectedKeys.includes(`${item.source}:${item.id}`)),
    [quoteItems, selectedKeys],
  );

  function toggleItem(item: QuoteRemovalItem) {
    const key = `${item.source}:${item.id}`;
    setSelectedKeys((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  }

  function toggleAll() {
    if (allSelected) return setSelectedKeys([]);
    setSelectedKeys(quoteItems.map((item) => `${item.source}:${item.id}`));
  }

  async function removeSelectedQuotes() {
    if (!selectedKeys.length || quoteBusy) return;
    const selectedItems = quoteItems.filter((item) => selectedKeys.includes(`${item.source}:${item.id}`));
    const label = selectedItems.length === 1 ? "this quote record" : `these ${selectedItems.length} quote records`;
    if (!window.confirm(`Remove ${label}? This removes the quote/pre-quote from Master Quote Review and cannot be undone.`)) return;

    setQuoteBusy(true);
    setQuoteMessage("");
    try {
      const serverIds = selectedItems.filter((item) => item.source === "server").map((item) => item.id);
      const localIds = new Set(selectedItems.filter((item) => item.source === "local").map((item) => item.id));

      if (serverIds.length) {
        const token = await masterAccessToken();
        if (!token) throw new Error("Your Master session expired. Sign in again.");
        const response = await fetch("/api/master/quote-management", {
          method: "DELETE",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ ids: serverIds }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "The selected quote records could not be removed.");
      }

      if (localIds.size) {
        const rows = JSON.parse(window.localStorage.getItem(LOCAL_ESTIMATE_KEY) || "[]") as any[];
        window.localStorage.setItem(LOCAL_ESTIMATE_KEY, JSON.stringify(rows.filter((row) => !localIds.has(String(row.id)))));
        window.dispatchEvent(new Event("storage"));
      }

      window.sessionStorage.setItem(REOPEN_QUOTES_KEY, "1");
      window.location.reload();
    } catch (error) {
      setQuoteMessage(error instanceof Error ? error.message : "The selected quote records could not be removed.");
      setQuoteBusy(false);
    }
  }

  const navigation = nav ? createPortal(
    <>
      {pathname !== "/master/customers" && (
        <Link className="master-nav-portal-link" href="/master/customers">Customers <span aria-hidden="true">›</span></Link>
      )}
      <Link className={`master-nav-portal-link ${pathname === "/master/pricing" ? "active" : ""}`} href="/master/pricing">Pricing & Memberships <span aria-hidden="true">$</span></Link>
      <Link className={`master-nav-portal-link ${pathname === "/master/payments" ? "active" : ""}`} href="/master/payments">Payments & Contracts <span aria-hidden="true">$</span></Link>
    </>,
    nav,
  ) : null;

  const removalTrigger = quoteToolbar ? createPortal(
    <button
      type="button"
      className="master-inline-button master-quote-remove-trigger"
      onClick={() => { setRemoveOpen(true); void refreshQuoteItems(); }}
    >
      Select to remove{quoteItems.length ? ` (${quoteItems.length})` : ""}
    </button>,
    quoteToolbar,
  ) : null;

  const removalModal = bodyReady && removeOpen ? createPortal(
    <div className="master-quote-removal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRemoveOpen(false); }}>
      <section className="master-quote-removal-modal" role="dialog" aria-modal="true" aria-labelledby="master-remove-quotes-title">
        <header className="master-quote-removal-head">
          <div><small>MASTER QUOTE DESK</small><h3 id="master-remove-quotes-title">Remove quote records</h3><p>Select submitted quotes or pre-quotes to remove from Quote Review.</p></div>
          <button type="button" aria-label="Close" onClick={() => setRemoveOpen(false)}>×</button>
        </header>
        <div className="master-quote-removal-tools">
          <label><input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!quoteItems.length || quoteBusy} /> Select all</label>
          <span>{selectedKeys.length} selected · {quoteItems.length} available</span>
        </div>
        {quoteMessage && <div className="master-quote-removal-message">{quoteMessage}</div>}
        <div className="master-quote-removal-list">
          {quoteBusy && !quoteItems.length ? <div className="master-quote-removal-empty">Loading quote records…</div> : quoteItems.map((item) => {
            const key = `${item.source}:${item.id}`;
            const meta = [item.number, item.service, item.email || item.phone, item.address].filter(Boolean).join(" · ");
            return <label key={key} className="master-quote-removal-item">
              <input type="checkbox" checked={selectedKeys.includes(key)} onChange={() => toggleItem(item)} />
              <span className="master-quote-removal-copy"><strong>{item.customer}</strong><small>{meta || item.id}</small></span>
              <span className={`master-quote-removal-stage ${item.stage}`}>{item.stage === "prequote" ? "Pre-quote" : "Submitted"}</span>
            </label>;
          })}
          {!quoteBusy && !quoteItems.length && <div className="master-quote-removal-empty">There are no removable quote records.</div>}
        </div>
        <footer className="master-quote-removal-actions">
          <button type="button" onClick={() => setRemoveOpen(false)}>Cancel</button>
          <button type="button" className="danger" disabled={!selectedKeys.length || quoteBusy} onClick={() => void removeSelectedQuotes()}>{quoteBusy ? "Removing…" : `Remove selected${selectedKeys.length ? ` (${selectedKeys.length})` : ""}`}</button>
        </footer>
      </section>
    </div>,
    document.body,
  ) : null;

  return <>{navigation}{removalTrigger}{removalModal}</>;
}
