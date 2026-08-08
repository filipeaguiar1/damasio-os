"use client";

import { useEffect, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Employee = {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  active: boolean;
  address_line1?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  route_start_address?: string | null;
  avatar_url?: string | null;
  daily_route_capacity?: number | null;
};

type Form = {
  fullName: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
  routeStartAddress: string;
  avatarUrl: string;
  dailyRouteCapacity: number;
  active: boolean;
};

async function api(options?: RequestInit) {
  const client = getSupabaseBrowserClient() as any;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in as Admin to manage employees.");
  const response = await fetch("/api/admin/users", {
    ...options,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(options?.headers || {}) },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Employee operation failed.");
  return result;
}

function formFrom(employee: Employee): Form {
  return {
    fullName: employee.full_name,
    email: employee.email,
    phone: employee.phone || "",
    addressLine1: employee.address_line1 || "",
    city: employee.city || "",
    province: employee.province || "ON",
    postalCode: employee.postal_code || "",
    routeStartAddress: employee.route_start_address || employee.address_line1 || "",
    avatarUrl: employee.avatar_url || "",
    dailyRouteCapacity: Math.max(1, Number(employee.daily_route_capacity || 16)),
    active: employee.active,
  };
}

export default function MobileEmployees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [message, setMessage] = useState("Loading employees...");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const result = await api();
      setEmployees(result.users || []);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Employees could not be loaded.");
    }
  }

  useEffect(() => { void refresh(); }, []);

  function open(employee: Employee) {
    setSelected(employee);
    setForm(formFrom(employee));
  }

  async function save(nextForm = form) {
    if (!selected || !nextForm) return;
    setBusy(true);
    try {
      const payload = {
        id: selected.id,
        ...nextForm,
        dailyRouteCapacity: Math.max(1, Math.trunc(Number(nextForm.dailyRouteCapacity || 0))),
        phone: nextForm.phone || null,
        addressLine1: nextForm.addressLine1 || null,
        city: nextForm.city || null,
        postalCode: nextForm.postalCode || null,
        routeStartAddress: nextForm.routeStartAddress || nextForm.addressLine1 || null,
        avatarUrl: nextForm.avatarUrl || null,
      };
      const result = await api({ method: "PATCH", body: JSON.stringify(payload) });
      const updated = result.user as Employee;
      setEmployees(rows => rows.map(row => row.id === selected.id ? updated : row));
      setSelected(updated);
      setForm(formFrom(updated));
      setMessage("Employee profile, route origin and daily capacity synchronized.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    if (!form) return;
    const next = { ...form, active: !form.active };
    setForm(next);
    await save(next);
  }

  async function remove() {
    if (!selected || !window.confirm(`Delete ${selected.full_name}'s access? Completed work and history will remain.`)) return;
    setBusy(true);
    try {
      const result = await api({ method: "DELETE", body: JSON.stringify({ id: selected.id }) });
      setEmployees(rows => rows.filter(row => row.id !== selected.id));
      setSelected(null);
      setForm(null);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Employee could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return <MobileRoleGuard allowed={["admin"]}><main className="mobile-app-shell role-mobile-shell mobile-native-subpage">
    <header className="role-mobile-topbar"><MobileBackButton fallback="/mobile/admin/more" /><div><strong>Employees</strong><span>Profiles and route capacity</span></div><button className="mobile-native-add mobile-native-check" onClick={() => void refresh()}>↻</button></header>
    <section className="mobile-native-hero"><span>WORKFORCE</span><h1>{employees.filter(employee => employee.active).length} active employees.</h1><p>Daily route capacity is controlled by the company Admin and used throughout Dispatch.</p></section>
    {message && <div className="mobile-native-message">{message}<button onClick={() => setMessage("")}>×</button></div>}
    <section className="mobile-native-route-list">{employees.map((employee, index) => <button type="button" key={employee.id} onClick={() => open(employee)}><b>{index + 1}</b><div><strong>{employee.full_name}</strong><span>{employee.email} · {employee.phone || "No phone"}</span><small>{employee.route_start_address || employee.address_line1 || "Route start not set"}</small></div><i className={employee.active ? "done" : ""}>{Math.max(1, Number(employee.daily_route_capacity || 16))}/day</i></button>)}{!employees.length && !message && <div className="mobile-native-empty"><i>♧</i><strong>No employees</strong><p>Invite an Employee from company users.</p></div>}</section>

    {selected && form && <div className="mobile-native-modal"><button className="mobile-native-scrim" onClick={() => { setSelected(null); setForm(null); }} /><section><header><div><span>EMPLOYEE PROFILE</span><h2>{selected.full_name}</h2></div><button onClick={() => { setSelected(null); setForm(null); }}>×</button></header>
      <label>Full name<input value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} /></label>
      <label>Email<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
      <label>Phone<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
      <label>Home address<AddressAutocomplete value={form.addressLine1} onChange={value => setForm({ ...form, addressLine1: value, routeStartAddress: form.routeStartAddress || value })} placeholder="Employee home address" /></label>
      <label>Default route start<AddressAutocomplete value={form.routeStartAddress} onChange={value => setForm({ ...form, routeStartAddress: value })} placeholder="Where routes normally start" /></label>
      <label>Maximum houses per day<input type="number" min="1" value={form.dailyRouteCapacity} onChange={event => setForm({ ...form, dailyRouteCapacity: Number(event.target.value) })} /></label>
      <button className="mobile-native-submit" disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : "Save profile"}</button>
      <div className="mobile-return-actions"><button disabled={busy} onClick={() => void toggle()}>{form.active ? "Deactivate" : "Activate"}</button><button disabled={busy} onClick={() => void remove()}>Delete employee</button></div>
    </section></div>}
  </main></MobileRoleGuard>;
}
