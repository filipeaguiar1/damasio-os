from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    if old not in content:
        raise RuntimeError(f"Expected text not found in {path}: {old[:100]!r}")
    write(path, content.replace(old, new, 1))


alerts = r'''"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileAdminNav } from "@/components/mobile/MobileAdminNav";
import { loadDailyOperations } from "@/lib/services/dailyOperationsService";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type LiveAlert = {
  id: string;
  title: string;
  message: string;
  customer: string;
  address: string;
  status: string;
  priority: string;
  createdAt?: string;
  photo?: string | null;
  href: string;
};

async function token() {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new Error("Your Admin session expired. Sign in again.");
  return value;
}

async function loadRequestAlerts(): Promise<LiveAlert[]> {
  const response = await fetch("/api/admin/service-requests", {
    headers: { authorization: `Bearer ${await token()}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Alerts could not be loaded.");
  return (result.requests || [])
    .filter((item: any) => item.priority === "urgent" && !["completed", "resolved", "cancelled"].includes(item.status))
    .map((item: any) => ({
      id: String(item.id),
      title: item.serviceName || item.title || "Urgent customer task",
      message: item.issue || item.description || item.message || "This item needs Admin attention.",
      customer: item.customerName || "Customer",
      address: item.address || "Address unavailable",
      status: item.status || "pending",
      priority: item.priority || "urgent",
      createdAt: item.createdAt || item.created_at,
      photo: item.requestPhotos?.[0] || item.photos?.[0] || null,
      href: "/mobile/admin/tasks",
    }));
}

async function loadOperationAlerts(): Promise<LiveAlert[]> {
  const operations = await loadDailyOperations();
  return (operations.tasks || [])
    .filter((item: any) => item.priority === "urgent" && !["completed", "resolved", "cancelled"].includes(item.status))
    .map((item: any) => ({
      id: `operation-${item.id}`,
      title: item.title || "Urgent operational task",
      message: item.description || item.issue || "This operation needs attention.",
      customer: item.customerName || "Customer",
      address: item.address || "Address unavailable",
      status: item.status || "pending",
      priority: item.priority || "urgent",
      createdAt: item.createdAt || item.created_at,
      photo: item.requestPhotos?.[0] || null,
      href: "/mobile/admin/tasks",
    }));
}

export default function MobileAdminAlerts() {
  const [items, setItems] = useState<LiveAlert[]>([]);
  const [selected, setSelected] = useState<LiveAlert | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const groups = await Promise.allSettled([loadRequestAlerts(), loadOperationAlerts()]);
      const merged = new Map<string, LiveAlert>();
      for (const group of groups) {
        if (group.status === "fulfilled") for (const alert of group.value) merged.set(alert.id.replace(/^operation-/, ""), alert);
      }
      setItems([...merged.values()].sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "")));
      const failed = groups.every(group => group.status === "rejected");
      setMessage(failed ? "Live alerts could not be loaded. Pull down or tap Refresh." : "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const client = getSupabaseBrowserClient() as any;
    const channel = client.channel("mobile-admin-live-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => void refresh(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "service_requests" }, () => void refresh(true))
      .subscribe();
    const timer = window.setInterval(() => void refresh(true), 5000);
    const focus = () => void refresh(true);
    window.addEventListener("focus", focus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
      void client.removeChannel(channel);
    };
  }, [refresh]);

  const title = useMemo(() => loading ? "Loading active alerts…" : items.length ? `${items.length} alert${items.length === 1 ? "" : "s"} need attention.` : "You are all caught up.", [items.length, loading]);

  return <MobileRoleGuard allowed={["admin", "manager"]}>
    <main className="mobile-app-shell role-mobile-shell mobile-native-subpage mobile-live-alerts">
      <header className="role-mobile-topbar"><MobileBackButton fallback="/mobile/admin"/><div><strong>Alerts</strong><span>Live company attention</span></div><button className="mobile-native-add" onClick={() => void refresh()} aria-label="Refresh alerts">↻</button></header>
      <section className="mobile-native-hero alert"><span>LIVE ALERTS</span><h1>{title}</h1><p>The number on the Admin home and this list now use the same live task data.</p></section>
      {message && <div className="mobile-native-message" role="alert">{message}</div>}
      <section className="mobile-alert-list">
        {items.map(item => <button type="button" className="mobile-alert-item" key={item.id} onClick={() => setSelected(item)}>
          {item.photo ? <img className="mobile-alert-thumb" src={item.photo} alt="Task evidence"/> : <i>!</i>}
          <div><span>{item.priority} · {item.status.replaceAll("_", " ")}</span><strong>{item.title}</strong><p>{item.message}</p><small>{item.customer} · {item.address}</small></div><b/>
        </button>)}
        {!loading && !items.length && <div className="mobile-native-empty"><i>✓</i><strong>No active alerts</strong><p>Urgent tasks will appear here immediately.</p></div>}
      </section>
      {selected && <div className="mobile-native-modal"><button className="mobile-native-scrim" onClick={() => setSelected(null)} aria-label="Close alert"/><section><header><div><span>URGENT TASK</span><h2>{selected.title}</h2></div><button onClick={() => setSelected(null)}>×</button></header><div className="mobile-alert-detail">{selected.photo && <img className="mobile-alert-detail-photo" src={selected.photo} alt="Task evidence"/>}<label>What needs attention</label><p>{selected.message}</p><dl><div><dt>Customer</dt><dd>{selected.customer}</dd></div><div><dt>House</dt><dd>{selected.address}</dd></div><div><dt>Status</dt><dd>{selected.status.replaceAll("_", " ")}</dd></div>{selected.createdAt && <div><dt>Received</dt><dd>{new Date(selected.createdAt).toLocaleString("en-CA")}</dd></div>}</dl><Link className="mobile-native-submit" href={selected.href}>Open task center</Link></div></section></div>}
      <MobileAdminNav active="alerts"/>
      <style jsx global>{`.mobile-live-alerts .mobile-alert-thumb{width:48px;height:48px;border-radius:13px;object-fit:cover;align-self:start}.mobile-live-alerts .mobile-alert-item>div{min-width:0}.mobile-live-alerts .mobile-alert-item p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.mobile-alert-detail-photo{width:100%;max-height:240px;object-fit:cover;border-radius:16px;margin-bottom:14px}`}</style>
    </main>
  </MobileRoleGuard>;
}
'''
write("app/mobile/admin/alerts/page.tsx", alerts)

