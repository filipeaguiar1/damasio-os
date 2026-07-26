"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { PremiumMetricCard, PremiumMobileHeader, PremiumMobileNav } from "@/components/mobile/PremiumMobileChrome";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Company = { id: string; name: string; active: boolean; plan_name?: string; deleted_at?: string | null };
type Member = { id: string; company_id: string; kind: "admin" | "employee" | "customer"; name: string; active: boolean };
type Lead = { id: string; full_name: string; status: string; assigned_company_id?: string | null; created_at?: string };

type MasterData = {
  masterName: string;
  companies: Company[];
  members: Member[];
  leads: Lead[];
};

const EMPTY: MasterData = { masterName: "Master Admin", companies: [], members: [], leads: [] };

export default function MobileMasterDashboard() {
  const [data, setData] = useState<MasterData>(EMPTY);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const supabase = getSupabaseBrowserClient() as any;
        const { data: auth } = await supabase.auth.getSession();
        const token = auth.session?.access_token;
        if (!token) throw new Error("Your Master login expired. Sign in again.");
        const [{ data: user }, response] = await Promise.all([
          supabase.from("profiles").select("full_name").eq("id", auth.session.user.id).maybeSingle(),
          fetch("/api/master/companies", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }),
        ]);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Master information could not be loaded.");
        const next: MasterData = {
          masterName: user?.full_name || "Master Admin",
          companies: result.companies || [],
          members: result.members || [],
          leads: result.leads || [],
        };
        setData(next);
        setSelectedCompanyId((current) => current || next.companies.find((company) => company.active && !company.deleted_at)?.id || "");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Master information could not be loaded.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activeCompanies = useMemo(() => data.companies.filter((company) => company.active && !company.deleted_at), [data.companies]);
  const customers = useMemo(() => data.members.filter((member) => member.kind === "customer" && member.active), [data.members]);
  const employees = useMemo(() => data.members.filter((member) => member.kind === "employee" && member.active), [data.members]);
  const activeUsers = useMemo(() => data.members.filter((member) => member.active), [data.members]);
  const selectedCompany = activeCompanies.find((company) => company.id === selectedCompanyId) || activeCompanies[0] || null;
  const selectedMembers = selectedCompany ? data.members.filter((member) => member.company_id === selectedCompany.id && member.active) : [];
  const selectedCustomers = selectedMembers.filter((member) => member.kind === "customer").length;
  const selectedEmployees = selectedMembers.filter((member) => member.kind === "employee").length;
  const pendingLeads = data.leads.filter((lead) => ["new", "offered"].includes(lead.status)).length;
  const todayKey = new Date().toISOString().slice(0, 10);
  const leadsToday = data.leads.filter((lead) => String(lead.created_at || "").slice(0, 10) === todayKey).length;

  const nav = [
    { id: "home", href: "/mobile/master", icon: "⌂", label: "Home" },
    { id: "companies", href: "/master", icon: "▦", label: "Companies" },
    { id: "finance", href: "/master", icon: "$", label: "Finance" },
    { id: "leads", href: "/master", icon: "♙", label: "Leads" },
    { id: "more", href: "/master", icon: "⋮", label: "More" },
  ];

  return (
    <MobileRoleGuard allowed={["master"]}>
      <main className="premium-mobile-page">
        <PremiumMobileHeader role="MASTER" name={data.masterName} subtitle="Master Dashboard" menuHref="/master" notificationHref="/master" />
        <section className="premium-mobile-content">
          {error && <p className="mobile-message mobile-error" role="alert">{error}</p>}
          <div className="premium-mobile-metrics">
            <PremiumMetricCard href="/master" icon="▦" label="Active Companies" value={loading ? "…" : activeCompanies.length} note="Connected organizations" />
            <PremiumMetricCard href="/master" icon="♙" label="Total Customers" value={loading ? "…" : customers.length} note="Across the platform" />
            <PremiumMetricCard href="/master" icon="♟" label="Employees" value={loading ? "…" : employees.length} note={`${activeUsers.length} active users`} />
            <PremiumMetricCard href="/master" icon="＋" label="New Leads" value={loading ? "…" : leadsToday} note={`${pendingLeads} awaiting review`} tone="gold" />
          </div>

          <div className="premium-two-column">
            <section className="premium-panel premium-company-card">
              <span>COMPANIES</span>
              <div className="premium-company-select"><i>✦</i><div><strong>{selectedCompany?.name || "No active company"}</strong><small>{selectedCompany?.plan_name || "Select a company in Master"}</small></div><b>⌄</b></div>
              <div className="premium-company-kpis">
                <div><span>Customers</span><strong>{selectedCustomers}</strong><small>Connected</small></div>
                <div><span>Employees</span><strong>{selectedEmployees}</strong><small>Active</small></div>
                <div><span>Pending Leads</span><strong>{data.leads.filter((lead) => lead.assigned_company_id === selectedCompany?.id && ["new", "offered"].includes(lead.status)).length}</strong><small>Review</small></div>
                <div><span>Plan</span><strong>{selectedCompany?.plan_name || "—"}</strong><small>Subscription</small></div>
              </div>
              <Link className="premium-gold-button" href="/master">View Company <b>›</b></Link>
            </section>

            <section className="premium-panel">
              <div className="premium-panel-head"><div><small>PLATFORM OVERVIEW</small><h2>Live network</h2></div><Link href="/master">Open Master</Link></div>
              <div className="premium-summary-list">
                <div className="premium-summary-item"><i>▦</i><div><span>Active companies</span><strong>{activeCompanies.length}</strong><small>Tenant isolation enabled</small></div></div>
                <div className="premium-summary-item"><i>♙</i><div><span>Customers</span><strong>{customers.length}</strong><small>Connected to companies</small></div></div>
                <div className="premium-summary-item"><i>◇</i><div><span>Lead Center</span><strong>{pendingLeads}</strong><small>Awaiting Master action</small></div></div>
              </div>
            </section>
          </div>

          <div className="premium-two-column">
            <section className="premium-panel">
              <div className="premium-panel-head"><div><small>LEADS & ACCESS</small><h2>Platform activity</h2></div><Link href="/master">Review</Link></div>
              <div className="premium-list">
                <div className="premium-list-row"><i>＋</i><div><strong>New leads today</strong><span>Customers entering the platform</span></div><b>{leadsToday}</b></div>
                <div className="premium-list-row"><i>◇</i><div><strong>Pending leads</strong><span>Need company assignment or response</span></div><b className="gold">{pendingLeads}</b></div>
                <div className="premium-list-row"><i>✓</i><div><strong>Active users</strong><span>Admins, employees and customers</span></div><b>{activeUsers.length}</b></div>
              </div>
            </section>

            <section className="premium-panel">
              <div className="premium-panel-head"><div><small>COMPANY NETWORK</small><h2>Connected accounts</h2></div></div>
              <div className="premium-summary-list">
                <div className="premium-summary-item"><i>✦</i><div><span>Admins</span><strong>{data.members.filter((member) => member.kind === "admin" && member.active).length}</strong><small>Company administrators</small></div></div>
                <div className="premium-summary-item"><i>♟</i><div><span>Employees</span><strong>{employees.length}</strong><small>Field users</small></div></div>
                <div className="premium-summary-item"><i>○</i><div><span>Customers</span><strong>{customers.length}</strong><small>Customer portal users</small></div></div>
              </div>
            </section>
          </div>

          <section className="premium-promo"><div><strong>Grow the platform with 4Ever Seasons</strong><span>Companies, users and operational data remain isolated and connected.</span></div><Link href="/master">View Analytics</Link></section>
        </section>
        <PremiumMobileNav items={nav} active="home" />
      </main>
    </MobileRoleGuard>
  );
}
