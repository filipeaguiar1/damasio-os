from pathlib import Path

path = Path("app/employee/route/page.tsx")
text = path.read_text()


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
'''  const [routeOrigin,setRouteOrigin]=useState<{latitude:number;longitude:number;label:string}|null>(null);
  const photoInputRef=useRef<HTMLInputElement|null>(null);
''',
'''  const [routeOrigin,setRouteOrigin]=useState<{latitude:number;longitude:number;label:string}|null>(null);
  const photoInputRef=useRef<HTMLInputElement|null>(null);
  const verifiedExecutionRef=useRef(new Map<string,{
    status:string;
    startedAt?:string;
    finishedAt?:string;
    durationSeconds?:number;
  }>());

  function acceptCanonicalContext(context:EmployeeRouteMapContext){
    const rank=(status:string)=>status==="completed"||status==="missed"?2:status==="in_progress"?1:0;
    const stops=context.stops.map(stop=>{
      const verified=verifiedExecutionRef.current.get(stop.visitId);
      if(!verified)return stop;
      if(stop.status===verified.status||rank(stop.status)>rank(verified.status)){
        verifiedExecutionRef.current.delete(stop.visitId);
        return stop;
      }
      return {...stop,...verified};
    });
    setMapContext({...context,stops});
  }
''')

replace_once(
'''    const loadContext=()=>void loadEmployeeRouteMapContext(selectedDate,crew)
      .then(context=>{if(!cancelled)setMapContext(context)})
''',
'''    const loadContext=()=>void loadEmployeeRouteMapContext(selectedDate,crew)
      .then(context=>{if(!cancelled)acceptCanonicalContext(context)})
''')

replace_once(
'''        setMapContext(current=>({...current,stops:current.stops.map(stop=>stop.visitId===visitId?{
          ...stop,
          status:"in_progress",
          startedAt:verified.started_at||undefined,
          finishedAt:undefined,
          durationSeconds:undefined,
        }:stop)}));
        void loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,visitId,"in_progress")
          .then(setMapContext)
''',
'''        const confirmed={
          status:"in_progress",
          startedAt:verified.started_at||undefined,
          finishedAt:undefined,
          durationSeconds:undefined,
        };
        verifiedExecutionRef.current.set(visitId,confirmed);
        setMapContext(current=>({...current,stops:current.stops.map(stop=>stop.visitId===visitId?{
          ...stop,
          ...confirmed,
        }:stop)}));
        void loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,visitId,"in_progress")
          .then(acceptCanonicalContext)
''')

replace_once(
'''        setMapContext(current=>({...current,stops:current.stops.map(stop=>stop.visitId===visitId?{
          ...stop,
          status:"completed",
          startedAt:verified.started_at||undefined,
          finishedAt:verified.finished_at||undefined,
          durationSeconds:Number(verified.duration_seconds),
        }:stop)}));
        void loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,visitId,"completed")
          .then(setMapContext)
''',
'''        const confirmed={
          status:"completed",
          startedAt:verified.started_at||undefined,
          finishedAt:verified.finished_at||undefined,
          durationSeconds:Number(verified.duration_seconds),
        };
        verifiedExecutionRef.current.set(visitId,confirmed);
        setMapContext(current=>({...current,stops:current.stops.map(stop=>stop.visitId===visitId?{
          ...stop,
          ...confirmed,
        }:stop)}));
        void loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,visitId,"completed")
          .then(acceptCanonicalContext)
''')

replace_once(
'''        await runVisitStatusOrQueue(selected.canonicalVisitId,"scheduled");
        setMapContext(await loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,selected.canonicalVisitId,"scheduled"));
''',
'''        await runVisitStatusOrQueue(selected.canonicalVisitId,"scheduled");
        verifiedExecutionRef.current.delete(selected.canonicalVisitId);
        acceptCanonicalContext(await loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,selected.canonicalVisitId,"scheduled"));
''')

path.write_text(text)
