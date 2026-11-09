import { hoursToSeconds, secondsToJiraTimeSpent } from "@/lib/duration";
import { AppError } from "@/lib/errors";
import {
  addCalendarDays,
  assertValidWorkDate,
  calendarDateInTimeZone,
  formatJiraStarted,
  zonedWallTimeToUtcMs,
} from "@/lib/time";
import type {
  ExecuteResponse,
  ExecuteTicketInput,
  WorkflowExecutionResult,
  WorkflowStepResult,
  WorklogResult,
} from "@/types/api";
import type { AvailableTransition, IssueSnapshot, JiraGateway } from "@/types/jira";
import {
  canonicalStatus,
  DRY_RUN_LIMITATION,
  selectWorkflow,
  statusesAfter,
  WORKLOG_POLICY,
  type WorkflowDefinition,
  type WorkflowKey,
} from "@/workflows/normal.workflow";

export type WorkflowRuntime = {
  timeZone: string;
  worklogStartTime: string;
};

type PreparedWorklog = {
  seconds: number;
  timeSpent: string;
  started: string;
  startedAfterMs: number;
  startedBeforeMs: number;
  comment: string;
};

export async function executeNormalTicket(
  input: ExecuteTicketInput,
  gateway: JiraGateway,
  runtime: WorkflowRuntime,
): Promise<{ status: number; body: ExecuteResponse }> {
  const prepared =
    input.hours !== undefined && input.workDate
      ? prepareWorklog({ ...input, hours: input.hours, workDate: input.workDate }, runtime)
      : null;
  const issue = await gateway.getIssue(input.ticketKey);
  const workflow = selectWorkflow(issue.issueType, issue.status);

  if (!input.executeWorkflow) {
    const worklog = await resolveWorklog(input, gateway, runtime, prepared);
    const body = buildResponse({
      input,
      issue,
      workflow,
      currentStatus: issue.status,
      worklog,
      workflowExecution: {
        success: true,
        completedSteps: [],
        skipped: true,
        currentStatus: issue.status,
        finalStatus: issue.status,
        message: "Workflow execution was not requested.",
      },
    });
    return { status: httpStatus(body), body };
  }

  const plan = locateRemainingSteps(workflow, issue.issueType, issue.status, input.targetStatus);
  if (!plan.ok) {
    const transitions = await safeTransitions(gateway, input.ticketKey);
    const body = buildResponse({
      input,
      issue,
      workflow,
      currentStatus: issue.status,
      worklog: heldWorklog(
        input,
        prepared,
        "Worklog was not created because the issue is not eligible for this workflow step.",
      ),
      workflowExecution: {
        success: false,
        completedSteps: [],
        currentStatus: issue.status,
        ...(transitions ? { availableTransitions: transitions.map(describeTransition) } : {}),
        error: plan.error,
      },
    });
    return { status: 409, body };
  }

  if (input.dryRun) {
    return dryRun(input, gateway, runtime, issue, plan.remaining, prepared);
  }

  const execution = await runTransitions(input, gateway, issue, plan.remaining);
  if (!execution.workflowExecution.success) {
    const body = buildResponse({
      input,
      issue,
      workflow,
      currentStatus: execution.currentStatus,
      worklog: heldWorklog(
        input,
        prepared,
        execution.workflowExecution.uncertain
          ? "Worklog was not created because the workflow result is uncertain. Verify the issue before retrying."
          : "Worklog was not created because the workflow did not finish.",
      ),
      workflowExecution: execution.workflowExecution,
    });
    return { status: httpStatus(body), body };
  }

  let worklog: WorklogResult;
  try {
    worklog = await resolveWorklog(input, gateway, runtime, prepared);
  } catch (error) {
    const logged = loggedInput(input);
    worklog =
      prepared && logged ? worklogFromError(logged, prepared, error) : notRequestedWorklog();
  }

  const body = buildResponse({
    input,
    issue,
    workflow,
    currentStatus: execution.currentStatus,
    worklog,
    workflowExecution: execution.workflowExecution,
  });
  return { status: httpStatus(body), body };
}

export async function inspectIssue(ticketKey: string, gateway: JiraGateway) {
  const issue = await gateway.getIssue(ticketKey);
  const transitions = await gateway.getTransitions(ticketKey);
  const workflow = selectWorkflow(issue.issueType, issue.status);
  const index = workflow ? workflow.statuses.indexOf(canonicalStatus(issue.status)) : -1;
  return {
    ticketKey: issue.key,
    summary: issue.summary,
    issueType: issue.issueType,
    currentStatus: issue.status,
    originalEstimate: issue.originalEstimate,
    timeSpent: issue.timeSpent,
    remainingEstimate: issue.remainingEstimate,
    workflow: workflow?.key ?? null,
    workflowLabel: workflow?.label ?? null,
    statusInWorkflow: index >= 0,
    workflowIndex: index >= 0 ? index : null,
    workflowStatuses: workflow?.statuses ?? [],
    nextStatuses: workflow ? statusesAfter(workflow, issue.status) : [],
    transitions: transitions.map((transition) => ({
      id: transition.id,
      name: transition.name,
      toStatus: transition.toStatus,
    })),
    note: "Read only. No transition or worklog was created.",
  };
}

