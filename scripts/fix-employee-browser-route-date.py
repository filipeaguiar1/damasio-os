from pathlib import Path

path = Path("app/employee/route/page.tsx")
text = path.read_text()
old = '''    const today=DAMASIO_WEEK_DAYS[(new Date().getDay()+6)%7];
    if(qDay&&DAMASIO_WEEK_DAYS.includes(qDay)){setDay(qDay);setSelectedDate(routeDateForWeekday(qDay));}
    else setDay(today);'''
new = '''    const clientNow=new Date();
    const clientToday=localDateKey(clientNow);
    const clientWeekStart=mondayKey(clientNow);
    const today=DAMASIO_WEEK_DAYS[(clientNow.getDay()+6)%7];
    setWeekStart(clientWeekStart);
    if(qDay&&DAMASIO_WEEK_DAYS.includes(qDay)){setDay(qDay);setSelectedDate(routeDateForWeekday(qDay));}
    else {setDay(today);setSelectedDate(clientToday);}'''
if text.count(old) != 1:
    raise RuntimeError(f"expected one Employee date bootstrap block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
