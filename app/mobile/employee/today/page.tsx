"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";


type Stop = {
  visitId: string;
  jobId: string | null;
  customerId: string | null;
  propertyId: string | null;
  routeId: string | null;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
  routeOrder: number | null;
  status: string;
  customerName: string;
  serviceName: string;
  scheduledDate: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  employeeNotes: string | null;
};

type RoutePayload = {
  employee: {
    id: string;
    profileId: string | null;
    companyId: string;
    name: string;
    crewId: string | null;
    email: string | null;
    avatarUrl: string | null;
  };
  routeId: string | null;
  date: string;
  stops: Stop[];
};

function torontoDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function fullAddress(stop: Stop) {
  return [stop.addressLine1, stop.city, stop.province, stop.postalCode].filter(Boolean).join(", ");
}

function mapsHref(stop: Stop) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress(stop))}&travelmode=driving`;
}

function statusLabel(status: string) {
  if (status === "in_progress") return "In progress";
  if (status === "completed") return "Completed";
  if (status === "missed") return "Needs reschedule";
  return "Open";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || "EM").toUpperCase();
}

export default function EmployeeTodayRoute() {
  const [date, setDate] = useState(torontoDateKey());
  const [payload, setPayload] = useState<RoutePayload>({
    employee: { id: "", profileId: null, companyId: "", name: "Employee", crewId: null, email: null, avatarUrl: null },
    routeId: null,
    date: torontoDateKey(),
    stops: [],
  });
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const accessToken = useCallback(async () => {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Your Employee login expired. Sign in again.");
    return token;
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = await accessToken();
      const response = await fetch(`/api/mobile/employee/today-route?date=${encodeURIComponent(date)}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your assigned route could not be loaded.");
      setPayload(result as RoutePayload);
      setSelectedId(current =>
        current && (result.stops || []).some((stop: Stop) => stop.visitId === current)
          ? current
          : (result.stops || []).find((stop: Stop) => !["completed", "missed"].includes(stop.status))?.visitId
            || (result.stops || [])[0]?.visitId
            || "");
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Your assigned route could not be loaded.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [accessToken, date]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 20_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const ordered = useMemo(() => [...payload.stops].sort((left, right) =>
    (left.routeOrder ?? 9999) - (right.routeOrder ?? 9999)
    || left.addressLine1.localeCompare(right.addressLine1)), [payload.stops]);
  const selected = ordered.find(stop => stop.visitId === selectedId) || ordered[0] || null;
  const completed = ordered.filter(stop => stop.status === "completed").length;
  const open = ordered.filter(stop => !["completed", "missed"].includes(stop.status)).length;

  async function updateVisit(action: "start" | "done") {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const token = await accessToken();
      const response = await fetch("/api/mobile/employee/route", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ visitId: selected.visitId, action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The visit could not be updated.");
      setMessage(action === "start" ? "Visit started." : "Visit completed.");
      await refresh(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The visit could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return <MobileRoleGuard allowed={["employee"]}>
    <main className="mobile-app-shell role-mobile-shell employee-today-route">
      <header className="role-mobile-topbar">
        <div><strong>Today&apos;s route</strong><span>{payload.employee.name || "Employee"}</span></div>
        <span className="role-mobile-avatar role-mobile-profile-avatar">{payload.employee.avatarUrl ? <img src={payload.employee.avatarUrl} alt="Employee profile"/> : initials(payload.employee.name || "Employee")}</span>
      </header>

      <section className="employee-route-hero">
        <div><span>ASSIGNED VISITS</span><h1>{loading ? "Loading route…" : `${ordered.length} stop${ordered.length === 1 ? "" : "s"}`}</h1><p>{completed} completed · {open} remaining</p></div>
        <label><span>Service day</span><input type="date" value={date} onChange={event => { setDate(event.target.value); setSelectedId(""); setMessage(""); }}/></label>
      </section>

      {!payload.routeId && ordered.length > 0 && <div className="employee-route-notice">These visits are assigned to your account. The app is showing them even while the route marker is being synchronized.</div>}
      {error && <div className="mobile-message mobile-error" role="alert">{error}</div>}
      {message && <div className="mobile-message" role="status">{message}</div>}

      <section className="employee-route-toolbar">
        <strong>{date === torontoDateKey() ? "Today" : date}</strong>
        <button type="button" disabled={loading} onClick={() => void refresh()}>{loading ? "Loading…" : "Refresh"}</button>
      </section>

      {selected && <section className="employee-active-stop">
        <div className="employee-stop-head"><span><small>ACTIVE STOP</small><strong>{selected.customerName}</strong></span><em className={selected.status}>{statusLabel(selected.status)}</em></div>
        <h2>{selected.serviceName}</h2>
        <p>{fullAddress(selected) || "Property address unavailable"}</p>
        <div className="employee-active-actions">
          <a href={mapsHref(selected)} target="_blank" rel="noopener noreferrer">Directions</a>
          <button type="button" disabled={busy || selected.status !== "scheduled" || date !== torontoDateKey()} onClick={() => void updateVisit("start")}>{busy ? "Saving…" : "Start"}</button>
          <button type="button" disabled={busy || selected.status !== "in_progress" || date !== torontoDateKey()} onClick={() => void updateVisit("done")}>{busy ? "Saving…" : "Complete"}</button>
        </div>
      </section>}

      <section className="employee-route-list">
        {ordered.length ? ordered.map((stop, index) => <button type="button" key={stop.visitId} className={selected?.visitId === stop.visitId ? "active" : ""} onClick={() => setSelectedId(stop.visitId)}>
          <b>{index + 1}</b>
          <span><strong>{stop.customerName}</strong><small>{stop.serviceName}</small><small>{fullAddress(stop)}</small></span>
          <em className={stop.status}>{statusLabel(stop.status)}</em>
        </button>) : !loading && <div className="employee-route-empty"><i>✓</i><strong>No assigned visits for this day</strong><p>Ask Admin to confirm the Employee, date and published route.</p></div>}
      </section>

      <style jsx>{`
        .employee-today-route{padding-bottom:42px}.employee-route-hero{display:flex;justify-content:space-between;gap:18px;align-items:end;margin:14px 14px 12px;padding:20px;border-radius:23px;background:linear-gradient(145deg,#0c7656,#075e46);color:#fff;box-shadow:0 18px 40px rgba(7,94,70,.2)}.employee-route-hero span,.employee-route-hero h1,.employee-route-hero p{display:block;margin:0}.employee-route-hero span{font-size:10px;font-weight:950;letter-spacing:.12em;opacity:.78}.employee-route-hero h1{margin-top:6px;font-size:30px}.employee-route-hero p{margin-top:5px;opacity:.82}.employee-route-hero label{display:grid;gap:5px;min-width:145px}.employee-route-hero input{min-height:44px;border:1px solid rgba(255,255,255,.35);border-radius:12px;background:rgba(255,255,255,.14);color:#fff;padding:0 10px;font-weight:850}.employee-route-notice{margin:0 14px 12px;padding:12px 14px;border:1px solid #fde68a;border-radius:14px;background:#fffbeb;color:#92400e;font-size:12px;line-height:1.45}.employee-route-toolbar{display:flex;justify-content:space-between;align-items:center;padding:8px 14px}.employee-route-toolbar button{min-height:40px;border:1px solid #cddfd6;border-radius:12px;background:#fff;color:#086348;font-weight:900;padding:0 15px}.employee-active-stop{margin:8px 14px 16px;padding:18px;border:1px solid #d9e7e0;border-radius:21px;background:#fff;box-shadow:0 14px 32px rgba(15,62,45,.08)}.employee-stop-head{display:flex;justify-content:space-between;gap:12px}.employee-stop-head small,.employee-stop-head strong{display:block}.employee-stop-head small{color:#0b7655;font-size:9px;font-weight:950;letter-spacing:.1em}.employee-stop-head strong{margin-top:3px;font-size:18px}.employee-active-stop h2{margin:16px 0 5px}.employee-active-stop p{margin:0;color:#64748b;line-height:1.45}.employee-active-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px;margin-top:17px}.employee-active-actions a,.employee-active-actions button{display:grid;place-items:center;min-height:48px;border-radius:14px;text-decoration:none;font-weight:900}.employee-active-actions a{border:1px solid #cbdad2;background:#fff;color:#075e46}.employee-active-actions button{border:0;background:#0b7655;color:#fff}.employee-active-actions button:last-child{background:#173a2c}.employee-active-actions button:disabled{opacity:.42}.employee-route-list{display:grid;gap:9px;padding:0 14px}.employee-route-list>button{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:11px;align-items:center;width:100%;padding:13px;border:1px solid #e0e9e5;border-radius:16px;background:#fff;text-align:left}.employee-route-list>button.active{border-color:#0b7655;background:#f2faf6}.employee-route-list>button>b{display:grid;place-items:center;width:36px;height:36px;border-radius:12px;background:#e9f4ef;color:#0b7655}.employee-route-list span strong,.employee-route-list span small{display:block}.employee-route-list span small{margin-top:3px;color:#64748b;font-size:11px}.employee-route-list em,.employee-stop-head em{font-style:normal;font-size:9px;font-weight:950;text-transform:uppercase;border-radius:999px;padding:6px 8px;background:#eef2f7;color:#475569}.employee-route-list em.in_progress,.employee-stop-head em.in_progress{background:#fff7ed;color:#c2410c}.employee-route-list em.completed,.employee-stop-head em.completed{background:#ecfdf5;color:#047857}.employee-route-list em.missed,.employee-stop-head em.missed{background:#fff1f2;color:#be123c}.employee-route-empty{display:grid;place-items:center;text-align:center;padding:32px 18px;border:1px dashed #cbdad2;border-radius:18px;background:#fff}.employee-route-empty i{display:grid;place-items:center;width:46px;height:46px;border-radius:15px;background:#edf8f2;color:#0b7655;font-style:normal;font-size:22px}.employee-route-empty strong{margin-top:10px}.employee-route-empty p{margin:5px 0 0;color:#64748b}@media(max-width:520px){.employee-route-hero{align-items:stretch;flex-direction:column}.employee-route-hero label{min-width:0}.employee-active-actions{grid-template-columns:1fr}.employee-route-list>button{grid-template-columns:36px minmax(0,1fr)}.employee-route-list>button>em{grid-column:2;justify-self:start}}
      `}</style>
    </main>
  </MobileRoleGuard>;
}
