from pathlib import Path

root = Path(__file__).resolve().parents[1]

service = root / "lib/services/routeMapService.ts"
text = service.read_text()
needle = "export async function applyEmployeeDatabaseSmartRoute(params: {\n  routeId: string;\n  originalOrder: string[];\n  appliedOrder: string[];\n  origin: { label: string; latitude: number; longitude: number };\n  expectedVersion?: number | null;\n}) {\n  if (!isSupabaseConfigured()) throw new Error(\"Database route mode is not configured.\");\n  const supabase = getSupabaseBrowserClient() as any;\n  const { data, error } = await supabase.rpc(\"apply_employee_smart_route\", {\n    p_route_id: params.routeId,\n    p_original_order: params.originalOrder,\n    p_applied_order: params.appliedOrder,\n    p_origin_label: params.origin.label,\n    p_origin_latitude: params.origin.latitude,\n    p_origin_longitude: params.origin.longitude,\n    p_expected_version: params.expectedVersion ?? null,\n  });\n  if (error) throw new Error(error.message);\n  const row = Array.isArray(data) ? data[0] : null;\n  return Number(row?.route_version || 0);\n}\n"
replacement = "export async function optimizeEmployeeRoadRoute(params: {\n  routeId: string;\n  origin: { label: string; latitude: number; longitude: number };\n  stops: Array<{ id: string; latitude: number; longitude: number }>;\n  alternative?: number;\n}) {\n  const token = await accessToken();\n  if (!token) throw new Error(\"Your Employee login expired. Sign in again.\");\n  const response = await fetch(\"/api/mobile/employee/smart-route\", {\n    method: \"POST\",\n    headers: { \"content-type\": \"application/json\", authorization: `Bearer ${token}` },\n    body: JSON.stringify({ action: \"optimize\", ...params }),\n  });\n  const result = await response.json();\n  if (!response.ok) throw new Error(result.error || \"Road Smart Route could not be calculated.\");\n  return result as { orderedIds: string[]; distanceMeters: number; durationSeconds: number; alternative: number };\n}\n\nexport async function applyEmployeeDatabaseSmartRoute(params: {\n  routeId: string;\n  originalOrder: string[];\n  appliedOrder: string[];\n  origin: { label: string; latitude: number; longitude: number };\n  expectedVersion?: number | null;\n}) {\n  const token = await accessToken();\n  if (!token) throw new Error(\"Your Employee login expired. Sign in again.\");\n  const response = await fetch(\"/api/mobile/employee/smart-route\", {\n    method: \"POST\",\n    headers: { \"content-type\": \"application/json\", authorization: `Bearer ${token}` },\n    body: JSON.stringify({ action: \"apply\", routeId: params.routeId, originalOrder: params.originalOrder, appliedOrder: params.appliedOrder, origin: params.origin }),\n  });\n  const result = await response.json();\n  if (!response.ok) throw new Error(result.error || \"Smart Route could not be applied.\");\n  return Number(result.count || 0);\n}\n"
if needle not in text:
    raise SystemExit("routeMapService apply block not found")
service.write_text(text.replace(needle, replacement))

page = root / "app/mobile/employee/page.tsx"
text = page.read_text()
old_import = "applyEmployeeDatabaseSmartRoute, applyEmployeeRouteMapContext, loadEmployeeDatabaseSmartRouteState, loadEmployeeRouteMapContext, restoreEmployeeDatabaseSmartRoute"
new_import = "applyEmployeeDatabaseSmartRoute, applyEmployeeRouteMapContext, loadEmployeeDatabaseSmartRouteState, loadEmployeeRouteMapContext, optimizeEmployeeRoadRoute, restoreEmployeeDatabaseSmartRoute"
if old_import not in text:
    raise SystemExit("employee routeMapService import not found")
text = text.replace(old_import, new_import, 1)
old_state = "  const [smartPreparing,setSmartPreparing]=useState(false);\n"
new_state = "  const [smartPreparing,setSmartPreparing]=useState(false);\n  const [smartRoadMetrics,setSmartRoadMetrics]=useState<{distance:number;time:number}|null>(null);\n"
if old_state not in text:
    raise SystemExit("smartPreparing state not found")
