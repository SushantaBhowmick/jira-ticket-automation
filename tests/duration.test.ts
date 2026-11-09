import { describe, expect, it } from "vitest";
import { hoursToSeconds, secondsToJiraTimeSpent } from "@/lib/duration";

describe("duration", () => {
  it("converts whole and fractional hours to seconds", () => {
    expect(hoursToSeconds(4)).toBe(14400);
    expect(hoursToSeconds(1.5)).toBe(5400);
    expect(hoursToSeconds(0.25)).toBe(900);
    expect(secondsToJiraTimeSpent(14400)).toBe("4h");
    expect(secondsToJiraTimeSpent(5400)).toBe("1h 30m");
    expect(secondsToJiraTimeSpent(900)).toBe("15m");
    expect(secondsToJiraTimeSpent(3601)).toBe("1h 1s");
  });

  it("rejects zero, negative, and tiny durations", () => {
    expect(() => hoursToSeconds(0)).toThrow(/greater than zero/);
    expect(() => hoursToSeconds(-2)).toThrow(/greater than zero/);
    expect(() => hoursToSeconds(0.0001)).toThrow(/whole seconds/);
  });
});
