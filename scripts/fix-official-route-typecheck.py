from pathlib import Path

path = Path("app/employee/route/page.tsx")
text = path.read_text()

if 'type { CanonicalRouteLead }' not in text:
    text = text.replace(
        'import {runVisitStatusOrQueue} from "@/lib/mobile/offlineActionQueue";',
        'import {runVisitStatusOrQueue} from "@/lib/mobile/offlineActionQueue";\nimport type { CanonicalRouteLead } from "@/lib/routes/canonicalRouteIdentity";',
        1,
    )

text = text.replace(
    '  const allRouteLeads=useMemo(()=>applyEmployeeRouteMapContext(localRouteLeads,mapContext),[localRouteLeads,mapContext]);',
    '  const allRouteLeads=useMemo(()=>applyEmployeeRouteMapContext(localRouteLeads,mapContext) as CanonicalRouteLead[],[localRouteLeads,mapContext]);',
    1,
)
text = text.replace('            const attention=tasks.some(task=>task.leadId===lead.id&&task.status!=="resolved");\n', '')
text = text.replace('            const nextId=mapRouteLeads.find(item=>item.status!=="completed"&&getSessionForLead(item.id)?.status!=="skipped")?.id;\n', '')
text = text.replace(
    '<span>{index+1}</span><div><strong>{lead.address||"Not mapped"}</strong><small>{lead.service}</small></div><em>{state==="attention"?"Needs attention":state==="next"?"Next visit":state}</em>',
    '<span>{index+1}</span><div><strong>{lead.address||"Not mapped"}</strong><small>{lead.service}</small></div><em>{state}</em>',
    1,
)
text = text.replace(
    '{view==="details"?<button className="reset-btn" onClick={reset}>Reset House</button>:<button className="reset-btn" onClick={loadDemo}>Load Demo</button>}',
    '{view==="details"&&<button className="reset-btn" onClick={reset}>Reset House</button>}',
    1,
)

path.write_text(text)
print("Official route TypeScript fixes applied.")
