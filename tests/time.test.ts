import { describe, expect, it } from "vitest";
import { calendarDateInTimeZone, formatJiraStarted, isValidCalendarDate } from "@/lib/time";

describe("jira timestamps", () => {
  it("keeps the supplied calendar date in Asia/Kolkata", () => {
    expect(formatJiraStarted("2026-11-09", "09:00:00", "Asia/Kolkata")).toBe(
      "2026-11-09T09:00:00.000+0530",
    );
  });

  it("uses the daylight-saving offset for the supplied date", () => {
    expect(formatJiraStarted("2026-01-15", "09:00:00", "America/New_York")).toBe(
      "2026-01-15T09:00:00.000-0500",
    );
    expect(formatJiraStarted("2026-07-15", "09:00:00", "America/New_York")).toBe(
      "2026-07-15T09:00:00.000-0400",
    );
  });

  it("reads a Jira timestamp back onto the configured calendar date", () => {
    expect(calendarDateInTimeZone("2026-11-09T09:00:00.000+0530", "Asia/Kolkata")).toBe(
      "2026-11-09",
    );
  });

  it("rejects impossible calendar dates", () => {
    expect(isValidCalendarDate("2026-02-31")).toBe(false);
    expect(isValidCalendarDate("2026-11-09")).toBe(true);
    expect(isValidCalendarDate("09-11-2026")).toBe(false);
  });
});
