from pathlib import Path

branch_note = "Employee contracts stay derived from the canonical scheduling board and crew assignment."

# Route Advisor: only show canonical contracts for the selected Employee crew.
path = Path("components/admin/RouteAdvisorPanel.tsx")
text = path.read_text()
old = '''  const normalizedQuery = query.trim().toLowerCase();
  const visibleJobs = useMemo(() => jobs
    .filter(item =>
      !normalizedQuery
      || `${item.name} ${item.address} ${item.service}`.toLowerCase().includes(normalizedQuery))
    .sort((left, right) =>
      (left.nextVisitDate || "9999").localeCompare(right.nextVisitDate || "9999")
      || left.address.localeCompare(right.address)),
  [jobs, normalizedQuery]);

  const selectedHomes = useMemo(
    () => jobs.filter(item => selected.has(canonicalJobId(item))),
    [jobs, selected],
  );'''
new = '''  const normalizedQuery = query.trim().toLowerCase();
  const employeeJobs = useMemo(() => {
    if (!employee) return [];
    return jobs.filter(item =>
      Boolean(item.canonicalCrewId)
      && item.canonicalCrewId === employee.crewId);
  }, [jobs, employee?.crewId]);
  const visibleJobs = useMemo(() => employeeJobs
    .filter(item =>
      !normalizedQuery
      || `${item.name} ${item.address} ${item.service}`.toLowerCase().includes(normalizedQuery))
    .sort((left, right) =>
      (left.nextVisitDate || "9999").localeCompare(right.nextVisitDate || "9999")
      || left.address.localeCompare(right.address)),
  [employeeJobs, normalizedQuery]);

  const selectedHomes = useMemo(
    () => employeeJobs.filter(item => selected.has(canonicalJobId(item))),
    [employeeJobs, selected],
  );'''
if old not in text:
    raise SystemExit("Route Advisor employee job block did not match")
text = text.replace(old, new)

old = '''  function changeEmployee(next: string) {
    setEmployeeId(next);
    setRecommendations([]);
    resetPreview();
  }'''
new = '''  function changeEmployee(next: string) {
    setEmployeeId(next);
    setSelectedJobIds([]);
    setRecommendations([]);
    resetPreview();
  }

  function selectAllVisible() {
    const selectable = visibleJobs
      .filter(home => {
        const id = canonicalJobId(home);
        const status = routeStatus(occurrencesOnDate.get(id));
        return !["completed", "in_progress", "missed"].includes(status)
          && !(status === "scheduled"
            && currentRoute.some(item => canonicalJobId(item) === id));
      })
      .map(canonicalJobId);
    setSelectedJobIds(selectable);
    setRecommendations([]);
    resetPreview();
    setMessage(selectable.length
      ? `${selectable.length} ${employee?.name || "Employee"} contracts selected.`
      : "No selectable contracts are available for this Employee and date.");
  }'''
if old not in text:
    raise SystemExit("Route Advisor changeEmployee block did not match")
text = text.replace(old, new)

old = '''          <button
            type="button"
            onClick={() => {
              setSelectedJobIds([]);
              resetPreview();
            }}
          >
            Clear
          </button>'''
new = '''          <div className="advisor-picker-actions">
            <button
              type="button"
              onClick={() => {
                setSelectedJobIds([]);
                resetPreview();
              }}
            >
              Clear
            </button>
            <button type="button" onClick={selectAllVisible}>
              Select all
            </button>
          </div>'''
if old not in text:
    raise SystemExit("Route Advisor Clear button block did not match")
text = text.replace(old, new)
text = text.replace(
    '<small>{selectedJobIds.length} selected · route {currentRoute.length}/{employee?.dailyCapacity || 0}</small>',
    '<small>{employeeJobs.length} contracts · {selectedJobIds.length} selected · route {currentRoute.length}/{employee?.dailyCapacity || 0}</small>',
)
text = text.replace(
    '.advisor-house-picker header button{border:0;background:transparent;color:#0b7655;font-weight:900;cursor:pointer}',
    '.advisor-house-picker header button{border:0;background:transparent;color:#0b7655;font-weight:900;cursor:pointer}.advisor-picker-actions{display:grid;gap:4px;text-align:right}',
)
path.write_text(text)

