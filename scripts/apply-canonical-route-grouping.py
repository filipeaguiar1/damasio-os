from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "components/admin/OfficialRoutePlanMap.tsx",
    'import { belongsToCanonicalEmployee } from "@/lib/routes/canonicalRouteIdentity";',
    'import { belongsToCanonicalEmployee, canonicalRouteLeadsForEmployee } from "@/lib/routes/canonicalRouteIdentity";',
)

replace_once(
    "components/admin/OfficialRoutePlanMap.tsx",
    '''  const selectedRoute = useMemo(() => selectedIdentity
    ? visits.filter(item => belongsToCanonicalEmployee(item, selectedIdentity)).sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999))
    : [], [visits, selectedIdentity?.id, selectedIdentity?.crewId]);''',
    '''  const selectedRoute = useMemo(() => selectedIdentity
    ? canonicalRouteLeadsForEmployee(visits, selectedIdentity).sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999))
    : [], [visits, selectedIdentity?.id, selectedIdentity?.crewId]);''',
)

replace_once(
    "components/admin/OfficialRoutePlanMap.tsx",
    '      result.set(employee.id, visits.filter(item => belongsToCanonicalEmployee(item, identity)).length);',
    '      result.set(employee.id, canonicalRouteLeadsForEmployee(visits, identity).length);',
)

replace_once(
    "app/mobile/admin/routes/page.tsx",
    'import { belongsToCanonicalEmployee } from "@/lib/routes/canonicalRouteIdentity";',
    'import { canonicalRouteLeadsForEmployee } from "@/lib/routes/canonicalRouteIdentity";',
)

replace_once(
    "app/mobile/admin/routes/page.tsx",
    '''  const route = useMemo(() => {
    if (!employee) return [];
    const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId };
    return leads
      .filter(item => item.canonicalVisitId
        && item.canonicalRouteId
        && item.scheduledDate === date
        && belongsToCanonicalEmployee(item, identity))
      .sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999)
        || a.address.localeCompare(b.address));
  }, [leads, employee, date]);''',
    '''  const route = useMemo(() => {
    if (!employee) return [];
    const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId };
    const datedVisits = leads.filter(item => item.canonicalVisitId
      && item.canonicalRouteId
      && item.scheduledDate === date);
    return canonicalRouteLeadsForEmployee(datedVisits, identity)
      .sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999)
        || a.address.localeCompare(b.address));
  }, [leads, employee, date]);''',
)