# Remove the internal database tool from the customer-facing mobile Admin menu.
replace_once(
    "app/mobile/admin/more/page.tsx",
    '  ["Database", "DB", "/admin/database"],\n',
    "",
)

# Make Settings cards open editable screens.
replace_once(
    "app/mobile/admin/[section]/page.tsx",
    '  function openRow(row: Row) {\n    if (section === "customers") router.push(`/mobile/admin/customers/${row.id}`);\n    if (section === "command" || section === "reports") setSelectedLog(logs.find(log => log.id === row.id) || null);\n  }',
    '  function openRow(row: Row) {\n    if (section === "customers") router.push(`/mobile/admin/customers/${row.id}`);\n    if (section === "command" || section === "reports") setSelectedLog(logs.find(log => log.id === row.id) || null);\n    if (section === "settings" && ["company", "mobile"].includes(row.id)) router.push(`/mobile/admin/settings/${row.id}`);\n  }',
)

settings_page = r'''"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type CompanyDraft = { companyName: string; adminName: string; contactEmail: string; phone: string; recoveryEmail: string };
type MobileDraft = { liveAlerts: boolean; taskPhotos: boolean; routeReminders: boolean; compactCards: boolean; autoRefreshSeconds: number };
const EMPTY_COMPANY: CompanyDraft = { companyName: "", adminName: "", contactEmail: "", phone: "", recoveryEmail: "" };
const DEFAULT_MOBILE: MobileDraft = { liveAlerts: true, taskPhotos: true, routeReminders: true, compactCards: true, autoRefreshSeconds: 5 };

async function accessToken() {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

export default function MobileAdminSettingsEditor() {
  const panel = String(useParams().panel || "company");
  const isCompany = panel === "company";
  const [company, setCompany] = useState<CompanyDraft>(EMPTY_COMPANY);
  const [mobile, setMobile] = useState<MobileDraft>(DEFAULT_MOBILE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isCompany) {
      try { setMobile({ ...DEFAULT_MOBILE, ...JSON.parse(localStorage.getItem("damasio-mobile-admin-preferences") || "{}") }); } catch { setMobile(DEFAULT_MOBILE); }
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const response = await fetch("/api/company/profile", { headers: { authorization: `Bearer ${await accessToken()}` }, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Company profile could not be loaded.");
        setCompany({
          companyName: result.company?.name || "",
          adminName: result.profile?.full_name || "",
          contactEmail: result.company?.contact_email || result.profile?.email || "",
          phone: result.profile?.phone || "",
          recoveryEmail: result.profile?.recovery_email || "",
        });
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Company profile could not be loaded."); }
      finally { setLoading(false); }
    })();
  }, [isCompany]);

  async function save() {
    setBusy(true); setError(""); setMessage("");
    try {
      if (isCompany) {
        const response = await fetch("/api/company/profile", { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken()}` }, body: JSON.stringify(company) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Company profile could not be saved.");
        setMessage("Company profile saved.");
      } else {
        localStorage.setItem("damasio-mobile-admin-preferences", JSON.stringify(mobile));
        window.dispatchEvent(new CustomEvent("damasio-mobile-preferences-change", { detail: mobile }));
        setMessage("Mobile application preferences saved on this device.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Settings could not be saved."); }
    finally { setBusy(false); }
  }

  return <MobileRoleGuard allowed={["admin", "manager"]}><main className="mobile-app-shell role-mobile-shell mobile-native-subpage mobile-settings-editor">
    <header className="role-mobile-topbar"><MobileBackButton fallback="/mobile/admin/settings"/><div><strong>{isCompany ? "Company Profile" : "Mobile Application"}</strong><span>Edit settings</span></div><span className="role-mobile-avatar">⚙</span></header>
    <section className="mobile-native-hero"><span>EDIT SETTINGS</span><h1>{isCompany ? "Company information" : "Mobile experience"}</h1><p>{isCompany ? "Update the business and administrator details used throughout the app." : "Choose how this Admin device handles alerts, task evidence and route updates."}</p></section>
    {error && <div className="mobile-native-message" role="alert">{error}</div>}{message && <div className="mobile-native-message" role="status">{message}</div>}
    {loading ? <div className="mobile-native-empty"><strong>Loading settings…</strong></div> : isCompany ? <section className="mobile-settings-form">
      <label><span>Company name</span><input value={company.companyName} onChange={e => setCompany(v => ({ ...v, companyName: e.target.value }))}/></label>
      <label><span>Administrator name</span><input value={company.adminName} onChange={e => setCompany(v => ({ ...v, adminName: e.target.value }))}/></label>
      <label><span>Company email</span><input type="email" value={company.contactEmail} onChange={e => setCompany(v => ({ ...v, contactEmail: e.target.value }))}/></label>
      <label><span>Phone</span><input type="tel" value={company.phone} onChange={e => setCompany(v => ({ ...v, phone: e.target.value }))}/></label>
      <label><span>Recovery email</span><input type="email" value={company.recoveryEmail} onChange={e => setCompany(v => ({ ...v, recoveryEmail: e.target.value }))}/></label>
    </section> : <section className="mobile-settings-form mobile-settings-toggles">
      {[["liveAlerts", "Live alerts", "Refresh urgent task alerts automatically."], ["taskPhotos", "Task photos", "Show customer evidence directly in task cards."], ["routeReminders", "Route reminders", "Keep route and scheduled-date reminders visible."], ["compactCards", "Compact cards", "Use compact cards while keeping key information visible."]].map(([key, title, detail]) => <label className="mobile-setting-toggle" key={key}><div><strong>{title}</strong><small>{detail}</small></div><input type="checkbox" checked={Boolean(mobile[key as keyof MobileDraft])} onChange={e => setMobile(v => ({ ...v, [key]: e.target.checked }))}/></label>)}
      <label><span>Automatic refresh</span><select value={mobile.autoRefreshSeconds} onChange={e => setMobile(v => ({ ...v, autoRefreshSeconds: Number(e.target.value) }))}><option value={5}>Every 5 seconds</option><option value={15}>Every 15 seconds</option><option value={30}>Every 30 seconds</option></select></label>
    </section>}
    <button className="mobile-native-submit mobile-settings-save" disabled={busy || loading} onClick={() => void save()}>{busy ? "Saving…" : "Save Changes"}</button>
    <style jsx global>{`.mobile-settings-form{display:grid;gap:12px;padding:16px}.mobile-settings-form>label:not(.mobile-setting-toggle){display:grid;gap:7px;padding:14px;border:1px solid #dce8e1;border-radius:16px;background:#fff}.mobile-settings-form label>span{font-size:11px;font-weight:900;text-transform:uppercase;color:#50665b}.mobile-settings-form input,.mobile-settings-form select{width:100%;min-height:48px;border:1px solid #cbdad2;border-radius:12px;padding:0 12px;background:#fff;font-size:16px}.mobile-setting-toggle{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px;border:1px solid #dce8e1;border-radius:16px;background:#fff}.mobile-setting-toggle div{display:grid;gap:3px}.mobile-setting-toggle small{color:#687970}.mobile-setting-toggle input{width:24px;height:24px}.mobile-settings-save{position:sticky;bottom:calc(env(safe-area-inset-bottom) + 10px);margin:8px 16px 20px;width:calc(100% - 32px);z-index:4}`}</style>
  </main></MobileRoleGuard>;
}
'''
write("app/mobile/admin/settings/[panel]/page.tsx", settings_page)

