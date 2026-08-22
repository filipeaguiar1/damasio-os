"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function MasterRequestedPolish() {
  const [quoteSearchHost, setQuoteSearchHost] = useState<HTMLElement | null>(null);
  const [quoteTable, setQuoteTable] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(0);
  const [total, setTotal] = useState(0);
  const [quotesVisible, setQuotesVisible] = useState(false);
  const hostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let stopped = false;
    const sync = () => {
      if (stopped) return;
      const heading = Array.from(document.querySelectorAll<HTMLElement>(".master-header h2"))
        .find(node => node.textContent?.trim() === "Quote Review");
      if (!heading) {
        hostRef.current?.remove();
        hostRef.current = null;
        setQuoteSearchHost(null);
        setQuoteTable(null);
        setQuotesVisible(false);
        return;
      }
      const header = heading.closest<HTMLElement>(".master-header");
      if (!header?.parentElement) return;
      const table = Array.from(header.parentElement.children)
        .find(node => node instanceof HTMLElement && node.classList.contains("master-table-wrap")) as HTMLElement | undefined;
      if (!table) return;
      if (!hostRef.current || !hostRef.current.isConnected) {
        const host = document.createElement("div");
        host.className = "master-quote-search-host";
        table.insertAdjacentElement("beforebegin", host);
        hostRef.current = host;
        setQuoteSearchHost(host);
      }
      setQuoteTable(table);
      setQuotesVisible(table.style.display !== "none");
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    return () => {
      stopped = true;
      observer.disconnect();
      hostRef.current?.remove();
      hostRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!quoteTable) return;
    const rows = Array.from(quoteTable.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    const needle = query.trim().toLowerCase();
    let count = 0;
    rows.forEach(row => {
      const match = !needle || (row.textContent || "").toLowerCase().includes(needle);
      row.style.display = match ? "" : "none";
      if (match) count += 1;
    });
    setTotal(rows.length);
    setVisible(count);
    return () => rows.forEach(row => { row.style.display = ""; });
  }, [quoteTable, query, quotesVisible]);

  return <>
    <style>{`
      .master-sidebar nav a{
        min-height:44px!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;
        padding:11px 12px!important;border-radius:13px!important;color:rgba(255,255,255,.76)!important;font-weight:800!important;text-decoration:none!important;
        border:1px solid transparent!important;background:transparent!important;transition:background .16s ease,transform .16s ease,color .16s ease!important;
      }
      .master-sidebar nav a:hover{background:rgba(255,255,255,.08)!important;color:#fff!important;transform:translateX(2px)}
      .master-sidebar nav a.active{background:rgba(255,255,255,.12)!important;color:#fff!important;border-color:rgba(255,255,255,.08)!important;box-shadow:inset 3px 0 0 #a8dac0!important}
      .customer-master-sidebar{padding:26px 20px!important}.customer-master-sidebar nav{display:grid!important;gap:5px!important}.customer-master-content{padding:38px 44px 60px!important}
      .master-quote-search-host{margin:-4px 0 16px}.master-quote-searchbar{display:flex;align-items:center;gap:10px;max-width:720px}
      .master-quote-searchbox{flex:1;display:flex;align-items:center;gap:9px;background:#fff;border:1px solid rgba(13,61,44,.12);border-radius:15px;padding:0 14px;box-shadow:0 8px 24px rgba(13,61,44,.045)}
      .master-quote-searchbox span{color:#527062;font-size:18px}.master-quote-searchbox input{width:100%;border:0;outline:0;background:transparent;padding:12px 0;color:#16352a;font-size:13px}
      .master-quote-searchcount{white-space:nowrap;border:1px solid rgba(13,61,44,.1);background:#eef4f0;color:#476859;border-radius:12px;padding:10px 12px;font-size:11px;font-weight:900}
      @media(max-width:760px){.customer-master-content{padding:24px 18px 42px!important}.master-quote-searchbar{align-items:stretch;flex-direction:column}.master-quote-searchcount{width:max-content}}
      @media(prefers-reduced-motion:reduce){.master-sidebar nav a{transition:none!important}.master-sidebar nav a:hover{transform:none}}
    `}</style>
    {quoteSearchHost && quotesVisible ? createPortal(
      <div className="master-quote-searchbar">
        <label className="master-quote-searchbox"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search quote, customer, email, service or address" aria-label="Search quotes" /></label>
        <div className="master-quote-searchcount">{visible} of {total}</div>
      </div>,
      quoteSearchHost,
    ) : null}
  </>;
}