async function dryRun(
  input: ExecuteTicketInput,
  gateway: JiraGateway,
  runtime: WorkflowRuntime,
  issue: IssueSnapshot,
  remaining: string[],
  prepared: PreparedWorklog | null,
): Promise<{ status: number; body: ExecuteResponse }> {
  let verifiedNextStep: string | null = null;
  let availableTransitions: string[] | undefined;
  let blocker: string | undefined;
  let failedAt: string | undefined;

  if (remaining.length > 0) {
    const transitions = await gateway.getTransitions(input.ticketKey);
    availableTransitions = transitions.map(describeTransition);
    const match = transitions.find(
      (transition) => canonicalStatus(transition.toStatus) === remaining[0],
    );
    if (!match) {
      blocker = "Requested transition is not currently available.";
      failedAt = remaining[0];
    } else {
      verifiedNextStep = remaining[0];
    }
  }

  const workflowBlocked = Boolean(blocker);
  const worklog = workflowBlocked
    ? heldWorklog(
        input,
        prepared,
        "Worklog would not be created because the next workflow transition is not available.",
      )
    : await resolveWorklog(input, gateway, runtime, prepared);

  const workflowExecution: WorkflowExecutionResult = {
    success: !workflowBlocked,
    completedSteps: [],
    currentStatus: issue.status,
    ...(remaining.length === 0 ? { finalStatus: issue.status } : {}),
    plannedSteps: remaining,
    verifiedNextStep,
    ...(availableTransitions ? { availableTransitions } : {}),
    ...(failedAt ? { failedAt } : {}),
    ...(remaining.length === 0
      ? {
          noop: true,
          message: "Issue is already at the target status. No transition is needed.",
        }
      : {}),
    ...(remaining.length > 1 ? { limitation: DRY_RUN_LIMITATION } : {}),
    ...(blocker ? { error: blocker } : {}),
  };

  const body = buildResponse({
    input,
    issue,
    workflow: selectWorkflow(issue.issueType, issue.status),
    currentStatus: issue.status,
    worklog,
    workflowExecution,
  });
  return { status: httpStatus(body), body };
}

async function runTransitions(
  input: ExecuteTicketInput,
  gateway: JiraGateway,
  issue: IssueSnapshot,
  remaining: string[],
): Promise<{ currentStatus: string; workflowExecution: WorkflowExecutionResult }> {
  const completedSteps: WorkflowStepResult[] = [];
  let current = issue;

  if (remaining.length === 0) {
    return {
      currentStatus: current.status,
      workflowExecution: {
        success: true,
        completedSteps,
        finalStatus: current.status,
        currentStatus: current.status,
        noop: true,
        message: "Issue is already at the target status. No transition was needed.",
      },
    };
  }

  for (const expected of remaining) {
    let transitions: AvailableTransition[];
    try {
      transitions = await gateway.getTransitions(input.ticketKey);
    } catch (error) {
      if (shouldPropagate(error, completedSteps.length)) throw error;
      return stopped(current.status, completedSteps, expected, error, undefined);
    }

    const match = transitions.find((transition) => canonicalStatus(transition.toStatus) === expected);
    if (!match) {
      return {
        currentStatus: current.status,
        workflowExecution: {
          success: false,
          completedSteps,
          failedAt: expected,
          currentStatus: current.status,
          availableTransitions: transitions.map(describeTransition),
          error: "Requested transition is not currently available.",
        },
      };
    }

    try {
      await gateway.transitionIssue(input.ticketKey, match.id);
    } catch (error) {
      if (shouldPropagate(error, completedSteps.length)) throw error;
      return stopped(
        current.status,
        completedSteps,
        expected,
        error,
        transitions.map(describeTransition),
      );
    }

    try {
      current = await gateway.getIssue(input.ticketKey);
    } catch (error) {
      if (shouldPropagate(error, completedSteps.length)) throw error;
      return stopped(current.status, completedSteps, expected, error, undefined, true);
    }

    if (canonicalStatus(current.status) !== expected) {
      return {
        currentStatus: current.status,
        workflowExecution: {
          success: false,
          completedSteps,
          failedAt: expected,
          currentStatus: current.status,
          uncertain: true,
          error: `Jira accepted transition ${match.id}, but the issue status is "${current.status}" instead of "${expected}". Stopped. Verify the issue before retrying.`,
        },
      };
    }

    completedSteps.push({
      status: expected,
      success: true,
      transitionId: match.id,
      transitionName: match.name,
    });
  }

  return {
    currentStatus: current.status,
    workflowExecution: {
      success: true,
      completedSteps,
      finalStatus: current.status,
      currentStatus: current.status,
    },
  };
}

