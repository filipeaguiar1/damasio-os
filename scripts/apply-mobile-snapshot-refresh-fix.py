from pathlib import Path

path = Path('components/mobile/EmployeeRouteMap.tsx')
text = path.read_text()
old = '  const { snapshot, error, loading, refresh } = useCanonicalRouteSnapshot(effectiveRouteId);\n'
new = '  const { snapshot, error, loading, refresh, invalidateAndRefresh } = useCanonicalRouteSnapshot(effectiveRouteId);\n'
if old not in text:
    raise SystemExit('EmployeeRouteMap hook anchor not found')
text = text.replace(old, new, 1)

anchor = '  const snapshotMatches = !preview\n    && Boolean(snapshot)\n    && snapshot?.routeId === effectiveRouteId\n    && (Boolean(routeId) || sameVisitMembership(operationalRoute, snapshot));\n\n'
insert = '''  const snapshotMatches = !preview\n    && Boolean(snapshot)\n    && snapshot?.routeId === effectiveRouteId\n    && (Boolean(routeId) || sameVisitMembership(operationalRoute, snapshot));\n  const publishedOrderSignature = useMemo(\n    () => operationalRoute.map(lead => `${lead.canonicalVisitId || lead.id}:${lead.routeOrder ?? 9999}`).join("|"),\n    [operationalRoute],\n  );\n  const publishedOrderRef = useRef(publishedOrderSignature);\n\n  useEffect(() => {\n    if (preview || !effectiveRouteId) {\n      publishedOrderRef.current = publishedOrderSignature;\n      return;\n    }\n    if (publishedOrderRef.current === publishedOrderSignature) return;\n    publishedOrderRef.current = publishedOrderSignature;\n    void invalidateAndRefresh();\n  }, [preview, effectiveRouteId, publishedOrderSignature, invalidateAndRefresh]);\n\n'''
if anchor not in text:
    raise SystemExit('EmployeeRouteMap snapshot anchor not found')
text = text.replace(anchor, insert, 1)
path.write_text(text)
