// Convert a wall-clock date/time in an IANA timezone to a UTC Date (no external deps).
export function zonedToUtc(dateStr, hhmm, tz) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const asZoned = (ms) => {
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  };
  let utc = guess - (asZoned(guess) - guess);
  utc = guess - (asZoned(utc) - utc); // second pass handles DST edges
  return new Date(utc);
}

export function dateInZone(date, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

export const dayOfWeek = (dateStr) =>
  new Date(`${dateStr}T00:00:00Z`).getUTCDay();

export function* eachDate(from, to) {
  const end = new Date(`${to}T00:00:00Z`);
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= end;
    d = new Date(d.getTime() + 86400000)
  ) {
    yield d.toISOString().slice(0, 10);
  }
}