text = text.replace(old_state, new_state, 1)
text = text.replace("function clearSmartPreview(){setSmartPreview([]);setSmartOriginPoint(null);setSmartAlternative(0)}", "function clearSmartPreview(){setSmartPreview([]);setSmartOriginPoint(null);setSmartRoadMetrics(null);setSmartAlternative(0)}", 1)
old_prepare = "      const located=await Promise.all(chosen.map(ensureCoordinates));\n      const ordered=buildSmartOrder(located,origin,nextAlternative);\n      setSmartAlternative(nextAlternative);setSmartOriginPoint(origin);setSmartPreview(ordered);setMessage(nextAlternative?\"Another route is ready. Review it before applying.\":\"Preview ready. Review the map before applying this route.\");"
new_prepare = "      const located=await Promise.all(chosen.map(ensureCoordinates));\n      if(!mapContext.routeId)throw new Error(\"Publish the Admin route before using road Smart Route.\");\n      const optimized=await optimizeEmployeeRoadRoute({routeId:mapContext.routeId,origin,stops:located.map(lead=>({id:lead.canonicalVisitId||lead.id,latitude:Number(lead.latitude),longitude:Number(lead.longitude)})),alternative:nextAlternative});\n      const byVisit=new Map(located.map(lead=>[lead.canonicalVisitId||lead.id,lead]));\n      const ordered=optimized.orderedIds.map(id=>byVisit.get(id)).filter(Boolean) as Lead[];\n      if(ordered.length!==located.length)throw new Error(\"The road optimizer did not return every selected stop.\");\n      setSmartAlternative(nextAlternative);setSmartOriginPoint(origin);setSmartPreview(ordered);setSmartRoadMetrics({distance:optimized.distanceMeters/1000,time:Math.max(1,Math.round(optimized.durationSeconds/60))});setMessage(nextAlternative?\"A genuinely different road route is ready. Review it before applying.\":\"Road-based preview ready. Review the map before applying this route.\");"
if old_prepare not in text:
    raise SystemExit("prepareSmartRoute block not found")
text = text.replace(old_prepare, new_prepare, 1)
old_metrics = "  const smartMetrics=useMemo(()=>{if(!smartPreview.length||!smartOriginPoint)return null;const points=[smartOriginPoint,...smartPreview.map(lead=>({latitude:Number(lead.latitude),longitude:Number(lead.longitude)}))];let km=0;for(let index=1;index<points.length;index++){const a=points[index-1],b=points[index];const toRad=(value:number)=>value*Math.PI/180;const dLat=toRad(b.latitude-a.latitude);const dLon=toRad(b.longitude-a.longitude);const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.latitude))*Math.cos(toRad(b.latitude))*Math.sin(dLon/2)**2;km+=6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}const roadKm=km*1.22;return{distance:roadKm,time:Math.max(1,Math.round(roadKm/35*60))}},[smartPreview,smartOriginPoint]);"
new_metrics = "  const smartMetrics=smartRoadMetrics;"
if old_metrics not in text:
    raise SystemExit("smartMetrics block not found")
text = text.replace(old_metrics, new_metrics, 1)
page.write_text(text)

css = root / "app/globals.css"
text = css.read_text()
text += "\n/* Employee Smart Route road preview layering */\n.employee-smart-preview,.employee-smart-preview>header,.employee-smart-preview-tools{position:relative;z-index:40}\n.employee-smart-info{position:relative;z-index:80}\n.employee-smart-info>div{position:absolute!important;z-index:120!important;right:0;top:calc(100% + 8px);min-width:220px;box-shadow:0 18px 45px rgba(15,23,42,.28)}\n.employee-smart-map-wrap{position:relative;z-index:1;overflow:hidden}\n.employee-smart-preview-actions{position:sticky;bottom:0;z-index:60;background:#fff;padding-bottom:max(12px,env(safe-area-inset-bottom))}\n"
css.write_text(text)
