from pathlib import Path

branch_files = {
    "profile": Path("app/admin/customers/[id]/page.tsx"),
    "customers": Path("app/admin/customers/page.tsx"),
    "tasks": Path("app/admin/tasks/page.tsx"),
    "operations": Path("app/admin/page.tsx"),
    "css": Path("app/globals.css"),
}

profile = branch_files["profile"].read_text()
old_board = '''    const board = await loadSchedulingDispatchBoard({ force: true });
    const jobs = [...board.unscheduledJobs, ...board.assignedJobs];'''
new_board = '''    const [board, nextPhotoHistory] = await Promise.all([
      loadSchedulingDispatchBoard(),
      getPropertyPhotoHistory(next.property.id).catch(() => null),
    ]);
    const jobs = [...board.unscheduledJobs, ...board.assignedJobs];'''
if old_board not in profile:
    raise SystemExit("Property profile board anchor not found")
profile = profile.replace(old_board, new_board, 1)

old_photo = '''    await getPropertyPhotoHistory(next.property.id).then(setPhotoHistory).catch(() => setPhotoHistory(null));
    setMessage("");'''
new_photo = '''    setPhotoHistory(nextPhotoHistory);
    setMessage("");'''
if old_photo not in profile:
    raise SystemExit("Property photo history anchor not found")
profile = profile.replace(old_photo, new_photo, 1)
branch_files["profile"].write_text(profile)

customers = branch_files["customers"].read_text()
if "loadSchedulingDispatchBoard({force:true})" not in customers:
    raise SystemExit("Customers force-refresh anchor not found")
customers = customers.replace("loadSchedulingDispatchBoard({force:true})", "loadSchedulingDispatchBoard()", 1)
customers = customers.replace('<div className="app-top">', '<div className="app-top customer-directory-head">', 1)
customers = customers.replace('<div className="stats v19-stats">', '<div className="stats v19-stats customer-directory-stats">', 1)
customers = customers.replace(
    '<section className="card table-card"><div className="table-head"><div><h2>Accepted customer directory</h2>',
    '<section className="card table-card customer-directory-card"><div className="table-head"><div><h2>Accepted customer directory</h2>',
    1,
)
branch_files["customers"].write_text(customers)

tasks = branch_files["tasks"].read_text()
tasks = tasks.replace('<div className="app-top">', '<div className="app-top tasks-page-head">', 1)
tasks = tasks.replace(
    '<section className="card profile-card" style={{ marginBottom: 20 }}>',
    '<section className="card profile-card task-create-card" style={{ marginBottom: 20 }}>',
    1,
)
tasks = tasks.replace(
    '<section className="card table-card"><div className="table-head"><div><h2>Open Tasks</h2>',
    '<section className="card table-card task-board-card"><div className="table-head"><div><h2>Open Tasks</h2>',
    1,
)
tasks = tasks.replace(
    '<section className="card table-card" style={{ marginTop: 20 }}>',
    '<section className="card table-card task-history-card" style={{ marginTop: 20 }}>',
    1,
)
branch_files["tasks"].write_text(tasks)

operations = branch_files["operations"].read_text()
operations = operations.replace('<AdminShell active="Dashboard">', '<AdminShell active="Operations Studio">', 1)
operations = operations.replace(
    '<section className="studio-page-head">',
    '<section className="studio-page-head operations-studio-hero">',
    1,
)
branch_files["operations"].write_text(operations)

css_path = branch_files["css"]
css = css_path.read_text()
marker = "/* V53.2 focused Admin layout and performance */"
if marker in css:
    css = css[:css.index(marker)].rstrip() + "\n"
