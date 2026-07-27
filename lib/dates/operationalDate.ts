const DEFAULT_OPERATIONAL_TIME_ZONE = "America/Toronto";

export function operationalDateKey(date = new Date(), timeZone = DEFAULT_OPERATIONAL_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function operationalTimeZone() {
  return DEFAULT_OPERATIONAL_TIME_ZONE;
}