# Employees web: load the same canonical scheduling board and expose assigned contracts.
path = Path("app/admin/employees/page.tsx")
text = path.read_text()
text = text.replace(
'''type Employee = {
  id: string;''',
'''type EmployeeContract = {
  id: string;
  customerName: string;
  address: string;
  serviceName: string;
};

type Employee = {
  id: string;''')
text = text.replace(
'''  invite_status?: string | null;
};''',
'''  invite_status?: string | null;
  crew_id?: string | null;
  contracts?: EmployeeContract[];
};''')
text = text.replace(
'''  const [busy, setBusy] = useState(false);''',
'''  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);''')
old = '''      const result = await api();
      setEmployees(result.users || []);
      setMessage("");'''
new = '''      const result = await api();
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
            }))
            .sort((left: EmployeeContract, right: EmployeeContract) =>
              left.address.localeCompare(right.address)),
        };
      });
      setEmployees(nextEmployees);
      setMessage("");'''
if old not in text:
    raise SystemExit("Employees refresh block did not match")
text = text.replace(old, new)

old = '''<section className="card table-card" style={{ marginTop: 20 }}><div className="table-head"><div><h2>Employee profiles</h2><p className="section-intro">Route Advisor, Build, Move and Route Status read the capacity saved here.</p></div></div><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Contact</th><th>Route start</th><th>Capacity</th><th>Status</th><th>Action</th></tr></thead><tbody>{!employees.length ? <tr><td colSpan={6}>{busy ? "Loading employees…" : "No employees yet. Use Add Employee."}</td></tr> : employees.map(employee => <tr key={employee.id}><td><div className="employee-admin-person"><div>{employee.avatar_url ? <img src={employee.avatar_url} alt={employee.full_name} /> : <span>{employee.full_name.slice(0, 1)}</span>}</div><strong>{employee.full_name}</strong></div></td><td>{employee.email}<br /><small>{employee.phone || "No phone"}</small></td><td>{employee.route_start_address || employee.address_line1 || "Not set"}</td><td><strong>{Math.max(1, Number(employee.daily_route_capacity || 16))}</strong> houses/day</td><td>{employee.active ? "Active" : "Inactive"}<br /><small>{employee.invite_status || "pending"}</small></td><td><button className="btn btn-outline" onClick={() => open(employee)}>Edit profile</button></td></tr>)}</tbody></table></div></section>'''
new = '''<section className="card table-card" style={{ marginTop: 20 }}><div className="table-head"><div><h2>Employee profiles</h2><p className="section-intro">Route Advisor, Build, Move and Route Status read the capacity and canonical contracts shown here.</p></div></div><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Contact</th><th>Route start</th><th>Contracts</th><th>Capacity</th><th>Status</th><th>Action</th></tr></thead><tbody>{!employees.length ? <tr><td colSpan={7}>{busy ? "Loading employees…" : "No employees yet. Use Add Employee."}</td></tr> : employees.flatMap(employee => {
      const expanded = expandedId === employee.id;
      const contracts = employee.contracts || [];
      return [
        <tr key={employee.id}><td><div className="employee-admin-person"><div>{employee.avatar_url ? <img src={employee.avatar_url} alt={employee.full_name} /> : <span>{employee.full_name.slice(0, 1)}</span>}</div><strong>{employee.full_name}</strong></div></td><td>{employee.email}<br /><small>{employee.phone || "No phone"}</small></td><td>{employee.route_start_address || employee.address_line1 || "Not set"}</td><td><button className="employee-contract-toggle" type="button" onClick={() => setExpandedId(expanded ? null : employee.id)} aria-expanded={expanded}><span>{expanded ? "▾" : "▸"}</span><strong>{contracts.length}</strong> houses</button></td><td><strong>{Math.max(1, Number(employee.daily_route_capacity || 16))}</strong> houses/day</td><td>{employee.active ? "Active" : "Inactive"}<br /><small>{employee.invite_status || "pending"}</small></td><td><button className="btn btn-outline" onClick={() => open(employee)}>Edit profile</button></td></tr>,
        expanded ? <tr key={`${employee.id}-contracts`} className="employee-contract-row"><td colSpan={7}><div className="employee-contract-list">{contracts.length ? contracts.map(contract => <article key={contract.id}><strong>{contract.customerName}</strong><span>{contract.address}</span><small>{contract.serviceName}</small></article>) : <p>No canonical contracts assigned to this Employee.</p>}</div></td></tr> : null,
      ];
    })}</tbody></table></div></section>'''