css += r'''

/* V53.2 focused Admin layout and performance */
.studio-rail nav a .quick-action-label{
  min-width:0;
  width:auto;
  height:auto;
  display:block;
  align-self:center;
  margin:0;
  color:inherit;
  font-size:14px;
  font-weight:900;
  line-height:1.08;
  white-space:normal;
  word-break:normal;
  overflow-wrap:normal;
  hyphens:none;
}
.studio-rail nav a .quick-action-icon{
  align-self:center;
  justify-self:center;
}

.studio-main:has(.property-profile-card){
  background:
    radial-gradient(circle at 85% 4%,rgba(110,179,126,.16),transparent 28%),
    linear-gradient(145deg,#edf6f0 0%,#e4f0e8 54%,#edf6f1 100%);
}
.studio-main:has(.property-profile-card) .property-service-hero,
.studio-main:has(.property-profile-card) .property-profile-card{
  border-color:#cfe1d5;
  box-shadow:0 22px 58px rgba(7,62,39,.12);
}
.property-main-photo{background:#dcebe1}

.customer-directory-head,.tasks-page-head{
  padding:22px 24px;
  border:1px solid #d9e7df;
  border-radius:22px;
  background:linear-gradient(135deg,#fff,#f0f7f3);
  box-shadow:0 12px 32px rgba(8,62,40,.06);
}
.customer-directory-head .toolbar-inline,.tasks-page-head .toolbar-inline{
  align-items:center;
  gap:9px;
}
.customer-directory-stats .dash-card{
  border-color:#d8e6de;
  box-shadow:0 10px 26px rgba(7,54,35,.055);
}
.customer-directory-card{
  border-color:#d8e5de!important;
  box-shadow:0 16px 40px rgba(7,54,35,.07);
}
.customer-directory-card tbody tr:not(:has(td[colspan])){transition:background .14s ease}
.customer-directory-card tbody tr:not(:has(td[colspan])):hover{background:#f0f7f3}
.customer-directory-person>div{box-shadow:0 6px 16px rgba(7,61,38,.11)}

.task-summary-actions{gap:12px!important}
.task-summary-actions .quick-action{
  min-height:116px;
  border:1px solid #d8e6de!important;
  border-radius:20px!important;
  background:linear-gradient(145deg,#fff,#eef7f2)!important;
  box-shadow:0 12px 30px rgba(7,58,37,.07)!important;
  transition:transform .14s ease,box-shadow .14s ease;
}
.task-summary-actions .quick-action:hover{
  transform:translateY(-2px);
  box-shadow:0 18px 38px rgba(7,58,37,.11)!important;
}
.task-create-card,.task-board-card,.task-history-card{
  border-color:#d8e5de!important;
  border-radius:22px!important;
  box-shadow:0 14px 36px rgba(7,55,35,.065);
}
.task-create-card{background:linear-gradient(145deg,#fff,#f3f8f5)}
.task-create-card .form-grid{padding:2px 0}
.task-board-card thead th{background:#eef6f1}
.task-board-card tbody tr{transition:background .14s ease}
.task-board-card tbody tr:hover{background:#f2f8f4}
.task-board-card .mini-field{gap:8px}
.task-board-card .pill{display:inline-flex;align-items:center;min-height:30px}

.operations-studio-hero{
  position:relative;
  overflow:hidden;
  border-color:#d4e4da!important;
  background:
    radial-gradient(circle at 88% 15%,rgba(102,187,112,.22),transparent 30%),
    linear-gradient(135deg,#fff 0%,#edf7f1 100%)!important;
  box-shadow:0 18px 44px rgba(7,60,38,.085)!important;
}
.operations-studio-hero:after{
  content:"";
  position:absolute;
  width:180px;
  height:180px;
  right:-70px;
  bottom:-110px;
  border-radius:50%;
  border:30px solid rgba(13,112,70,.055);
  pointer-events:none;
}
.operations-studio-hero h1{letter-spacing:-.04em!important}
.studio-main:has(.operations-studio-hero) .studio-kpi,
.studio-main:has(.operations-studio-hero) .studio-panel{
  border-color:#d9e6df;
  box-shadow:0 11px 29px rgba(7,55,35,.06);
}

@media(max-width:760px){
  .customer-directory-head,.tasks-page-head{padding:17px;border-radius:18px}
  .studio-main:has(.property-profile-card){background:#edf6f0}
  .task-summary-actions .quick-action{min-height:100px}
}
'''
css_path.write_text(css)

for temporary in [
    Path(".github/workflows/agent-admin-polish-performance.yml"),
    Path(".github/workflows/agent-admin-polish-run.yml"),
    Path("scripts/temp-admin-polish.py"),
]:
    temporary.unlink(missing_ok=True)