# Improve Admin task summaries with the actual issue, evidence and due date visible before opening.
replace_once(
    "app/mobile/admin/tasks/page.tsx",
    '      <button className="mobile-return-summary" onClick={()=>openAssign(task)}><span className="mobile-return-icon">↺</span><span><small>{task.priority} · {task.status.replace("_"," ")}</small><strong>{task.title}</strong><em>{task.customer}</em><i>{task.address}</i></span><b>›</b></button>\n      <div className="mobile-return-meta"><span>{assigned(task)?task.assignedTo:"Admin queue"}</span><span>{dateLabel(task.scheduledDate)}</span></div>',
    '      <button className="mobile-return-summary mobile-return-summary-rich" onClick={()=>openAssign(task)}>{task.requestPhotos?.[0]?<img className="mobile-return-thumb" src={task.requestPhotos[0]} alt="Customer task evidence"/>:<span className="mobile-return-icon">↺</span>}<span className="mobile-return-copy"><small>{task.priority} · {task.status.replace("_"," ")}</small><strong>{task.title}</strong><p>{task.description||"No additional instructions."}</p><em>{task.customer}</em><i>{task.address}</i></span><b>›</b></button>\n      <div className="mobile-return-meta"><span>{assigned(task)?task.assignedTo:"Admin queue"}</span><strong>Due {dateLabel(task.scheduledDate)}</strong></div>',
)
replace_once(
    "app/mobile/admin/tasks/task-proof.css",
    ".mobile-task-proof{",
    ".mobile-return-summary-rich{align-items:flex-start!important}.mobile-return-thumb{width:64px;height:64px;border-radius:13px;object-fit:cover;flex:0 0 64px}.mobile-return-copy{min-width:0}.mobile-return-copy p{margin:5px 0;color:#4c5f55;font-size:11px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.mobile-return-meta strong{color:#0b7046;font-size:10px}.mobile-task-proof{",
)