function stopped(
  currentStatus: string,
  completedSteps: WorkflowStepResult[],
  expected: string,
  error: unknown,
  availableTransitions: string[] | undefined,
  forceUncertain = false,
): { currentStatus: string; workflowExecution: WorkflowExecutionResult } {
  const appError = error instanceof AppError ? error : undefined;
  const uncertain = forceUncertain || Boolean(appError?.uncertain);
  return {
    currentStatus,
    workflowExecution: {
      success: false,
      completedSteps,
      failedAt: expected,
      currentStatus,
      uncertain,
      ...(availableTransitions ? { availableTransitions } : {}),
      error: appError?.message ?? "The workflow stopped because Jira could not be updated.",
    },
  };
}

function locateRemainingSteps(
  workflow: WorkflowDefinition | null,
  issueType: string,
  currentStatus: string,
  targetStatus: string | undefined,
): { ok: true; remaining: string[] } | { ok: false; error: string } {
  const current = canonicalStatus(currentStatus);
  if (!workflow) {
    return {
      ok: false,
      error: `Current status "${currentStatus}" on this ${issueType} is not part of a configured workflow. Configured starts are BUG LOGGED, Re - Open, and Marked for Development. The ticket was not moved.`,
    };
  }

  const currentIndex = workflow.statuses.indexOf(current);
  if (currentIndex === -1) {
    return {
      ok: false,
      error: `Current status "${currentStatus}" on this ${issueType} is not on the ${workflow.label} workflow. The ticket was not moved.`,
    };
  }
  const target = targetStatus ? canonicalStatus(targetStatus) : undefined;
  const targetIndex = target ? workflow.statuses.indexOf(target) : workflow.statuses.length - 1;
  if (target && targetIndex === -1) {
    return {
      ok: false,
      error: `Target status "${target}" is not on the ${workflow.label} workflow for this ${issueType}.`,
    };
  }
  if (targetIndex < currentIndex) {
    return {
      ok: false,
      error: `Target status "${target}" is before the current status "${current}". This workflow does not move tickets backwards.`,
    };
  }

  return {
    ok: true,
    remaining: workflow.statuses.slice(currentIndex + 1, targetIndex + 1),
  };
}

type LoggedInput = ExecuteTicketInput & { hours: number; workDate: string };

function loggedInput(input: ExecuteTicketInput): LoggedInput | null {
  if (input.hours === undefined || input.workDate === undefined) return null;
  return { ...input, hours: input.hours, workDate: input.workDate };
}

async function createOrPreviewWorklog(
  input: LoggedInput,
  gateway: JiraGateway,
  runtime: WorkflowRuntime,
  prepared: PreparedWorklog,
): Promise<WorklogResult> {
  let existing;
  try {
    existing = await gateway.findWorklogsOnDate(input.ticketKey, {
      startedAfterMs: prepared.startedAfterMs,
      startedBeforeMs: prepared.startedBeforeMs,
    });
  } catch (error) {
    if (error instanceof AppError && !error.uncertain && error.statusCode < 500 && error.statusCode !== 429) {
      throw error;
    }
    return {
      ...worklogBase(input, prepared),
      success: false,
      skipped: true,
      uncertain: true,
      error:
        "Could not read existing worklogs, so no worklog was created. Verify Jira before retrying.",
    };
  }

  const match = existing.find((worklog) => {
    if (worklog.timeSpentSeconds !== prepared.seconds) return false;
    if (worklog.commentText.trim() !== prepared.comment) return false;
    try {
      return calendarDateInTimeZone(worklog.started, runtime.timeZone) === input.workDate;
    } catch {
      return false;
    }
  });

  if (match) {
    return {
      ...worklogBase(input, prepared),
      success: true,
      skipped: true,
      wouldCreate: false,
      jiraWorklogId: match.id,
      reason: "matching_worklog_exists",
      message:
        "A worklog with the same date, duration, and comment already exists. It was not created again.",
    };
  }

  if (input.dryRun) {
    return {
      ...worklogBase(input, prepared),
      success: true,
      wouldCreate: true,
    };
  }

  const created = await gateway.addWorklog(input.ticketKey, {
    timeSpentSeconds: prepared.seconds,
    started: prepared.started,
    ...(prepared.comment ? { comment: prepared.comment } : {}),
  });
  return {
    ...worklogBase(input, prepared),
    success: true,
    jiraWorklogId: created.id,
  };
}

