"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileCustomerNav } from "@/components/mobile/MobileCustomerNav";
import { useCustomerWallet } from "@/lib/hooks/useCustomerWallet";

const PAGE_SIZE = 10;

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function pageItems(current: number, total: number): Array<number | "ellipsis-left" | "ellipsis-right"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "ellipsis-right", total];
  if (current >= total - 3) return [1, "ellipsis-left", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "ellipsis-left", current - 1, current, current + 1, "ellipsis-right", total];
}

function BalanceHistoryContent() {
  const wallet = useCustomerWallet();
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(wallet.transactions.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = useMemo(() => wallet.transactions.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [wallet.transactions, safePage]);
  const pages = pageItems(safePage, pageCount);

  return (
    <MobileRoleGuard allowed={["customer"]}>
      <main className="mobile-app-shell role-mobile-shell mobile-customer-subpage">
        <header className="role-mobile-topbar">
          <MobileBackButton fallback="/mobile/customer/payments" />
          <div><strong>Balance history</strong><span>Account ledger</span></div>
          <Link href="/mobile/customer/profile" className="role-mobile-avatar role-mobile-profile-avatar" aria-label="Open customer profile">CU</Link>
        </header>

        <section className="customer-native-hero payments">
          <span>ACCOUNT BALANCE</span>
          <h1>{money(wallet.balanceCredits)} available.</h1>
          <p>{wallet.transactions.length} transaction{wallet.transactions.length === 1 ? "" : "s"} recorded.</p>
        </section>

        <section className="customer-payment-native">
          <div className="customer-history-summary"><span>Page {safePage} of {pageCount}</span><strong>{PAGE_SIZE} transactions per page</strong></div>
          {wallet.loading ? <div className="customer-native-empty"><i>…</i><strong>Loading history</strong><p>Checking your account ledger.</p></div> : rows.length ? <div className="customer-wallet-history-box customer-wallet-history-full"><div className="customer-wallet-history">{rows.map((item) => <article key={item.id}><div><strong>{item.description || item.type}</strong><span>{new Date(item.createdAt).toLocaleString("en-CA")}</span></div><b>{item.credits > 0 ? "+" : ""}{money(item.credits)}</b></article>)}</div></div> : <div className="customer-native-empty"><i>$</i><strong>No balance activity</strong><p>Your financial movements will appear here.</p></div>}

          <nav className="customer-history-pagination" aria-label="Balance history pages">
            <button disabled={safePage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</button>
            {pages.map((item) => typeof item === "number" ? <button key={item} className={safePage === item ? "active" : ""} onClick={() => setPage(item)}>{item}</button> : <span key={item}>…</span>)}
            <button disabled={safePage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>›</button>
          </nav>
        </section>

        <MobileCustomerNav active="billing" />
      </main>
    </MobileRoleGuard>
  );
}

export default function CustomerBalanceHistoryPage() {
  return (
    <Suspense fallback={<main className="mobile-app-shell role-mobile-shell mobile-customer-subpage"><div className="customer-native-empty"><i>…</i><strong>Loading history</strong><p>Preparing your account ledger.</p></div></main>}>
      <BalanceHistoryContent />
    </Suspense>
  );
}
