import { describe, expect, it } from "vitest";
import { commentToText, textToAdf } from "@/lib/adf";
import { validateExecuteRequest } from "@/validators/ticket.validator";

describe("request validation", () => {
  it("normalizes a ticket key and applies defaults", () => {
    const input = validateExecuteRequest({
      ticketKey: " pp3-3198 ",
      hours: 4,
      workDate: "2026-11-09",
    });
    expect(input.ticketKey).toBe("PP3-3198");
    expect(input.executeWorkflow).toBe(true);
    const withoutHours = validateExecuteRequest({
      ticketKey: "PP3-3174",
      executeWorkflow: true,
    });
    expect(withoutHours.hours).toBeUndefined();
    expect(input.dryRun).toBe(false);
    expect(input.worklogComment).toBeUndefined();
  });

  it("rejects an impossible date, bad hours, and an unknown target", () => {
    expect(() =>
      validateExecuteRequest({ ticketKey: "PP3-3198", hours: 4, workDate: "2026-02-31" }),
    ).toThrow(/workDate/);
    expect(() =>
      validateExecuteRequest({ ticketKey: "PP3-3198", hours: 0, workDate: "2026-11-09" }),
    ).toThrow(/hours/);
    expect(() =>
      validateExecuteRequest({
        ticketKey: "PP3-3198",
        hours: 1.5,
        workDate: "2026-11-09",
        targetStatus: "Done",
      }),
    ).toThrow(/targetStatus/);
  });
});

describe("worklog comments", () => {
  it("round-trips comment text through Atlassian document format", () => {
    const adf = textToAdf("Development and testing work");
    expect(commentToText(adf)).toBe("Development and testing work");
  });
});
