"use client";

import { Suspense, useMemo, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileCustomerNav } from "@/components/mobile/MobileCustomerNav";
import { useCustomerWallet } from "@/lib/hooks/useCustomerWallet";

const PAGE_SIZE = 10;

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function BalanceHistoryContent() {
  const wallet = useCustomerWallet();
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(wallet.transactions.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = useMemo(() => wallet.transactions.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [wallet.transactions, safePage]);

  return (
    <MobileRoleGuard allowed={["customer"]}>
      <main className="mobile-app-shell role-mobile-shell mobile-customer-subpage">
        <header className="role-mobile-topbar">
          <MobileBackButton fallback="/mobile/customer/payments" />
          <div><strong>Balance history</strong><span>Account transactions</span></div>
          <span className="role-mobile-avatar">$</span>
        </header>

        <section className="customer-native-hero payments">
          <span>ACCOUNT BALANCE</span>
          <h1>{money(wallet.balanceCredits)} available.</h1>
          <p>Deposits, payments, tips and adjustments.</p>
        </section>

        <section className="customer-payment-native">
          {wallet.loading ? <div className="customer-native-empty"><i>…</i><strong>Loading history</strong><p>Checking your account ledger.</p></div> : rows.length ? <div className="customer-wallet-history-box"><div className="customer-wallet-history">{rows.map((item) => <article key={item.id}><div><strong>{item.description || item.type}</strong><span>{new Date(item.createdAt).toLocaleString("en-CA")}</span></div><b>{item.credits > 0 ? "+" : ""}{money(item.credits)}</b></article>)}</div></div> : <div className="customer-native-empty"><i>$</i><strong>No balance activity</strong><p>Your financial movements will appear here.</p></div>}

          {pageCount > 1 && <nav className="customer-history-pagination" aria-label="Balance history pages">
            <button disabled={safePage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => <button key={number} className={safePage === number ? "active" : ""} onClick={() => setPage(number)}>{number}</button>)}
            <button disabled={safePage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>›</button>
          </nav>}
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
