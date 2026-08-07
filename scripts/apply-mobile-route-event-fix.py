from pathlib import Path

path = Path('app/mobile/employee/page.tsx')
text = path.read_text()

old_apply = '''      const nextContext=await loadEmployeeRouteMapContextByRouteId(mapContext.routeId);\n      setMapContext(nextContext);\n      setSmartPreview([]);setHomeMode("route");setRouteView("map");refresh(false);setMessage("Smart Route applied. Admin and Employee now share the same published order.");\n'''
new_apply = '''      const nextContext=await loadEmployeeRouteMapContextByRouteId(mapContext.routeId);\n      setMapContext(nextContext);\n      window.dispatchEvent(new CustomEvent("damasio:canonical-route-updated", { detail: { routeId: mapContext.routeId, routeVersion: nextContext.routeVersion } }));\n      setSmartPreview([]);setHomeMode("route");setRouteView("map");refresh(false);setMessage("Smart Route applied. Admin and Employee now share the same published order.");\n'''
if old_apply not in text:
    raise SystemExit('Smart Route apply anchor not found')
text = text.replace(old_apply, new_apply, 1)

old_restore = '''        setSmartRouteActive(false);setActiveSmartState(null);setSmartPreview([]);\n        setMapContext(await loadEmployeeRouteMapContextByRouteId(mapContext.routeId));\n        refresh(false);setMessage("Original route restored on Admin and Employee.")\n'''
new_restore = '''        setSmartRouteActive(false);setActiveSmartState(null);setSmartPreview([]);\n        const restoredContext=await loadEmployeeRouteMapContextByRouteId(mapContext.routeId);\n        setMapContext(restoredContext);\n        window.dispatchEvent(new CustomEvent("damasio:canonical-route-updated", { detail: { routeId: mapContext.routeId, routeVersion: restoredContext.routeVersion } }));\n        refresh(false);setMessage("Original route restored on Admin and Employee.")\n'''
if old_restore not in text:
    raise SystemExit('Smart Route restore anchor not found')
text = text.replace(old_restore, new_restore, 1)

path.write_text(text)
