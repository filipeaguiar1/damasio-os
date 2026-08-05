from pathlib import Path
import re
p=Path("components/admin/AdminShell.tsx");x=p.read_text()
x=x.replace('  ["Dashboard", "/admin/command"],\n','',1)
x=x.replace(' || (label === "Operations Studio" && active === "Dashboard")','')
m=re.search(r'<style jsx global>\{`.*?`\}</style>',x,re.S)
if not m: raise SystemExit("style block missing")
n='''<style jsx global>{`
        .studio-rail > nav a{display:grid!important;grid-template-columns:32px minmax(0,1fr);align-items:center;gap:10px;height:44px;min-height:44px;padding:5px 10px!important;overflow:hidden}
        .studio-rail > nav a > .quick-action-icon{display:grid!important;place-items:center;width:32px;height:32px;min-width:32px;line-height:1;align-self:center;justify-self:center}
        .studio-rail > nav a > .quick-action-label{display:flex!important;align-items:center;min-width:0;height:34px;font-size:12px!important;line-height:1.05!important;font-weight:900;white-space:normal!important;word-break:normal!important;overflow-wrap:normal!important;hyphens:none!important;overflow:visible!important}
      `}</style>'''
x=x[:m.start()]+n+x[m.end():];p.write_text(x)

p=Path("app/admin/customers/[id]/page.tsx");x=p.read_text()
a='''    const board = await loadSchedulingDispatchBoard({ force: true });
    const jobs = [...board.unscheduledJobs, ...board.assignedJobs];'''
b='''    const [board, nextPhotoHistory] = await Promise.all([
      loadSchedulingDispatchBoard(),
      getPropertyPhotoHistory(next.property.id).catch(() => null),
    ]);
    const jobs = [...board.unscheduledJobs, ...board.assignedJobs];'''
if a not in x: raise SystemExit("board anchor missing")
x=x.replace(a,b,1)
a='''    await getPropertyPhotoHistory(next.property.id).then(setPhotoHistory).catch(() => setPhotoHistory(null));
    setMessage("");'''
b='''    setPhotoHistory(nextPhotoHistory);
    setMessage("");'''
if a not in x: raise SystemExit("photo anchor missing")
x=x.replace(a,b,1);p.write_text(x)

p=Path("app/admin/customers/page.tsx");x=p.read_text().replace("loadSchedulingDispatchBoard({force:true})","loadSchedulingDispatchBoard()",1);p.write_text(x)
p=Path("app/globals.css");x=p.read_text();k="/* V52.8 focused Admin polish and performance */"
if k not in x:
 x+='''

/* V52.8 focused Admin polish and performance */
.studio-main:has(.property-profile-card){background:linear-gradient(145deg,#eef7f1 0%,#e4f1e9 55%,#edf6f0 100%)}
.property-profile-card{box-shadow:0 22px 58px rgba(8,70,43,.13)!important;border-color:#cfe2d6!important}
.property-main-photo{background:#dfece4!important}
.studio-rail>nav{gap:7px!important}.studio-rail>nav a{border-radius:13px!important}
.studio-main .app-top{padding:22px 24px;border:1px solid #dce9e1;border-radius:22px;background:linear-gradient(135deg,#fff,#f1f8f4);box-shadow:0 12px 32px rgba(8,68,42,.06)}
.studio-main .app-top .toolbar-inline{align-items:center;gap:9px}
.customer-directory-person{align-items:center!important}.customer-directory-person>div{box-shadow:0 5px 16px rgba(8,68,42,.10)}
.table-card{border-color:#dce7e1!important;box-shadow:0 12px 34px rgba(7,55,35,.055)}
.table-card tbody tr:not(:has(td[colspan])):hover{background:#f2f8f4}
.task-center-card,.task-summary-actions .quick-action{border-color:#d9e7df!important;box-shadow:0 12px 30px rgba(8,64,40,.07)!important}
.task-center-card{border-radius:20px!important;overflow:hidden}.task-center-card .task-main-clean{padding:18px!important}
.task-center-card .task-meta-strip{padding:10px 14px!important;border-radius:13px!important;background:#f1f7f3!important}
.task-summary-actions{gap:10px!important}.task-summary-actions .quick-action{border-radius:18px!important;background:linear-gradient(145deg,#fff,#f2f8f4)!important}
.studio-page-head{padding:24px 26px;border:1px solid #d9e7df;border-radius:24px;background:linear-gradient(135deg,#fff,#edf7f1);box-shadow:0 14px 38px rgba(7,64,39,.07)}
.studio-page-head h1{letter-spacing:-.035em}
.studio-main .studio-grid .card,.studio-main .studio-kpi{border-color:#d9e7df;box-shadow:0 10px 28px rgba(8,58,38,.055)}
@media(max-width:760px){.studio-main:has(.property-profile-card){background:#edf6f0}.studio-main .app-top{padding:17px;border-radius:19px}}
'''
p.write_text(x)
