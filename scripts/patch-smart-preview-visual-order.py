from pathlib import Path

page_path = Path('app/mobile/employee/page.tsx')
page = page_path.read_text()

old = '''      const ordered=optimized.orderedIds.map(id=>byVisit.get(id)).filter(Boolean) as Lead[];
      if(ordered.length!==located.length)throw new Error("The road optimizer did not return every selected stop.");
      setSmartAlternative(nextAlternative);setSmartOriginPoint(origin);setSmartPreview(ordered);setSmartRoadMetrics({distance:optimized.distanceMeters/1000,time:Math.max(1,Math.round(optimized.durationSeconds/60))});setMessage(nextAlternative?"A genuinely different road route is ready. Review it before applying.":"Road-based preview ready. Review the map before applying this route.");'''
new = '''      const ordered=optimized.orderedIds.map((id,index)=>{const lead=byVisit.get(id);return lead?{...lead,routeOrder:index+1}:null}).filter(Boolean) as Lead[];
      if(ordered.length!==located.length)throw new Error("The road optimizer did not return every selected stop.");
      const inputIds=located.map(lead=>lead.canonicalVisitId||lead.id);
      const changed=optimized.orderedIds.some((id,index)=>id!==inputIds[index]);
      setSmartAlternative(optimized.alternative);setSmartOriginPoint(origin);setSmartPreview(ordered);setSmartRoadMetrics({distance:optimized.distanceMeters/1000,time:Math.max(1,Math.round(optimized.durationSeconds/60))});setMessage(changed?(nextAlternative?"A different road sequence is ready. Review the numbered stops before applying.":"Road-based preview ready. Review the numbered stops before applying."):"This is already the best sequence for the selected starting point.");'''
if old not in page:
    raise SystemExit('prepare block not found')
page = page.replace(old, new)

old2 = '''function tryAnotherSmartRoute(){void prepareSmartRoute(smartAlternative+1)}'''
new2 = '''function tryAnotherSmartRoute(){if(smartPreparing)return;setMessage("Calculating a different driving sequence...");void prepareSmartRoute(smartAlternative+1)}'''
if old2 not in page:
    raise SystemExit('reroute handler not found')
page = page.replace(old2, new2)

page_path.write_text(page)

map_path = Path('components/mobile/EmployeeRouteMap.tsx')
map_text = map_path.read_text()
old3 = '''html: `<div class="employee-map-marker ${active ? "active" : ""}" style="background:${point.color}">${point.routeOrder || index + 1}</div>`,'''
new3 = '''html: `<div class="employee-map-marker ${active ? "active" : ""}" style="background:${point.color}">${index + 1}</div>`,'''
if old3 not in map_text:
    raise SystemExit('marker label block not found')
map_text = map_text.replace(old3, new3)
map_path.write_text(map_text)
