const formatterCache = new Map();

function formatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      }),
    );
  }
  return formatterCache.get(timeZone);
}

const WEEKDAY_INDEX = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

export function zonedParts(date, timeZone) {
  const values = {};
  for (const part of formatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAY_INDEX[values.weekday],
  };
}

export function zonedLocalToDate(local, timeZone) {
  const targetUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour ?? 0,
    local.minute ?? 0,
    local.second ?? 0,
  );
  let guess = targetUtc;

  // Iteratively compensate for the timezone's UTC offset at the target wall time.
  // This also handles DST changes without a third-party datetime dependency.
  for (let i = 0; i < 5; i += 1) {
    const observed = zonedParts(new Date(guess), timeZone);
    const observedUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const delta = targetUtc - observedUtc;
    if (Math.abs(delta) < 1000) break;
    guess += delta;
  }
  return new Date(guess);
}

function shiftCalendarDate(parts, days) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function localDayStart(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return zonedLocalToDate({ year: parts.year, month: parts.month, day: parts.day }, timeZone);
}

export function addLocalDays(date, days, timeZone) {
  const parts = zonedParts(date, timeZone);
  const shifted = shiftCalendarDate(parts, days);
  return zonedLocalToDate(shifted, timeZone);
}

export function weekBounds(date, timeZone) {
  const local = zonedParts(date, timeZone);
  const daysSinceMonday = (local.weekday + 6) % 7;
  const monday = shiftCalendarDate(local, -daysSinceMonday);
  const start = zonedLocalToDate(monday, timeZone);
  const endDate = shiftCalendarDate(monday, 7);
  const end = zonedLocalToDate(endDate, timeZone);
  return [start, end];
}
