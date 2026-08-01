from pathlib import Path
import re

api_path = Path('app/api/mobile/employee/smart-route/route.ts')
api = api_path.read_text()
api = api.replace(
    'const forcedFirst = alternative > 0 ? starts[(alternative - 1) % starts.length] : null;',
    'const forcedFirst = alternative > 0 ? starts[alternative % starts.length] : null;'
)
old = '''      const matrix = await roadMatrix(body.origin, stops);
      const order = exactRoadOrder(stops.length, matrix.durations, Math.max(0, Number(body.alternative || 0)));
      const orderedIds = order.map(index => stops[index - 1].id);
      return NextResponse.json({
        orderedIds,
        distanceMeters: pathCost(order, matrix.distances),
        durationSeconds: pathCost(order, matrix.durations),
        alternative: Number(body.alternative || 0),
      });'''
new = '''      const matrix = await roadMatrix(body.origin, stops);
      const originDistances = (matrix.distances[0] || []).slice(1).filter((value): value is number => Number.isFinite(value));
      const nearestOriginDistance = originDistances.length ? Math.min(...originDistances) : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(nearestOriginDistance) || nearestOriginDistance > 80000) {
        throw new Error("The starting address was located too far from this route. Choose the full street address and city.");
      }
      const requestedAlternative = Math.max(0, Number(body.alternative || 0));
      let usedAlternative = requestedAlternative;
      let order = exactRoadOrder(stops.length, matrix.durations, requestedAlternative);
      let orderedIds = order.map(index => stops[index - 1].id);
      const inputIds = stops.map(stop => stop.id);
      if (requestedAlternative > 0 && orderedIds.every((id, index) => id === inputIds[index])) {
        for (let offset = 1; offset <= stops.length; offset += 1) {
          const candidateAlternative = requestedAlternative + offset;
          const candidateOrder = exactRoadOrder(stops.length, matrix.durations, candidateAlternative);
          const candidateIds = candidateOrder.map(index => stops[index - 1].id);
          if (candidateIds.some((id, index) => id !== inputIds[index])) {
            usedAlternative = candidateAlternative;
            order = candidateOrder;
            orderedIds = candidateIds;
            break;
          }
        }
      }
      const changed = orderedIds.some((id, index) => id !== inputIds[index]);
      return NextResponse.json({
        orderedIds,
        distanceMeters: pathCost(order, matrix.distances),
        durationSeconds: pathCost(order, matrix.durations),
        alternative: usedAlternative,
        changed,
      });'''
if old not in api:
    raise SystemExit('optimize block not found')
api = api.replace(old, new)
api_path.write_text(api)

service_path = Path('lib/services/routeMapService.ts')
service = service_path.read_text()
service = service.replace(
    'return result as { orderedIds: string[]; distanceMeters: number; durationSeconds: number; alternative: number };',
    'return result as { orderedIds: string[]; distanceMeters: number; durationSeconds: number; alternative: number; changed: boolean };'
)
service_path.write_text(service)

page_path = Path('app/mobile/employee/page.tsx')
page = page_path.read_text()
page = page.replace(
    'return await response.json() as {latitude:number;longitude:number};',
    'return await response.json() as {latitude:number;longitude:number;displayName?:string};'
)
page = page.replace(
    'function tryAnotherSmartRoute(){void prepareSmartRoute(smartAlternative+1)}',
    'function tryAnotherSmartRoute(){if(smartPreparing)return;setMessage("Calculating a different driving route...");void prepareSmartRoute(smartAlternative+1)}'
)
page = page.replace(
    'onClick={tryAnotherSmartRoute}',
    'className={`employee-smart-reroute${smartPreparing?" spinning":""}`} onClick={tryAnotherSmartRoute}'
)
# Prefer the geocoder's resolved label whenever a point variable is used to build the origin object.
page = re.sub(r'label:smartOriginValue\(\)', 'label:point.displayName||smartOriginValue()', page)
# If the API says the sequence is unchanged, make that explicit instead of pretending a new route appeared.
page = page.replace(
    'setSmartAlternative(result.alternative);',
    'setSmartAlternative(result.alternative);if(!result.changed)setMessage("This is already the best route for the selected starting point.");'
)
page_path.write_text(page)

css_path = Path('app/globals.css')
css = css_path.read_text()
css += '''\n@keyframes employeeSmartRouteSpin{to{transform:rotate(360deg)}}\n.employee-smart-reroute.spinning{animation:employeeSmartRouteSpin .75s linear infinite;pointer-events:none}\n.employee-smart-reroute.spinning:disabled{opacity:.85}\n'''
css_path.write_text(css)
