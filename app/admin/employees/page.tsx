"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type EmployeeContract = {
  id: string;
  customerName: string;
  address: string;
  serviceName: string;
  customerId: string | null;
  propertyId: string | null;
};

type Employee = {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  active: boolean;
  avatar_url?: string | null;
  address_line1?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  route_start_address?: string | null;
  daily_route_capacity?: number | null;
  invite_status?: string | null;
  crew_id?: string | null;
  contracts?: EmployeeContract[];
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
  dailyRouteCapacity: number;
  avatarUrl: string;
  active: boolean;
};

const blank: Form = {
  fullName: "",
  email: "",
  phone: "",
  addressLine1: "",
  city: "",
  province: "ON",
  postalCode: "",
  routeStartAddress: "",
  dailyRouteCapacity: 16,
  avatarUrl: "",
  active: true,
};

async function api(options?: RequestInit) {
  const client = getSupabaseBrowserClient() as any;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in with a real Admin account to manage employees.");
  const response = await fetch("/api/admin/users", {
    ...options,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(options?.headers || {}) },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Employee operation failed.");
  return result;
}

function fromEmployee(employee: Employee): Form {
  return {
    fullName: employee.full_name,
    email: employee.email,
    phone: employee.phone || "",
    addressLine1: employee.address_line1 || "",
    city: employee.city || "",
    province: employee.province || "ON",
    postalCode: employee.postal_code || "",
    routeStartAddress: employee.route_start_address || employee.address_line1 || "",
    dailyRouteCapacity: Math.max(1, Number(employee.daily_route_capacity || 16)),
    avatarUrl: employee.avatar_url || "",
    active: employee.active,
  };
}

const CONTRACTS_PER_PAGE = 18;
const EXPANDED_STORAGE_KEY = "damasio:employee-contracts-expanded";

export default function EmployeesPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Form>(blank);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contractPages, setContractPages] = useState<Record<string, number>>({});

  async function refresh() {
    setBusy(true);
    try {
      const result = await api();
      const client = getSupabaseBrowserClient() as any;
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      const routeResponse = await fetch("/api/admin/routes", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const routeResult = await routeResponse.json().catch(() => ({ employees: [], board: {} }));
      if (!routeResponse.ok) throw new Error(routeResult.error || "Employee contracts could not be loaded.");

      const routeEmployees = new Map(
        (routeResult.employees || []).map((item: any) => [String(item.id), item]),
      );
      const assignedJobs = routeResult.board?.assignedJobs || [];
      const nextEmployees = (result.users || []).map((employee: Employee) => {
        const routeEmployee: any = routeEmployees.get(employee.id);
        const crewId = String(routeEmployee?.crewId || "");
        return {
          ...employee,
          crew_id: crewId || null,
          contracts: assignedJobs
            .filter((job: any) => crewId && String(job.crewId || "") === crewId)
            .map((job: any) => ({
              id: String(job.id),
              customerName: String(job.customerName || "Customer"),
              address: String(job.address || "Address missing"),
              serviceName: String(job.serviceName || "Property Service"),
              customerId: job.customerId ? String(job.customerId) : null,
              propertyId: job.propertyId ? String(job.propertyId) : null,
            }))
            .sort((left: EmployeeContract, right: EmployeeContract) =>
              left.address.localeCompare(right.address)),
        };
      });
      setEmployees(nextEmployees);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Employees could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(EXPANDED_STORAGE_KEY) || "[]");
      if (Array.isArray(saved)) setExpandedIds(new Set(saved.map(String)));
    } catch {
      setExpandedIds(new Set());
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      EXPANDED_STORAGE_KEY,
      JSON.stringify([...expandedIds]),
    );
  }, [expandedIds]);

  function toggleContracts(employeeId: string) {
    setExpandedIds(current => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  function openContract(contract: EmployeeContract) {
    if (contract.customerId) {
      router.push(`/admin/customers/${contract.customerId}`);
    }
  }

  const counts = useMemo(() => ({
    active: employees.filter(item => item.active).length,
    capacity: employees.filter(item => item.active).reduce((sum, item) => sum + Math.max(1, Number(item.daily_route_capacity || 16)), 0),
    pending: employees.filter(item => ["sent", "pending"].includes(item.invite_status || "")).length,
  }), [employees]);

  function open(employee: Employee) {
    setCreating(false);
    setSelected(employee);
    setForm(fromEmployee(employee));
  }

  function startCreate() {
    setSelected(null);
    setCreating(true);
    setForm(blank);
    setMessage("");
  }

  function close() {
    setSelected(null);
    setCreating(false);
    setForm(blank);
  }

  async function uploadPhoto(file: File) {
    const client = getSupabaseBrowserClient() as any;
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await client.storage.from("employee-avatars").upload(path, file, { upsert: false });
    if (error) throw new Error(error.message);
    const { data } = client.storage.from("employee-avatars").getPublicUrl(path);
    setForm(current => ({ ...current, avatarUrl: data.publicUrl }));
  }

  async function save() {
    const capacity = Math.max(1, Math.trunc(Number(form.dailyRouteCapacity || 0)));
    setBusy(true);
    try {
      const payload = {
        ...form,
        dailyRouteCapacity: capacity,
        phone: form.phone || null,
        addressLine1: form.addressLine1 || null,
        city: form.city || null,
        postalCode: form.postalCode || null,
        routeStartAddress: form.routeStartAddress || form.addressLine1 || null,
        avatarUrl: form.avatarUrl || null,
      };
      const result = await api({
        method: creating ? "POST" : "PATCH",
        body: JSON.stringify(creating ? payload : { id: selected?.id, ...payload }),
      });
      close();
      await refresh();
      setMessage(result.message || `${form.fullName} saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Employee could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(employee: Employee) {
    if (!window.confirm(`Delete ${employee.full_name}'s access? Historical visits remain preserved.`)) return;
    setBusy(true);
    try {
      const result = await api({ method: "DELETE", body: JSON.stringify({ id: employee.id }) });
      close();
      await refresh();
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Employee could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const modalOpen = creating || Boolean(selected);
  return <AdminShell active="Employees">
    <div className="app-top"><div><span className="eyebrow">WORKFORCE</span><h1>Employees</h1><p className="section-intro">One canonical profile controls access, route origin and the maximum number of houses this worker can receive per day.</p></div><div className="toolbar-inline"><button className="btn btn-primary" disabled={busy} onClick={startCreate}>＋ Add Employee</button><button className="btn btn-outline" disabled={busy} onClick={() => void refresh()}>Refresh</button></div></div>

    <section className="business-metrics"><div className="business-metric"><span>Active</span><strong>{counts.active}</strong><small>field access enabled</small></div><div className="business-metric"><span>Daily capacity</span><strong>{counts.capacity}</strong><small>houses across active Employees</small></div><div className="business-metric"><span>Pending invites</span><strong>{counts.pending}</strong><small>email invitation sent</small></div></section>
    {message && <div className="payment-message" style={{ marginTop: 18 }}>{message}</div>}

    <section className="card table-card" style={{ marginTop: 20 }}><div className="table-head"><div><h2>Employee profiles</h2><p className="section-intro">Route Advisor, Build, Move and Route Status read the capacity and canonical contracts shown here.</p></div></div><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Contact</th><th>Route start</th><th>Contracts</th><th>Capacity</th><th>Status</th><th>Action</th></tr></thead><tbody>{!employees.length ? <tr><td colSpan={7}>{busy ? "Loading employees…" : "No employees yet. Use Add Employee."}</td></tr> : employees.flatMap(employee => {
      const expanded = expandedIds.has(employee.id);
      const contracts = employee.contracts || [];
      const pageCount = Math.max(1, Math.ceil(contracts.length / CONTRACTS_PER_PAGE));
      const page = Math.min(contractPages[employee.id] || 1, pageCount);
      const pageContracts = contracts.slice(
        (page - 1) * CONTRACTS_PER_PAGE,
        page * CONTRACTS_PER_PAGE,
      );
      return [
        <tr key={employee.id}><td><div className="employee-admin-person"><div>{employee.avatar_url ? <img src={employee.avatar_url} alt={employee.full_name} /> : <span>{employee.full_name.slice(0, 1)}</span>}</div><strong>{employee.full_name}</strong></div></td><td>{employee.email}<br /><small>{employee.phone || "No phone"}</small></td><td>{employee.route_start_address || employee.address_line1 || "Not set"}</td><td><button className="employee-contract-toggle" type="button" onClick={() => toggleContracts(employee.id)} aria-expanded={expanded}><span>{expanded ? "▾" : "▸"}</span><strong>{contracts.length}</strong> houses</button></td><td><strong>{Math.max(1, Number(employee.daily_route_capacity || 16))}</strong> houses/day</td><td>{employee.active ? "Active" : "Inactive"}<br /><small>{employee.invite_status || "pending"}</small></td><td><button className="btn btn-outline" onClick={() => open(employee)}>Edit profile</button></td></tr>,
        expanded ? <tr key={`${employee.id}-contracts`} className="employee-contract-row"><td colSpan={7}><div className="employee-contract-list">{contracts.length ? pageContracts.map(contract => <button type="button" key={contract.id} onClick={() => openContract(contract)}><strong>{contract.customerName}</strong><span>{contract.address}</span><small>{contract.serviceName}</small></button>) : <p>No canonical contracts assigned to this Employee.</p>}</div>{pageCount > 1 && <nav className="employee-contract-pagination" aria-label={`${employee.full_name} contract pages`}><button type="button" disabled={page === 1} onClick={() => setContractPages(current => ({ ...current, [employee.id]: Math.max(1, page - 1) }))}>Previous</button>{Array.from({ length: pageCount }, (_, index) => index + 1).map(number => <button type="button" key={number} className={number === page ? "active" : ""} aria-current={number === page ? "page" : undefined} onClick={() => setContractPages(current => ({ ...current, [employee.id]: number }))}>{number}</button>)}<button type="button" disabled={page === pageCount} onClick={() => setContractPages(current => ({ ...current, [employee.id]: Math.min(pageCount, page + 1) }))}>Next</button></nav>}</td></tr> : null,
      ];
    })}</tbody></table></div></section>

    {modalOpen && <div className="master-modal-backdrop" onMouseDown={close}><section className="master-modal" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}><header><h3>{creating ? "Add Employee" : selected?.full_name}</h3><button onClick={close}>×</button></header><div className="master-form">
      <div className="employee-admin-photo"><div>{form.avatarUrl ? <img src={form.avatarUrl} alt="Employee" /> : <span>{form.fullName.slice(0, 1) || "+"}</span>}</div><label>Profile photo<input type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file).catch(error => setMessage(error.message)); }} /></label></div>
      <label>Full name<input value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} /></label>
      <label>Email used to sign in<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
      <label>Phone<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
      <label>Home address<AddressAutocomplete value={form.addressLine1} onChange={value => setForm(current => ({ ...current, addressLine1: value, routeStartAddress: current.routeStartAddress || value }))} placeholder="Employee home or regular starting address" /></label>
      <label>City<input value={form.city} onChange={event => setForm({ ...form, city: event.target.value })} /></label>
      <label>Province<input value={form.province} onChange={event => setForm({ ...form, province: event.target.value })} /></label>
      <label>Postal code<input value={form.postalCode} onChange={event => setForm({ ...form, postalCode: event.target.value })} /></label>
      <label>Default route start address<AddressAutocomplete value={form.routeStartAddress} onChange={value => setForm({ ...form, routeStartAddress: value })} placeholder="Where this employee normally starts routes" /></label>
      <label>Maximum houses per day<input type="number" min="1" step="1" value={form.dailyRouteCapacity} onChange={event => setForm({ ...form, dailyRouteCapacity: Number(event.target.value) })} /><small>Company Admin control. Used everywhere routes are suggested or published.</small></label>
      {!creating && <label>Status<select value={form.active ? "active" : "inactive"} onChange={event => setForm({ ...form, active: event.target.value === "active" })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>}
      <button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : creating ? "Send invitation" : "Save profile"}</button>
      {!creating && selected && <button className="btn btn-danger" disabled={busy} onClick={() => void remove(selected)}>Delete employee</button>}
    </div></section></div>}

    <style jsx global>{`
      .employee-admin-person,.employee-admin-photo{display:flex;align-items:center;gap:12px}.employee-admin-person>div{width:40px;height:40px}.employee-admin-photo>div{width:72px;height:72px;font-size:28px}.employee-admin-person>div,.employee-admin-photo>div{overflow:hidden;border-radius:50%;background:#e9f4ef;display:grid;place-items:center;color:#0b684c}.employee-admin-person img,.employee-admin-photo img{width:100%;height:100%;object-fit:cover}.master-form label small{display:block;margin-top:5px;color:#6b7c72;font-size:11px}.employee-contract-toggle{display:inline-flex;align-items:center;gap:7px;border:0;background:transparent;color:#0b684c;font:inherit;cursor:pointer}.employee-contract-toggle span{font-size:16px}.employee-contract-row td{padding:0!important;background:#f7faf8}.employee-contract-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;padding:12px 18px 18px}.employee-contract-list button{display:grid;gap:3px;padding:11px 13px;border:1px solid #dce9e2;border-radius:12px;background:#fff;text-align:left;color:inherit;cursor:pointer}.employee-contract-list button:hover,.employee-contract-list button:focus-visible{border-color:#0b684c;background:#f1f8f4;outline:none}.employee-contract-list button span,.employee-contract-list button small{color:#63766c}.employee-contract-list p{margin:0;color:#63766c}.employee-contract-pagination{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:6px;padding:0 18px 18px}.employee-contract-pagination button{min-width:34px;height:34px;border:1px solid #d1dfd7;border-radius:9px;background:#fff;color:#315545;font-weight:800;cursor:pointer}.employee-contract-pagination button.active{border-color:#0b684c;background:#0b684c;color:#fff}.employee-contract-pagination button:disabled{opacity:.45;cursor:not-allowed}
    `}</style>
  </AdminShell>;
}