function prepareWorklog(
  input: LoggedInput,
  runtime: WorkflowRuntime,
): PreparedWorklog {
  assertValidWorkDate(input.workDate);
  const seconds = hoursToSeconds(input.hours);
  const started = formatJiraStarted(input.workDate, runtime.worklogStartTime, runtime.timeZone);
  const startedAfterMs = zonedWallTimeToUtcMs(input.workDate, "00:00:00", runtime.timeZone);
  const startedBeforeMs = zonedWallTimeToUtcMs(
    addCalendarDays(input.workDate, 1),
    "00:00:00",
    runtime.timeZone,
  );
  return {
    seconds,
    timeSpent: secondsToJiraTimeSpent(seconds),
    started,
    startedAfterMs,
    startedBeforeMs,
    comment: input.worklogComment?.trim() ?? "",
  };
}

function notRequestedWorklog(): WorklogResult {
  return {
    success: true,
    skipped: true,
    message: "Hours were not requested, so no worklog was created.",
  };
}

function heldWorklog(
  input: ExecuteTicketInput,
  prepared: PreparedWorklog | null,
  error: string,
): WorklogResult {
  const logged = loggedInput(input);
  if (!prepared || !logged) return notRequestedWorklog();
  return skippedWorklog(logged, prepared, error);
}

async function resolveWorklog(
  input: ExecuteTicketInput,
  gateway: JiraGateway,
  runtime: WorkflowRuntime,
  prepared: PreparedWorklog | null,
): Promise<WorklogResult> {
  const logged = loggedInput(input);
  if (!prepared || !logged) return notRequestedWorklog();
  return createOrPreviewWorklog(logged, gateway, runtime, prepared);
}

function worklogBase(
  input: LoggedInput,
  prepared: PreparedWorklog,
): WorklogResult {
  return {
    success: true,
    hours: input.hours,
    workDate: input.workDate,
    timeSpent: prepared.timeSpent,
    timeSpentSeconds: prepared.seconds,
    started: prepared.started,
  };
}

function skippedWorklog(
  input: LoggedInput,
  prepared: PreparedWorklog,
  error: string,
): WorklogResult {
  return {
    ...worklogBase(input, prepared),
    success: false,
    skipped: true,
    wouldCreate: false,
    error,
  };
}

function worklogFromError(
  input: LoggedInput,
  prepared: PreparedWorklog,
  error: unknown,
): WorklogResult {
  const appError = error instanceof AppError ? error : undefined;
  return {
    ...worklogBase(input, prepared),
    success: false,
    uncertain: appError?.uncertain ?? false,
    error: appError?.message ?? "The worklog could not be created.",
  };
}

function buildResponse(args: {
  input: ExecuteTicketInput;
  issue: IssueSnapshot;
  workflow: WorkflowDefinition | null;
  currentStatus: string;
  worklog: WorklogResult;
  workflowExecution: WorkflowExecutionResult;
}): ExecuteResponse {
  const workflowSuccess = args.workflowExecution.success;
  const worklogSuccess = args.worklog.success;
  const workflowKey: WorkflowKey | null = args.workflow?.key ?? null;
  return {
    success: workflowSuccess && worklogSuccess,
    dryRun: args.input.dryRun,
    ticketKey: args.input.ticketKey,
    workflow: workflowKey,
    executionOrder: "workflow_then_worklog",
    worklogPolicy: args.input.executeWorkflow
      ? WORKLOG_POLICY.afterSuccessfulWorkflow
      : WORKLOG_POLICY.worklogOnly,
    issue: {
      summary: args.issue.summary,
      issueType: args.issue.issueType,
      currentStatus: args.currentStatus,
    },
    worklog: args.worklog,
    workflowExecution: args.workflowExecution,
  };
}

function httpStatus(body: ExecuteResponse): number {
  if (body.success) return 200;
  if (body.dryRun) return 200;
  if (body.workflowExecution.uncertain || body.worklog.uncertain) return 504;
  if (!body.workflowExecution.success) return 409;
  return 502;
}

function shouldPropagate(error: unknown, completedCount: number): boolean {
  if (completedCount > 0) return false;
  return (
    error instanceof AppError && [401, 403, 404, 429].includes(error.statusCode)
  );
}

function describeTransition(transition: AvailableTransition): string {
  if (transition.name === transition.toStatus) return transition.toStatus;
  return `${transition.toStatus} (via ${transition.name})`;
}

async function safeTransitions(
  gateway: JiraGateway,
  ticketKey: string,
): Promise<AvailableTransition[] | null> {
  try {
    return await gateway.getTransitions(ticketKey);
  } catch {
    return null;
  }
}