if old not in text:
    raise SystemExit("Employees table block did not match")
text = text.replace(old, new)
text = text.replace(
'''      .employee-admin-person,.employee-admin-photo{display:flex;align-items:center;gap:12px}.employee-admin-person>div{width:40px;height:40px}.employee-admin-photo>div{width:72px;height:72px;font-size:28px}.employee-admin-person>div,.employee-admin-photo>div{overflow:hidden;border-radius:50%;background:#e9f4ef;display:grid;place-items:center;color:#0b684c}.employee-admin-person img,.employee-admin-photo img{width:100%;height:100%;object-fit:cover}.master-form label small{display:block;margin-top:5px;color:#6b7c72;font-size:11px}''',
'''      .employee-admin-person,.employee-admin-photo{display:flex;align-items:center;gap:12px}.employee-admin-person>div{width:40px;height:40px}.employee-admin-photo>div{width:72px;height:72px;font-size:28px}.employee-admin-person>div,.employee-admin-photo>div{overflow:hidden;border-radius:50%;background:#e9f4ef;display:grid;place-items:center;color:#0b684c}.employee-admin-person img,.employee-admin-photo img{width:100%;height:100%;object-fit:cover}.master-form label small{display:block;margin-top:5px;color:#6b7c72;font-size:11px}.employee-contract-toggle{display:inline-flex;align-items:center;gap:7px;border:0;background:transparent;color:#0b684c;font:inherit;cursor:pointer}.employee-contract-toggle span{font-size:16px}.employee-contract-row td{padding:0!important;background:#f7faf8}.employee-contract-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;padding:12px 18px 18px}.employee-contract-list article{display:grid;gap:3px;padding:11px 13px;border:1px solid #dce9e2;border-radius:12px;background:#fff}.employee-contract-list article span,.employee-contract-list article small{color:#63766c}.employee-contract-list p{margin:0;color:#63766c}''')
path.write_text(text)

# Regression test.
Path("scripts/validate-employee-contract-routing.mjs").write_text(r'''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const advisor = readFileSync("components/admin/RouteAdvisorPanel.tsx", "utf8");
const employees = readFileSync("app/admin/employees/page.tsx", "utf8");

assert.match(advisor, /item\.canonicalCrewId === employee\.crewId/, "Route Advisor must filter Jobs by the selected Employee crew.");
assert.match(advisor, /function selectAllVisible\(/, "Route Advisor must provide Select all.");
assert.match(advisor, /setSelectedJobIds\(\[\]\);\n    setRecommendations/, "Changing Employee must clear stale selections.");
assert.match(employees, /routeResult\.board\?\.assignedJobs/, "Employee contracts must use the canonical scheduling board.");
assert.match(employees, /job\.crewId.*crewId/, "Employee contract list must derive from canonical crew assignment.");
assert.match(employees, /employee-contract-toggle/, "Employee profiles must include a collapsible contracts control.");
console.log("PASS employee contract routing contract");
''')

package = Path("package.json")
data = package.read_text()
needle = '"check:smart-route-capacity": "node scripts/validate-smart-route-capacity.mjs"'
if needle in data and 'check:employee-contract-routing' not in data:
    data = data.replace(needle, needle + ',\n    "check:employee-contract-routing": "node scripts/validate-employee-contract-routing.mjs"')
    data = data.replace('pnpm check:smart-route-capacity && pnpm typecheck', 'pnpm check:smart-route-capacity && pnpm check:employee-contract-routing && pnpm typecheck')
package.write_text(data)

Path("docs/checkpoints/2026-08-05-smart-route-canonical-stable.md").write_text(
    Path("docs/checkpoints/2026-08-05-smart-route-canonical-stable.md").read_text()
    + "\n## Employee contract routing follow-up\n\n- Route Advisor house choices are filtered by the selected Employee canonical crew.\n- Select all applies only to visible, selectable contracts for that Employee.\n- Employee web profiles expose the same assigned Jobs in a collapsible contract list.\n- Changing Employee clears stale selections so houses cannot leak between workers.\n"
)
