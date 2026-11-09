import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { executeNormalTicket, inspectIssue, type WorkflowRuntime } from "@/services/workflow.service";
import type { ExecuteTicketInput } from "@/types/api";
import type { ExistingWorklog, JiraGateway } from "@/types/jira";
import { canonicalStatus, selectWorkflow, WORKFLOWS } from "@/workflows/normal.workflow";

const runtime: WorkflowRuntime = {
  timeZone: "Asia/Kolkata",
  worklogStartTime: "09:00:00",
};

function request(overrides: Partial<ExecuteTicketInput> = {}): ExecuteTicketInput {
  return {
    ticketKey: "PP3-3198",
    hours: 4,
    workDate: "2026-11-09",
    worklogComment: "Development and testing work",
    executeWorkflow: true,
    dryRun: false,
    ...overrides,
  };
}

function harness(options: {
  status: string;
  issueType?: string;
  blockAt?: string;
  timeoutOnTransition?: boolean;
  failWorklog?: boolean;
  existing?: ExistingWorklog[];
  missingIssue?: boolean;
}) {
  let status = options.status;
  const issueType = options.issueType ?? "Task";
  const calls = { transition: 0, worklog: 0, reads: 0 };
  const sequence = () => selectWorkflow(issueType, status)?.statuses ?? [];
  const gateway: JiraGateway = {
    async getIssue(key) {
      if (options.missingIssue) {
        throw new AppError(404, "Jira issue was not found or is not visible to the API user.");
      }
      return {
        key,
        summary: "Sample ticket",
        issueType,
        status,
        originalEstimate: null,
        timeSpent: null,
        remainingEstimate: null,
      };
    },
    async getTransitions() {
      const statuses = sequence();
      const index = statuses.indexOf(canonicalStatus(status));
      const next = statuses[index + 1];
      if (!next || next === options.blockAt) return [];
      return [{ id: String(100 + index + 1), name: `Move to ${next}`, toStatus: next }];
    },
    async transitionIssue() {
      calls.transition += 1;
      if (options.timeoutOnTransition) {
        throw new AppError(504, "timed out", { uncertain: true });
      }
      const statuses = sequence();
      const index = statuses.indexOf(canonicalStatus(status));
      status = statuses[index + 1];
    },
    async findWorklogsOnDate() {
      calls.reads += 1;
      return options.existing ?? [];
    },
    async addWorklog() {
      calls.worklog += 1;
      if (options.failWorklog) throw new AppError(400, "Worklog rejected.");
      return { id: "9001" };
    },
  };
  return { gateway, calls, current: () => status };
}

