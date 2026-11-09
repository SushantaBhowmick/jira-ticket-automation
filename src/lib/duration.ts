import { AppError } from "@/lib/errors";

const MAX_HOURS = 99;

export function hoursToSeconds(hours: number): number {
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) {
    throw new AppError(400, "hours must be a number greater than zero.", {
      details: { field: "hours" },
    });
  }
  if (hours > MAX_HOURS) {
    throw new AppError(400, `hours must be ${MAX_HOURS} or less.`, {
      details: { field: "hours" },
    });
  }

  const seconds = Math.round(hours * 3600);
  if (seconds <= 0) {
    throw new AppError(
      400,
      "hours is too small to record. Jira stores work in whole seconds.",
      { details: { field: "hours" } },
    );
  }
  return seconds;
}

export function secondsToJiraTimeSpent(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (remainingSeconds > 0) parts.push(`${remainingSeconds}s`);
  if (parts.length === 0) parts.push("0m");
  return parts.join(" ");
}