# Employee: use a production-supported status when skipping.
replace_once(
    "app/mobile/employee/page.tsx",
    'await runVisitStatusOrQueue(selected.canonicalVisitId,"missed")',
    'await runVisitStatusOrQueue(selected.canonicalVisitId,"cancelled")',
)

# Employee: keep the scheduled date visible on the compact task card.
replace_once(
    "app/mobile/employee/page.tsx",
    '<span className="employee-task-icon">!</span><div><em>RETURN TASK · {task.priority}</em><strong>{task.title}</strong><p>{task.customer}<br/>{task.address}</p><small>{task.description}</small></div><b>›</b>',
    '<span className="employee-task-icon">!</span><div><em>RETURN TASK · {task.priority}</em><strong>{task.title}</strong><p>{task.customer}<br/>{task.address}</p><small>{task.description}</small><time className="employee-task-card-date">Due {task.scheduledDate?new Date(`${task.scheduledDate}T12:00:00`).toLocaleDateString("en-CA",{weekday:"short",month:"short",day:"numeric"}):"date not assigned"}</time></div><b>›</b>',
)

# Employee: replace planar ordering with origin-first haversine nearest-neighbour plus 2-opt refinement.
employee_path = "app/mobile/employee/page.tsx"
employee = read(employee_path)
start = employee.index("  function distance(")
end = employee.index("  async function prepareSmartRoute", start)
smart_algorithm = r'''  function distance(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){
    const toRad=(value:number)=>value*Math.PI/180;
    const dLat=toRad(b.latitude-a.latitude),dLon=toRad(b.longitude-a.longitude);
    const value=Math.sin(dLat/2)**2+Math.cos(toRad(a.latitude))*Math.cos(toRad(b.latitude))*Math.sin(dLon/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value));
  }
  function smartRouteDistance(order:Lead[],origin:{latitude:number;longitude:number}){
    let total=0;let cursor=origin;
    for(const lead of order){const point={latitude:Number(lead.latitude),longitude:Number(lead.longitude)};total+=distance(cursor,point);cursor=point}
    return total;
  }
  function refineSmartOrder(order:Lead[],origin:{latitude:number;longitude:number}){
    let best=[...order],bestDistance=smartRouteDistance(best,origin),improved=true,passes=0;
    while(improved&&passes<5){improved=false;passes+=1;for(let left=0;left<best.length-2;left++){for(let right=left+1;right<best.length-1;right++){const candidate=[...best.slice(0,left),...best.slice(left,right+1).reverse(),...best.slice(right+1)];const candidateDistance=smartRouteDistance(candidate,origin);if(candidateDistance+0.01<bestDistance){best=candidate;bestDistance=candidateDistance;improved=true}}}}
    return best;
  }
  function buildSmartOrder(located:Lead[],origin:{latitude:number;longitude:number},alternative:number){
    if(!located.length)return [];
    const byOrigin=[...located].sort((a,b)=>distance(origin,{latitude:Number(a.latitude),longitude:Number(a.longitude)})-distance(origin,{latitude:Number(b.latitude),longitude:Number(b.longitude)}));
    const seedIndex=Math.min(alternative%Math.min(4,byOrigin.length),byOrigin.length-1);
    const first=byOrigin[seedIndex];
    const remaining=located.filter(lead=>lead.id!==first.id);
    const ordered:Lead[]=[first];
    let cursor={latitude:Number(first.latitude),longitude:Number(first.longitude)};
    while(remaining.length){let best=0;for(let index=1;index<remaining.length;index++){const candidate={latitude:Number(remaining[index].latitude),longitude:Number(remaining[index].longitude)};const current={latitude:Number(remaining[best].latitude),longitude:Number(remaining[best].longitude)};if(distance(cursor,candidate)<distance(cursor,current))best=index}const next=remaining.splice(best,1)[0];ordered.push(next);cursor={latitude:Number(next.latitude),longitude:Number(next.longitude)}}
    return refineSmartOrder(ordered,origin);
  }
'''
write(employee_path, employee[:start] + smart_algorithm + employee[end:])

