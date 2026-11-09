import { AppError } from "@/lib/errors";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

export function assertValidWorkDate(workDate: string): void {
  if (!isValidCalendarDate(workDate)) {
    throw new AppError(400, "workDate must be a real calendar date in YYYY-MM-DD format.", {
      details: { field: "workDate" },
    });
  }
}

export function assertValidStartTime(startTime: string): void {
  if (!TIME_PATTERN.test(startTime)) {
    throw new AppError(
      503,
      "JIRA_WORKLOG_START_TIME must use HH:mm:ss in 24-hour time.",
    );
  }
}

export function assertValidTimeZone(timeZone: string): void {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new AppError(503, `JIRA_TIMEZONE is not a valid IANA timezone: ${timeZone}`);
  }
}

export function isValidCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export function addCalendarDays(isoDate: string, days: number): string {
  const match = DATE_PATTERN.exec(isoDate);
  if (!match) {
    throw new AppError(400, "workDate must be a real calendar date in YYYY-MM-DD format.");
  }
  const utc = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function zonedWallTimeToUtcMs(
  workDate: string,
  startTime: string,
  timeZone: string,
): number {
  assertValidWorkDate(workDate);
  assertValidStartTime(startTime);
  assertValidTimeZone(timeZone);

  const [year, month, day] = workDate.split("-").map(Number);
  const [hour, minute, second] = startTime.split(":").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let offsetMinutes = readOffsetMinutes(new Date(wallAsUtc), timeZone);
  let utcMs = wallAsUtc - offsetMinutes * 60_000;
  const correctedOffset = readOffsetMinutes(new Date(utcMs), timeZone);
  if (correctedOffset !== offsetMinutes) {
    offsetMinutes = correctedOffset;
    utcMs = wallAsUtc - offsetMinutes * 60_000;
  }

  const actualWall = formatWallClock(new Date(utcMs), timeZone);
  if (actualWall !== `${workDate} ${startTime}`) {
    throw new AppError(
      400,
      `The worklog time ${startTime} is not a valid local time in ${timeZone} on ${workDate}.`,
    );
  }
  return utcMs;
}

export function formatJiraStarted(
  workDate: string,
  startTime: string,
  timeZone: string,
): string {
  const utcMs = zonedWallTimeToUtcMs(workDate, startTime, timeZone);
  const offsetMinutes = readOffsetMinutes(new Date(utcMs), timeZone);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${workDate}T${startTime}.000${sign}${hours}${minutes}`;
}

export function calendarDateInTimeZone(timestamp: string, timeZone: string): string {
  assertValidTimeZone(timeZone);
  const normalized = timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const instant = new Date(normalized);
  if (Number.isNaN(instant.getTime())) {
    throw new AppError(502, "Jira returned a worklog timestamp that could not be read.");
  }
  return formatWallClock(instant, timeZone).slice(0, 10);
}

function formatWallClock(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  let hour = read("hour");
  if (hour === "24") hour = "00";
  return `${read("year")}-${read("month")}-${read("day")} ${hour}:${read("minute")}:${read("second")}`;
}

function readOffsetMinutes(instant: Date, timeZone: string): number {
  for (const timeZoneName of ["longOffset", "shortOffset"] as const) {
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(instant);
    } catch {
      continue;
    }
    const label = parts.find((part) => part.type === "timeZoneName")?.value;
    if (!label) continue;
    const parsed = parseGmtOffset(label);
    if (parsed !== null) return parsed;
  }
  throw new AppError(503, `Could not resolve the UTC offset for timezone ${timeZone}.`);
}

function parseGmtOffset(value: string): number | null {
  const trimmed = value.trim();
  if (/^(?:GMT|UTC)$/i.test(trimmed)) return 0;
  const match = trimmed.match(/^(?:GMT|UTC)\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  if (hours > 14 || minutes > 59) return null;
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}