describe("normal workflow execution", () => {
  it("walks from the first status to the end, then logs work once", async () => {
    const fake = harness({ status: WORKFLOWS.NORMAL.statuses[0] });
    const result = await executeNormalTicket(request(), fake.gateway, runtime);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.workflow).toBe("NORMAL");
    expect(fake.calls.transition).toBe(WORKFLOWS.NORMAL.statuses.length - 1);
    expect(fake.calls.worklog).toBe(1);
    expect(result.body.workflowExecution.finalStatus).toBe(
      WORKFLOWS.NORMAL.statuses[WORKFLOWS.NORMAL.statuses.length - 1],
    );
    expect(result.body.workflowExecution.completedSteps[0]?.transitionId).toBe("101");
    expect(result.body.worklog).toMatchObject({
      jiraWorklogId: "9001",
      timeSpentSeconds: 14400,
      started: "2026-11-09T09:00:00.000+0530",
    });
  });

  it("moves toward the confirmed next status without logging hours", async () => {
    const fake = harness({ status: "In Progress" });
    const input = request({ targetStatus: "Done codded & Merged" });
    delete input.hours;
    delete input.workDate;
    delete input.worklogComment;
    const result = await executeNormalTicket(input, fake.gateway, runtime);

    expect(result.status).toBe(200);
    expect(result.body.workflowExecution.completedSteps.map((step) => step.status)).toEqual([
      "DONE - CODED & MERGED",
    ]);
    expect(result.body.worklog.skipped).toBe(true);
    expect(fake.calls.worklog).toBe(0);
    expect(fake.current()).toBe("DONE - CODED & MERGED");
  });

  it("enters the workflow from Marked for Development and stops at In Progress", async () => {
    const fake = harness({ status: "Marked for Development" });
    const result = await executeNormalTicket(
      request({ targetStatus: "In progres", hours: 2, workDate: "2026-11-10" }),
      fake.gateway,
      runtime,
    );

    expect(result.status).toBe(200);
    expect(result.body.workflowExecution.completedSteps.map((step) => step.status)).toEqual([
      "In Progress",
    ]);
    expect(fake.calls.transition).toBe(1);
    expect(fake.calls.worklog).toBe(1);
    expect(fake.current()).toBe("In Progress");
  });

  it("continues from an intermediate status instead of restarting", async () => {
    const fake = harness({ status: "Build created - Dev. Env" });
    const result = await executeNormalTicket(
      request({ targetStatus: "Testing Initiated - Dev. Env" }),
      fake.gateway,
      runtime,
    );

    expect(result.body.workflowExecution.completedSteps.map((step) => step.status)).toEqual([
      "Build Deployed - Dev. Env.",
      "Under Testing - DEV. ENV",
    ]);
    expect(fake.calls.transition).toBe(2);
    expect(result.body.workflowExecution.completedSteps[0]?.transitionId).toBe("104");
  });

  it("treats the final status as a workflow no-op and still logs work", async () => {
    const fake = harness({ status: WORKFLOWS.NORMAL.statuses.at(-1)! });
    const result = await executeNormalTicket(request(), fake.gateway, runtime);

    expect(result.body.workflowExecution.noop).toBe(true);
    expect(result.body.workflowExecution.completedSteps).toEqual([]);
    expect(fake.calls.transition).toBe(0);
    expect(fake.calls.worklog).toBe(1);
  });

  it("stops when the next transition is unavailable and does not log work", async () => {
    const fake = harness({
      status: "Marked for Development",
      blockAt: "In Progress",
    });
    const result = await executeNormalTicket(request(), fake.gateway, runtime);

    expect(result.status).toBe(409);
    expect(result.body.success).toBe(false);
    expect(result.body.workflowExecution.failedAt).toBe("In Progress");
    expect(result.body.workflowExecution.currentStatus).toBe("Marked for Development");
    expect(fake.calls.transition).toBe(0);
    expect(fake.calls.worklog).toBe(0);
    expect(fake.current()).toBe("Marked for Development");
  });

  it("does not move backward or start an unknown status", async () => {
    const backwards = harness({ status: "Live - Dev. Env" });
    const rejected = await executeNormalTicket(
      request({ targetStatus: "In progres" }),
      backwards.gateway,
      runtime,
    );
    expect(rejected.status).toBe(409);
    expect(backwards.calls.transition).toBe(0);
    expect(backwards.calls.worklog).toBe(0);

    const unknown = harness({ status: "Bug locked" });
    const ineligible = await executeNormalTicket(request(), unknown.gateway, runtime);
    expect(ineligible.status).toBe(409);
    expect(ineligible.body.workflowExecution.error).toMatch(/not part of a configured workflow/);
    expect(unknown.calls.worklog).toBe(0);
  });

  it("previews the next step without changing Jira", async () => {
    const fake = harness({ status: "Marked for Development" });
    const result = await executeNormalTicket(request({ dryRun: true }), fake.gateway, runtime);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.workflowExecution.verifiedNextStep).toBe("In Progress");
    expect(result.body.workflowExecution.plannedSteps).toHaveLength(WORKFLOWS.NORMAL.statuses.length - 1);
    expect(result.body.workflowExecution.limitation).toMatch(/does not prove the rest/);
    expect(result.body.worklog.wouldCreate).toBe(true);
    expect(fake.calls.transition).toBe(0);
    expect(fake.calls.worklog).toBe(0);
  });

  it("does not create a second identical worklog", async () => {
    const fake = harness({
      status: WORKFLOWS.NORMAL.statuses.at(-1)!,
      existing: [
        {
          id: "555",
          started: "2026-11-09T09:00:00.000+0530",
          timeSpentSeconds: 14400,
          commentText: "Development and testing work",
        },
      ],
    });
    const result = await executeNormalTicket(request(), fake.gateway, runtime);

    expect(result.body.success).toBe(true);
    expect(result.body.worklog.reason).toBe("matching_worklog_exists");
    expect(result.body.worklog.jiraWorklogId).toBe("555");
    expect(fake.calls.worklog).toBe(0);
  });

  it("keeps a successful workflow when the worklog fails", async () => {
    const fake = harness({ status: "Build Created - STAGE ENV.", failWorklog: true });
    const result = await executeNormalTicket(
      request({ targetStatus: "Build Deployed - Stage ENV." }),
      fake.gateway,
      runtime,
    );

    expect(result.status).toBe(502);
    expect(result.body.workflowExecution.success).toBe(true);
    expect(result.body.worklog.success).toBe(false);
    expect(fake.calls.transition).toBe(1);
  });

  it("does not log work when a transition times out", async () => {
    const fake = harness({ status: "Marked for Development", timeoutOnTransition: true });
    const result = await executeNormalTicket(request(), fake.gateway, runtime);

    expect(result.status).toBe(504);
    expect(result.body.workflowExecution.uncertain).toBe(true);
    expect(fake.calls.transition).toBe(1);
    expect(fake.calls.worklog).toBe(0);
  });

  it("can log work without running the workflow", async () => {
    const fake = harness({ status: "Bug locked" });
    const result = await executeNormalTicket(
      request({ executeWorkflow: false, hours: 1.5 }),
      fake.gateway,
      runtime,
    );

    expect(result.body.workflowExecution.skipped).toBe(true);
    expect(result.body.worklog.timeSpent).toBe("1h 30m");
    expect(fake.calls.transition).toBe(0);
    expect(fake.calls.worklog).toBe(1);
  });

  it("does not touch Jira when the issue cannot be read", async () => {
    const fake = harness({ status: "Marked for Development", missingIssue: true });
    await expect(executeNormalTicket(request(), fake.gateway, runtime)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(fake.calls.transition).toBe(0);
    expect(fake.calls.worklog).toBe(0);
  });

  it("applies every status from Marked for Development through the chosen last stop", async () => {
    const fake = harness({ status: "Marked for Development" });
    const input = request({ targetStatus: "Build Deployed - Stage ENV." });
    delete input.hours;
    delete input.workDate;
    const result = await executeNormalTicket(input, fake.gateway, runtime);

    expect(result.status).toBe(200);
    expect(result.body.workflowExecution.completedSteps.map((step) => step.status)).toEqual(
      WORKFLOWS.NORMAL.statuses.slice(1),
    );
    expect(fake.calls.transition).toBe(WORKFLOWS.NORMAL.statuses.length - 1);
    expect(fake.current()).toBe("Build Deployed - Stage ENV.");
  });

  it("moves from Under Testing to Testing Completed, using the destination status", async () => {
    let status = "Under Testing - DEV. ENV";
    const gateway = {
      async getIssue(key: string) {
        return {
          key,
          summary: "Sample ticket",
          issueType: "Task",
          status,
          originalEstimate: null,
          timeSpent: null,
          remainingEstimate: null,
        };
      },
      async getTransitions() {
        return [
          {
            id: "121",
            name: "Testing Completed - DEV.",
            toStatus: "Testing Completed - DEV. ENV",
          },
        ];
      },
      async transitionIssue() {
        status = "Testing Completed - DEV. ENV";
      },
      async findWorklogsOnDate() {
        return [];
      },
      async addWorklog() {
        return { id: "1" };
      },
    };
    const input = request({ targetStatus: "Testing Completed - Dev. Env" });
    delete input.hours;
    delete input.workDate;
    const result = await executeNormalTicket(input, gateway, runtime);

    expect(result.status).toBe(200);
    expect(result.body.workflowExecution.completedSteps).toEqual([
      {
        status: "Testing Completed - DEV. ENV",
        success: true,
        transitionId: "121",
        transitionName: "Testing Completed - DEV.",
      },
    ]);
  });

  it("moves from Build Deployed to Under Testing, not the transition name", async () => {
    let status = "Build Deployed - Dev. Env.";
    const gateway = {
      async getIssue(key: string) {
        return {
          key,
          summary: "Sample ticket",
          issueType: "Task",
          status,
          originalEstimate: null,
          timeSpent: null,
          remainingEstimate: null,
        };
      },
      async getTransitions() {
        return [
          {
            id: "91",
            name: "Testing Initiated - DEV.",
            toStatus: "Under Testing - DEV. ENV",
          },
        ];
      },
      async transitionIssue() {
        status = "Under Testing - DEV. ENV";
      },
      async findWorklogsOnDate() {
        return [];
      },
      async addWorklog() {
        return { id: "1" };
      },
    };
    const input = request({ targetStatus: "Testing Initiated - DEV." });
    delete input.hours;
    delete input.workDate;
    const result = await executeNormalTicket(input, gateway, runtime);

    expect(result.status).toBe(200);
    expect(result.body.workflowExecution.completedSteps).toEqual([
      {
        status: "Under Testing - DEV. ENV",
        success: true,
        transitionId: "91",
        transitionName: "Testing Initiated - DEV.",
      },
    ]);
    expect(status).toBe("Under Testing - DEV. ENV");
  });

  it("uses the confirmed Build Created status after DONE - CODED & MERGED", async () => {
    const fake = harness({ status: "DONE - CODED & MERGED" });
    const result = await executeNormalTicket(
      request({ targetStatus: "Build created - Dev. Env", hours: undefined, workDate: undefined }),
      fake.gateway,
      runtime,
    );

    expect(result.status).toBe(200);
    expect(result.body.workflowExecution.completedSteps.map((step) => step.status)).toEqual([
      "Build Created - Dev. Env",
    ]);
    expect(fake.current()).toBe("Build Created - Dev. Env");
  });

  it("moves a bug from BUG LOGGED to Re-Open and then into development", async () => {
    const fake = harness({ status: "BUG LOGGED", issueType: "Bug" });
    const result = await executeNormalTicket(
      request({ targetStatus: "In Progress", hours: undefined, workDate: undefined }),
      fake.gateway,
      runtime,
    );

    expect(result.status).toBe(200);
    expect(result.body.workflow).toBe("BUG_LOGGED");
    expect(result.body.workflowExecution.completedSteps.map((step) => step.status)).toEqual([
      "Re - Open",
      "In Progress",
    ]);
    expect(result.body.workflowExecution.completedSteps.map((step) => step.status)).not.toContain(
      "Marked for Development",
    );
  });

  it("continues a reopen from Re-Open into the development statuses", async () => {
    const fake = harness({ status: "Re - Open", issueType: "Task" });
    const result = await executeNormalTicket(
      request({ targetStatus: "In Progress", hours: undefined, workDate: undefined }),
      fake.gateway,
      runtime,
    );

    expect(result.body.workflow).toBe("REOPEN");
    expect(result.body.workflowExecution.completedSteps.map((step) => step.status)).toEqual([
      "In Progress",
    ]);
  });

  it("lists only statuses after the current one when the ticket is fetched", async () => {
    const fake = harness({ status: "DONE - CODED & MERGED" });
    const inspected = await inspectIssue("PP3-3174", fake.gateway);

    expect(inspected.workflow).toBe("NORMAL");
    expect(inspected.currentStatus).toBe("DONE - CODED & MERGED");
    expect(inspected.nextStatuses[0]).toBe("Build Created - Dev. Env");
    expect(inspected.nextStatuses).not.toContain("In Progress");
    expect(inspected.nextStatuses).not.toContain("DONE - CODED & MERGED");
  });
});
