from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))

replace_once(
    "app/employee/route/page.tsx",
    '''    const qDay=params.get("day");
    const qProperty=params.get("property");
    const qView=params.get("view");''',
    '''    const qDay=params.get("day");
    const qDate=params.get("date");
    const qProperty=params.get("property");
    const qView=params.get("view");''',
)
replace_once(
    "app/employee/route/page.tsx",
    '''    setWeekStart(clientWeekStart);
    if(qDay&&DAMASIO_WEEK_DAYS.includes(qDay)){setDay(qDay);setSelectedDate(routeDateForWeekday(qDay));}
    else {setDay(today);setSelectedDate(clientToday);}''',
    '''    if(qDate&&/^\\d{4}-\\d{2}-\\d{2}$/.test(qDate)){
      setSelectedDate(qDate);
      setWeekStart(mondayKey(new Date(`${qDate}T12:00:00`)));
      const routeDayIndex=(new Date(`${qDate}T12:00:00`).getDay()+6)%7;
      setDay(DAMASIO_WEEK_DAYS[routeDayIndex]);
    }else{
      setWeekStart(clientWeekStart);
      if(qDay&&DAMASIO_WEEK_DAYS.includes(qDay)){setDay(qDay);setSelectedDate(routeDateForWeekday(qDay));}
      else {setDay(today);setSelectedDate(clientToday);}
    }''',
)
replace_once(
    "tests/canonical-route-sync.spec.ts",
    '''  await employeeDesktop.goto(`${baseURL}/employee/route?view=map`);

  await adminDesktop.goto(`${baseURL}/admin/routes?tab=view`);''',
    '''  await employeeDesktop.goto(`${baseURL}/employee/route?view=map&date=${encodeURIComponent(routeDate)}`);
  const employeeMapTab = employeeDesktop.getByRole("button", { name: "Map", exact: true });
  await expect(employeeMapTab).toBeVisible({ timeout: 30_000 });
  await employeeMapTab.click();

  await adminDesktop.goto(`${baseURL}/admin/routes?tab=view`);''',
)