# Employee: reserve real mobile space for the preview map and keep route actions visible.
replace_once(
    employee_path,
    '<div className="employee-smart-map-wrap"><EmployeeRouteMap route={smartPreview} originPoint={smartOriginPoint} onOpenVisit={()=>{}} actionLabel="Preview stop"/></div><div className="employee-smart-preview-actions"><button onClick={clearSmartPreview}>Cancel</button><button onClick={applySmartPreview}>Apply Smart Route</button></div>',
    '<div className="employee-smart-map-wrap" style={{height:"min(58vh,620px)",minHeight:"420px",overflow:"hidden",borderRadius:"18px"}}><EmployeeRouteMap route={smartPreview} originPoint={smartOriginPoint} onOpenVisit={()=>{}} actionLabel="Preview stop"/></div><div className="employee-smart-preview-actions" style={{position:"sticky",bottom:"calc(env(safe-area-inset-bottom) + 8px)",zIndex:8,background:"rgba(255,255,255,.96)",padding:"10px",borderRadius:"16px",boxShadow:"0 10px 30px rgba(9,45,31,.16)"}}><button onClick={clearSmartPreview}>Cancel</button><button onClick={applySmartPreview}>Apply Smart Route</button></div>',
)

# Map cancelled/skipped visits consistently after removing the unsupported enum value.
replace_once(
    "components/mobile/EmployeeRouteMap.tsx",
    '  if (canonicalStatus === "missed") return { color: "#eab308", label: "Skipped" };',
    '  if (canonicalStatus === "cancelled" || canonicalStatus === "missed") return { color: "#eab308", label: "Skipped" };',
)

