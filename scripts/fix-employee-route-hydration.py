from pathlib import Path

path = Path("app/employee/route/page.tsx")
text = path.read_text()
old = '''    void loadEmployeeOperationalIdentity().then(identity=>{setCrew(identity.crew);setRouteStartAddress(identity.routeStartAddress||"")});
    const clientNow=new Date();
    const clientToday=localDateKey(clientNow);
    const clientWeekStart=mondayKey(clientNow);
    const today=DAMASIO_WEEK_DAYS[(clientNow.getDay()+6)%7];
    if(qDate&&/^\\d{4}-\\d{2}-\\d{2}$/.test(qDate)){
      setSelectedDate(qDate);
      setWeekStart(mondayKey(new Date(`${qDate}T12:00:00`)));
      const routeDayIndex=(new Date(`${qDate}T12:00:00`).getDay()+6)%7;
      setDay(DAMASIO_WEEK_DAYS[routeDayIndex]);
    }else{
      setWeekStart(clientWeekStart);
      if(qDay&&DAMASIO_WEEK_DAYS.includes(qDay)){setDay(qDay);setSelectedDate(routeDateForWeekday(qDay));}
      else {setDay(today);setSelectedDate(clientToday);}
    }
    refresh();
    if(qProperty){setSelectedId(qProperty);setView("details");}
    else if(qView==="map")setView("map");
    const on=()=>refresh();
    window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);
    window.addEventListener("storage",on);
    const timer=setInterval(()=>{if(document.visibilityState==="visible")refresh()},15000);
    return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on);clearInterval(timer)}'''
new = '''    // Resolve the requested canonical surface before touching legacy browser storage.
    // A stale or blocked localStorage record must never prevent the web map from hydrating.
    const clientNow=new Date();
    const clientToday=localDateKey(clientNow);
    const clientWeekStart=mondayKey(clientNow);
    const today=DAMASIO_WEEK_DAYS[(clientNow.getDay()+6)%7];
    if(qDate&&/^\\d{4}-\\d{2}-\\d{2}$/.test(qDate)){
      setSelectedDate(qDate);
      setWeekStart(mondayKey(new Date(`${qDate}T12:00:00`)));
      const routeDayIndex=(new Date(`${qDate}T12:00:00`).getDay()+6)%7;
      setDay(DAMASIO_WEEK_DAYS[routeDayIndex]);
    }else{
      setWeekStart(clientWeekStart);
      if(qDay&&DAMASIO_WEEK_DAYS.includes(qDay)){setDay(qDay);setSelectedDate(routeDateForWeekday(qDay));}
      else {setDay(today);setSelectedDate(clientToday);}
    }
    if(qProperty){setSelectedId(qProperty);setView("details");}
    else if(qView==="map")setView("map");

    void loadEmployeeOperationalIdentity()
      .then(identity=>{setCrew(identity.crew);setRouteStartAddress(identity.routeStartAddress||"")})
      .catch(error=>setMenuMessage(error instanceof Error?error.message:"Employee identity could not be loaded."));

    const safeRefresh=()=>{
      try{refresh()}
      catch(error){setMenuMessage(error instanceof Error?error.message:"Legacy route data could not be loaded.")}
    };
    safeRefresh();
    const on=()=>safeRefresh();
    window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);
    window.addEventListener("storage",on);
    const timer=setInterval(()=>{if(document.visibilityState==="visible")safeRefresh()},15000);
    return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on);clearInterval(timer)}'''
count = text.count(old)
if count != 1:
    raise RuntimeError(f"expected one hydration block, found {count}")
path.write_text(text.replace(old, new, 1))