# Shared mobile card styles.
globals_path = "app/globals.css"
globals = read(globals_path)
styles = r'''
/* Mobile Admin/Employee task and Smart Route readability */
.employee-task-card-date{display:inline-flex!important;width:max-content;margin-top:8px;padding:5px 8px;border-radius:999px;background:#e9f6ef;color:#075f3c!important;font-size:10px!important;font-weight:900;letter-spacing:.02em}
.employee-smart-preview .employee-map-panel{height:100%;min-height:0;display:grid;grid-template-rows:auto minmax(280px,1fr) auto;overflow:hidden}
.employee-smart-preview .employee-route-map{height:100%!important;min-height:280px!important}
.employee-smart-preview .employee-map-sheet{max-height:132px;overflow:auto}
@media(max-width:640px){.employee-smart-preview{overflow:visible!important}.employee-smart-preview>header{position:sticky;top:0;z-index:9;background:#fff}.employee-smart-preview-tools{display:flex;flex-wrap:wrap;justify-content:flex-end}.employee-smart-map-wrap{width:100%;max-width:100vw}.employee-smart-preview-actions button{min-height:48px}}
'''
if "Mobile Admin/Employee task and Smart Route readability" not in globals:
    write(globals_path, globals + "\n" + styles)

# New migration: patch already-installed Smart Route functions without casting an unavailable enum literal.
migration = r'''-- Smart Route compatibility for production databases whose visit_status enum has no `missed` value.
-- The existing PL/pgSQL functions parse the enum literal at execution time. Recreate their
-- stored definitions with status text comparison so both older and newer schemas work.
do $$
declare
  function_name regprocedure;
  definition text;
begin
  foreach function_name in array array[
    'public.apply_employee_smart_route(uuid,uuid[],uuid[],text,double precision,double precision,integer)'::regprocedure,
    'public.restore_employee_smart_route(uuid,integer)'::regprocedure
  ] loop
    definition := pg_get_functiondef(function_name);
    definition := replace(
      definition,
      'and v.status not in (''cancelled'',''missed'');',
      'and v.status::text not in (''cancelled'',''missed'');'
    );
    definition := replace(
      definition,
      'AND v.status <> ALL (ARRAY[''cancelled''::visit_status, ''missed''::visit_status])',
      'AND v.status::text <> ALL (ARRAY[''cancelled''::text, ''missed''::text])'
    );
    execute definition;
  end loop;
end
$$;
'''
write("supabase/migrations/202608010001_smart_route_visit_status_compat.sql", migration)

print("Mobile Alerts, Tasks, Settings and Smart Route patch applied.")
